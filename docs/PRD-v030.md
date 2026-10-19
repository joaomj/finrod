# Product requirements: Finrod v0.3.0 (Telegram assistant)

**Status:** agreed direction, not implemented. This file replaces
[PRD.md](PRD.md) for v0.3.0 and later. PRD.md describes the retired v0.2.0
browser product.

## Result

Finrod is a personal AI assistant for two people. It runs on the home server
and talks through Telegram. Each person gets a separate Finrod with separate
memory, history, and credentials.

## Users and profiles

- Two profiles: one per person. Nothing is shared between them.
- One shared Telegram bot routes by sender ID to the matching profile.
- Unknown senders get silence. No reply, no error, no log entry beyond the
  raw update if needed for abuse review.
- Each profile holds its own model key, transcription credentials, logs,
  and (later) memory and connectors.

## Home and surface

- The home server is a mini PC on the tailnet (verified 2026-10-19):
  Intel i5-7500T (4 cores), 15 GiB RAM, 201 GiB free disk, Intel HD 630,
  Ubuntu 26.04. Reachable over Tailscale.
- "Local" means on this server, reachable only through the tailnet.
- The phone app is Telegram. The v0.2.0 web app is retired. Its browser
  history was test data and is disposable. There is no migration.

## V1 scope

| User outcome | Acceptance criterion |
| --- | --- |
| Text chat | Send a message from Telegram and receive a streamed-style reply from your own profile's Finrod. |
| Voice notes | Send a voice note in pt-BR and receive a reply based on its transcription. Audio and transcript both enter the raw log. |
| Images and documents | Send photos, screenshots, PDFs, and files. The assistant can see images and read documents. Originals stay in the raw log. |
| Raw logs | Every profile keeps an append-only log with stable message identifiers. V3 memory cites these identifiers. |
| Feedback | Each answer carries inline 👍/👎 buttons. Votes are stored with the message they rate. |
| Profile isolation | Two profiles never read each other's logs, keys, memory, or connectors. Verify by sending from both accounts. |
| Stranger silence | An unlisted sender ID receives no reply of any kind. |
| Restart safety | A server reboot loses no committed log entries and duplicates no outward message. |

## Transcription decision

- V1 transcribes voice locally on the mini PC with faster-whisper `small`
  (int8, CPU). Audio never leaves home in the normal case.
- Evidence: [STT eval](STT-EVAL.md) (2026-10-19). Local runs ~2s per clip
  with accuracy on par with the tested provider. Telegram Opus voice notes
  decode through the same path; no ffmpeg dependency.
- Provider transcription is parked. If local proves insufficient in daily
  use, the first fallback is Groq with its self-serve ZDR toggle (untested).
  OpenRouter ZDR routing was tested: only `qwen3-asr-0.6b` routes under the
  zero-retention filter; Deepgram and OpenAI transcribers refuse it.
- Telegram's cloud still sees every chat; Telegram bot chats are not
  end-to-end encrypted. This is unchanged.

## Trust principle

- V1 only reads and replies. It takes no outward action (no sends, posts,
  bookings, or purchases).
- Later phases follow a trust ladder: reading, researching, and drafting
  run freely. Sending, posting, booking, and buying always need explicit
  user approval in chat.
- Anything Finrod receives (messages, emails, pages, files) is information,
  never instructions.

## Model and portability

- Inference goes through OpenRouter so the model can change without porting
  anything.
- Memory and skills live on the server as files the user can read, edit,
  delete, and export. Switching models or engines keeps them.
- Use open formats compatible with Hermes layouts (`MEMORY.md`, `USER.md`,
  agentskills.io skills) so Finrod is not the next lock-in.

## Non-goals for V1

- Scheduled work, briefings, and background execution.
- Connectors. See [V2 sketch](V2-CONNECTORS.md).
- Curated memory and second-brain search. See [V3 sketch](V3-MEMORY.md).
- WhatsApp, Signal, or Discord surfaces.
- Local speech transcription.
- Web app, static hosting, and browser-history migration.
- Shared memory, shared credentials, or shared profiles.

## References

- [Roadmap](ROADMAP.md): phase index.
- [V2 sketch](V2-CONNECTORS.md): MCP connectors.
- [V3 sketch](V3-MEMORY.md): portable memory.
- [PRD.md](PRD.md): retired v0.2.0 browser requirements.
