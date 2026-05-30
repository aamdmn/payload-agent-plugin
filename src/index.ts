import { createMemoryState } from "@chat-adapter/state-memory";
import type { AnyTextAdapter } from "@tanstack/ai";
import type {
  Adapter,
  Attachment,
  ConcurrencyConfig,
  ConcurrencyStrategy,
  Message,
  StateAdapter,
  Thread,
} from "chat";
import { Chat } from "chat";
import type { Config, PayloadHandler } from "payload";
import {
  type AccessControlConfig,
  type Authorize,
  resolveServiceUser,
  runAuthorize,
} from "./access.js";
import { type Agent, createAgent } from "./agent.js";
import type { RichTextMode } from "./tools.js";

export type {
  AccessControlConfig,
  Authorize,
  AuthorizeContext,
  CollectionAccessConfig,
  OperationAccessConfig,
  ServiceUser,
  ServiceUserConfig,
} from "./access.js";

const TYPING_HEARTBEAT_MS = 4000;
const DEFAULT_UNAUTHORIZED_MESSAGE =
  "Sorry, you are not authorized to use this assistant.";

export interface PayloadAgentPluginConfig {
  /**
   * Restricts which collections the agent can read or write. By default the
   * agent can access every collection except Payload's internal collections
   * (slugs starting with `payload-`) and auth-enabled collections (which hold
   * credentials and sessions). Use `access.collections.allow` to expose a
   * specific set, or `access.collections.deny` to remove more.
   */
  access?: AccessControlConfig;
  /** Chat platform adapters (e.g. telegram, slack, whatsapp). */
  adapters?: Record<string, Adapter>;
  /** AI agent configuration. */
  agent?: {
    /** TanStack AI text adapter (e.g. anthropicText('claude-haiku-4-5')) */
    adapter: AnyTextAdapter;
    /** Log agent activity to stdout (default: false) */
    debug?: boolean;
    /** Max output tokens per model call (default: 4096) */
    maxTokens?: number;
    /** Additional system prompt appended to the default */
    systemPrompt?: string;
  };
  /**
   * How concurrent messages on the same thread are handled. The default drops a
   * message that arrives while another is being processed -- a problem for
   * long-running agent replies. Use 'queue' to process them in order. Passed
   * through to the underlying Chat instance.
   */
  concurrency?: ConcurrencyConfig | ConcurrencyStrategy;
  /** Disable the plugin without removing it from the config. */
  disabled?: boolean;
  /**
   * How richText (Lexical) fields are exchanged with the agent (default:
   * 'markdown'). With 'markdown', the agent reads and writes Markdown and the
   * plugin converts to and from Lexical editor state. With 'lexical', the agent
   * works with raw Lexical editor state directly.
   */
  richText?: RichTextMode;
  /**
   * State adapter backing conversation history, subscriptions, locks, and
   * deduplication. Defaults to in-memory, which does not persist across
   * restarts or scale across instances. For production, pass a persistent
   * adapter such as `@chat-adapter/state-redis` or `@chat-adapter/state-pg`.
   */
  state?: StateAdapter;
}

const createWebhookHandler =
  (chat: Chat): PayloadHandler =>
  (req) => {
    const platform = req.routeParams?.platform as string | undefined;

    if (!platform) {
      return Response.json({ error: "Missing platform" }, { status: 400 });
    }

    const handler = chat.webhooks[platform as keyof typeof chat.webhooks];

    if (!handler) {
      return Response.json(
        { error: `Unknown platform: ${platform}` },
        { status: 404 }
      );
    }

    return handler(req as unknown as Request);
  };

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function logHandlerError(thread: Thread, input: string, error: unknown): void {
  const header = [
    "[agent-handler] message handling failed",
    `adapter=${thread.adapter.name}`,
    `threadId=${thread.id}`,
    `input=${JSON.stringify(input.slice(0, 200))}`,
  ].join(" ");

  process.stderr.write(`${header}\n`);

  if (error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
    return;
  }

  process.stderr.write(`${String(error)}\n`);
}

function startTypingHeartbeat(thread: Thread): () => void {
  let stopped = false;

  const sendTyping = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    try {
      await thread.startTyping();
    } catch {
      // ignore typing errors to avoid affecting message handling
    }
  };

  sendTyping().catch(() => undefined);

  const interval = setInterval(() => {
    sendTyping().catch(() => undefined);
  }, TYPING_HEARTBEAT_MS);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

