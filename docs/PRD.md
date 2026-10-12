# Product requirements: Finrod

**Status:** browser implementation with partial phone verification. The user
reports successful iPhone/Brave conversations, reopening, personal-key Exa
research, and saved-key restoration. The full phone acceptance gate remains open.
See [Validation](VALIDATION.md) for evidence and remaining gaps.

## Purpose and user

Each person runs an independent Finrod instance entirely on their phone.
Finrod is an AI chat companion, not a coding platform. The target experience
is close to ChatGPT's core chat experience, without its additional product surfaces.
Finrod supports conversation and web research without a personal computer,
VPS, or Finrod backend. External model and tool services still require network
access. Phone-local operation is not offline operation.

The initial browser targets are Brave on the user's iPhone and Chrome for the
second user. The second user's phone platform must be confirmed before device
acceptance. Desktop Brave is a development and validation environment, not a
substitute for phone acceptance.

Each browser installation owns its history and credentials. Two people opening
the same website do not share a conversation, account, or local database.

## Principles

- **Conversation is the product.** Use a minimal, dark-only chat interface.
  Keep credentials and backup controls in Settings. Web research supports the
  conversation; it is not a general-purpose agent interface. Do not add Dots,
  Projects, Codex, Work, task dashboards, workspace panels, or coding-platform controls.
- **Execution stays on the phone.** Run the assistant and tool orchestration in
  the browser. A static website distributes application files only.
- **Product features define requirements.** Pi is an implementation choice,
  not a product requirement. The current runtime uses `@earendil-works/pi-agent-core`
  and Pi AI. Reuse that runtime instead of duplicating its model or tool execution loop.
- **Use only necessary machinery.** Avoid persistent task scheduling, subagents,
  task graphs, codemode, dynamic tool search, and a general plugin framework in
  the initial version.
- **Data stays local by default.** Store history in the device's browser.
  Do not silently upload history, backups, or credentials to a Finrod service.
- **Failures remain visible.** Report incomplete answers, failed tool calls,
  provider errors, and storage failures. Do not imply that interrupted work
  completed.
- **Foreground use is sufficient.** Finrod only needs to execute while its page
  remains open and visible. Unattended background operation is not required.

## Approved runtime decision

This decision describes the selected implementation, not a permanent requirement
to use Pi. Pi makes functionality integration easier through extensions and Model
Context Protocol (MCP) support. Evaluate runtime changes against product features,
privacy, reliability, and maintenance cost.

Normal browser execution uses `@earendil-works/pi-agent-core`. Pi Durable remains
only for migrating earlier browser histories.

The phone experience requires saved conversations, streamed replies, direct
remote tools, and explicit interruption behavior. It does not require durable
workflow replay or automatic task resumption. The original prototype cancelled
unfinished work on reopening rather than using Durable's resumption capability.

Use IndexedDB directly for conversation records. Normal phone execution does not
use Chord, SQLite, sql.js, or a full-database snapshot adapter. The old snapshot
adapter exported the complete SQLite database for each persisted commit.
That storage cost came from the adapter, not from an inherent Durable limit.
Load the old runtime and SQLite only for the one-time prototype migration.
Retain the original snapshot as a recovery copy until a separate retention
decision permits its removal.

Agent-core owns model requests, tool execution, and cancellation. Finrod owns
local persistence, browser lifecycle behavior, and recovery presentation.
Persistence must cover tool messages as well as visible chat text.

The smaller runtime does not remove the need for reliable storage. Reconsider
durable execution only if an approved requirement needs resumable workflows.
Do not add that machinery for hypothetical future features.

## Requirements and acceptance

| User outcome | Acceptance criterion |
| --- | --- |
| Phone-only setup | Open an HTTPS URL and configure personal provider access from the phone, without SSH, another computer, or server administration. |
| Independent operation | Execute conversation logic and tools on the phone, with no Finrod backend or existing server dependency. |
| Model conversation | Use OpenRouter directly, with `anthropic/claude-haiku-5.5` as the initial default. Show the selected model and the external inference boundary. |
| Web research | Search and retrieve pages through Exa MCP. Support an optional personal Exa key. Return source links, distinguish retrieved evidence from unsupported claims, and show rate-limit responses as failed research. |
| Date-aware questions | Supply the device's current date and timezone so relative dates have an explicit reference. Treat the device clock as a reference, not verified external time. |
| Local continuity | Restore saved history and usable model context after closing and reopening the browser. Re-enter credentials when required. |
| Chat-first interface | Show a dark-only chat view, New chat, a hidden-by-default sidebar, formatted answers, source links, an expanding composer, and compact research activity. Respect the reader when they scroll away from new output. |
| Separate conversations | Assign sequential session IDs and isolate each chat's model context. Preserve the current conversation during migration. Keep the provider key shared within this browser. |
| Conversation titles | After a new chat's first successful reply, make one small tool-free model request for its title. Do not block chatting, add the title exchange to model context, or automatically retry failed titles. |
| Visible progress | Stream replies and periodically persist partial progress. Identify restored partial replies as incomplete. |
| Safe interruption | Cancel active work when the page becomes hidden where cancellation is possible. On reopening, mark unfinished work interrupted without automatically replaying model or tool requests. |
| Reliable persistence | Save input before starting paid work. Save finalized assistant and tool messages before continuing the model/tool loop. Report saving failures and block unsafe continuation. |
| One history writer | Permit one page to write this browser's chat library. Explain how to release the conflict. |
| Recoverable data | Export all chats, IDs, and titles to a user-controlled file and restore them into a local instance, without a required cloud backup. Preserve the saved provider key separately. |
| Existing-data preservation | Preserve the prototype's saved conversation during the runtime migration. Do not reset browser data as an installation step. |
| Independent users | Verify separate local history and credentials for each person's browser installation. No automatic cross-device synchronization is required. |

