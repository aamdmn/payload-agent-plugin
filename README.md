<div align='center'>
    <br/>
    <br/>
    <h3>payload-agent</h3>
    <p>AI chat agent for Payload CMS. Telegram, Slack, WhatsApp and more.</p>
    <br/>
    <br/>
</div>

Adds a conversational AI agent directly inside your Payload instance. Users query and manage content through chat platforms without leaving their messaging app.

Powered by [Chat SDK](https://www.npmjs.com/package/chat) for multi-platform messaging, [TanStack AI](https://tanstack.com/ai) for model orchestration, and [Code Mode](https://tanstack.com/ai/latest/docs/code-mode/code-mode) for reliable tool execution - a sandboxed alternative to MCP that runs TypeScript directly against the Payload Local API.

## Status

**Work in progress.** The core agent loop, chat integrations, content operations, rich text, localization, and media uploads work. Not yet implemented:

- Outbound media (the agent sending files back to chat)
- Folder handling

## Quick Start

`payload-agent` ships the agent core. You bring **one AI provider** and **one or more chat adapters** and pass instances of both into the plugin. The example below uses Claude (Anthropic) and Telegram:

```bash
pnpm add payload-agent @tanstack/ai-anthropic @chat-adapter/telegram
```

Prefer GPT? Use `@tanstack/ai-openai @tanstack/ai-client` instead. For a different chat platform, swap the adapter for any `@chat-adapter/*` (see [Supported Platforms](#supported-platforms)).

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

### Next.js config

`payload-agent` runs Code Mode in an `esbuild` + `isolated-vm` sandbox — native,
server-only packages that Next must not bundle. Spread the list it exports into
`serverExternalPackages` in your `next.config`. Keeping the names in the package
(not your config) means they stay correct when you upgrade:

```ts
// next.config.ts
import { withPayload } from "@payloadcms/next/withPayload";
import { serverExternalPackages } from "payload-agent/next";

const nextConfig = {
  serverExternalPackages, // or: [...serverExternalPackages, ...yourOwn]
};

export default withPayload(nextConfig);
```

`withPayload` merges this with its own entries, so the order of the wrappers does
not matter. Skip it and the app fails to boot with `Unknown module type` /
`invalid utf-8 sequence` errors pointing at `esbuild`.

### AI providers

The agent's model adapter is any [TanStack AI](https://tanstack.com/ai) text
provider — you install the provider package and pass its adapter in. Because the
Code Mode sandbox pins `@tanstack/ai` to an exact version, install a provider on
the matching line so your tree has a single `@tanstack/ai`:

| Provider | Install | Import |
| --- | --- | --- |
| Anthropic (Claude) | `@tanstack/ai-anthropic@^0.15` | `import { anthropicText } from "@tanstack/ai-anthropic"` |
| OpenAI (GPT) | `@tanstack/ai-openai@^0.14 @tanstack/ai-client` | `import { openaiText } from "@tanstack/ai-openai"` |

```ts
payloadAgentPlugin({
  agent: { adapter: anthropicText("claude-sonnet-4-6") },
  // ...
});
```

`payload-agent` declares these providers as optional peer dependencies, so your
package manager warns if an installed version falls outside the supported line.
The current line is `@tanstack/ai@0.28`, which the latest providers target — so
installing `@tanstack/ai-anthropic` or `@tanstack/ai-openai` works without a
version. If a future provider release outpaces `payload-agent`, the warning tells
you; pin to the line in the table above (see [Troubleshooting](#troubleshooting)).
Other TanStack AI providers work the same way: install one on the `0.28` line and
pass its `*Text` adapter.

Set the required environment variables:

- `ANTHROPIC_API_KEY` — model provider key (`OPENAI_API_KEY` if you swapped the
  provider)
- `TELEGRAM_BOT_TOKEN` — bot token from [@BotFather](https://t.me/botfather)

On a long-running host (local dev, Railway, a VPS, Docker) that is all you need:
the Telegram adapter long-polls for updates, so there is no webhook to set up.
Start your app and message the bot. A serverless deploy (Vercel, Lambda) needs
one extra step — see [Webhooks (serverless)](#webhooks-serverless).

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
| `uploadFile` | Upload a file (a chat attachment or a URL) to an upload collection |

The agent runs TypeScript through Code Mode, so it can compose multi-step operations in a single turn (e.g. read several collections, compute across them, then create a summary document). It ships with a built-in, source-verified reference to Payload's query API and field shapes, so it filters with `where`, controls `depth`, and writes data in the right shape. Reads default to `depth: 0` — relationship and upload fields come back as ids, and the agent raises `depth` when it needs related data inline.

`delete` is off by default, and the agent is scoped to safe collections — see [Access control](#access-control).

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

## Media

When a collection has an `upload` config, the agent gets a `uploadFile` tool.
A user can send a photo or file in chat and ask the agent to save it:

1. Inbound chat attachments are registered server-side and surfaced to the
   agent as an `attachmentId` (the file bytes never enter the Code Mode
   sandbox).
2. The agent calls `uploadFile({ collection, attachmentId, data })`, and the
   plugin fetches the bytes and creates the upload document.
3. The returned id can be referenced from upload or relationship fields in a
   follow-up `create`/`update`.

`uploadFile` can also fetch from a `url` instead of an attachment.

## Configuration

```ts
payloadAgentPlugin({
  // Chat platform adapters
  adapters: Record<string, Adapter>,

  // AI agent
  agent: {
    adapter: AnyTextAdapter,          // required
    maxTokens?: number,               // default: 4096
    maxWritesPerMessage?: number,     // default: 50; writes allowed per message
    debug?: boolean,                  // log agent activity
    systemPrompt?: string,            // appended to default prompt
  },

  // Access control (see below). Safe defaults apply without it.
  access?: AccessControlConfig,

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

## Access control

By default the agent uses safe scoping: it skips Payload's internal (`payload-*`)
and auth collections, can create and update but not delete, answers anyone who
messages the bot, and only fetches public http(s) URLs. It is also capped at 50
write operations per message (`agent.maxWritesPerMessage`) so a single request
can't run away, and is instructed to treat the content it reads as data, not as
instructions to follow.

Use the `access` option to go further:

```ts
payloadAgentPlugin({
  access: {
    // Act as a Payload user, so the agent obeys that user's access control
    // and field permissions instead of running unrestricted.
    serviceUser: { collection: "users", id: process.env.AGENT_USER_ID },

    // Who may talk to the bot. Runs before every message; fails closed.
    authorize: (ctx) => allowedIds.has(ctx.userId),

    // Restrict collections, or expose one that is denied by default.
    collections: { allow: ["posts", "media"] },

    // Toggle writes. delete is off unless you enable it.
    operations: { delete: true },

    // Reply when authorize refuses; null stays silent.
    unauthorizedMessage: "You don't have access to this assistant.",
  },
});
```

Without `serviceUser` the agent keeps full database access (still bounded by
`collections` and `operations`) and warns in production — set it to enforce
Payload's own access control.

## Production

Conversation history, per-thread locks, and webhook deduplication are stored in
the configured state adapter. The default is **in-memory**, which is fine for
local development but **does not persist across restarts and does not work
across multiple instances** - the bot forgets every conversation on restart.

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

## Webhooks (serverless)

The Telegram adapter picks its transport from the runtime:

- **Long-running host** (local dev, Railway, Render, Fly, a VPS, Docker): it
  long-polls Telegram. Nothing to configure beyond `TELEGRAM_BOT_TOKEN`.
- **Serverless host** (Vercel, AWS Lambda, Netlify, Cloud Run): long-polling
  can't run, so updates arrive by webhook. The plugin serves that endpoint at
  `POST /api/agent/webhooks/<platform>`, where `<platform>` is the key you used
  in `adapters` (`telegram` here) and `/api` is Payload's default API route.

The adapter verifies inbound webhooks but does not register the URL for you.
Point Telegram at your endpoint once, after deploying:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=https://<your-domain>/api/agent/webhooks/telegram" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET_TOKEN"
```

Set `TELEGRAM_WEBHOOK_SECRET_TOKEN` to a random string in both the deployment
environment and the call above; the adapter checks it on every request.
**Without it, verification is disabled and any caller that finds the URL can
drive the agent** — which can write to your database — so treat the secret as
required in production.

Other platforms work the same way: same endpoint path, each with its own bot
token and signing secret. See the [Chat SDK docs](https://www.npmjs.com/package/chat).

## Supported Platforms

Any adapter from [Chat SDK](https://www.npmjs.com/package/chat) works — install the matching `@chat-adapter/<platform>` package and pass it in `adapters`:

- Telegram (`@chat-adapter/telegram`)
- Slack
- Discord
- WhatsApp
- Microsoft Teams
- Google Chat

Keep all your `@chat-adapter/*` packages on the same release line (currently `4.x`) — each pins the `chat` core exactly, so mixing lines pulls in a second copy. `payload-agent` declares `chat` as a peer dependency, so it shares the single copy your adapters resolve rather than adding its own.

## Requirements

- Node.js ^18.20.2 or >=20.9.0
- Payload CMS ^3.37.0

## Development

```bash
pnpm test        # unit + integration tests (Vitest)
pnpm test:eval   # agent behavior evals against a live model
```

`pnpm test:eval` runs the agent loop end-to-end and asserts on the resulting
database state: creating, updating, and translating content, plus the
guardrails (delete disabled, the per-message write cap, and ignoring injected
instructions). It needs a model API key (`ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`), and it is kept out of the normal suite, so it never runs (or
spends) unless you invoke it. Set `EVAL_MODEL` to pick the model (e.g.
`claude-haiku-4-5`).

## Troubleshooting

**`Unknown module type` or `invalid utf-8 sequence` errors pointing at `esbuild`
on boot.** Next is bundling the Code Mode sandbox. Add the
`serverExternalPackages` entries from [Next.js config](#nextjs-config).

**`Export buildBaseUsage doesn't exist` (or `toRunErrorRawEvent`) from
`@tanstack/ai`.** Your `@tanstack/ai-*` provider is on a newer line than the
`@tanstack/ai@0.28` `payload-agent` builds on, so two copies of `@tanstack/ai`
ended up in your tree. Pin the provider to the matching line —
`@tanstack/ai-anthropic@^0.15` or `@tanstack/ai-openai@^0.14` — then reinstall.

**Adapter type error mentioning two `chat` copies or a private
`_subjectPromise`.** Your `@chat-adapter/*` packages are on different release
lines, so `chat` (which they pin exactly) is installed twice. Put them all on the
same line (e.g. all `4.30.x`) and reinstall. `payload-agent` no longer bundles
`chat` — it shares the single copy your adapters bring, so you should not need a
`pnpm.overrides.chat` workaround.

## License

MIT
