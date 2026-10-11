# Product requirements: phone-local Finrod

**Status:** implemented as an unreleased browser prototype; phone acceptance is pending.
The browser runtime uses Pi agent-core with direct IndexedDB persistence and
native Pi MCP connections. Desktop Brave verification passes; this is not a
claim of verified iPhone operation.
This document defines the phone version. It does not change the existing
Telegram runtime or its single-owner boundary.

## Purpose and user

Each person runs an independent Finrod instance entirely on their phone.
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

- **Execution stays on the phone.** Run the assistant and tool orchestration in
  the browser. A static website distributes application files only.
- **Pi supplies the agent engine.** Use `@earendil-works/pi-agent-core` and Pi AI.
  Do not implement a second model or tool execution loop.
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

Replace Pi Durable in the phone version with `@earendil-works/pi-agent-core`.
Keep Pi Durable in the existing Telegram/server version.

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
| Web research | Search and retrieve pages through Exa MCP. Return source links and distinguish retrieved evidence from unsupported claims. |
| Date-aware questions | Supply the device's current date and timezone so relative dates have an explicit reference. Treat the device clock as a reference, not verified external time. |
| Local continuity | Restore saved history and usable model context after closing and reopening the browser. Re-enter credentials when required. |
| Visible progress | Stream replies and periodically persist partial progress. Identify restored partial replies as incomplete. |
| Safe interruption | Cancel active work when the page becomes hidden where cancellation is possible. On reopening, mark unfinished work interrupted without automatically replaying model or tool requests. |
| Reliable persistence | Save input before starting paid work. Save finalized assistant and tool messages before continuing the model/tool loop. Report saving failures and block unsafe continuation. |
| One history writer | Prevent concurrent pages from writing the same local conversation. Explain how to release the conflict. |
| Recoverable data | Export history to a user-controlled file and restore it into a local instance, without a required cloud backup. |
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
`@earendil-works/pi-mcp`, not the third-party `pi-mcp-client` adapter or a custom
protocol implementation. Connect directly from the phone over streamable HTTP.

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
production quota. Explain rate limits and paid usage before requiring credentials.
Do not publish a shared operator key in the application.

Exa's direct REST API is not the selected initial integration. Live preflight
checks permitted `http://localhost:4173` but did not permit the current
`http://127.0.0.1:4173` origin or a representative custom HTTPS origin. Verify the
actual hosting origin before any future API integration. Do not add a proxy to
bypass browser restrictions without a separate product decision.

## Privacy, credentials, and hosting

The approved initial credential behavior keeps the OpenRouter key in page
memory. Users enter it again after reload or reopening. Stored credentials are
not an initial requirement. Any optional personal tool key must have an explicit
storage policy; do not silently persist it.

OpenRouter and its selected inference provider receive submitted model context.
Exa receives tool queries and requested URLs. These services have separate
billing, retention, and availability policies. Explain these boundaries before
normal use. Keep credentials out of model context, logs, exports, and static
application files.

Local history is not application-encrypted. Device access, browser access,
malicious application updates, and compromised hosting remain trust boundaries.
Static hosting does not make the software distributor unable to access data
through modified client code. Do not claim end-to-end encryption.

Browser-data deletion, storage eviction, or device loss can remove local history.
Export and restore provide recovery only when the user has a usable backup.
The application must not describe IndexedDB as permanent storage.

## Initial non-goals

- A native iOS application or App Store distribution.
- A Finrod conversation backend, local computer service, or VPS dependency.
- Telegram integration in the phone version.
- Background execution, scheduled work, or automatic replay of unfinished work.
- Shared accounts, shared history, or automatic synchronization.
- Local model inference.
- Voice, imported-history retrieval, or the server version's complete tool set.
- A new agent engine, memory framework, or general-purpose extension platform.

Home Screen installation is optional polish, not a requirement for initial
acceptance. Additional capabilities require explicit scope approval.

## Current evidence and remaining verification

The original Durable prototype was exercised manually in desktop Brave: the
user reported a model conversation and history surviving close/reopen.

The new implementation passes server typechecking and browser typechecking and
bundling. Three controlled browser scenarios cover real legacy database
migration, research, reopen, export/restore, writer locking, interrupted tool
recovery, storage failure, provider failure, and credential redaction.

Live desktop Brave checks confirm direct native MCP search and a complete Haiku
research conversation through OpenRouter and Exa, with a cited source.
These checks do not establish phone compatibility or large-history capacity.
Actual phone sessions, phone-only setup, abrupt device termination, and remote CI
remain unverified. See [Browser prototype](BROWSER.md) for commands and limits.

**Release gate:** on the target phones, complete setup, exchange model messages,
perform web research, reopen saved history, observe an interrupted request,
and export and restore data. Confirm that normal operation uses no Finrod
backend. Confirm preservation of the existing prototype history during migration.

## References

- [Browser prototype](BROWSER.md): current implementation and preview procedure.
- [Roadmap](ROADMAP.md#priority-phone-local-browser-operation): agreed phone outcomes.
- [Server PRD](PRD.md): separate Telegram product and owner boundary.
- [Pi agent-core](https://github.com/earendil-works/pi/tree/main/packages/agent): agent engine and lifecycle contracts.
- [Pi MCP](https://github.com/earendil-works/pi/tree/main/packages/mcp): native client and transports.
- [Exa MCP](https://exa.ai/docs/get-started/exa-mcp): remote endpoint and authentication modes.
