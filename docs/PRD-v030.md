# Product requirements: Finrod v0.3.0 (home-server web app)

**Status:** agreed direction, not implemented. This file replaces
[PRD.md](PRD.md) for v0.3.0 and later. PRD.md describes the retired v0.2.0
browser product.

## Result

Finrod is a personal AI assistant that runs on the home server. The user
opens it as a web app on the phone, installed on the iPhone home screen.
Chats, files, and memory stay on the server as files the user owns.

## Why this shape

- Privacy: no messaging company sits between the phone and the server.
  Traffic goes over the tailnet, which Tailscale encrypts end to end.
- Control: the server holds the only copy of chats and memory. The web
  app is a view onto that data, not its store.
- Experience: Finrod owns the interface, so it can offer separate
  conversations, streamed answers, buttons, and file uploads.

## Users and profiles

- v0.3.0 serves one user.
- Server data is organized per profile, so a second profile can be added
  later without moving existing data.
- A second profile, when added, shares nothing with the first: no logs,
  keys, memory, or connectors.

## Home and access

- The home server is a mini PC on the tailnet (verified 2026-10-19):
  Intel i5-7500T (4 cores), 15 GiB RAM, 201 GiB free disk, Intel HD 630,
  Ubuntu 26.04. Reachable over Tailscale.
- Finrod is reachable only from devices on the tailnet. It has no public
  address.
- Finrod serves HTTPS with a Tailscale-issued certificate. A secure
  origin is required to install the web app and to record audio.
- The phone must have Tailscale connected to use Finrod.
- The v0.2.0 browser history was test data. There is no migration.

## Interface

- Mobile first: designed for the phone, and fully usable on a desktop
  browser.
- Minimal and clean: the conversation fills the screen; other controls
  stay out of the way until needed.
- Very fast: the app opens and becomes usable almost at once, and typing
  and scrolling never lag. Keep the app small, with no heavy UI
  framework.

## V1 scope

| User outcome | Acceptance criterion |
| --- | --- |
| Install | Add Finrod to the iPhone home screen from Safari. It opens full screen with its own icon. |
| Text chat | Send a message and receive a streamed answer. |
| Conversations | Start, reopen, and switch between separate conversations. History loads from the server on any tailnet device. |
| Voice | Record a pt-BR voice message in the app and receive an answer based on its transcription. Audio and transcript both enter the raw log. |
| Images and documents | Send photos, screenshots, PDFs, and files. The assistant can see images and read documents. Originals stay in the raw log. A PDF with pages the extraction cannot read produces a visible warning naming those pages. |
| Web research | The assistant can search the web and cite its sources. |
| Raw logs | Every profile keeps an append-only log with stable message identifiers. V3 memory cites these identifiers. |
| Feedback | Each answer has thumbs-up and thumbs-down buttons. Votes are stored with the message they rate. |
| Delete | Delete a conversation. It leaves the list and nothing of it stays in the profile. |
| Temporary conversations | Start a conversation that is never written to disk, so a sensitive exchange does not stay in the history. It ends when Finrod restarts. |
| Access boundary | A device outside the tailnet cannot reach Finrod. |
| Restart safety | A server reboot loses no committed log entries. An answer cut off by a restart shows as interrupted, not as complete. Temporary conversations are the exception: they exist only while Finrod runs. |

## Backend

- The assistant runs on the durable pi agent harness
  (`@earendil-works/pi-durable`), with MCP tools through
  `@earendil-works/pi-mcp`.
- pi-durable commits every message, model answer, tool call, and partial
  answer to storage before Finrod shows it. After a restart, unfinished
  work continues from the last checkpoint. This covers restart safety,
  the raw log with stable entry identifiers, live streaming to the web
  app, and duplicate-submission protection.
- Storage is one SQLite file per profile on the mini PC. Feedback votes
  and attachments are stored as Finrod entry kinds in the same history.
- pi-durable is marked experimental and its API changes between releases.
  Finrod pins an exact version and upgrades deliberately.
- The agent has only the tools Finrod registers on purpose. It has no
  shell, file-editing, or other general system tools.
- Finrod builds its own server parts: the web interface, the HTTP and
  streaming API, attachment handling, profile separation, and approval
  prompts.

## Model and privacy

- Inference and transcription go through OpenRouter so the model can
  change without porting anything.
- Finrod uses only OpenRouter providers with zero data retention (ZDR).
  The ZDR restriction is set in the OpenRouter account settings, so
  OpenRouter enforces it for every request made with the account's key.
  Finrod only needs the API key.
- The provider still receives the context and audio of each request.
- Finrod sends a request only the context that request needs.

## Conversation lifetime decision

