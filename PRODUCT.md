# Finrod: findings and architecture proposal

## Purpose and status

Finrod is a personal conversational assistant. Its everyday interface is text
and voice through Telegram. It should help the user continue discussions, save
tangents for later, and connect ideas across conversations.

This document records research findings, agreed technical choices, and an
architecture proposal. It is not a product requirements document (PRD).
The initial v0 scope is approved and a first implementation is present.
Local integration tests pass. The user has started the local service and observed
Telegram text replies; voice, feedback, and live recovery still need verification.
See [README.md](README.md) for the current implementation and operating limits.

Conversation history and personal knowledge serve different purposes. History
preserves what was said. Personal knowledge records useful facts, preferences,
decisions, open questions, and connections. The user should be able to inspect,
correct, and delete stored knowledge.

## Approved v0 scope

- One owner-only private Telegram conversation, with text and voice input.
- Exa search and fetch, plus explicitly saved Markdown topic summaries.
- Park and resume topics through summaries in the current conversation.
- Defer QMD, automatic memory extraction, voice output, and background agents.
- Default transcription to OpenRouter `openai/whisper-large-v3`, with mandatory
  ZDR routing. Permit a configured local OpenAI-compatible transcription server.
- Run locally first, with configuration and persistent data separate from code
  so the same service can move to an always-on VPS.
- Keep the core small. Reuse Pi Durable extensions rather than create another
  plugin framework.
- Add owner-only thumbs-up and thumbs-down buttons to new model-generated
  Telegram replies. Store the latest vote, timestamps, reply references, and
  model identity locally. Do not send votes to the model or change behavior
  automatically. Export metadata for later review without message content.

## Agreed direction

- Use **Pi Durable** as the conversation runtime and **SQLite** for its storage.
- Use **Telegram** as the main interface, including voice input.
- Use **`pi-mcp-client/durable`**, the third-party Durable adapter, for Model
  Context Protocol (MCP) connections.
- Include web search in v0 through Exa's **`web_search_exa`** and
  **`web_fetch_exa`** tools.
- Do not adopt **`llm-wiki-mcp`**. Retain useful ideas such as linked Markdown,
  source references, and narrowly scoped knowledge tools.
- Keep external integrations **read-only permanently**. Finrod can write its
  own conversations, knowledge, and operational state. Sending replies through
  Telegram is part of the interface, not permission to modify external sources.
- Keep model providers and knowledge/retrieval components replaceable.
- Reuse existing runtime and retrieval software. Do not build a general-purpose
  memory framework or graph database.
- Do not expose coding tools, shell execution, or unrestricted filesystem access
  to the model.

The discussion graph is a conversational capability, not a canvas requirement.
A user should be able to park a tangent, resume it, and relate it to another
subject through ordinary conversation.

## Proposed architecture

```text
                         User
                          |
                     text / voice
                          |
                       Telegram
                          |
+----------------------- Finrod --------------------------+
|                                                        |
| Telegram adapter                                       |
|   grammY + interaction patterns from pi-telegram        |
|   owner authorization, durable intake/delivery state    |
|   voice download -> transcription provider              |
|                          |                             |
|                     Pi Durable <----> LLM provider      |
|                          |                             |
|          +---------------+------------------+          |
|          |               |                  |          |
|          v               v                  v          |
|       SQLite       Scoped wiki tools   Durable MCP     |
|       runtime      read/save/link      adapter         |
|       storage            |                  |          |
|                          v                  |          |
|                    Markdown wiki            |          |
|                    source references        |          |
+--------------------------|------------------|----------+
                           |                  |
                    local indexing       +----+----+
                           |             |         |
                           v             v         v
                          QMD <------ QMD MCP   Exa MCP
                       local index    retrieval  search/fetch
```

This is a proposed single-host service, not a distributed platform. QMD has its
own local index; that index is distinct from Pi Durable's SQLite storage.
Finrod also needs persistent Telegram routing and delivery state. Its exact
storage layout remains an implementation decision.

