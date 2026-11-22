# Changelog

This file records user-facing changes.

## [Unreleased]

### Changed

- Finrod no longer reports each wiki update. Once a week, after the wiki cleanup, it sends a numbered list of the facts it learned since the last list, such as A1 and A2 for the first page. Reply with a number to correct a fact, such as "remova A2" or "B1: na verdade é ...". The first list holds every fact in the wiki. A 👎 no longer undoes an update.

### Fixed

- Answers reach Element again after a message too large for Matrix. Since 2026-11-20, a large wiki report was refused by the Matrix server and held back every later answer. Finrod now splits a long answer into several messages, and if the Matrix server still refuses a message, Finrod sends a short notice in its place and goes on.

## [0.11.0] - 2026-11-21

### Added

- Every OpenRouter request demands zero data retention and no data collection, whatever the account settings are.
- Canary tokens: set `FINROD_CANARY_FILE` to a file with tokens from canarytokens.org, and every prompt carries them, so their alert reports a leaked prompt. See Canary in `docs/OPERATIONS.md`.

## [0.10.2] - 2026-11-20

### Changed

- `finrod-update` downloads releases from the public repository without a GitHub token. After the server has installed this release, revoke `finrod-github-release-token` on GitHub and delete it from Proton Pass.

## [0.10.1] - 2026-11-20

### Fixed

- Finrod starts after a reboot again, and the daily update runs again. Both failed because systemd did not find `pass-cli` in `~/.local/bin`. Copy `deploy/systemd/finrod-data.service` and `deploy/systemd/finrod-update.service` to `~/.config/systemd/user/` and run `systemctl --user daemon-reload`.

## [0.10.0] - 2026-11-20

### Added

