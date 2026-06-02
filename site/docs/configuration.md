---
title: Configuration
description: Every payloadAgentPlugin option.
---

```ts
payloadAgentPlugin({
  // Chat platform adapters, keyed by name.
  adapters: Record<string, Adapter>,

  agent: {
    adapter: AnyTextAdapter,          // required
    maxTokens?: number,               // default: 4096
    maxWritesPerMessage?: number,     // default: 50; writes allowed per message
    debug?: boolean,                  // log agent activity
    systemPrompt?: string,            // appended to the default prompt
  },

  access?: AccessControlConfig,       // see Access control

  // How richText (Lexical) fields are exchanged with the agent.
  richText?: "markdown" | "lexical",  // default: "markdown"

  // Backs conversation history, locks, and dedup. Default: in-memory.
  state?: StateAdapter,               // see Production

  // Concurrency strategy for messages on the same thread.
  concurrency?: ConcurrencyStrategy | ConcurrencyConfig,

  // Disable the plugin without removing it from config.
  disabled?: boolean,
})
```

## richText

`"markdown"` (default): the agent reads and writes Markdown, converted to and
from Lexical editor state via Payload's official converters. `"lexical"`: the
agent works with raw Lexical editor state.

## Localization

When your Payload config has `localization` enabled, the agent becomes
locale-aware automatically — no extra configuration. `find`, `findByID`,
`create`, `update`, and `count` accept `locale` and `fallbackLocale`, and the
schema marks which fields are `localized`.

Localized fields are written one locale per call with plain values. The plugin
rejects a per-locale object on write — a common mistake that would otherwise
corrupt the field — with a message the agent can recover from.
