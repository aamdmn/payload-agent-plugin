---
title: Production
description: Use a persistent state adapter so the bot remembers across restarts.
---

Conversation history, per-thread locks, and webhook deduplication are stored in
the configured state adapter. The default is **in-memory**, which is fine for
local development but **does not persist across restarts and does not work
across multiple instances** — the bot forgets every conversation on restart.

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
