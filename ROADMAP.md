# Roadmap

Path from working WIP to production-ready, ordered by ROI. **Tier 0 blocks
production.** Everything below it is enhancement.

Legend: `[ ]` todo / `[x]` done. Impact: Critical / High / Med / Low. Effort: S / M / L.

**Guiding principle — secure by default.** A fresh install must not expose
system collections, must not act with more authority than configured, and must
not fetch arbitrary URLs. Power is opt-in; safety is not.

---

## Access control — target design (decided)

**Model: shared service user.** The agent acts as one configurable Payload user
for every chat user.

- All Local API calls pass that `user` with `overrideAccess: false`, so
  Payload's collection access, field access, and hooks apply normally. Today
  every op uses `overrideAccess: true` (`src/tools.ts`), bypassing all of it.
- Resolve the service user once at init (by configured id, or accept a user
  object). Identity is constant across threads, so **no per-turn
  `AsyncLocalStorage` binding is needed** — a key simplification vs. per-user
  mapping. (That binding only becomes necessary if per-user identity is added
  later; see Tier 2.)
- **Auth gate (allowlist):** an `authorize(ctx)` callback (or a static
  per-platform id allowlist) decides who may talk to the bot at all. Runs in the
  message handler (`src/index.ts`) before the agent. Unauthorized → configurable
  refusal. Today the bot replies to any DM/mention.
- **Collection scoping:** `collections: { allow?, deny? }`, default-deny
  `users`, `payload-preferences`, `payload-migrations`,
  `payload-locked-documents`. Defense-in-depth even if the service user is
  over-privileged. Filters `getSchema` and rejects out-of-scope ops.
- **Operation scoping:** per-collection op toggles; `delete` off by default.

Illustrative config (not final):

```ts
payloadAgentPlugin({
  access: {
    serviceUser: { collection: "users", id: process.env.AGENT_USER_ID },
    authorize: (ctx) => allowlist.includes(ctx.userId),
    collections: { deny: ["users"] }, // system collections denied by default
    operations: { delete: false },
  },
});
```

---

## Tier 0 — Block production (security correctness)

- [x] **Collection scoping** — default-deny system collections; `allow`/`deny`
      option; filter `getSchema` and reject out-of-scope ops. (Critical, S)
- [x] **Identity + authorization** — `access.serviceUser` resolved at startup;
      all DB ops run with `user` + `overrideAccess: false` when set. Defaults to
      full access with a production warning. (Critical, S–M)
- [x] **Auth gate** — `access.authorize(ctx)` in the message handler; fails
      closed; `access.unauthorizedMessage` customizes the refusal. (Critical, S)
- [x] **Operation scoping** — global op toggles (`access.operations`);
      `delete` disabled by default; disabled ops are not exposed to the agent.
      (High, S) _Per-collection granularity deferred to Tier 2._
- [x] **SSRF hardening of `fileFromUrl`** (`src/safe-fetch.ts`) — http(s) only;
      DNS-resolved private/loopback/link-local/metadata ranges blocked; every
      redirect hop re-validated; 25 MB cap + timeout. (High, S–M)
- [~] **Release hygiene** — `package.json` description fixed. Version still
      `1.0.0`; dropping to pre-1.0 deferred (owner decision, affects npm
      consumers). (Low, S)

## Tier 1 — Hardening (abuse / cost / ops)

- [ ] **Rate limit + cost guard** per platform user and per thread (token bucket
      in the state adapter). (Med–High, M)
- [ ] **Audit hook** — `onMutation(ctx)` and/or an optional audit collection
      recording who did what. (Med, S–M)
- [ ] **Sanitize tool errors** before they reach chat — `throwPayloadToolError`
      serializes internal context into the message (`src/tools.ts:78`). (Med, S)
- [ ] **Webhook authenticity** — verify Chat SDK enforces per-platform signature
      verification on `/agent/webhooks/:platform`; document required secrets.
      (Med, S to verify)
- [ ] **Attachment isolation** — scope pending-attachment ids per thread
      (`src/agent.ts`); currently a shared map. (Low–Med, S)

## Tier 2 — Feature completeness

- [ ] **Outbound media** — agent sends files/images back to chat. (Med, M)
- [ ] **Folder handling.** (Low–Med, M)
- [ ] **Per-collection operation scoping** — extend `access.operations` to a
      per-collection matrix (e.g. read-only on `posts`, full on `drafts`).
      (Low–Med, M)
- [ ] **Per-turn transaction** — share one `req`/transaction across all ops in a
      Code-Mode turn so multi-step writes are atomic. (Med, M)
- [ ] **History token-budgeting** — summarize or token-window beyond the
      50-message cap to bound prompt cost (`src/conversation-history.ts`).
      (Low–Med, M)
- [ ] **Per-user identity (optional upgrade)** — map platform user → Payload
      user with an account-linking flow; requires per-turn `AsyncLocalStorage`
      binding. (Med, M–L)

## Tier 3 — Adoption / polish

- [ ] **Per-platform setup + env reference** (Telegram / Slack / WhatsApp /
      Discord). (Med, S–M)
- [ ] **Example recipes** — translate, bulk edit, media intake. (Med, M)
- [ ] **Observability** — structured logs / metrics for turns, tool calls,
      errors, cost. (Low–Med, M)

---

## Quick wins (highest ROI, ship first)

Collection scoping, SSRF hardening, operation scoping, and release hygiene are
all small and either Critical or High impact. They can land in one focused pass
and remove most of the production risk before the larger identity work.

## Notes

- Conversation history is already bounded (50 messages / 30-day TTL,
  `src/conversation-history.ts`). Revisit only for token cost, not correctness.
- The shared-service-user model deliberately avoids `AsyncLocalStorage`; only the
  optional per-user upgrade (Tier 2) reintroduces that need.