### Why these components

| Component | Benefit | Cost or limitation |
| --- | --- | --- |
| Pi Durable | Reuses conversations, forks, context management, queues, and recovery. | Experimental APIs require version pinning and upgrade checks. |
| SQLite | Transactional local storage without a database service. | Requires backups and a deliberate durability configuration. |
| Telegram with grammY | Provides phone access without building a mobile application. | Telegram limits formatting and cannot guarantee exactly-once delivery. |
| Third-party Durable MCP adapter | Already exercised with the selected Durable version. Avoids a custom MCP client bridge. | Adds an experimental integration dependency. |
| Linked Markdown | Keeps knowledge inspectable and portable. | Finrod owns safe writes and the relationship between pages and transcripts. |
| QMD | Reuses local retrieval instead of building a search engine. | Adds indexing and local resource requirements; runtime compatibility remains unverified. |
| Exa | Supplies web search and page retrieval in v0. | Authenticated connectivity, usage costs, and operational limits need validation. |

**grammY** is a TypeScript library for Telegram bots. It handles Telegram API
calls, messages, file retrieval, and replies. It is not an AI runtime or a memory
system. The initial Finrod Telegram adapter now uses grammY. Its live connection remains
unverified. [S5]

### A small knowledge layer

Propose one Markdown page per saved topic, with a summary, open questions,
related topics, and references to conversation entries or web sources.

Expose a small set of tools to read, save, and link these pages. Restrict writes
to Finrod-owned knowledge. Use atomic page replacement and serialized updates.
Treat the retrieval index as rebuildable state, not the authoritative record.

Original conversations and source references remain available behind summaries.
A Markdown page does not replace a transcript or guarantee factual accuracy.

Use QMD through its own MCP server for retrieval. Let the application manage
index updates after page changes; do not expose indexing or unrestricted file
operations to the model. QMD retrieves knowledge; it does not decide what to
remember or maintain the wiki automatically. [S9]

Do not reproduce a generic vault manager, schema framework, autonomous ingestion
pipeline, or visual graph editor. Automatic memory updates, confirmation rules,
and deletion behavior still need product decisions.

## Findings and evidence

### Pi Durable storage: SQLite versus JSONL

Pi Durable's JSONL backend is not a collection of plain chat transcripts. It
uses a commit log plus document and task sidecars, then replays state into
memory. Its default `fsync` setting is false.

The SQLite backend uses Node's built-in `DatabaseSync`. It needs no separate
database service. The inspected implementation uses write-ahead logging and
`PRAGMA synchronous = NORMAL`. [S1]

**Conclusion:** SQLite is operationally simpler for this runtime. Markdown
provides the human-readable knowledge format. Neither backend removes the need
for backups. Default SQLite settings can lose recent commits after power loss,
even when process-crash recovery works.

### Native Pi MCP support versus Durable

Pi's coding-agent runtime has native MCP support. Its public MCP factory uses
the coding-agent extension API and session lifecycle. It is not a direct
Durable integration. The inspected Durable package has no equivalent native
MCP factory. [S2]

The selected third-party adapter provides the Durable integration. Restore its
persisted state before calling `harness.resume()`. Tool availability must be
explicitly restricted; do not rely on model instructions or server-provided
read-only hints as an access boundary. [S3]

Interrupted MCP tool calls are not automatically replayed by the inspected
adapter. Finrod must report or resolve interrupted operations rather than
assume they completed or silently repeat them.

### Mario Zechner's Telegram bridge

`badlogic/pi-telegram` is the strongest Telegram behavior reference. It supports
private messages, attachments, streamed replies, long-reply splitting, stop
requests, and queued follow-ups. Its package declares the MIT license. [S4]

It is not a ready-made Durable transport:

- It connects to a regular Pi session.
- Pending turns remain in memory.
- It persists the Telegram update cursor before handling an update. A crash in
  between can lose that update from processing.