A completed request must have a clear completion state. An interrupted tool call
must not become a successful result or leave invalid model context. Cancellation
cannot guarantee that an external provider stops work or cancels charges.

Browser shutdown can prevent final asynchronous writes. Bound partial-progress
loss through periodic saves; do not promise that every displayed token survives
an abrupt close. A saved history does not establish interruption correctness.

## MCP integration

Use Model Context Protocol (MCP) for the initial Exa integration. Reuse
`@earendil-works/pi-mcp` rather than a custom protocol implementation. Connect
directly from the phone over streamable HTTP.

Expose only these initial tools directly to the model:

- `web_search_exa`: search for external evidence.
- `web_fetch_exa`: retrieve content from known URLs.

Use a thin adapter from MCP tools to agent-core tools. Preserve cancellation and
error reporting. Do not add codemode or tool discovery infrastructure for two
known tools. Do not expose shell, coding, or unrestricted filesystem tools.

The published native Pi MCP `1.1.0` package requires browser adaptation:
its public entry imports Node-only stdio code, and its HTTP stream parser uses
`Buffer.byteLength()`. The browser build excludes stdio and uses `TextEncoder`
for byte counting. Limit adaptations to this path; do not replace the client or
introduce a Node runtime on the phone.

Exa documents keyless, rate-limited MCP access and personal API-key access.
Keyless access is suitable for initial connection validation, not a guaranteed
production quota. Explain rate limits and paid usage before using credentials.
Accept an optional personal Exa API key in Settings. The same key authenticates
Exa MCP. Send it in the `x-api-key` header, not a URL. A failed keyed request must
remain visible; do not silently remove the key or switch to free access.
Do not publish a shared operator key in the application.

Exa's direct REST API is not the selected initial integration. Live preflight
checks permitted `http://localhost:4173` but did not permit the current
`http://127.0.0.1:4173` origin or a representative custom HTTPS origin. Verify the
actual hosting origin before any future API integration. Do not add a proxy to
bypass browser restrictions without a separate product decision.

## Privacy, credentials, and hosting

The approved credential behavior saves the OpenRouter key locally after the user
selects Done in Settings. Restore it after reload or reopening. Store it in
localStorage, separate from the IndexedDB conversation records. Provide a
**Forget key** control that removes the saved key without changing history.
History export and restore must not include or replace the key. Explain that the
saved key is not application-encrypted and recommend a spending-limited key.
Save an optional personal Exa key in localStorage under `finrod.exa-key`,
separately from conversation records and the model key. Restore it on reopening.
Provide **Forget Exa key** without changing history. History export and restore
must not include or replace either saved key. Saving and removing the Exa key
use the same explicit Settings controls as the model key.

OpenRouter and its selected inference provider receive submitted model context.
Exa receives tool queries and requested URLs. These services have separate
billing, retention, and availability policies. Explain these boundaries before
normal use. Keep credentials out of model context, logs, exports, and static
application files.

Local history and saved keys are not application-encrypted. Planned local
encryption and complete conversation-log export belong in [Roadmap](ROADMAP.md).
These plans do not change the current privacy guarantees. Device access, browser access,
malicious application updates, and compromised hosting remain trust boundaries.
Static hosting does not make the software distributor unable to access data
through modified client code. Do not claim end-to-end encryption.

Browser-data deletion, storage eviction, or device loss can remove local history.
Export and restore provide recovery only when the user has a usable backup.
The application must not describe IndexedDB as permanent storage.

## Initial non-goals

- A native iOS application or App Store distribution.
- A Finrod conversation backend, local computer service, or VPS dependency.
- Background execution, scheduled work, or automatic replay of unfinished work.
- Shared accounts, shared history, or automatic synchronization.
- Local model inference.
- Voice, imported-history retrieval, or saved-topic tools.
- A new agent engine, memory framework, or general-purpose extension platform.

Home Screen installation is optional polish, not a requirement for initial
acceptance. Additional capabilities require explicit scope approval.

## Current evidence and remaining verification

The three controlled browser scenarios cover real legacy database migration,
research, separate context, sequential chat IDs, titles, reopening, writer
locking, export/restore, interruption, storage failures, and credential redaction.
The same scenarios cover personal Exa-key storage, header authentication,
visible rate-limit failures, and rejected keys without fallback to free access.

User-reported iPhone/Brave checks confirm conversations, saved history after
reopening, live research with a personal Exa key, and key restoration. These
observations do not establish interruption recovery, phone export/restore,
second-user compatibility, or large-history capacity. Detailed evidence belongs
in [Validation](VALIDATION.md), not in the acceptance requirements.

**Release gate:** on both target phones, complete setup, exchange model messages,
perform web research, reopen saved history, observe an interrupted request,
and export and restore data. Confirm independent browser history and credentials.
Confirm that normal operation uses no Finrod conversation backend. Preserve
existing browser history during migration without replaying requests.

## References

- [Browser](BROWSER.md): current behavior and preview procedure.
- [Architecture](ARCHITECTURE.md): implemented components and persistence.
- [Roadmap](ROADMAP.md): planned protection and complete log export.
- [Pi agent-core](https://github.com/earendil-works/pi/tree/main/packages/agent): agent engine and lifecycle contracts.
- [Pi MCP](https://github.com/earendil-works/pi/tree/main/packages/mcp): native client and transports.
- [Exa MCP](https://exa.ai/docs/get-started/exa-mcp): remote endpoint and authentication modes.
