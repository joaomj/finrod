# Architecture

Finrod is a single-host personal assistant. Telegram provides the interface;
Pi Durable owns conversation execution. The core stays small by using Pi's
provider collection, extension registry, tools, and recovery machinery.
Finrod does not implement a separate plugin framework or a model tool loop.

## Components

| Component | Responsibility | Implementation |
| --- | --- | --- |
| Service composition | Validate configuration, acquire a process lock, start and close components | `src/main.ts`, `src/config.ts` |
| Conversation runtime | Open SQLite, install extensions, restore MCP tools, submit stable requests, return answer metadata | `src/runtime.ts` |
| Telegram adapter | Authorize intake, poll updates, deliver replies, accept feedback callbacks | `src/telegram/adapter.ts` |
| Telegram ledger | Persist inbox, cursor, outbox, bot identity, reply references, and votes | `src/telegram/store.ts` |
| Assistant instructions | Conversation behavior and explicit-save policy | `src/extensions/persona.ts` |
| Knowledge extension | List, read, save, correct, and delete scoped Markdown topics | `src/extensions/knowledge.ts` |
| Transcription | Convert voice-note bytes to text through a configured HTTP provider | `src/transcription.ts` |
| Reply contract | Associate answer text with its Durable and model identifiers | `src/reply.ts` |
| Feedback export | Read private metadata as JSON Lines without loading credentials or mutating state | `src/feedback-export.ts` |

### Request flow

1. Telegram updates arrive through outbound long polling.
2. Authorized text and voice updates enter the SQLite inbox before the cursor advances.
3. For voice input, Finrod downloads the audio and stores a completed transcript.
4. The runtime submits the text to the root conversation with a stable request ID.
5. Pi Durable runs model turns and selected tools, then stores the answer.
6. Finrod records the answer's references and outgoing message parts atomically.
7. Telegram delivery records move from pending to sending to sent, or uncertain.
8. Owner feedback callbacks update local metadata without starting model turns.

The v0 worker is sequential. Messages arriving during a model turn remain queued
at Telegram until the next poll. Feedback callbacks also wait for that turn.
This keeps orchestration small but can delay feedback confirmation.

## Runtime and extensions

The application pins Pi Durable, Pi AI, and Chord at `1.1.0`, and the third-party
`pi-mcp-client` adapter at `0.12.0`. The MCP client SDK is overridden to `2.2.0`
to avoid the OAuth credential-routing vulnerability reported against `2.1.0`.
Package versions are locked in `package-lock.json`.

The runtime installs the persona, knowledge, and Durable MCP extensions. New
root conversations receive an explicit baseline tool list. MCP restores
persisted tool registrations before `harness.resume()`. Runtime code never
installs Pi's coding tools or supplies a general execution environment.

Add capabilities as scoped Pi Durable extensions. Keep Telegram interaction
logic in the adapter and provider protocols outside it. Extension code is trusted
application code; Pi's registry is not a sandbox for arbitrary third-party code.
The current application composes extensions in source, not through automatic
package discovery.

Finrod uses one root conversation. Topic summaries restore context within that
conversation; they do not create independent branches. Pi Durable retains raw
conversation history behind compaction summaries.

## Storage and recovery

`FINROD_DATA_DIR` defaults to `~/.local/share/finrod`. It is separate from the
checkout and credential file. The [operations guide](OPERATIONS.md) describes
backups and migration.

### Durable database

`conversation.sqlite` stores Pi Durable conversations, entries, submissions,
tasks, and documents. Request IDs use the bot ID and Telegram update ID.
Resubmitting the same request after a crash finds the same Durable submission.
The response metadata uses the provider and model from the stored assistant
message, not merely the current configuration.

The pinned SQLite backend uses WAL with `synchronous=NORMAL`. Process crashes
and host power failures are different: recent conversation commits can be lost
after a power failure. Backups remain necessary.

### Telegram database

`telegram.sqlite` uses WAL with `synchronous=FULL`:

| Table | Contents |
| --- | --- |
| `identity` | Bound bot and owner IDs; startup rejects a different identity |
| `cursor` | Next Telegram update offset |
| `inbox` | Authorized input payload, optional transcript, processing outcome |
| `outbox` | Reply text and part number, source update, delivery state, Telegram message ID |
| `reply_metadata` | Request ID, conversation ID, submission ID, answer entry ID, provider, model |
| `feedback` | One current vote per delivery, owner ID, latest callback update ID, UTC timestamps |

Intake and cursor advancement share a transaction. Completed work and its
outgoing parts share another transaction. Stable Durable request IDs bridge the
two databases; there is no transaction spanning Telegram and Durable storage.

Telegram cannot guarantee exactly-once delivery. A crash or network loss after
sending but before recording the response leaves an uncertain outcome. Startup
moves unfinished sending records to uncertain rather than resending them.
`/status` exposes their recorded text. Unexpected processing errors create a
failure notice, mark the input failed, and propagate to the service process.

A separate `process-lock.sqlite` holds an exclusive transaction for the lifetime
of the process. It prevents concurrent owners of the same local directory, not
instances on different hosts or instances using different directories.

### Feedback

Only new model-generated replies receive feedback buttons. Each button carries
the delivery ID and vote. The adapter checks the callback user's identity and
private-chat context. The store requires the delivery ID, chat ID, and sent
Telegram message ID to match a rated model reply before recording a vote.

