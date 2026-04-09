import { createMemoryState } from "@chat-adapter/state-memory";
import type { Adapter, StateAdapter } from "chat";
import { Chat } from "chat";
import type { Config, PayloadHandler } from "payload";

export interface PayloadAgentPluginConfig {
  /**
   * Chat platform adapters (e.g. telegram, slack, whatsapp).
   */
  adapters?: Record<string, Adapter>;
  /**
   * Disable the plugin without removing it from the config.
   */
  disabled?: boolean;
  /**
   * State adapter for subscriptions and deduplication.
   * Defaults to in-memory state if not provided.
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

    const chat = new Chat({
      userName: "payload-agent",
      adapters,
      state: pluginOptions.state ?? createMemoryState(),
    });

    chat.onDirectMessage(async (thread, message) => {
      await thread.post(`Echo: ${message.text}`);
    });

    chat.onNewMention(async (thread, message) => {
      await thread.post(`You said: ${message.text}`);
    });

    config.endpoints = [
      ...(config.endpoints ?? []),
      {
        handler: createWebhookHandler(chat),
        method: "post",
        path: "/agent/webhooks/:platform",
      },
    ];

    config.custom = {
      ...config.custom,
      chat,
    };

    const existingOnInit = config.onInit;
    config.onInit = async (payload) => {
      await existingOnInit?.(payload);
      await chat.initialize();
    };

    return config;
  };
