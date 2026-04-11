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

**Work in progress.** The core agent loop, chat integrations, and content operations work. Several areas are not yet implemented:

- Media management (uploads, image handling)
- Localization (locale cloning, locale-aware queries)
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

  // State adapter for subscriptions (defaults to in-memory)
  state?: StateAdapter,

  // Disable plugin without removing from config
  disabled?: boolean,
})
```

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
