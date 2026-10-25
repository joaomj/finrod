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

## V1 scope

| User outcome | Acceptance criterion |
| --- | --- |
| Install | Add Finrod to the iPhone home screen from Safari. It opens full screen with its own icon. |
| Text chat | Send a message and receive a streamed answer. |
| Conversations | Start, reopen, and switch between separate conversations. History loads from the server on any tailnet device. |
| Voice | Record a pt-BR voice message in the app and receive an answer based on its transcription. Audio and transcript both enter the raw log. |
| Images and documents | Send photos, screenshots, PDFs, and files. The assistant can see images and read documents. Originals stay in the raw log. |
| Web research | The assistant can search the web and cite its sources. |
| Raw logs | Every profile keeps an append-only log with stable message identifiers. V3 memory cites these identifiers. |
| Feedback | Each answer has thumbs-up and thumbs-down buttons. Votes are stored with the message they rate. |
| Access boundary | A device outside the tailnet cannot reach Finrod. |
| Restart safety | A server reboot loses no committed log entries. An answer cut off by a restart shows as interrupted, not as complete. |

## First validation

Before building on the web app, confirm on the user's iPhone that a
home-screen web app served over the tailnet can:

1. Install from Safari and open full screen.
2. Record audio and upload it to the server.
3. Keep working after the app is closed and reopened.

Voice recording in home-screen web apps has had iOS defects in the past.
If recording fails, voice input needs a different design before V1 work
continues.

## Backend

- The assistant runs on the pi agent loop (`@earendil-works/pi-agent-core`),
  with MCP tools through `@earendil-works/pi-mcp`. The v0.2.0 browser app
  used the same libraries.
- The agent has only the tools Finrod registers on purpose. It has no
  shell, file-editing, or other general system tools.
- Finrod builds its own server parts: the web interface, conversation
  storage, the raw log, profile separation, and approval prompts.

## Model and privacy

- Inference and transcription go through OpenRouter so the model can
  change without porting anything.
- Finrod uses only OpenRouter providers with zero data retention (ZDR).
  The provider still receives the context and audio of each request.
- Finrod sends a request only the context that request needs.

## Transcription decision

- V1 transcribes voice through OpenRouter `/audio/transcriptions` with the
  ZDR filter (`provider.data_collection: deny`). Audio leaves home for
  each voice message; the provider does not retain it.
- In the [STT eval](STT-EVAL.md) (2026-10-19), only `qwen/qwen3-asr-0.6b`
  routed under the ZDR filter. Its first call took 86s cold, then 1-3s.
  Accuracy was on par with local faster-whisper `small`.
- Finrod does not transcribe through a provider without ZDR. If no ZDR
  model is available, the voice message fails with a visible error and
  the audio stays in the raw log.
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