- It downloads voice notes but does not implement transcription.
- The first person to contact an unpaired bot becomes the allowed user.

**Recommendation:** adapt its interaction and streaming patterns. Use an
explicit owner ID and persist incoming work before advancing the Telegram
cursor. Use stable request IDs when submitting work to Durable. Persist outgoing
delivery state, while acknowledging that a crash after sending can still cause
an uncertain delivery outcome.

The bridge uses direct HTTP calls. grammY remains the proposed API library;
reuse of the bridge does not require copying its entire extension.

### Pi's vacation-planning example

Pi includes a non-coding assistant built on Durable. It replaces coding tools
and instructions with vacation-planning behavior. [S6]

The example demonstrates SQLite sessions, restricted tools, background research,
and delivery of a result into the main conversation. Stable request IDs prevent
duplicate submissions and reports during recovery.

**Recommendation:** use its runtime setup and recovery patterns as references.
Do not adopt its terminal interface. Its searches return canned results, so it
is not evidence of a working web-search integration. Background subagents are
optional future behavior, not an added v0 commitment.

### Phone and voice experiments

| Project | Observed behavior | Relevance to Finrod |
| --- | --- | --- |
| `badlogic/pi-termux-mobile` | Fork of `jeamy/pi-termux-mobile`; Android application with Durable, SQLite, chat, and remote sessions. | Useful session/reconnection reference. Do not adopt its Android, terminal, or remote-execution stack. |
| `badlogic/pibot` | Smartphone robot with local speech recognition and synthesis. The inspected harness uses in-memory sessions and a JSON memory list. | Possible voice reference, not a Durable assistant foundation. |
| `badlogic/yakety` | Desktop dictation with local Whisper transcription. | Not a Telegram voice service. |

The mobile application is explicitly experimental and documents Android
background-process failures. Its daemon includes prototype persistence and
event-delivery shortcuts. The full robot stack needs native builds and
substantial local model resources. Neither is a simpler deployment than a
hosted Telegram service. [S7, S8, S12]

### Why `llm-wiki-mcp` was rejected

Inspection of published version `0.2.0` found these issues: [S10]

- Its CLI imports `StdioServerTransport` from an entry point that does not
  export it in the resolved dependency version. Startup fails.
- Its update tool can overwrite files under `raw/`, not only generated pages.
- Page, index, and log writes are separate and non-transactional.
- Its QMD wrapper uses commands and options incompatible with the inspected
  QMD CLI. Search errors become empty results.
- Its ingestion tool returns source material and instructions. The model must
  perform synthesis; the server does not provide autonomous ingestion.

A corrected temporary launcher allowed the exported server to work through the
Durable adapter. A live call also confirmed the raw-source overwrite problem.
The decision is to abandon the package, not maintain a hardened fork.

## Verification performed during initial research

The following packages were installed in an isolated temporary directory with
installation scripts disabled:

- `@earendil-works/pi-durable@1.1.0`
- `pi-mcp-client@0.12.0`
- `llm-wiki-mcp@0.2.0`, for evaluation only

On Node `v22.22.1`, the Durable, adapter, and wiki server imports succeeded.
The wiki server connected through an in-memory MCP transport. With its launcher
import corrected, the Durable adapter discovered and called wiki tools over
stdio. Hidden tools were absent from discovery. Creating and reading a page
worked; overwriting a temporary raw source also worked.

These checks establish limited package and MCP compatibility. They do not prove
Finrod's recovery, delivery, security, or model behavior.

Exa documents the selected search and fetch tools. An unauthenticated direct
handshake attempt returned `HTTP Error 403: Forbidden`. The cause and
authenticated connection remain unresolved. [S11]

The research included source inspection of the Telegram and mobile projects.
Those applications were not run. No real Telegram bot, QMD process, transcription
provider, paid model call, or end-to-end restart scenario was exercised.

## Implementation verification

