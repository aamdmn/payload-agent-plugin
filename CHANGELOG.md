# Changelog

## [Unreleased]

## [0.8.0] - 2026-06-06

### Added

- Bundled a verified Payload query/data reference into the agent's system prompt so it queries and shapes data correctly without trial and error: the `where` operators, `depth`/`select` semantics, `sort`, the find result shape, and per-field-type data shapes (relationships/uploads, blocks with `blockType`, arrays, groups, named/unnamed tabs, select, date, point). Every fact is verified against the Payload source and rides in the prompt-cached prefix, so it costs tokens once per conversation (`src/payload-guide.ts`)
- Added a `depth` option to `find`, `findByID`, and `findGlobal` so the agent can control relationship and upload population per call

### Changed

- Reads (`find` / `findByID` / `findGlobal`) now default to `depth: 0`: relationship and upload fields return as ids instead of fully populated documents, which keeps results small. Raise `depth` (or read the related document by id) when you need related fields inline

### Fixed

- Reject a read whose result exceeds ~100KB with a recoverable error telling the agent to narrow the query (where/select/limit/depth). A wide find that populated relationships could otherwise return megabytes -- one real query returned ~2.3MB / ~470k prompt tokens and stalled the turn for ~12 minutes

## [0.7.2] - 2026-06-06

### Fixed

- Pinned `@tanstack/ai-code-mode` and `@tanstack/ai-isolate-node` to exact `0.1.23` (were `^0.1.23`). Fresh installs drifted to newer patches that require a newer `@tanstack/ai` than the pinned `0.23.0`, producing peer-dependency warnings and build breakage
- Documented the `next.config` `serverExternalPackages` entries (`@tanstack/ai-code-mode`, `@tanstack/ai-isolate-node`, `esbuild`, `isolated-vm`) required so Next does not bundle the Code Mode sandbox; without them a fresh install fails to boot with `Unknown module type` / `invalid utf-8` errors
- Pinned the AI provider (`@tanstack/ai-anthropic@^0.11.1`) and `zod@^4.4.3` in the quick-start install command and added a Troubleshooting section; the previously unpinned command pulled an incompatible `@tanstack/ai-anthropic` and a duplicate `zod`, breaking the build and the adapter types

## [0.7.1] - 2026-06-06

### Changed

- Declared the AI provider (`@tanstack/ai-anthropic`, `@tanstack/ai-openai`) and chat adapter (`@chat-adapter/telegram`) packages as optional peer dependencies, so install tooling surfaces version-compatibility guidance for the packages you pass into the plugin. The README quick-start now installs the provider and adapter alongside `payload-agent`

## [0.7.0] - 2026-06-01

### Added

