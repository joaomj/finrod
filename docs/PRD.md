# Product requirements: Finrod v0

**Status:** v0.1.0 records the single-user architecture validated on the VPS. Core
conversation, voice, feedback, and migration paths are verified live.
[Roadmap](ROADMAP.md) defines the separate multi-user v1 target; it does not
change this release's one-owner boundary.
This is the product requirements document (PRD). It consolidates the existing
scope rather than introducing new capabilities or a second product plan.

## Purpose and user

Finrod helps one person think through questions, research subjects, and return
to unfinished discussions through Telegram text and voice. The user should not
need to reconstruct context after restarting the service or maintain a separate
knowledge application to preserve a useful topic.

Conversation history records what was said. Saved knowledge records what the
user explicitly chooses to retain, correct, connect, or delete. These are related
but distinct responsibilities.

## Principles

- **Pi is the engine.** Reuse Pi Durable for conversation execution, context
  management, tools, and recovery. Inspect existing Pi behavior and the integration
  before adding capabilities. Do not build another agent or plugin framework.
- **The user directs memory.** Change saved knowledge only on explicit request.
  Keep topics inspectable and portable as Markdown.
- **External sources stay read-only.** Do not expose shell, coding, or unrestricted
  filesystem tools to the model. Sending Telegram replies is part of the interface.
- **Failures stay visible.** Report failed work and uncertain delivery. A model's
  confidence or a source link is not proof of factual correctness.
- **Deployment stays small.** Run one instance on one host. Keep credentials and
  persistent data outside the checkout; support migration from local use to a VPS.

## Requirements and acceptance

Statuses distinguish live evidence from local automated coverage. Detailed
observations and limitations belong in [Validation](VALIDATION.md).

| User outcome | Acceptance criterion | Current evidence |
| --- | --- | --- |
| Private access | Only the configured owner can use the bot, in a private chat | Owner flow works live; unauthorized and group rejection covered locally |
| Conversation continuity | Earlier messages remain usable after service and computer restarts | Verified live across local restarts and migration to the VPS |
| Voice conversation | A voice note yields a stored transcript and delivered text answer | Verified live locally and with a fresh voice note on the VPS; interrupted downloads covered locally |
| Web research | The assistant can search and cite sources through the restricted integration | Successful Exa search results and delivered citations inspected; factual quality still needs judgment |
| Explicit topic memory | On request, list, save, resume, correct, link, and delete named topics | List/save/read tools succeeded live; save/resume interaction verified; correction/deletion covered locally |
| Feedback for review | The owner can rate a reply and change the vote; metadata persists without automatically altering behavior | New positive votes verified locally and on the VPS; changes and replay covered locally |
| Visible delivery outcome | Avoid duplicate submissions and do not automatically resend uncertain replies | Local replay and uncertain-delivery checks pass; live failure notice observed |
| Portable operation | Preserve conversation, topics, and operational state through backup restore and single-instance migration | Stopped-service archive restored with integrity/count checks; only the VPS remains enabled; earlier conversation recalled after migration |

The implementation permits a configured chat provider and a separate
transcription service. OpenRouter transcription requires zero data retention
(ZDR) routing; a local OpenAI-compatible alternative is supported. The language
hint is configurable. Exact model selections are deployment choices, not product
requirements. See [Architecture](ARCHITECTURE.md) for configuration and defaults.

## Data and behavior boundaries

- Persist text transcripts and conversation history. Process audio bytes in
  memory rather than saving local recordings. Telegram retains its own copy.
- Resuming a saved topic brings its summary into the current conversation; it
  does not create a separate branch.
- Deleting a topic removes its Markdown page, not its history or backup copies.
- Feedback records the latest vote and its message/model references. It does
  not trigger automatic training, prompt edits, or knowledge changes.
- Provider privacy policies, local storage, logs, and backups are separate boundaries.

## Next steps, in order

### 1. Close the remaining knowledge and answer-quality gaps

Use a disposable topic to confirm correction, related-topic links, and deletion
through Telegram without altering useful saved knowledge. Verify a changed
feedback vote live. Inspect current-date context and ambiguous-name handling in
the existing Pi integration; correct integration or instruction gaps before
considering additional tools. Spot-check cited pages against the answer.

**Done when:** remaining topic operations and changed feedback are observed live,
and the known context/ambiguity problems have an evidence-based diagnosis and
an agreed resolution. Ordinary conversation continuity is already verified;
it is not a prerequisite to repeat.

### 2. Close the remaining operational checks

Stopped-service backup restore and migration are complete. Exercise recovery of
an interrupted turn under controlled conditions; completed-turn continuity does
not establish that behavior. Observe automatic startup at the next planned VPS
reboot. Keep current VPS backups: the retained laptop copy no longer contains
new messages.

**Done when:** the interruption check records whether work resumes, fails
explicitly, or leaves delivery uncertain, and post-reboot startup is observed.
Use the [operations procedure](OPERATIONS.md#backup-and-vps-migration) for future
backups and moves rather than repeating the completed migration as a prerequisite.

### 3. Improve from daily use

Review explicit feedback and answer quality before expanding scope. Prioritize
changes that improve conversation and saved-topic usefulness. New capabilities
require a product decision; adding infrastructure is not itself a success metric.

## Deferred

QMD indexing, automatic memory extraction, autonomous ingestion, background
agents, automatic feedback-driven changes, voice output, groups,
a visual discussion graph, and a feedback dashboard remain outside v0.
Multiple users also remain outside v0; shared-bot support for hundreds of users
is now the planned v1 direction in [Roadmap](ROADMAP.md).

## Document ownership

- [README](../README.md): setup and first use.
- [Architecture](ARCHITECTURE.md): implementation, diagrams, and configuration.
- [Operations](OPERATIONS.md): service management, retention, backup, and migration.
- [Validation](VALIDATION.md): dated evidence, checks, and remaining uncertainty.
- [Roadmap](ROADMAP.md): multi-user v1 design, privacy decisions, and release gates.

This PRD owns user outcomes, scope, boundaries, and priorities. The earlier
research proposal remains in Git history rather than a duplicate active document.
