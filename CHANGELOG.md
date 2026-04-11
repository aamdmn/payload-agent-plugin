# Changelog

## [Unreleased]

### Breaking Changes

- Removed markdown-to-Lexical coercion: `create` and `update` tools no longer auto-convert string values to Lexical JSON for richText fields. Pass proper Lexical editor state objects directly.
- Removed `timeout` and `memoryLimit` from agent config. Use `maxTokens` instead.

### Added

- Added `handleMessageStream` method to agent for streaming responses via `AsyncIterable<string>`
- Added Telegram-specific streaming with throttled message editing
- Added typing heartbeat during agent message processing
- Added `select` option to `find` and `findByID` tools for fetching specific fields only
- Added `maxTokens` option to agent config (default: 4096)
- Added token limit error detection with user-friendly truncation notice
