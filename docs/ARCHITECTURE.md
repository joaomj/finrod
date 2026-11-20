# Architecture

Finrod is two Node processes on the home server. You talk to it in Element,
through a Matrix server on the same machine.

- **Finrod** owns the conversation. It runs the model, the tools, and voice
  transcription, and serves an HTTP API on `127.0.0.1`. Every request must
  carry the gateway token.
- **The gateway** is the Matrix bot. It is Finrod's only client: it passes
  each message to Finrod and posts the answers back to the user's room.

Each user gets their own Finrod process, with its own port, data, wiki,
and model key. `FINROD_GATEWAY_USERS` maps each Matrix user to their core
(`@user:server=http://127.0.0.1:<port>`), so nothing is shared between
users. Today one core runs, for one user.

The durable pi harness (`@earendil-works/pi-durable`) runs the agent: model
streaming, tool calls, retries, and the restart-safe log.

## Components

| Component | Responsibility | File |
| --- | --- | --- |
| HTTP server | JSON API, Server-Sent Events, token check, error mapping | `server/main.ts` |
| Configuration | Read and validate environment settings at startup | `server/config.ts` |
| Conversations | The stream, send, answers for the gateway and its cursor, view mapping | `server/chat.ts` |
| Wiki | The user's notes as Markdown pages, the index, change records and undo; the `read_page`, `write_page`, and `delete_page` tools | `server/wiki.ts` |
| Search | BM25 search over past messages and wiki pages in SQLite FTS5; the `search` and `read_messages` tools | `server/search.ts` |
| Wiki update | After a quiet period, a separate conversation updates the wiki from the chat and reports the change | `server/dream.ts` |
| Old memories | Read the approved memories of `memories.enc` once, for the first wiki update | `server/memories.ts` |
| ChatGPT import | Read the user's ChatGPT history in `chatgpt/chatgpt.sqlite`, for search and the wiki | `server/chatgpt.ts` |
| Voice | Audio upload, transcription, audio deletion | `server/voice.ts` |
| Speech to text | faster-whisper in `python:3.12-slim`, its setup and pinned versions | `deploy/stt/` |
| Research | `web_search` and `web_fetch` tools through Exa MCP | `server/research.ts` |
| Prompt | The model's instructions, kept as Markdown and bundled as text by the build | `server/prompts/` |
| Clock | `clock` tool: the current date and time in the server's time zone | `server/clock.ts` |
| Gateway | Matrix sign-in, encryption keys, routing, delivery | `gateway/main.ts` |
| Build | Bundle Finrod and the gateway into `dist/` | `scripts/build.mjs` |
| Release archive | Built code, production dependencies, deploy files, checksum | `scripts/package.sh` |
| Data unlock | Read the passphrase from Proton Pass, mount the gocryptfs folder | `deploy/data-unlock`, `deploy/data-encrypt` |
| Deployment | systemd user units and the update script | `deploy/` |
| Release | Build and publish the archive when a `v*` tag is pushed | `.github/workflows/release.yml` |

## Message flow

1. A user sends a text or a voice note in their direct room with the bot.
2. The gateway decrypts it. For a voice note, it downloads and decrypts the
   audio and sends it to `POST /api/voice?extension=ogg`, which returns the
   transcript.
3. The gateway sends `POST /api/conversations/<id>/messages` with the text
   and a `requestId` made from a hash of the Matrix event ID. A repeated
   `requestId` does not send the message twice, so an event that Matrix
   delivers again is answered once.
4. pi-durable commits the message, runs the model, and commits each answer
   part and tool result.
5. The gateway follows `GET /api/conversations/<id>/events`. While Finrod
   answers, it shows typing in Element. On each change it reads
   `GET /api/gateway/answers`, posts each answer as Markdown, and
   acknowledges it with `POST /api/gateway/answers/ack`. The cursor lives in
   Finrod, so the gateway keeps no conversation state.

On start, the gateway reads each room back to the newest message it forwarded
before, so messages sent while it was down are answered. It also fetches the
users' devices again, because it keeps no sync position and would otherwise
miss devices added while it was down.

## Memory