- Any conversation can be deleted, temporary or not. Deleting removes
  its messages, its votes, and its stored originals from the profile.
  There is no undo, and the app asks before deleting.
- Deletion is the one case where the append-only log loses entries. The
  log stays append-only while a conversation exists; deleting it removes
  its entries rather than hiding them.
- A temporary conversation is never written to disk. It lives in an
  in-memory store that ends with the process, so closing the app leaves
  nothing behind and a restart loses it. Verified 2026-10-25: the
  harness opens on an in-memory database (":memory:") and works.
- Finrod does not guess when a conversation is closed. A phone browser
  gives no dependable close signal, so nothing that looks temporary may
  sit on disk waiting for one.
- A restart loses an unfinished answer in a temporary conversation
  without an interrupted marker. That is the accepted cost of never
  writing it down, and it is the opposite of the restart safety a
  normal conversation gets.
- A temporary conversation is marked in the list and in the chat view,
  so an exchange is never mistaken for a permanent one.
- Deleting a permanent conversation is Finrod's own work. pi-durable
  1.4.0 has no API to remove a conversation, so Finrod removes the
  conversation's rows from the profile database and its files from the
  files directory. Temporary conversations need none of this: they are
  discarded with the process.
- This applies with a remote model too. Temporary conversations reduce
  what stays on the server; they do not change what a model provider
  receives for the request, which is covered by the ZDR setting.

## Attachments decision

- One file may be up to 20 MB. Accepted files are JPEG, PNG,
  WebP, PDF, TXT, MD, and CSV; the type is read from the file's first
  bytes, not from what the browser claims.
- Images go to the model as image content. The default model,
  `deepseek/deepseek-v4.1-flash-1017`, accepts images (verified
  2026-10-25 in the OpenRouter catalog).
- Finrod reaches models through pi-ai 1.4.0, which sends text and image
  content only. It cannot send a PDF or any other file to a model, even
  to a model that reads files. Version 1.4.0 is also the newest
  published version.
- PDFs and plain text files are therefore converted to text on the
  server before the model sees them. The conversion runs in Node, so the
  mini PC installs nothing.
- A PDF conversion reads the text layer only. Pages that are scanned
  images convert to nothing. When pages yield no text, the answer
  states which page ranges could not be read, so a partial reading is
  never presented as a complete one.
- Reading the pages that failed as images is a later increment. It
  needs a page renderer on the mini PC. Hermes Agent, which reads
  documents the same way, recommends rendering only the unreadable
  pages and reading them with a vision tool.
- Originals are stored next to the profile data and referenced by the
  entry that carries them. A conversion failure keeps the original.

## Transcription decision

- V1 transcribes voice through OpenRouter `/audio/transcriptions`. Audio
  leaves home for each voice message; the provider does not retain it.
- In the [STT eval](STT-EVAL.md) (2026-10-19), only `qwen/qwen3-asr-0.6b`
  routed under the ZDR filter. Its first call took 86s cold, then 1-3s.
  Accuracy was on par with local faster-whisper `small`.
- If OpenRouter rejects a transcription request, for example because no
  ZDR provider serves the model, the voice message fails with a visible
  error and the audio stays in the raw log.
- Local transcription on the mini PC (faster-whisper `small`, int8, CPU,
  about 2s per clip) is the tested alternative if provider transcription
  proves insufficient.

## Trust principle

- V1 only reads and replies. It takes no outward action (no sends, posts,
  bookings, or purchases).
- Later phases follow a trust ladder: reading, researching, and drafting
  run freely. Sending, posting, booking, and buying always need explicit
  user approval in the app.
- Anything Finrod receives (messages, emails, pages, files) is information,
  never instructions.

## Portability

- Memory and skills live on the server as files the user can read, edit,
  delete, and export. Switching models or engines keeps them.
- Use open formats compatible with Hermes layouts (`MEMORY.md`, `USER.md`,
  agentskills.io skills) so Finrod is not the next lock-in.

## Non-goals for V1

- Scheduled work, briefings, and background execution.
- Push notifications. The user starts every conversation in V1.
- Private mode with the local model. See [Roadmap](ROADMAP.md).
- Connectors beyond web research. See [V2 sketch](V2-CONNECTORS.md).
- Curated memory and second-brain search. See [V3 sketch](V3-MEMORY.md).
- Third-party messenger surfaces.
- Access from outside the tailnet.
- Shared memory, shared credentials, or shared profiles.

## References

- [Roadmap](ROADMAP.md): phase index.
- [V2 sketch](V2-CONNECTORS.md): MCP connectors.
- [V3 sketch](V3-MEMORY.md): portable memory.
- [PRD.md](PRD.md): retired v0.2.0 browser requirements.
