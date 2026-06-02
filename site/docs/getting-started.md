---
title: Getting started
description: Install payload-agent and connect your first chat platform.
---

`payload-agent` ships the agent core. You also bring **one AI provider** and
**one or more chat adapters**, and pass instances of both into the plugin — so a
working install is three packages.

## Install

This example uses Claude (Anthropic) and Telegram:

```bash
pnpm add payload-agent @tanstack/ai-anthropic @chat-adapter/telegram
```

Prefer GPT? Swap the provider for `@tanstack/ai-openai @tanstack/ai-client`. For
a different platform, swap the adapter for any `@chat-adapter/*` — see
[Supported platforms](#supported-platforms).

## Register the plugin

```ts
// payload.config.ts
import { anthropicText } from "@tanstack/ai-anthropic";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { payloadAgentPlugin } from "payload-agent";

export default buildConfig({
  plugins: [
    payloadAgentPlugin({
      adapters: {
        telegram: createTelegramAdapter(),
      },
      agent: {
        adapter: anthropicText("claude-sonnet-4-6"),
        maxTokens: 8192,
        systemPrompt: "Be concise. No emojis.",
      },
    }),
  ],
});
```

Set your provider and adapter API keys as environment variables, then message
your bot.

## What the agent can do

| Action | Description |
| --- | --- |
| `getSchema` | Discover collections and their field definitions |
| `find` | Query documents with filters, sort, pagination, and field selection |
| `findByID` | Fetch a single document by ID |
| `create` | Create documents |
| `update` | Partial update a document |
| `delete` | Delete a document (off by default) |
| `count` | Count documents matching a filter |
| `uploadFile` | Upload a chat attachment or URL to an upload collection |

Because it runs through Code Mode, the agent can compose multi-step operations
in one turn — e.g. find, filter in code, then create a summary document.

## Supported platforms

Any [Chat SDK](https://www.npmjs.com/package/chat) adapter works — install the
matching `@chat-adapter/<platform>` package and pass it in `adapters`:

- Telegram (`@chat-adapter/telegram`)
- Slack
- Discord
- WhatsApp
- Microsoft Teams
- Google Chat

Keep your `@chat-adapter/*` packages on the same release line as the `chat` core
the plugin depends on (currently `4.x`) — adapters pin the core version exactly,
so a mismatched one can pull in a second copy.

## Requirements

- Node.js ^18.20.2 or >=20.9.0
- Payload CMS ^3.37.0
