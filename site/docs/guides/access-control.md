---
title: Access control
description: Scope what the agent can read and write, and who is allowed to talk to it.
---

By default the agent uses safe scoping: it skips Payload's internal
(`payload-*`) and auth collections, can create and update but not delete,
answers anyone who messages the bot, and only fetches public http(s) URLs. It is
capped at 50 write operations per message (`agent.maxWritesPerMessage`) so a
single request can't run away, and it treats the content it reads as data, not
as instructions to follow.

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
