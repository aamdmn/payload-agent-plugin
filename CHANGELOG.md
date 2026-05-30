# Changelog

## [Unreleased]

### Breaking Changes

- Removed `timeout` and `memoryLimit` from agent config. Use `maxTokens` instead.

### Added

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
