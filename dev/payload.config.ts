import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";

// import { anthropicText } from "@tanstack/ai-anthropic";
import { openaiText } from "@tanstack/ai-openai";

import { type Block, buildConfig } from "payload";
import { payloadAgentPlugin } from "payload-agent";
import sharp from "sharp";

import { testEmailAdapter } from "./helpers/test-email-adapter.js";
import { seed } from "./seed.js";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname;
}

const adapters: Record<string, ReturnType<typeof createTelegramAdapter>> = {};
// Skip the live Telegram poller under vitest: every integration spec boots its
// own Payload, and polling mode makes a network call to Telegram in onInit,
// which makes the suite flaky and non-hermetic.
if (process.env.TELEGRAM_BOT_TOKEN && !process.env.VITEST) {
  adapters.telegram = createTelegramAdapter({ mode: "polling" });
}

// Shared layout blocks, reused by `products` and `pages`. `interfaceName` makes
// Payload generate a named interface for each, so the agent (and the type
// slicer) see a real discriminated union on `blockType`.
const heroBlock = {
  slug: "hero",
  interfaceName: "HeroBlock",
  fields: [
    { name: "heading", type: "text", required: true, localized: true },
    { name: "subheading", type: "text", localized: true },
    { name: "image", type: "upload", relationTo: "media" },
    {
      name: "cta",
      type: "group",
      fields: [
        { name: "label", type: "text", localized: true },
        { name: "url", type: "text" },
      ],
    },
  ],
} satisfies Block;

const featureGridBlock = {
  slug: "featureGrid",
  interfaceName: "FeatureGridBlock",
  fields: [
    { name: "heading", type: "text", localized: true },
    {
      name: "products",
      type: "relationship",
      relationTo: "products",
      hasMany: true,
    },
  ],
} satisfies Block;

const galleryBlock = {
  slug: "gallery",
  interfaceName: "GalleryBlock",
  fields: [
    {
      name: "images",
      type: "array",
      fields: [
        { name: "image", type: "upload", relationTo: "media" },
        { name: "alt", type: "text", localized: true },
      ],
    },
  ],
} satisfies Block;

const richTextBlock = {
  slug: "richText",
  interfaceName: "RichTextBlock",
  fields: [{ name: "content", type: "richText", localized: true }],
} satisfies Block;

const layoutBlocks = [heroBlock, featureGridBlock, galleryBlock, richTextBlock];

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
        { name: "summary", type: "text", localized: true },
        { name: "heroImage", type: "upload", relationTo: "media" },
        {
          name: "status",
          type: "select",
          options: ["draft", "published", "archived"],
          defaultValue: "draft",
        },
        { name: "content", type: "richText", localized: true },
      ],
    },
    {
      slug: "media",
      fields: [{ name: "alt", type: "text" }],
      upload: {
        staticDir: path.resolve(dirname, "media"),
      },
    },
    {
      slug: "categories",
      admin: { useAsTitle: "title" },
      fields: [
        { name: "title", type: "text", required: true, localized: true },
        { name: "slug", type: "text" },
      ],
    },
    {
      slug: "products",
      admin: { useAsTitle: "title" },
      fields: [
        {
          type: "tabs",
          tabs: [
            {
              label: "Content",
              fields: [
                {
                  name: "title",
                  type: "text",
                  required: true,
                  localized: true,
                },
                { name: "description", type: "richText", localized: true },
                {
                  name: "status",
                  type: "select",
                  options: ["draft", "published", "archived"],
                  defaultValue: "draft",
                },
                {
                  name: "categories",
                  type: "relationship",
                  relationTo: "categories",
                  hasMany: true,
                },
              ],
            },
            {
              label: "Pricing",
              fields: [
                {
                  name: "prices",
                  type: "array",
                  labels: { singular: "Price", plural: "Prices" },
                  fields: [
                    {
                      name: "currency",
                      type: "select",
                      options: ["USD", "EUR", "GBP"],
                      required: true,
                    },
                    { name: "amount", type: "number", required: true },
                  ],
                },
              ],
            },
            {
              label: "Variants",
              fields: [
                {
                  name: "variants",
                  type: "array",
                  fields: [
                    { name: "name", type: "text" },
                    { name: "sku", type: "text" },
                    { name: "stock", type: "number", defaultValue: 0 },
                  ],
                },
              ],
            },
            {
              name: "seo",
              fields: [
                { name: "metaTitle", type: "text", localized: true },
                { name: "metaDescription", type: "textarea", localized: true },
                { name: "ogImage", type: "upload", relationTo: "media" },
              ],
            },
            {
              label: "Layout",
              fields: [
                { name: "layout", type: "blocks", blocks: layoutBlocks },
              ],
            },
          ],
        },
      ],
    },
    {
      slug: "pages",
      admin: { useAsTitle: "title" },
      fields: [
        { name: "title", type: "text", required: true, localized: true },
        { name: "slug", type: "text", required: true },
        { name: "layout", type: "blocks", blocks: layoutBlocks },
      ],
    },
  ],
  globals: [
    {
      slug: "site-settings",
      fields: [
        { name: "siteName", type: "text", localized: true },
        { name: "tagline", type: "text", localized: true },
        { name: "about", type: "richText", localized: true },
      ],
    },
  ],
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || "file:./dev/data.db",
    },
  }),
  localization: {
    defaultLocale: "en",
    locales: ["en", "es", "de"],
  },
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
          adapter: openaiText("gpt-5.5"),
          debug: true,
          maxTokens: 20_000,
          systemPrompt:
            "Be concise and practical, do not use emojis, be direct and human. all lowecase, short sentences.",
        },
        access: {
          operations: {
            delete: true,
          },
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
