# Product direction

Finrod is a personal conversational assistant with Telegram text and voice
input. It helps one user continue discussions, save topics for later, and connect
ideas without building a separate productivity platform.

Use the [README](README.md) for setup, [architecture](docs/ARCHITECTURE.md) for
implementation, and [validation record](docs/VALIDATION.md) for current evidence.

## Principles

- **A lean application around Pi.** Use Pi Durable for conversation execution,
  context management, tool orchestration, and recovery. Inspect existing Pi
  behavior and the integration before adding another capability or framework.
- **Explicit knowledge.** Conversation history records what was said. Saved
  knowledge records what the user explicitly asks to preserve, correct, or delete.
- **User control.** Keep external sources read-only. Do not expose shell, coding,
  or unrestricted filesystem tools to the model.
- **Portable state.** Keep credentials, runtime databases, and Markdown topics
  outside the checkout. Support local use and later single-host VPS deployment.
- **Visible limitations.** Report failures and uncertain delivery. Do not treat
  source links, model confidence, or a successful startup as proof of correctness.

## v0 scope

- One owner-only private Telegram conversation with text and voice input.
- Persistent conversation and reply tracking in SQLite.
- Exa search and fetch through a restricted Model Context Protocol (MCP) adapter.
- Named Markdown topics that can be saved, resumed, corrected, linked, and deleted
  on explicit request. Resuming imports a summary into the current conversation.
- OpenRouter Whisper transcription with mandatory zero data retention (ZDR)
  routing, plus a configurable local OpenAI-compatible alternative.
- A configurable transcription language hint, defaulting to Portuguese (`pt`).
- Per-reply positive or negative feedback stored locally with message and model
  references. Feedback does not automatically change prompts or assistant behavior.
- A local systemd user service, with documented backup and VPS migration procedures.

## Boundaries

Deleting a saved topic removes its Markdown page, not its conversation history
or backups. Transcripts persist; audio bytes are processed in memory rather than
saved as local recordings. Provider and Telegram data policies remain separate
from local storage decisions.

Keep the core extensible through Pi's existing mechanisms. Do not build another
plugin system, generic memory framework, retrieval engine, or graph database.
Knowledge remains inspectable Markdown. The rejected `llm-wiki-mcp` integration
is not part of the application.

## Deferred

- QMD indexing and automatic memory extraction.
- Autonomous ingestion, background agents, and automatic feedback-driven changes.
- Voice output, group chats, and multiple users.
- A visual discussion graph or feedback dashboard.

## Current priorities

Use the validated conversation, voice, summaries, and feedback paths in daily
work. Check ambiguity and date handling through the existing Pi integration
before proposing new tools. Complete explicit restart-continuity and backup
restore checks before migrating the single running instance to Contabo.