function registerAgentHandlers(
  chatInstance: Chat,
  agent: Agent,
  authorize: Authorize | undefined,
  unauthorizedMessage: null | string
): void {
  const handleMessage = async (
    thread: Thread,
    text: string,
    attachments?: Attachment[]
  ): Promise<void> => {
    const stopTyping = startTypingHeartbeat(thread);

    try {
      const responseStream = agent.handleMessageStream(
        thread.id,
        text,
        attachments
      );

      // Chat SDK handles per-platform streaming natively: post+edit with
      // throttled updates, markdown healing, and table buffering for Telegram,
      // Discord, Google Chat, etc., and native streaming for Slack/Teams.
      await thread.post(responseStream);
    } catch (error) {
      logHandlerError(thread, text, error);

      const message = getErrorMessage(error);

      try {
        await thread.post(`Sorry, I encountered an error: ${message}`);
      } catch (postError) {
        logHandlerError(thread, text, postError);
      }
    } finally {
      stopTyping();
    }
  };

  const handleIfAuthorized = async (
    thread: Thread,
    message: Message
  ): Promise<void> => {
    const result = await runAuthorize(authorize, {
      message,
      platform: thread.adapter.name,
      thread,
      threadId: thread.id,
      userId: message.author.userId,
      userName: message.author.userName,
    });

    if (result.status === "error") {
      logHandlerError(thread, message.text, result.error);
      return;
    }

    if (result.status === "deny") {
      if (unauthorizedMessage) {
        await thread.post(unauthorizedMessage).catch(() => undefined);
      }
      return;
    }

    await handleMessage(thread, message.text, message.attachments);
  };

  chatInstance.onDirectMessage(async (thread, message) => {
    await handleIfAuthorized(thread, message);
  });

  chatInstance.onNewMention(async (thread, message) => {
    await handleIfAuthorized(thread, message);
  });
}

function registerEchoHandlers(chatInstance: Chat): void {
  chatInstance.onDirectMessage(async (thread, message) => {
    await thread.post(`Echo: ${message.text}`);
  });

  chatInstance.onNewMention(async (thread, message) => {
    await thread.post(`You said: ${message.text}`);
  });
}

function resolveState(pluginOptions: PayloadAgentPluginConfig): StateAdapter {
  if (pluginOptions.state) {
    return pluginOptions.state;
  }

  if (process.env.NODE_ENV === "production") {
    process.stderr.write(
      "[payload-agent] No `state` adapter configured; using in-memory state. " +
        "Conversation history, locks, and deduplication will not persist across " +
        "restarts or scale across instances. For production, pass a persistent " +
        "adapter such as @chat-adapter/state-redis or @chat-adapter/state-pg.\n"
    );
  }

  return createMemoryState();
}

export const payloadAgentPlugin =
  (pluginOptions: PayloadAgentPluginConfig = {}) =>
  (config: Config): Config => {
    if (pluginOptions.disabled) {
      return config;
    }

    const adapters = pluginOptions.adapters ?? {};

    if (Object.keys(adapters).length === 0) {
      return config;
    }

    const state = resolveState(pluginOptions);

    const chatInstance = new Chat({
      userName: "payload-agent",
      adapters,
      concurrency: pluginOptions.concurrency,
      fallbackStreamingPlaceholderText: null,
      state,
    });

    config.endpoints = [
      ...(config.endpoints ?? []),
      {
        handler: createWebhookHandler(chatInstance),
        method: "post",
        path: "/agent/webhooks/:platform",
      },
    ];

    config.custom = {
      ...config.custom,
      chat: chatInstance,
    };

    const existingOnInit = config.onInit;

    config.onInit = async (payload) => {
      await existingOnInit?.(payload);

      if (pluginOptions.agent) {
        const serviceUser = await resolveServiceUser(
          payload,
          pluginOptions.access
        );

        if (!serviceUser && process.env.NODE_ENV === "production") {
          process.stderr.write(
            "[payload-agent] No `access.serviceUser` configured; agent operations run with overrideAccess: true (full access, bounded only by collection/operation scoping). Set `access.serviceUser` to enforce Payload access control.\n"
          );
        }

        const agent = createAgent({
          access: pluginOptions.access,
          adapter: pluginOptions.agent.adapter,
          debug: pluginOptions.agent.debug,
          maxTokens: pluginOptions.agent.maxTokens,
          payload,
          richText: pluginOptions.richText,
          serviceUser,
          state,
          systemPrompt: pluginOptions.agent.systemPrompt,
        });

        const unauthorizedMessage =
          pluginOptions.access?.unauthorizedMessage === undefined
            ? DEFAULT_UNAUTHORIZED_MESSAGE
            : pluginOptions.access.unauthorizedMessage;
        registerAgentHandlers(
          chatInstance,
          agent,
          pluginOptions.access?.authorize,
          unauthorizedMessage
        );
      } else {
        registerEchoHandlers(chatInstance);
      }

      await chatInstance.initialize();
    };

    return config;
  };
