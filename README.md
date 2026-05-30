<div align='center'>
    <br/>
    <br/>
    <h3>payload-agent-plugin</h3>
    <p>AI chat agent for Payload CMS. Telegram, Slack, WhatsApp and more.</p>
    <br/>
    <br/>
</div>

Adds a conversational AI agent directly inside your Payload instance. Users query and manage content through chat platforms without leaving their messaging app.

Powered by [Chat SDK](https://www.npmjs.com/package/chat) for multi-platform messaging, [TanStack AI](https://tanstack.com/ai) for model orchestration, and [Code Mode](https://tanstack.com/ai/latest/docs/code-mode/code-mode) for reliable tool execution -- a sandboxed alternative to MCP that runs TypeScript directly against the Payload Local API.

## Status

**Work in progress.** The core agent loop, chat integrations, content operations, rich text, and localization work. Several areas are not yet implemented:

- Media management (uploads, image handling)
- Folder handling

## Quick Start

```ts
// payload.config.ts
import { anthropicText } from "@tanstack/ai-anthropic";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { payloadAgentPlugin } from "@adamdemian/payload-agent-plugin";

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

Set your API keys in environment variables and start chatting with your bot.

## What the Agent Can Do

| Action | Description |
| --- | --- |
| `getSchema` | Discover collections and their field definitions |
| `find` | Query documents with filters, sort, pagination, and field selection |
| `findByID` | Fetch a single document by ID |
| `create` | Create documents |
| `update` | Partial update a document |
| `delete` | Delete a document |
| `count` | Count documents matching a filter |

The agent runs TypeScript through Code Mode, so it can compose multi-step operations in a single turn (e.g. find, filter in code, then create a summary document).

## Localization

When your Payload config has `localization` enabled, the agent becomes
locale-aware automatically — no extra configuration. `find`, `findByID`,
`create`, `update`, and `count` accept `locale` and `fallbackLocale`, and the
schema marks which fields are `localized`.

Because the agent is an LLM, it can actually translate rather than just copy
content. A request like "translate post 5 into Spanish and German" becomes:

1. Read every locale at once with `locale: "all"` and `fallbackLocale: "false"`
   to see existing values and which locales are missing.
2. Translate the content (richText comes back as Markdown).
3. Write each target locale in its own `update` call with `locale: "es"` etc.

Localized fields are written one locale per call with plain values — the plugin
rejects a per-locale object on write (a common mistake that would otherwise
corrupt the field) with a message the agent can recover from.

## Configuration

```ts
payloadAgentPlugin({
  // Chat platform adapters
  adapters: Record<string, Adapter>,

  // AI agent
  agent: {
    adapter: AnyTextAdapter,       // required
    maxTokens?: number,            // default: 4096
    debug?: boolean,               // log agent activity
    systemPrompt?: string,         // appended to default prompt
  },

  // How richText (Lexical) fields are exchanged with the agent.
  // "markdown" (default): agent reads/writes Markdown, converted to and from
  // Lexical editor state via Payload's official converters.
  // "lexical": agent works with raw Lexical editor state.
  richText?: "markdown" | "lexical",

  // State adapter backing conversation history, locks, and dedup.
  // Defaults to in-memory. Use a persistent adapter in production (see below).
  state?: StateAdapter,

  // Concurrency strategy for messages on the same thread.
  // Default drops a message that arrives mid-reply; "queue" processes in order.
  concurrency?: ConcurrencyStrategy | ConcurrencyConfig,

  // Disable plugin without removing from config
  disabled?: boolean,
})
```

## Production

Conversation history, per-thread locks, and webhook deduplication are stored in
the configured state adapter. The default is **in-memory**, which is fine for
local development but **does not persist across restarts and does not work
across multiple instances** -- the bot forgets every conversation on restart.

For production, pass a persistent state adapter. Both auto-detect their
connection string from the environment:

```ts
// Reuse your Payload Postgres database (zero extra infrastructure):
import { createPostgresState } from "@chat-adapter/state-pg";

payloadAgentPlugin({
  // ...
  state: createPostgresState(), // reads POSTGRES_URL / DATABASE_URL
  concurrency: "queue",         // don't drop a user's follow-up mid-reply
});
```

```ts
// Or Redis:
import { createRedisState } from "@chat-adapter/state-redis";

payloadAgentPlugin({
  // ...
  state: createRedisState(), // reads REDIS_URL
});
```

Install the adapter you choose (`@chat-adapter/state-pg` or
`@chat-adapter/state-redis`). When no `state` is configured in production, the
plugin logs a warning.

## Supported Platforms

Any adapter from [Chat SDK](https://www.npmjs.com/package/chat) works:

- Telegram
- Slack
- Discord
- WhatsApp
- Microsoft Teams
- Google Chat

## Requirements

- Node.js ^18.20.2 or >=20.9.0
- Payload CMS ^3.37.0

## License

MIT
