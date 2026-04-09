import { createMemoryState } from "@chat-adapter/state-memory";
import type { AnyTextAdapter } from "@tanstack/ai";
import type { Adapter, StateAdapter, Thread } from "chat";
import { Chat } from "chat";
import type { Config, PayloadHandler } from "payload";
import { type Agent, createAgent } from "./agent.js";

const TYPING_HEARTBEAT_MS = 4000;

export interface PayloadAgentPluginConfig {
  /** Chat platform adapters (e.g. telegram, slack, whatsapp). */
  adapters?: Record<string, Adapter>;
  /** AI agent configuration. */
  agent?: {
    /** TanStack AI text adapter (e.g. anthropicText('claude-haiku-4-5')) */
    adapter: AnyTextAdapter;
    /** Log agent activity to stdout (default: false) */
    debug?: boolean;
    /** Additional system prompt appended to the default */
    systemPrompt?: string;
  };
  /** Disable the plugin without removing it from the config. */
  disabled?: boolean;
  /** State adapter for subscriptions and deduplication. */
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

function registerAgentHandlers(chatInstance: Chat, agent: Agent): void {
  const handleMessage = async (thread: Thread, text: string): Promise<void> => {
    const stopTyping = startTypingHeartbeat(thread);

    try {
      const responseStream = agent.handleMessageStream(thread.id, text);
      await thread.post(responseStream);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "An unexpected error occurred";
      await thread.post(`Sorry, I encountered an error: ${msg}`);
    } finally {
      stopTyping();
    }
  };

  chatInstance.onDirectMessage(async (thread, message) => {
    await handleMessage(thread, message.text);
  });

  chatInstance.onNewMention(async (thread, message) => {
    await handleMessage(thread, message.text);
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

    const chatInstance = new Chat({
      userName: "payload-agent",
      adapters,
      state: pluginOptions.state ?? createMemoryState(),
      fallbackStreamingPlaceholderText: null,
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
        const agent = createAgent({
          adapter: pluginOptions.agent.adapter,
          debug: pluginOptions.agent.debug,
          payload,
          systemPrompt: pluginOptions.agent.systemPrompt,
        });
        registerAgentHandlers(chatInstance, agent);
      } else {
        registerEchoHandlers(chatInstance);
      }

      await chatInstance.initialize();
    };

    return config;
  };
