import type {
  AnyTextAdapter,
  ChatMiddleware,
  ModelMessage,
} from "@tanstack/ai";
import { chat, maxIterations } from "@tanstack/ai";
import { createCodeMode } from "@tanstack/ai-code-mode";
import { createNodeIsolateDriver } from "@tanstack/ai-isolate-node";
import type { BasePayload } from "payload";
import { loggingMiddleware } from "./logger.js";
import { buildSchemaDescription, createPayloadTools } from "./tools.js";

const MAX_HISTORY_MESSAGES = 50;
const MAX_AGENT_ITERATIONS = 10;

export interface AgentConfig {
  /** TanStack AI text adapter (e.g. anthropicText('claude-haiku-4-5')) */
  adapter: AnyTextAdapter;
  /** Log agent activity to stdout (default: false) */
  debug?: boolean;
  /** Sandbox memory limit in MB (default: 128) */
  memoryLimit?: number;
  /** Additional middleware for the chat() call */
  middleware?: ChatMiddleware[];
  /** Payload instance -- available after onInit */
  payload: BasePayload;
  /** Optional additional system prompt appended to the default */
  systemPrompt?: string;
  /** Code Mode execution timeout in ms (default: 30000) */
  timeout?: number;
}

export interface Agent {
  handleMessage: (threadId: string, text: string) => Promise<string>;
}

export function createAgent(config: AgentConfig): Agent {
  const tools = createPayloadTools(config.payload);
  const driver = createNodeIsolateDriver();

  const { tool: codeModeTool, systemPrompt: codeModePrompt } = createCodeMode({
    driver,
    tools,
    timeout: config.timeout ?? 30_000,
    memoryLimit: config.memoryLimit ?? 128,
  });

  const schemaDescription = buildSchemaDescription(config.payload);

  const baseSystemPrompt = [
    "You are a Payload CMS assistant. You help users query and manage their content.",
    "",
    "Available collections:",
    schemaDescription,
    "",
    "Use the execute_typescript tool to write TypeScript that calls the external_* functions to interact with the CMS.",
    "Do not narrate your intermediate steps or thinking. Perform all actions silently, then respond with only the final result.",
    "You are responding in a chat app (Telegram, Slack, etc). Use plain text only. Do not use markdown syntax like **, __, `, or #. Use unicode bullets (•) for lists. Keep responses concise.",
    config.systemPrompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const middleware: ChatMiddleware[] = [];
  if (config.debug) {
    middleware.push(loggingMiddleware);
  }
  if (config.middleware) {
    middleware.push(...config.middleware);
  }

  const conversations = new Map<string, ModelMessage[]>();

  return {
    async handleMessage(threadId: string, text: string): Promise<string> {
      let history = conversations.get(threadId);
      if (!history) {
        history = [];
        conversations.set(threadId, history);
      }

      history.push({ role: "user", content: text });

      const response = await chat({
        adapter: config.adapter,
        systemPrompts: [baseSystemPrompt, codeModePrompt],
        tools: [codeModeTool],
        messages: history,
        agentLoopStrategy: maxIterations(MAX_AGENT_ITERATIONS),
        stream: false,
        middleware,
      });

      history.push({ role: "assistant", content: response });

      if (history.length > MAX_HISTORY_MESSAGES) {
        const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
        conversations.set(threadId, trimmed);
      }

      return response;
    },
  };
}