Finrod's memory has two layers. The first is the conversation log itself,
which never changes and which the model searches. The second is a wiki of
Markdown pages that Finrod keeps from the log, following the
[LLM wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The pages are
`core.md`, with the few facts that matter in almost every conversation, and
pages such as `people/ana.md` and `topics/health.md`. `index.md` lists every
page but the core page with a one-line summary.

- **Search.** `search` ranks past messages and wiki pages with BM25 (SQLite
  FTS5). It folds accents, so `medico` finds "médico", and takes `word*` for
  other endings and `"quotes"` for phrases; there is no stemmer, because
  FTS5's only one is for English. It leaves out the exchange being answered.
  `read_messages` shows the messages around a result. The index is
  `search.sqlite`, derived from the log and the pages: before each search it
  adds the newer messages and reads the pages again. Deleting it rebuilds it.
  Search covers the user's stream, the newest conversation.
- **Reading.** Each message's instructions hold the core page and the index,
  not the other pages. The chat model opens a page with `read_page` when it
  needs one. It cannot change the wiki.
- **Updating.** When the chat has been quiet for `FINROD_WIKI_IDLE_SECONDS`
  (30 minutes by default) and Finrod is not answering, `server/dream.ts`
  starts a separate conversation on `FINROD_WIKI_MODEL`, with the same
  `search` and `read_messages`. Its instructions are the schema in
  `server/prompts/wiki-schema.md`, and its input is the core page, the index,
  and the messages since the last update, each with its entry number. It
  edits pages with `write_page` and `delete_page`. One update reads at most
  about 40,000 characters of conversation; a longer backlog takes several
  updates. `dream.json` keeps how far the wiki has read and the update in
  progress, so a restart resumes that update instead of starting another.
- **Cleanup.** Every `FINROD_WIKI_CLEANUP_SECONDS` (7 days by default),
  when the chat is quiet, one update reads no new messages. Its input starts
  with `server/prompts/wiki-cleanup.md`: read every page, check facts against
  the messages they cite, merge repeats, and remove what is no longer true.
  The user sees and can undo its change like any other.
- **Small by construction.** What goes into every message stays bounded:
  `write_page` refuses a core page over 2,000 characters, and a new page once
  the index lists 60. The schema says what the notes are for and what must
  hold, and leaves their organization to the model.
- **Sources.** `write_page` refuses a page in which a line is not a heading
  or a fact as a list item that ends in `(source: ...)`, such as
  `(source: #123)` for entry 123 of the conversation.
- **Review.** Each update records every page it touched, before and after,
  in `wiki-changes/<id>.json`. If it changed a fact, Finrod adds a
  `finrod.wiki-change` entry to the stream, which the model never sees, with
  the facts added and removed. The gateway posts it as a notice that carries
  the change's ID in its encrypted content. A 👎 reaction undoes it
  (`POST /api/wiki/changes/<id>/undo`): each page that is still as the update
  left it goes back, and a page changed since keeps the newer version. Clients
  send reactions unencrypted, but a reaction holds only the emoji and the
  notice's event ID.
- **Old memories.** Versions before the wiki kept approved memories in
  `memories.enc`, encrypted with a scrypt key of the passphrase in
  `FINROD_MEMORY_KEY_FILE`. The first update takes them in as a source, cited
  as `(source: memory m-...)`, and Finrod then renames the file
  `memories.enc.imported`. A wrong passphrase stops Finrod at startup.
- **ChatGPT import.** `chatgpt/chatgpt.sqlite` holds the user's ChatGPT
  conversations, which a one-off script imported from ChatGPT's data export.
  Finrod only reads it. `search` also finds its messages, numbered `#c123`,
  and `read_chatgpt` shows the messages around one. When Finrod's own
  messages are all read, wiki updates read what the user wrote in ChatGPT,
  never ChatGPT's answers, about 40,000 characters at a time, and cite it as
  `(source: chatgpt #c123)`. `dream.json` keeps how far they have read
  (`chatgptAfter`) and the updates that read it (`chatgptChanges`), so they
  can all be undone. Without the file, the tool, the search results, and
  these updates are gone; see
  [Operations](OPERATIONS.md#chatgpt-import).

## Storage

All of Finrod's data is in a gocryptfs folder. `finrod-data.service` runs
`deploy/data-unlock` before Finrod starts: it reads the passphrase from
Proton Pass with an agent token sealed to the machine (`systemd-creds`),
mounts `data.crypt` on `data`, and leaves the passphrase in the service's
runtime folder, in memory, for `FINROD_MEMORY_KEY_FILE`. The passphrase is
never written to disk. `finrod.service` binds to `finrod-data.service`, so
Finrod does not run without the mounted folder.

Finrod's data directory (`FINROD_DATA_DIR`) holds one folder per profile
(`FINROD_PROFILE`):

```text
<data>/profiles/<profile>/
  finrod.sqlite        pi-durable log: conversations, entries, documents
  wiki/                the user's notes: core.md, index.md, and the other pages
  wiki-changes/        what each wiki update changed, before and after, for undo
  search.sqlite        the search index of messages and pages; derived, safe to delete
  dream.json           how far the wiki has read the conversation and the import; the update in progress
  memories.enc         memories from before the wiki, until the first update imports them
  chatgpt/             the ChatGPT import: chatgpt.sqlite, and the user's recordings in audio/
  gateway-cursor.json  the newest answer the gateway delivered
  voice/               audio being transcribed; deleted afterwards
```

A voice message is a `finrod.message` entry with the transcript and the
note's length in seconds.

The gateway's state (`FINROD_GATEWAY_STATE`) holds its login, its encryption
and cross-signing keys (`indexeddb/`, through `node-indexeddb`), and each
user's room.

## Logs

What the user writes or says never reaches a log. Errors name the step that
failed, not the message. Transcription errors carry only the exit status, and
the transcription container has no log. `test/server.test.ts` checks this.

## Model and research

- The model is `FINROD_MODEL` from the provider `FINROD_PROVIDER`: an
  OpenRouter model through pi-ai's OpenRouter provider, or a Claude model
  through [pi-claude-directsdk](https://github.com/joaomj/pi-claude-directsdk),
  which runs the Claude Code executable with its login, one process per
  conversation.
  The build bundles pi-claude-directsdk because it ships TypeScript source.
  Startup fails if the model is not in the provider's catalog.
- Zero data retention is set in the OpenRouter account, not in Finrod.
- Research uses Exa MCP's free tier at
  `https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa`. Each tool call
  opens a new connection. A free-tier limit message counts as a failed tool
  call.
- The agent has no other tools: no shell and no file access. The wiki tools
  reach only the wiki's folder.

## Releases and updates

Pushing a `v*` tag that matches `package.json` makes
`.github/workflows/release.yml` build `finrod-vX.Y.Z.tar.gz` and its
checksum and publish them as a GitHub release. On the server,
`finrod-update.timer` runs `deploy/finrod-update` daily. It installs
the newest release, restarts Finrod, and rolls back if Finrod does not
answer.

## References

- [Operations](OPERATIONS.md): install, update, backup, and recovery.
