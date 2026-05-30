import type { AnyTextAdapter, StreamChunk } from "@tanstack/ai";
import { chat, maxIterations } from "@tanstack/ai";
import { createCodeMode } from "@tanstack/ai-code-mode";
import { createNodeIsolateDriver } from "@tanstack/ai-isolate-node";
import type { StateAdapter } from "chat";
import type { BasePayload } from "payload";
import { createConversationHistory } from "./conversation-history.js";
import { loggingMiddleware } from "./logger.js";
import {
  buildSchemaDescription,
  createPayloadTools,
  type RichTextMode,
} from "./tools.js";

const MAX_AGENT_ITERATIONS = 10;
const MIN_STREAM_VISIBLE_CHARS = 5;
const DEFAULT_MAX_TOKENS = 4096;
const TOKEN_LIMIT_NOTICE =
  "\n\nResponse was truncated because the model hit its token limit. Ask me to continue from where I stopped.";

export interface AgentConfig {
  /** TanStack AI text adapter (e.g. anthropicText('claude-haiku-4-5')) */
  adapter: AnyTextAdapter;
  /** Log agent activity to stdout (default: false) */
  debug?: boolean;
  /** Max output tokens per model call (default: 4096) */
  maxTokens?: number;
  /** Payload instance -- available after onInit */
  payload: BasePayload;
  /** How richText fields are exchanged with the agent (default: 'markdown') */
  richText?: RichTextMode;
  /** State adapter that backs per-thread conversation history */
  state: StateAdapter;
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

const MAX_TOKEN_LIMIT_RE = /maximum token limit/i;
const MAX_TOKENS_RE = /max(?:imum)? tokens?/i;
const TOKEN_LIMIT_RE = /token limit/i;
const WHITESPACE_RE = /\s/g;

interface ExtractState {
  buffered: string;
  hasEmitted: boolean;
}

interface RunErrorOutcome {
  done: boolean;
  emit?: string;
  error?: Error;
}

function countVisibleChars(text: string): number {
  return text.replace(WHITESPACE_RE, "").length;
}

function getRunErrorMessage(chunk: StreamChunk): null | string {
  if (chunk.type !== "RUN_ERROR") {
    return null;
  }

  // As of @tanstack/ai 0.11+, the error message lives on the top-level
  // `message` field. The nested `error` object is deprecated and stripped by
  // the built-in stripToSpecMiddleware before chunks reach the consumer, so it
  // is only kept here as a defensive fallback.
  return chunk.message || chunk.error?.message || "Unknown model stream error";
}

function isTokenLimitError(message: string): boolean {
  return (
    MAX_TOKEN_LIMIT_RE.test(message) ||
    MAX_TOKENS_RE.test(message) ||
    TOKEN_LIMIT_RE.test(message)
  );
}

function getStreamTextDelta(chunk: StreamChunk): null | string {
  if (chunk.type !== "TEXT_MESSAGE_CONTENT") {
    return null;
  }

  return chunk.delta.length > 0 ? chunk.delta : null;
}

function getInitialBufferedOutput(buffered: string): null | string {
  if (countVisibleChars(buffered) < MIN_STREAM_VISIBLE_CHARS) {
    return null;
  }

  const output = buffered.trimStart();
  return output.length > 0 ? output : null;
}

function getFinalBufferedOutput(buffered: string): null | string {
  const output = buffered.trim();
  return output.length > 0 ? output : null;
}

function handleRunError(
  state: ExtractState,
  runError: string
): RunErrorOutcome {
  if (!state.hasEmitted) {
    const bufferedOutput = getFinalBufferedOutput(state.buffered);

    if (bufferedOutput) {
      state.hasEmitted = true;
      state.buffered = "";

      if (isTokenLimitError(runError)) {
        return {
          done: true,
          emit: `${bufferedOutput}${TOKEN_LIMIT_NOTICE}`,
        };
      }

      return { done: false, emit: bufferedOutput };
    }
  }

  if (state.hasEmitted && isTokenLimitError(runError)) {
    return { done: true, emit: TOKEN_LIMIT_NOTICE };
  }

  return { done: true, error: new Error(`Model stream error: ${runError}`) };
}

function handleTextDelta(state: ExtractState, delta: string): null | string {
  if (state.hasEmitted) {
    return delta;
  }

  state.buffered += delta;

  const initialOutput = getInitialBufferedOutput(state.buffered);
  if (!initialOutput) {
    return null;
  }

  state.hasEmitted = true;
  state.buffered = "";
  return initialOutput;
}

interface ChunkOutcome {
  done: boolean;
  emit?: string;
  error?: Error;
}

function processStreamChunk(
  state: ExtractState,
  chunk: StreamChunk
): ChunkOutcome {
  const runError = getRunErrorMessage(chunk);

  if (runError) {
    return handleRunError(state, runError);
  }

  const delta = getStreamTextDelta(chunk);
  if (!delta) {
    return { done: false };
  }

  const emit = handleTextDelta(state, delta);
  if (!emit) {
    return { done: false };
  }

  return { done: false, emit };
}

function getFinalOutcome(state: ExtractState): ChunkOutcome {
  if (state.hasEmitted) {
    return { done: true };
  }

  const emit = getFinalBufferedOutput(state.buffered);
  if (!emit) {
    return { done: true };
  }

  return { done: true, emit };
}

async function* streamTextChunks(
  stream: AsyncIterable<StreamChunk>
): AsyncIterable<string> {
  const state: ExtractState = { buffered: "", hasEmitted: false };

  for await (const chunk of stream) {
    const outcome = processStreamChunk(state, chunk);

    if (outcome.emit) {
      yield outcome.emit;
    }

    if (outcome.error) {
      throw outcome.error;
    }

    if (outcome.done) {
      return;
    }
  }

  const finalOutcome = getFinalOutcome(state);

  if (finalOutcome.emit) {
    yield finalOutcome.emit;
  }
}

function extractStreamText(
  stream: AsyncIterable<StreamChunk>
): AsyncIterable<string> {
  return streamTextChunks(stream);
}

export function createAgent(config: AgentConfig): Agent {
  const richTextMode = config.richText ?? "markdown";
  const tools = createPayloadTools(config.payload, richTextMode);
  const driver = createNodeIsolateDriver();

  const { systemPrompt: codeModePrompt, tool: codeModeTool } = createCodeMode({
    driver,
    tools,
  });

  const schemaDescription = buildSchemaDescription(
    config.payload,
    richTextMode
  );

  const richTextGuidance =
    richTextMode === "markdown"
      ? "Rich text fields (type richText) use Markdown. Pass a Markdown string when creating or updating them, and you will receive Markdown when reading. Use standard Markdown (headings, **bold**, *italic*, lists, [links](url)) and never indent Markdown lines."
      : "";

  const localization = config.payload.config.localization;
  const localeGuidance = localization
    ? [
        `Localization is enabled. Locales: ${localization.localeCodes.join(", ")} (default: ${localization.defaultLocale}). Fields marked "localized" hold a separate value per locale.`,
        "To translate content: read with locale 'all' and fallbackLocale 'false' to see every locale's values and find the missing ones, then translate and write ONE locale per call (set locale to the target code and pass plain scalar values -- never a per-locale object).",
      ].join("\n")
    : "";

  const baseSystemPrompt = [
    "You are a Payload CMS assistant. Help users query and manage their content.",
    "",
    "Available collections:",
    schemaDescription,
    "",
    "Use the execute_typescript tool and call external_* functions to interact with Payload.",
    "When calling find/findByID, use the select option to fetch only fields you need.",
    richTextGuidance,
    localeGuidance,
    "Keep responses concise and practical.",
    config.systemPrompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  // Both system prompts are static across every turn in a conversation, so we
  // attach an Anthropic prompt-caching breakpoint to the final block. A
  // breakpoint caches the entire prefix up to and including it, so this caches
  // baseSystemPrompt + codeModePrompt. Providers without prompt caching ignore
  // the metadata -- it is dropped before reaching the wire (see SystemPrompt).
  const systemPrompts = [
    baseSystemPrompt,
    {
      content: codeModePrompt,
      metadata: { cache_control: { type: "ephemeral" } },
    },
  ];

  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const middleware = config.debug ? [loggingMiddleware] : [];
  const history = createConversationHistory(config.state);

  return {
    async handleMessage(threadId: string, text: string): Promise<string> {
      await history.append(threadId, { role: "user", content: text });
      const messages = await history.get(threadId);

      const response = await chat({
        adapter: config.adapter,
        agentLoopStrategy: maxIterations(MAX_AGENT_ITERATIONS),
        maxTokens,
        messages,
        middleware,
        stream: false,
        systemPrompts,
        tools: [codeModeTool],
      });

      await history.append(threadId, { role: "assistant", content: response });

      return response;
    },

    handleMessageStream(threadId: string, text: string): AsyncIterable<string> {
      return (async function* () {
        await history.append(threadId, { role: "user", content: text });
        const messages = await history.get(threadId);

        const rawStream = chat({
          adapter: config.adapter,
          agentLoopStrategy: maxIterations(MAX_AGENT_ITERATIONS),
          maxTokens,
          messages,
          middleware,
          systemPrompts,
          tools: [codeModeTool],
        }) as AsyncIterable<StreamChunk>;

        let response = "";
        let completed = false;

        try {
          for await (const delta of extractStreamText(rawStream)) {
            response += delta;
            yield delta;
          }

          if (response.trim().length === 0) {
            throw new Error("Agent returned an empty response");
          }

          completed = true;
        } finally {
          if (completed) {
            await history.append(threadId, {
              role: "assistant",
              content: response,
            });
          }
        }
      })();
    },
  };
}