The vote and callback cursor advance atomically. A newer callback can change the
vote; repeated or older callbacks cannot overwrite newer state. The first-vote
timestamp stays fixed, and the change timestamp advances only when the vote
changes. Only the latest vote is retained. No automatic training, evaluation,
or prompt changes consume feedback.

Split Telegram messages are independently rateable. Their part numbers point to
the same Durable answer. Export joins the current vote to the source message,
reply, and model identifiers without including message text. Export uses a
read-only SQLite connection, so it cannot run startup recovery or alter votes.

### Knowledge pages

`knowledge/` holds one Markdown page per saved topic. Tools restrict topic IDs
to a short lowercase slug, refuse symlinks on reads, and limit pages to 64 KiB.
Writes use a private temporary file, file synchronization, atomic replacement,
and directory synchronization. Tool calls execute sequentially.

Read tools are replay-safe. Save and delete tools are replay-unsafe: an
interrupted call reports interruption rather than silently repeating a mutation.
Saved pages contain a reference to their conversation and writing tool task.
Related topics use Markdown links; web sources remain URLs in the page.

The instruction to save only on explicit request is model behavior, not a
semantic authorization engine. File confinement is enforced separately by the
scoped tool interface. Deleting a page does not erase its earlier content from
conversation history or backups. There is no QMD index in v0.

## External services

### Exa

The Durable MCP adapter connects to the hosted Exa endpoint with only
`web_search_exa` and `web_fetch_exa` enabled. Client-side exposure is hidden by
default, with exact exceptions for those two tools. The model cannot activate
other Exa tools merely because a server advertises them.

`EXA_API_KEY`, when configured, is sent as `x-api-key`. Omitting it selects Exa's
free keyless access. Authentication uses account billing and limits, not unlimited
access. There is no fallback that removes a configured key after failure.
Interrupted MCP calls are not automatically replayed by the adapter.

### Voice

The default provider is OpenRouter with `openai/whisper-large-v3`. Requests go to
`/audio/transcriptions` as base64 JSON with `provider.zdr=true`; there is no
fallback that relaxes ZDR. The local OpenAI-compatible adapter uses multipart
uploads to the same endpoint path and accepts an optional authentication key.
These transports do not use the Responses API.

Telegram audio is downloaded into memory with a 20 MiB limit. Finrod retains the
transcript, not a local audio recording. A crash before transcript persistence
can repeat transcription and its charge. Large recordings are not automatically
split and can exceed upstream processing limits.

## Configuration alternatives

`FINROD_MODEL_PROVIDER` supports `openrouter`, `anthropic`, and `openai`.
`FINROD_MODEL` must name a model in that provider's pinned Pi catalog. Direct
Anthropic and OpenAI providers use `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
The current user selected OpenRouter `anthropic/claude-haiku-5.5`.

For local Whisper:

```dotenv
TRANSCRIPTION_PROVIDER=openai-compatible
TRANSCRIPTION_BASE_URL=http://127.0.0.1:8000/v1
TRANSCRIPTION_MODEL=whisper-1
```

Use the model ID your server accepts. Set `TRANSCRIPTION_API_KEY` if required.
Remote transcription endpoints must use HTTPS; HTTP is restricted to loopback.
Changing providers is a configuration operation, not a Telegram adapter change.

Changing `FINROD_DATA_DIR` requires updating the service's `ReadWritePaths` too.
Use an absolute path outside the checkout. Credentials are process environment
settings, not model-accessible files or prompt content.

## Security and privacy boundaries

- Telegram accepts only the configured owner in private chats.
- External sources stay read-only. Finrod can write its own conversation,
  knowledge, operational state, and feedback.
- The model has no shell, coding, or unrestricted filesystem tools.
- Web content and tool output are untrusted source material, not instructions.
- OpenRouter account-wide ZDR can cover chat; the application additionally
  requires it per transcription request. The user reports account-wide ZDR enabled.
- ZDR does not cover Telegram, Exa, local databases, logs, or backups.
- The systemd template restricts writes to the data directory and private temporary
  storage. It runs as the user, not root, with `NoNewPrivileges` and private files.
- Known secret environment values are redacted from application error messages.
  Logs can still contain personal provider error content; protect them accordingly.

## Verification and limits

Run the narrow checks from the checkout:

```sh
npm run check
npm run test:telegram
npm run build && node --test test/knowledge.test.mjs
```

The Telegram integration tests use a local HTTP server and real SQLite. They
cover owner-only input, duplicate updates, uncertain delivery after reopen, and
feedback linked to the correct messages across restart. Feedback checks include
changed and repeated votes, foreign-click rejection, and metadata export.

The knowledge test uses Pi's scripted provider with real Durable storage and
Markdown files. It covers save, correction, reopen, submission deduplication,
path restrictions, and deletion. These tests do not establish model quality,
real transcription, or live external connectivity.

The user has observed live text replies. Voice, live feedback, restart continuity,
backup restore, and VPS migration still need confirmation. No clock tool is
installed: date answers inferred from web pages can be incorrect or use the
wrong timezone. Feedback records this kind of issue but does not fix it.

See [PRODUCT.md](../PRODUCT.md) for research and approved scope, and OpenRouter's
[speech-to-text guide](https://openrouter.ai/docs/guides/overview/multimodal/stt)
for transcription request and ZDR details.