- Finrod searches everything you and it said before, with BM25 ranking: accents do not matter, and `word*` finds other endings. It searches before it answers about something you told it, and it can read the messages around a result.
- Memory is a wiki of Markdown pages: a core page, pages about people and topics, and an index. After the chat has been quiet for 30 minutes (`FINROD_WIKI_IDLE_SECONDS`), Finrod updates the pages from what was said, and each fact names the message it came from. Each message carries only the core page and the index; Finrod opens other pages when it needs them, so a longer memory no longer makes every request longer. The core page holds at most 2,000 characters and the index at most 60 pages.
- Wiki updates run on `FINROD_WIKI_MODEL`, by default Opus with the Claude subscription, while the chat stays on `FINROD_MODEL`.
- Once a week, when the chat is quiet, Finrod checks the whole wiki against the messages it came from, merges repeats, and removes what is no longer true (`FINROD_WIKI_CLEANUP_SECONDS`).
- After each update, Finrod posts the facts it added and removed. A 👎 on that message undoes the update.
- Finrod can use your ChatGPT history once it is imported: search finds what you and ChatGPT said, and the wiki learns from what you wrote there. Deleting the import takes it out again; see [Operations](docs/OPERATIONS.md#chatgpt-import).
- `deploy/chatgpt-import` imports a ChatGPT data export once and transcribes its recordings with the voice transcriber. ChatGPT's saved memories and images are not imported.

### Changed

- Finrod no longer asks to keep each memory with 👍 or 👎. The memories approved before move into the wiki at the first update, and `memories.enc` is renamed `memories.enc.imported`.
- When the core is down, the gateway no longer answers each message with an error. It puts ⏳ on the message, retries it until the core is back, and removes the ⏳ once the core takes it.
- With `FINROD_PROVIDER=claude-directsdk`, `finrod-update` installs the Claude Code version the release was tested with, named in `claude-code-version`, and a rollback goes back to the previous release's version. Claude Code no longer needs to be updated by hand on the server.

## [0.9.1] - 2026-11-11

### Fixed

- After a change of `FINROD_PROVIDER` or `FINROD_MODEL`, Finrod answers in the existing conversation with the new model. Before, every message there failed with no answer.

## [0.9.0] - 2026-11-11

### Added

- Finrod can answer through the Claude subscription instead of OpenRouter. Set `FINROD_PROVIDER=claude-directsdk` after installing Claude Code on the server and logging in; see Claude subscription in `docs/OPERATIONS.md`. OpenRouter stays the default.

### Changed

- The release archive no longer includes the Agent SDK's bundled Claude Code binaries, about 314 MB; Finrod uses the Claude Code installed on the server.

### Upgrade

- A server still on v0.7.0 cannot update itself: its `finrod-update` reads the private releases without a token. Copy `deploy/finrod-update` from this repository to `~/.local/bin/finrod-update` once, then run it.

## [0.8.0] - 2026-11-08

### Changed

- A voice note is transcribed in one request to Finrod. A Finrod restart can no longer lose a note halfway through.

### Removed

- The plain-text memory file from before v0.6.0 is no longer converted at start.

## [0.7.1] - 2026-11-08

### Fixed

- `finrod-update` works with the private repository. It reads a read-only GitHub token from Proton Pass with the server's agent token and downloads the release through the GitHub API.

## [0.7.0] - 2026-11-08

### Changed

- All of Finrod's data, chats included, is in a gocryptfs folder. At each start, Finrod reads the passphrase from Proton Pass with an agent token sealed to the server, and the passphrase is never stored on the server's disk. `deploy/data-encrypt` sets this up once.

### Removed

- `deploy/memory-key`: the memory file's passphrase now comes from Proton Pass too.

## [0.6.0] - 2026-11-08

### Added

- Memory approval in Element. Finrod posts each memory it proposes as a question; react 👍 to keep it or 👎 to discard it.
- Ask Finrod to forget something, and it deletes that memory.

### Changed

- Memories are encrypted on disk with a key derived from your passphrase, which `deploy/memory-key` seals to the server. `FINROD_MEMORY_KEY_FILE` is required.

### Fixed

- `finrod-update` replaces itself with the copy in each new release, so a change to the update steps reaches the server. It also starts an enabled gateway that is not running.

## [0.5.0] - 2026-11-08

### Removed

- The web app. Element is the only way to talk to Finrod. File attachments, votes, search, deletion, and Exa sign-in went with it; research uses Exa's free tier.
- `FINROD_PUBLIC_URL`.

### Changed

- What you write or say never reaches the system log. Errors name the failed step only; the transcription container has no log.
- Every request to Finrod needs `FINROD_GATEWAY_TOKEN`, and Finrod refuses to start without it.
- Voice transcription is part of the release: `deploy/stt/setup` builds the environment and `deploy/stt/transcribe` runs it.

## [0.4.0] - 2026-11-08

### Added

- Chat with Finrod in Element through a self-hosted Matrix server. A gateway signs in as the Finrod account, answers only in a direct room with a known user, and sends text and voice notes to that user's Finrod. Answers return as formatted, end-to-end encrypted messages, and Element shows typing while Finrod works.
- The gateway keeps its device and encryption keys across restarts, so it stays verified and answers messages sent while it was down.
- `FINROD_GATEWAY_TOKEN`: the gateway proves itself with it; without it, Finrod refuses Matrix messages.

## [0.3.0] - 2026-11-01

### Added

- Finrod runs on the home server as one Node service and opens as a web app on the phone, over the tailnet only.
- One continuous stream per profile, with one divider per day, that any tailnet device can reopen. Search opens as a sheet and jumps to the message.
- Restart safety: every message and answer part is saved before it appears; an answer cut off by a restart shows as interrupted.
- Web research through Exa, with the sources collapsed into one line under each answer (“3 páginas”). Optional sign-in to your own Exa account.
- Images, PDFs, and text files in a message, up to 20 MB each. PDF pages without a text layer are named in the message.
- Thumbs up or down on each answer.
- Memory: Finrod proposes a memory when you state a lasting fact. You approve, edit, or delete it in the memory sheet; only approved memories reach the model.
- Voice input: hold the send button to record, with pause, cancel, and chunked upload. The server transcribes locally with faster-whisper while you speak, so the text is ready a few seconds after you stop, and deletes the audio.
- Messages sent while an answer runs wait in a queue that you can withdraw.
- Keyboard handling for the iPhone: the shell follows `visualViewport`, and the header hides while you type.
- Home-screen install on the iPhone, with a manifest and icons.
- Release archives with checksums, a systemd user service, and a daily update check that rolls back if the new release does not answer.

### Changed

- Finrod is now a personal assistant on the home server. The v0.2.0 browser product is retired.
- The conversation list and temporary conversations are gone.

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
- Full phone acceptance remains open.

## [0.1.0] - 2026-10-10

- Initial release.
