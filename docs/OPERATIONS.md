# Operations

Use this guide after completing the [setup](../README.md). Commands assume the
default data directory and a systemd user service.

## Install the user service

Create `~/.local/share/finrod` and `~/.config/systemd/user` if needed.
Copy `deploy/finrod.service.in` to `~/.config/systemd/user/finrod.service`.
Replace `@PROJECT@` with the absolute checkout path and `@NODE@` with the
absolute Node executable path. Use paths without spaces.

The template reads `~/.config/finrod/environment`. If you change
`FINROD_DATA_DIR`, update `ReadWritePaths` in the unit to match it.
Stop any foreground instance, then enable and start the service:

```sh
systemctl --user daemon-reload
systemctl --user enable --now finrod.service
```

Enabling the service starts it when the systemd user manager starts, normally
at login. It does not run while the machine is powered off or suspended.
For a dedicated VPS account, enable lingering with `loginctl enable-linger USER`
to start without an interactive login. This can require administrator permission.

## Service controls

```sh
systemctl --user status finrod.service
systemctl --user restart finrod.service
systemctl --user stop finrod.service
journalctl --user -u finrod.service -n 40 --no-pager
```

Do not start a foreground instance while the service is running. Changing the
credential file does not change an existing process; restart the service after
editing it. After building a new application revision, restart the service to
load it. Startup adds missing feedback tables without replacing existing inbox,
outbox, or conversation records.

The service finishes its current operation before shutdown. The service template
allows three minutes, then terminates the process. On reopen, Durable resumes
committed work; an uncommitted transcription request can run again.

## Per-message feedback

Each new model-generated reply has thumbs-up and thumbs-down inline buttons.
Only the configured Telegram owner can vote. Clicking either button saves the
current vote; clicking the other changes it. Repeated clicks do not create
additional feedback records. Telegram shows a confirmation toast; the buttons
do not display a persistent selection.

Votes are stored in `telegram.sqlite`, separately from the conversation. They
are not submitted to the model and do not change assistant behavior. Each record
links to the source Telegram message, sent reply, Durable conversation,
submission, answer entry, model provider, model ID, and UTC timestamps. The
first-vote timestamp stays fixed; the last-change timestamp updates when the
vote changes. Only the current vote is retained, not a history of prior votes.

Long replies split into separate Telegram messages. Each part has its own vote,
with a part number and the same Durable answer reference. Help, status, and
failure notices are not rated. Replies sent before this feature was installed
do not gain buttons retroactively. A reply with uncertain delivery cannot be
rated until its Telegram message identity is known.

Feedback is recorded before its update is acknowledged. Replayed old updates
cannot overwrite newer votes. Feedback processing shares the single Telegram
worker with conversation turns, so a click can wait while an answer is running.
If Telegram's confirmation window expires, a recorded vote still remains saved.

After the updated service has initialized its tables, export metadata as JSON
Lines from the checkout:

```sh
npm run --silent feedback:export
```

Set `FINROD_DATA_DIR` when using a non-default data directory. The exporter opens
SQLite read-only and does not need provider credentials. It omits message text
and transcripts, but includes Telegram identifiers. Treat the output as private;
keep exported files outside Git. An empty export means no votes are recorded.

## Data and retention

`FINROD_DATA_DIR` defaults to `~/.local/share/finrod`:

| Path | Contents |
| --- | --- |
| `conversation.sqlite` and SQLite sidecars | Durable conversation and task state |
| `telegram.sqlite` and SQLite sidecars | Incoming work, voice transcripts and Telegram file IDs, replies, feedback, bot identity, and cursor |
| `knowledge/` | Authoritative Markdown topic pages |
| `mcp/` | MCP adapter state and caches |
| `process-lock.sqlite` | Single-process ownership lock |

Voice notes are downloaded into memory and sent to the transcription provider.
Finrod does not save the audio file locally. The transcript is stored in
`telegram.sqlite` and submitted as conversation text to `conversation.sqlite`.
Telegram retains its own audio copy under its policies. Transcripts, replies,
and saved topics remain in local storage and backups; deleting a topic does not
erase conversation history.

## Backup and VPS migration

Back up the entire data directory while the service is stopped. Copy the
credential file separately through a secure channel. Store backups outside the
checkout, encrypt them, and retain more than one version. Do not copy only the
main SQLite files while the application is running.

For a consistent backup with the default paths:

```sh
systemctl --user stop finrod.service
umask 077
tar -C "$HOME/.local/share" -czf "$HOME/finrod-backup-$(date +%Y%m%d-%H%M%S).tar.gz" finrod
systemctl --user start finrod.service
```

To restore, stop the service and preserve the current data directory first.
Extract the backup into an empty replacement directory. Restore private ownership
and permissions, then start the service and check `/status`. A rollback to an
older backup can lose newer work and replay effects after that backup. Inspect
recent replies before asking Finrod to repeat a request.

For migration to the VPS:

1. Install the same Node release and application revision under a dedicated user.
2. Install locked dependencies and build on the VPS.
3. Stop Finrod on the source machine and copy its complete data directory.
4. Transfer the credential file securely, with mode `0600`.
5. Install the user service with the VPS paths and enable lingering.
6. Start only the VPS instance. Check text, voice, saved topics, and `/status`.

Never run two instances for the same bot, even with different data directories.
The process lock protects one directory on one machine, not multiple hosts.
Backup restore and VPS migration have not yet been exercised end to end.

## Failure and privacy boundaries

- Intake is stored before the polling cursor advances. Duplicate update IDs do
  not create duplicate Durable submissions.
- A lost connection after a reply is sent can leave delivery uncertain. Finrod
  does not automatically resend that reply. `/status` shows its recorded text.
- A failed message gets a failure notice and remains recorded as failed. The
  service exits with an error; systemd permits at most five starts in five minutes.
- A crash during transcription can repeat the provider request and its charge.
  A committed transcript is reused after restart. Audio is downloaded into memory,
  not saved as a local recording. Telegram retains its own copy under its policy.
- Transient voice-download failures receive up to three attempts. Transcription
  requests are not automatically retried by the downloader. After a message is
  marked failed, resend it explicitly; restarting does not replay failed inbox work.
- Voice downloads are limited to 20 MiB. Large recordings can also hit upstream
  processing limits. Finrod does not split long recordings automatically.
- ZDR is mandatory for OpenRouter transcription. It does not cover Telegram,
  Exa, local history, backups, or the separate chat-model request. Configure the
  chat provider's privacy settings independently.
- External integrations are read-only. Exa queries still leave this machine.
- Pi Durable's pinned SQLite backend uses `synchronous=NORMAL`. Process-crash
  recovery is supported, but power failure can lose recent conversation commits.
  The Telegram ledger uses `synchronous=FULL`. Backups remain necessary.
- Shutdown finishes the current operation before exiting. systemd allows three
  minutes, then terminates the process; committed work remains available for recovery.


## Acceptance checks

See [Validation](VALIDATION.md) for completed live checks, repeatable acceptance
steps, automated coverage, and remaining gaps. Keep the distinction between a
working transport and a factually correct answer: proper names, source claims,
and timezone-sensitive dates still require judgment.