Three local integration tests exercise Telegram authorization and replay,
uncertain delivery after reopen, saved-topic operations through Durable, and
per-message feedback across restart. The feedback test includes changed and
repeated votes, foreign-click rejection, reply metadata, and read-only export.
The tests use a local HTTP server, Pi's scripted provider, real SQLite files,
and real Markdown pages. They do not establish external connectivity or model
quality.

The user has reported a running local systemd service and provided a Telegram
screenshot with model replies, source links, and a saved-topic acknowledgement.
This establishes live text replies, not independent verification of the cited
facts or saved page. The screenshot also shows a date-handling limitation:
Finrod has no clock tool and relied on web pages for the current date.

Live voice transcription, feedback interaction, restart continuity, backup
restore, and VPS migration remain to be checked. The user selected
`anthropic/claude-haiku-5.5` through OpenRouter for chat and reports account-wide
OpenRouter ZDR enabled.

## Original open questions and validation

The approved v0 scope resolves the initial scope questions above. The original
research questions remain below for reference; provider connectivity, backup
restore, and deployment validation still need live checks:

1. Define how Telegram selects, parks, resumes, and links discussions.
2. Define when knowledge is saved and how correction and deletion work.
3. Select the initial model and transcription providers, including cost and
   privacy constraints. Voice output is not an agreed v0 feature.
4. Select hosting, credential storage, backup, and restore procedures.
5. Confirm whether QMD is necessary for the first usable version and verify its
   native MCP connection, indexing, and resource requirements.
6. Verify authenticated Exa access with only the two selected tools available.
7. Validate durable Telegram intake, interrupted transcription, restart recovery,
   and uncertain outgoing delivery before relying on the service.

The proposed implementation sequence is a narrow Telegram-to-Durable service
with Exa, followed by voice input and saved-topic knowledge/retrieval. The user subsequently approved the v0 scope recorded above.

## Sources

Repository links point to mutable branches. Package versions above identify the
published artifacts used in local compatibility checks. Source inspection and
runtime verification are distinguished throughout this document.

- **S1 — Pi Durable:** [package and documentation](https://github.com/earendil-works/pi/tree/main/packages/durable),
  [JSONL storage](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/jsonl/storage.ts),
  [SQLite setup](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/node.ts).
- **S2 — Native Pi MCP:** [documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md),
  [implementation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/extensions/mcp/index.ts).
- **S3 — Durable MCP adapter:** [documentation](https://github.com/mavam/pi-mcp-client/blob/main/docs/durable.md),
  [implementation](https://github.com/mavam/pi-mcp-client/blob/main/src/durable.ts).
- **S4 — Mario's Telegram bridge:** [repository](https://github.com/badlogic/pi-telegram),
  [implementation](https://github.com/badlogic/pi-telegram/blob/main/index.ts).
- **S5 — grammY:** [official documentation](https://grammy.dev/).
- **S6 — Durable vacation example:** [documentation and source](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/experimental/vacation).
- **S7 — Pi on Android:** [Mario's fork](https://github.com/badlogic/pi-termux-mobile),
  [upstream](https://github.com/jeamy/pi-termux-mobile).
- **S8 — Smartphone robot and voice stack:** [pibot](https://github.com/badlogic/pibot).
- **S9 — QMD:** [repository and usage documentation](https://github.com/tobi/qmd).
- **S10 — Rejected wiki package:** [repository](https://github.com/sumitroajiprabowo/llm-wiki-mcp),
  [wiki manager](https://github.com/sumitroajiprabowo/llm-wiki-mcp/blob/main/src/core/wiki-manager.ts),
  [QMD wrapper](https://github.com/sumitroajiprabowo/llm-wiki-mcp/blob/main/src/search/qmd-provider.ts).
- **S11 — Exa MCP:** [official documentation](https://docs.exa.ai/reference/exa-mcp).
- **S12 — Desktop dictation:** [Yakety](https://github.com/badlogic/yakety).
