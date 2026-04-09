import { createMemoryState } from "@chat-adapter/state-memory";
import type { AnyTextAdapter } from "@tanstack/ai";
import type { Adapter, StateAdapter } from "chat";
import { Chat } from "chat";
import type { Config, PayloadHandler } from "payload";
import { type Agent, createAgent } from "./agent.js";

export interface PayloadAgentPluginConfig {
  /**
   * Chat platform adapters (e.g. telegram, slack, whatsapp).
   */
  adapters?: Record<string, Adapter>;
  /**
   * AI agent configuration. When provided, the agent uses TanStack AI
   * with Code Mode to handle messages instead of echoing them back.
   */
  agent?: {
    /** TanStack AI text adapter (e.g. anthropicText('claude-haiku-4-5')) */
    adapter: AnyTextAdapter;
    /** Additional system prompt appended to the default */
    systemPrompt?: string;
    /** Code Mode sandbox execution timeout in ms (default: 30000) */
    timeout?: number;
    /** Code Mode sandbox memory limit in MB (default: 128) */
    memoryLimit?: number;
    /** Log agent activity to stdout (default: false) */
    debug?: boolean;
  };
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

function registerAgentHandlers(chatInstance: Chat, agent: Agent): void {
  chatInstance.onDirectMessage(async (thread, message) => {
    try {
      const response = await agent.handleMessage(thread.id, message.text);
      await thread.post(response);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "An unexpected error occurred";
      await thread.post(`Sorry, I encountered an error: ${msg}`);
    }
  });

  chatInstance.onNewMention(async (thread, message) => {
    try {
      const response = await agent.handleMessage(thread.id, message.text);
      await thread.post(response);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "An unexpected error occurred";
      await thread.post(`Sorry, I encountered an error: ${msg}`);
    }
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
          payload,
          systemPrompt: pluginOptions.agent.systemPrompt,
          timeout: pluginOptions.agent.timeout,
          memoryLimit: pluginOptions.agent.memoryLimit,
          debug: pluginOptions.agent.debug,
        });
        registerAgentHandlers(chatInstance, agent);
      } else {
        registerEchoHandlers(chatInstance);
      }

      await chatInstance.initialize();
    };

    return config;
  };
