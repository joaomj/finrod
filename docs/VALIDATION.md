# Validation

This record separates live observations from local test coverage. Successful
transport does not establish model accuracy, source quality, or disaster recovery.
No private message content, credentials, or Telegram identifiers are included.

## Live checks: 2026-10-10

The local service uses OpenRouter `anthropic/claude-haiku-5.5` for conversation
and `openai/whisper-large-v3` for transcription, with `TRANSCRIPTION_LANGUAGE=pt`.
The user reports account-wide OpenRouter ZDR enabled. The application additionally
requires ZDR on each transcription request.

| Area | Evidence | Limit |
| --- | --- | --- |
| Text conversation | User observed replies through Telegram | Does not establish model accuracy |
| Research replies | Observed answer contained relevant-looking source links | Source claims and individual Exa calls were not independently audited in this check |
| Summaries | User reported that the summary test worked | Correction, deletion, and complete topic lifecycle were not separately confirmed live |
| Feedback | A positive vote was read from SQLite with reply, Durable, and model references | Changing a vote is covered locally, not yet confirmed live |
| Voice | Persisted Portuguese transcript, completed input, and sent answer were inspected after the fix | Local Whisper and other language overrides remain unverified live |
| Service startup | Logs show startup after boot and after a controlled restart | Does not prove recovery of a turn interrupted by a crash |

### Audio failure and repair

The first voice attempt failed while downloading audio from Telegram, before
transcription. Logs showed a connection timeout. Subsequent unauthenticated
network checks reached Telegram successfully, consistent with a transient failure.

The downloader now retries recognized transient failures up to three attempts.
A local regression test also exposed truncated-response handling, which was
corrected. Typecheck, build, both Telegram tests, and the voice-download test
passed before the service restarted. A resent voice note then produced a stored
transcript and a delivered answer without a new error in the inspected logs.

This confirms the live audio path, not that live retry behavior was exercised:
the resent message did not show a retry in the inspected logs.

### Observed answer-quality limits

- An earlier date answer relied on web pages rather than reliable current-date
  and timezone context. Inspect the existing Pi integration before adding tools.
- A spoken proper name was ambiguous in transcription, and the answer selected
  one interpretation without clarification. A Portuguese hint does not guarantee
  accurate names or remove ambiguity.

## Automated checks

Run the focused check for the changed area from the checkout:

| Command | Coverage |
| --- | --- |
| `npm run check` | TypeScript types across the application |
| `npm run test:telegram` | Owner-only intake, replay deduplication, uncertain delivery after reopen, and per-message feedback |
| `npm run test:voice` | Interrupted audio download, clean retry, bounded exhaustion, and preservation of the final error |
| `npm run build && node --test test/knowledge.test.mjs` | Topic save, correction, reopen, request deduplication, path restrictions, and deletion |

Telegram and voice tests use a local HTTP server. Persistence checks use real
SQLite and Markdown files. The knowledge test uses Pi's scripted provider, not
a paid model. The four integration tests do not measure answer quality or prove
provider availability. The knowledge check passed during initial implementation;
it was not rerun for the voice-download-only repair.

## Repeatable live checks

1. Send `/start`, then a normal text message.
2. Request web research and inspect the cited pages.
3. Send a short voice note and compare the answer with what you said.
4. Save a named topic, list it, correct it, and resume it.
5. Rate a reply, change the vote, and inspect `npm run --silent feedback:export`.
6. Restart while idle. Continue the conversation and resume the saved topic.
7. Check `/status` for uncertain deliveries.

## Remaining operational validation

- Complete the explicit topic lifecycle and conversation-continuity checks above.
- Verify backup restore in an isolated directory without starting a second bot.
- Migrate to Contabo only after stopping the source instance; verify it again there.
- Confirm local OpenAI-compatible transcription if that provider is selected.

Follow the [operations guide](OPERATIONS.md) for backup and migration. Never run
two instances for the same Telegram bot.
