# Architecture

Finrod runs its chat and research logic in the browser. Static hosting serves
application files; it does not process conversations or store chat history.
OpenRouter provides inference, and Exa provides research through Model Context
Protocol (MCP). No Finrod conversation backend is required.

Pi agent-core owns model streaming, tool execution, and cancellation. Finrod owns
browser persistence, chat selection, lifecycle handling, and recovery presentation.
Pi is an implementation choice, not a product requirement. Finrod does not build
a second agent engine or expose a coding environment.

## Components

| Component | Responsibility | Implementation |
| --- | --- | --- |
| Chat interface | Composer, Settings, browser lifecycle, and writer lock | `web/main.ts`, `web/index.html`, `web/style.css` |
| Conversation runtime | Agent execution, saved progress, interruption, and chat selection | `web/runtime.ts` |
| Local storage | IndexedDB transactions, chat records, titles, and feedback | `web/storage.ts` |
| History contracts | Validate messages and backups; recover unfinished work | `web/history.ts`, `web/sessions.ts` |
| Model access | Configure OpenRouter and the initial model | `web/model.ts` |
| Research | Connect native Pi MCP to Exa; map tools and visible failures | `web/mcp.ts` |
| Titles | Make one bounded, tool-free request after the first successful exchange | `web/titles.ts` |
| Presentation | Sidebar, safe Markdown, transcript, and research activity | `web/sidebar.ts`, `web/markdown.ts`, `web/transcript.ts` |
| Feedback | Validate votes and present an optional negative-vote comment | `web/feedback.ts`, `web/feedback-ui.ts` |
| Credentials | Save model and research keys separately; redact configured values | `web/credentials.ts`, `web/research-key.ts`, `web/redaction.ts` |
| Earlier browser migration | Read the original SQLite snapshot without starting requests | `web/legacy.ts` |
| Static distribution | Bundle browser files and serve a local preview | `scripts/build-web.mjs`, `scripts/serve-web.mjs` |

## Request flow

1. The user submits a message from the active chat.
2. Finrod validates provider access and connects directly to Exa for tool schemas.
3. Agent-core starts the turn and saves user input before inference.
4. OpenRouter receives the active chat's model context, device date, and timezone.
5. Agent-core streams replies and executes the two Exa tools sequentially.
6. Finrod saves completed assistant and tool messages before execution continues.
7. Finrod saves the final turn state and displays failures or interruptions.
8. After the first successful exchange, a separate request generates the chat title.

Title requests do not enter chat context or block another chat. Failed titles are
not automatically retried. Feedback changes local records without a model request.
Finrod does not submit one chat's history as another chat's context.

## Storage and recovery

IndexedDB database `finrod-browser`, version 3, contains the chat library:

- `sessions`: IDs, titles, feedback, partial replies, turn state, and record counts.
- `chatMessages`: completed messages keyed by `[session_id, message_index]`.
- `library`: active selection and the next sequential chat ID.

Writes use transactions. Normal turns append completed records rather than
exporting a whole database. Streaming saves partial progress at most once per
500 ms. An abrupt close can lose progress since the last completed save.
A storage failure blocks unsafe continuation until reload.

Web Locks permits one page to write the library. A second page reports the
conflict. Finrod cancels active work when the page becomes hidden where possible.
Reopening marks unfinished turns interrupted and supplies explicit failed results
for unfinished tool calls. Recovery does not replay external requests.
Cancellation cannot guarantee that providers stop processing or cancel charges.

Earlier IndexedDB histories and the original Durable/SQLite browser snapshot
migrate into chat 1. The original records remain untouched as recovery copies.
Only the original snapshot migration loads Pi Durable, Chord, sql.js, and SQLite
WebAssembly. Normal chat execution does not use those dependencies. The browser
test also uses real Durable storage to create its migration input.

The all-chat backup uses format `finrod-phone`, version 2. Each chat contains
version 1 history. Restore validates the complete backup before replacement and
preserves the browser's increasing ID counter. Version 1 single-chat backups
remain supported. Restore does not submit model or tool requests.

## Model and research access

The initial model is `anthropic/claude-haiku-5.5` through OpenRouter. Model
configuration and tool execution use pinned Pi packages, not a separate provider
framework. Dependency versions are locked in `package-lock.json`.

The native Pi MCP client connects directly to
`https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa` over streamable HTTP.
Only `web_search_exa` and `web_fetch_exa` are exposed. Finrod does not expose shell,
filesystem, coding, or dynamically discovered tools.

Pi MCP `1.1.0` needs a browser build adaptation: exclude Node-only stdio exports
and replace HTTP stream byte counting with `TextEncoder`. The build rejects a
changed parser rather than silently applying an incompatible adaptation.

An optional personal Exa key uses the `x-api-key` header, never a URL parameter.
Blank credentials select free, rate-limited access. A rejected keyed request
remains a failure without fallback to free access. Known free-limit text counts
as failed research even when Exa does not set the MCP error flag. Older saved
results display correctly without rewriting their history.

## Privacy and distribution

Saved keys use localStorage, separate from conversation records. The model key
uses `finrod.openrouter-key`; the research key uses `finrod.exa-key`. Settings
saves keys only after **Done**. Export and restore exclude saved keys.
Configured credential values are redacted from external results, displayed
errors, persisted errors, title results, and feedback comments.

History and saved keys are not application-encrypted. Backups contain private
chat and tool content. Browser access, device access, hosting, and updates remain
trust boundaries. Modified application code can access readable local data.
Local encryption and complete diagnostic export are planned in [Roadmap](ROADMAP.md).

OpenRouter and its inference provider receive submitted context. Exa receives
queries and requested URLs. Static hosting does not hide these external requests
or guarantee that administrators cannot change application code.

`npm run build` checks browser types and writes `web-dist/`. The preview server
serves those files only. Publish the complete directory over HTTPS for phone use.
Use a stable origin: another origin has different local history and credentials.
Builds must not include keys, private histories, or local configuration.

## References

- [Product requirements](PRD.md): user outcomes and acceptance criteria.
- [Browser](BROWSER.md): current behavior, preview, migration, and backup format.
- [Operations](OPERATIONS.md): hosting, updates, and recovery.
- [Validation](VALIDATION.md): observed behavior and verification limits.
