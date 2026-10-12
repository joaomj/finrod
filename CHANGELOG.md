# Changelog

This file records user-facing changes. See the versioned release notes for
verification evidence and known limits.

## [0.2.0] - 2026-10-12

### Added

- Browser-local chat with a dark interface, streamed answers, Markdown, and source links.
- Separate conversations, sequential chat IDs, automatic titles, and local answer feedback.
- IndexedDB history, reopening, earlier browser migration, and all-chat export/restore.
- Direct OpenRouter inference and Exa MCP research without a Finrod conversation backend.
- Optional personal Exa credentials, with independent model and research key controls.
- Visible interruption, storage failures, and protection against simultaneous history writers.

### Changed

- Finrod is now a browser-only AI chat companion distributed as static files.
- Build commands, CI, requirements, architecture, and operations now target browser chat.

### Fixed

- Exa free-limit text now appears as failed research instead of successful activity.
- Configured credential values are redacted from external results and persisted errors.
- A rejected research key remains visible without silent fallback to free access.

### Removed

- Server runtime, bot integration, Linux installer, service template, and server-only dependencies and tests.

### Known limits

- History, saved keys, and backups are not application-encrypted.
- There is no automatic synchronization, voice, imported-source retrieval, or complete execution-log export.
- Full phone acceptance remains open. See [v0.2.0 release notes](docs/releases/v0.2.0.md).

## [0.1.0] - 2026-10-10

- Initial release. The original GitHub release records its historical scope and evidence.
  It does not describe the current browser architecture.

[0.2.0]: https://github.com/joaomj/finrod/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joaomj/finrod/releases/tag/v0.1.0
