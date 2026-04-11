import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";

// import { anthropicText } from "@tanstack/ai-anthropic";
import { openaiText } from "@tanstack/ai-openai";

import { buildConfig } from "payload";
import { payloadAgentPlugin } from "payload-agent-plugin";
import sharp from "sharp";

import { testEmailAdapter } from "./helpers/test-email-adapter.js";
import { seed } from "./seed.js";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname;
}

const adapters: Record<string, ReturnType<typeof createTelegramAdapter>> = {};
if (process.env.TELEGRAM_BOT_TOKEN) {
  adapters.telegram = createTelegramAdapter({ mode: "polling" });
}

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "status",
          type: "select",
          options: ["draft", "published", "archived"],
          defaultValue: "draft",
        },
        { name: "content", type: "richText" },
      ],
    },
    {
      slug: "media",
      fields: [{ name: "alt", type: "text" }],
      upload: {
        staticDir: path.resolve(dirname, "media"),
      },
    },
  ],
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || "file:./dev/data.db",
    },
  }),
  editor: lexicalEditor(),
  email: testEmailAdapter,
  onInit: async (payload) => {
    await seed(payload);
  },
  plugins: [
    payloadAgentPlugin({
      adapters,
      // ...(process.env.ANTHROPIC_API_KEY && {
      //   agent: {
      //     adapter: anthropicText("claude-sonnet-4-6"),
      //     debug: true,
      //     maxTokens: 20_000,
      //     systemPrompt:
      //       "Be concise and practical, do not use emojis, be direct and human. all lowecase, short sentences.",
      //   },
      // }),
      ...(process.env.OPENAI_API_KEY && {
        agent: {
          adapter: openaiText("gpt-5.4-mini"),
          debug: true,
          maxTokens: 20_000,
          systemPrompt:
            "Be concise and practical, do not use emojis, be direct and human. all lowecase, short sentences.",
        },
      }),
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || "test-secret_key",
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
});
