import type { AnyTextAdapter, ModelMessage, StreamChunk } from "@tanstack/ai";
import { chat, maxIterations } from "@tanstack/ai";
import { createCodeMode } from "@tanstack/ai-code-mode";
import { createNodeIsolateDriver } from "@tanstack/ai-isolate-node";
import type { BasePayload } from "payload";
import { loggingMiddleware } from "./logger.js";
import { buildSchemaDescription, createPayloadTools } from "./tools.js";

const MAX_AGENT_ITERATIONS = 10;
const MAX_HISTORY_MESSAGES = 50;

export interface AgentConfig {
  /** TanStack AI text adapter (e.g. anthropicText('claude-haiku-4-5')) */
  adapter: AnyTextAdapter;
  /** Log agent activity to stdout (default: false) */
  debug?: boolean;
  /** Payload instance -- available after onInit */
  payload: BasePayload;
  /** Optional additional system prompt appended to the default */
  systemPrompt?: string;
}

export interface Agent {
  handleMessage: (threadId: string, text: string) => Promise<string>;
  handleMessageStream: (
    threadId: string,
    text: string
  ) => AsyncIterable<string>;
}

function extractStreamText(
  stream: AsyncIterable<StreamChunk>
): AsyncIterable<string> {
  return (async function* () {
    let hasOutput = false;

    for await (const chunk of stream) {
      if (chunk.type !== "TEXT_MESSAGE_CONTENT") {
        continue;
      }

      if (chunk.delta.length === 0) {
        continue;
      }

      if (!hasOutput && chunk.delta.trim().length === 0) {
        continue;
      }

      hasOutput = true;
      yield chunk.delta;
    }
  })();
}

export function createAgent(config: AgentConfig): Agent {
  const tools = createPayloadTools(config.payload);
  const driver = createNodeIsolateDriver();

  const { systemPrompt: codeModePrompt, tool: codeModeTool } = createCodeMode({
    driver,
    tools,
  });

  const schemaDescription = buildSchemaDescription(config.payload);

  const baseSystemPrompt = [
    "You are a Payload CMS assistant. Help users query and manage their content.",
    "",
    "Available collections:",
    schemaDescription,
    "",
    "Use the execute_typescript tool and call external_* functions to interact with Payload.",
    // "Do not narrate intermediate steps. Perform actions, then return only the final answer.",
    // "Use plain text responses suitable for chat apps.",
    config.systemPrompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const middleware = config.debug ? [loggingMiddleware] : [];
  const conversations = new Map<string, ModelMessage[]>();

  const getHistory = (threadId: string): ModelMessage[] => {
    const existing = conversations.get(threadId);

    if (existing) {
      return existing;
    }

    const created: ModelMessage[] = [];
    conversations.set(threadId, created);
    return created;
  };

  const trimHistory = (threadId: string, history: ModelMessage[]): void => {
    if (history.length <= MAX_HISTORY_MESSAGES) {
      return;
    }

    conversations.set(threadId, history.slice(-MAX_HISTORY_MESSAGES));
  };

  return {
    async handleMessage(threadId: string, text: string): Promise<string> {
      const history = getHistory(threadId);
      history.push({ role: "user", content: text });

      const response = await chat({
        adapter: config.adapter,
        agentLoopStrategy: maxIterations(MAX_AGENT_ITERATIONS),
        messages: history,
        middleware,
        stream: false,
        systemPrompts: [baseSystemPrompt, codeModePrompt],
        tools: [codeModeTool],
      });

      history.push({ role: "assistant", content: response });
      trimHistory(threadId, history);

      return response;
    },

    handleMessageStream(threadId: string, text: string): AsyncIterable<string> {
      const history = getHistory(threadId);
      history.push({ role: "user", content: text });

      const rawStream = chat({
        adapter: config.adapter,
        agentLoopStrategy: maxIterations(MAX_AGENT_ITERATIONS),
        messages: history,
        middleware,
        systemPrompts: [baseSystemPrompt, codeModePrompt],
        tools: [codeModeTool],
      }) as AsyncIterable<StreamChunk>;

      return (async function* () {
        let response = "";
        let completed = false;

        try {
          for await (const delta of extractStreamText(rawStream)) {
            response += delta;
            yield delta;
          }

          completed = true;
        } finally {
          if (completed) {
            history.push({ role: "assistant", content: response });
            trimHistory(threadId, history);
          }
        }
      })();
    },
  };
}
