# Architecture

Finrod is one Node process on the home server. It serves the web app and an
HTTP API on `127.0.0.1`, and Tailscale Serve publishes it over HTTPS on the
tailnet. The server owns all conversation state. The browser only shows it.

The durable pi harness (`@earendil-works/pi-durable`) runs the agent: model
streaming, tool calls, retries, and the restart-safe log. Finrod adds the web
app, the HTTP layer, file handling, feedback, deletion, and temporary
conversations.

## Components

| Component | Responsibility | File |
| --- | --- | --- |
| HTTP server | Static app files, JSON API, Server-Sent Events, uploads, error mapping | `server/main.ts` |
| Configuration | Read and validate environment settings at startup | `server/config.ts` |
| Conversations | Permanent and temporary stores, send, vote, delete, view mapping | `server/chat.ts` |
| Files | Type detection, stored originals, PDF and text extraction | `server/files.ts` |
| Research | `web_search` and `web_fetch` tools through Exa MCP | `server/research.ts` |
| Exa account | OAuth sign-in to the user's Exa account, token file | `server/exa-auth.ts` |
| Web app | Conversation list, chat view, Markdown, composer, attachments | `app/main.ts`, `app/index.html`, `app/style.css` |
| Build | Bundle app and server into `dist/`, version the app's script and style | `scripts/build.mjs` |
| Release archive | Built app, production dependencies, deploy files, checksum | `scripts/package.sh` |
| Deployment | systemd user units and the update script | `deploy/` |

## Request flow

1. The app creates a conversation or opens one from the list.
2. The app subscribes to `GET /api/conversations/<id>/events`. The server
   sends the message list and the live status as Server-Sent Events.
3. Files upload first, one request per file, to `POST /api/files`. The server
   stores the original and returns a reference.
4. The app sends `POST /api/conversations/<id>/messages` with the text, the
   file references, and a `requestId`. A repeated `requestId` does not send
   the message twice.
5. pi-durable commits the message, runs the model, and commits each answer
   part and tool result before the app shows it.
6. The model can call `web_search` and `web_fetch`. Finrod reads the page
   titles and URLs from those tool results and shows them as the answer's
   sources.

Temporary conversations use the same routes under `/api/temporary/`.

## Storage

The data directory (`FINROD_DATA_DIR`) holds one folder per profile:

```text
<data>/profiles/<profile>/
  finrod.sqlite     pi-durable log: conversations, entries, documents
  files/            stored originals, named <uuid>.<ext>, mode 0600
  exa-oauth.json    Exa sign-in, mode 0600, present after connecting Exa
```

- Messages, answers, tool results, votes, and the conversation index are
  entries or documents in `finrod.sqlite`.
- A message with files is a `finrod.message` entry that lists the files.
- A vote is a `finrod.feedback` entry. The newest vote for an answer wins.
- Temporary conversations use a second pi-durable store in memory. Nothing of
  them reaches disk, and they end when the process ends. They do not accept
  files.

### Deletion

pi-durable 1.4.0 has no call to remove a conversation. Finrod deletes the
conversation's rows in one SQLite transaction, removes its stored files, and
refuses the conversation for the rest of the process, because the harness
still holds it in memory. A conversation that is still answering is not
deleted.

## Files

- Accepted types: JPEG, PNG, WebP, PDF, TXT, MD, CSV. Finrod reads the type
  from the first bytes, not from the name or the browser's claim.
- Limit: 20 MB per file.
- Images go to the model as image content.
- PDFs and text files become text on the server (`unpdf`, Node only). One
  document sends at most 40,000 characters; a longer one is cut with a note.
- A PDF page with no text layer is marked in the text the model gets, and the
  message names those pages.

## Model and research

- The model is an OpenRouter model, `FINROD_MODEL`, through pi-ai's OpenRouter
  provider. Startup fails if the model is not in the OpenRouter catalog.
- Zero data retention is set in the OpenRouter account, not in Finrod.
- Research uses Exa MCP at
  `https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa`. Each tool call
  opens a new connection. Without a connected Exa account, calls use Exa's
  free tier, which is rate limited. A free-tier limit message counts as a
  failed tool call.
- The agent has no other tools: no shell and no file access.

## Web app caching

The server tells browsers to revalidate the page on each load and to cache
other app files for 5 minutes. The build adds a content hash to the script and
style URLs in the page, so a new release loads the new app at once.

## References

- [v0.3.0 requirements](PRD-v030.md): outcomes and decisions.
- [Operations](OPERATIONS.md): install, update, backup, and recovery.
