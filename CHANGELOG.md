# Changelog

This file records user-facing changes. See the versioned release notes for
verification evidence and known limits.

## [0.3.0] - 2026-11-01

### Added

- Finrod runs on the home server as one Node service and opens as a web app on the phone, over the tailnet only.
- One continuous stream per profile, with one divider per day, that any tailnet device can reopen. Search opens as a sheet and jumps to the message.
- Restart safety: every message and answer part is saved before it appears; an answer cut off by a restart shows as interrupted.
- Web research through Exa, with the sources collapsed into one line under each answer (“3 páginas”). Optional sign-in to your own Exa account.
- Images, PDFs, and text files in a message, up to 20 MB each. PDF pages without a text layer are named in the message.
- Thumbs up or down on each answer.
- Memory: Finrod proposes a memory when you state a lasting fact. You approve, edit, or delete it in the memory sheet; only approved memories reach the model.
- Voice input: hold the send button to record, with pause, cancel, and chunked upload. The server transcribes locally with faster-whisper and deletes the audio.
- Messages sent while an answer runs wait in a queue that you can withdraw.
- Keyboard handling for the iPhone: the shell follows `visualViewport`, and the header hides while you type.
- Home-screen install on the iPhone, with a manifest and icons.
- Release archives with checksums, a systemd user service, and a daily update check that rolls back if the new release does not answer.

### Changed

- Finrod is now a personal assistant on the home server. The v0.2.0 browser product is retired.
- The conversation list and temporary conversations are gone; the interface follows `docs/ui/interface-2026-11-01.html`.
- The v0.2.0 documents moved to `docs/retired/`.

### Removed

- The browser-only app, its local history, export and restore, and the Cloudflare Pages deployment.

### Known limits

- Voice needs `FINROD_TRANSCRIBE_COMMAND`; recording and the keyboard are not yet verified on an iPhone.
- No way yet to forget a single message.
- One profile per server.
- Chats, files, and memories are not encrypted on the server's disk.
- Two end-to-end tests cover chat and restart safety; the phone checks are done by hand.

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

[0.3.0]: https://github.com/joaomj/finrod/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/joaomj/finrod/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joaomj/finrod/releases/tag/v0.1.0