- Added globals support: the agent can read and update Payload globals through new `findGlobal` and `updateGlobal` tools, `getSchema` lists accessible globals (and returns a specific global's generated TypeScript type), and the prompt schema gains an "Available globals" section. Globals are scoped with a new `access.globals` option (`allow` / `deny`; internal `payload-*` globals denied by default). `updateGlobal` is governed by `access.operations.update` and counts against the per-message write limit; Markdown <-> Lexical conversion and `locale` / `fallbackLocale` handling apply to globals exactly as they do to collections. The global tools are exposed only when at least one global is accessible

## [0.6.0] - 2026-06-01

### Breaking Changes

- Removed `timeout` and `memoryLimit` from agent config. Use `maxTokens` instead.
- The agent now denies Payload's internal (`payload-*`) and auth-enabled collections by default. Re-expose any it should manage with `access.collections.allow`, e.g. `access: { collections: { allow: ['users'] } }`
- The agent no longer deletes documents by default. Enable it with `access: { operations: { delete: true } }`

### Added

- Added a per-message write limit (`agent.maxWritesPerMessage`, default 50): the agent can perform at most that many create/update/delete/upload operations per user message, enforced server-side and shared across every Code Mode execution in the turn. Reaching it raises a recoverable error so the agent stops, reports what it changed, and offers to continue; reads are never capped
- Added prompt guardrails: the agent is instructed to treat document content, field values, and fetched text as data rather than instructions, and to confirm before deleting documents or making bulk writes
- Added `access.collections` option (`allow` / `deny`) to scope which collections the agent can read or write. By default internal (`payload-*`) and auth-enabled collections are denied; getSchema, the prompt schema, and every operation are filtered to the accessible set, and `uploadFile` is exposed only when an accessible upload collection exists
- Added `access.operations` option (`create` / `update` / `delete`) to control which write operations the agent can perform. `delete` is off by default; `create` and `update` are on. A disabled operation's tool is not exposed to the agent at all, and `uploadFile` is governed by `create`
- Added SSRF protection to URL uploads: `uploadFile({ url })` only fetches http(s) URLs that resolve to publicly routable addresses (loopback, private, link-local, and cloud-metadata ranges are blocked), re-validates every redirect hop, and bounds the request with a timeout and a 25 MB size cap
- Added `access.serviceUser` to make the agent act as a specific Payload user (by `{ collection, id }` or a resolver function). When set, every operation runs with `overrideAccess: false`, so Payload's own collection access, field-level access, and hooks apply. Without it the agent keeps full access, now with a production warning recommending you configure it
- Added `access.authorize(ctx)` to gate which inbound chat messages the agent answers (`ctx` has `platform`, `threadId`, `userId`, `userName`, and the raw `message`/`thread`). It fails closed: a thrown gate refuses rather than allows. `access.unauthorizedMessage` customizes the refusal (set to `null` to stay silent)
- Added type grounding: `getSchema` called with a specific collection now returns that collection's generated TypeScript (sliced from `payload-types.ts` via `config.typescript.outputFile`), including its block discriminated unions and referenced sub-interfaces, so the agent writes `data` against your real shapes. Falls back to the structural schema when the generated file is unavailable, with a startup hint to run `payload generate:types`

- Added `handleMessageStream` method to agent for streaming responses via `AsyncIterable<string>`
- Added typing heartbeat during agent message processing
- Added `select` option to `find` and `findByID` tools for fetching specific fields only
- Added `maxTokens` option to agent config (default: 4096)
- Added token limit error detection with user-friendly truncation notice
- Added Anthropic prompt caching on the system prompts to reduce token cost and latency on repeated turns (ignored by providers without prompt caching)
- Added Markdown exchange for richText (Lexical) fields: the agent reads and writes Markdown, and the plugin converts to and from Lexical editor state using Payload's official field-aware converters (`@payloadcms/richtext-lexical`). Conversion follows each field's enabled features and recurses into groups, arrays, blocks, and tabs. Raw Lexical objects passed on write are preserved untouched as an escape hatch
- Added `richText` plugin option (`'markdown' | 'lexical'`, default `'markdown'`) to control how richText fields are exchanged with the agent
- Added `concurrency` plugin option to control how concurrent messages on the same thread are handled (e.g. `'queue'` to avoid dropping a follow-up that arrives mid-reply)
- Added a production warning when no `state` adapter is configured (`NODE_ENV=production`), since in-memory state does not persist or scale across instances
- Added localization support: when Payload `localization` is enabled, `find`, `findByID`, `create`, `update`, and `count` accept `locale` and `fallbackLocale`, the schema reports which fields are `localized`, and the agent is prompted with the available locales and the read-all/translate/write-per-locale workflow
- Added per-locale richText conversion: a `locale: 'all'` read returns each localized richText field as a Markdown map keyed by locale, and writing a per-locale object to a richText field is rejected (it would corrupt the field) with a self-correcting error
- Added media uploads: a `uploadFile` tool (exposed when an upload-enabled collection exists) saves a file the user attached in chat, or one fetched from a URL, to an upload collection. Inbound attachments are registered server-side and surfaced to the agent as an `attachmentId`, so file bytes never cross the Code Mode sandbox boundary. The file's type and extension are sniffed from its magic bytes when the platform omits them (e.g. Telegram photos), and the schema now reports `relationTo` so the agent can link an upload to a relationship field

### Changed

- Upgraded dependencies: TanStack AI 0.23, Chat SDK 4.29, Payload 3.85, and related packages
- Replaced the custom Telegram post+edit streaming with Chat SDK native per-platform streaming, which adds markdown healing and GFM table buffering
- Added `@payloadcms/richtext-lexical` as an optional peer dependency (used for richText Markdown conversion; conversion is skipped when it is not installed)
- Conversation history is now persisted per thread in the configured state adapter instead of an in-process map, so it survives restarts and is shared across instances when a persistent adapter (Redis/Postgres) is used

### Fixed

- Restored model error reporting and token-limit detection: read the `RUN_ERROR` message from the top-level `message` field, which TanStack AI 0.11+ moved off the now-deprecated nested `error` object
