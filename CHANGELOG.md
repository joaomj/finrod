# Changelog

This file records user-facing changes. See the versioned release notes for
verification evidence and known limits.

## Unreleased

### Added

- Finrod runs on the home server as one Node service and opens as a web app on the phone, over the tailnet only.
- Text chat with streamed answers, Markdown, and separate conversations that any tailnet device can reopen.
- Restart safety: every message and answer part is saved before it appears; an answer cut off by a restart shows as interrupted.
- Web research through Exa, with the sources listed under each answer. Optional sign-in to your own Exa account.
- Images, PDFs, and text files in a message, up to 20 MB each. PDF pages without a text layer are named in the message.
- Thumbs up or down on each answer.
- Deleting a conversation, with its messages, votes, and stored files.
- Temporary conversations that are never written to disk and end when Finrod restarts.
- Home-screen install on the iPhone, with a manifest and icons.
- Release archives with checksums, a systemd user service, and a daily update check that rolls back if the new release does not answer.

### Changed

- Finrod is now a personal assistant on the home server. The v0.2.0 browser product is retired.
- The v0.2.0 documents moved to `docs/retired/`.

### Removed

- The browser-only app, its local history, export and restore, and the Cloudflare Pages deployment.

### Known limits

- No voice input.
- One profile per server.
- Chats and files are not encrypted on the server's disk.
- The iPhone checks for v0.3.0 are done by hand; there are no automated tests yet.

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
