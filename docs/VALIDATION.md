# Validation

This record separates live observations from local test coverage. Successful
transport does not establish model accuracy, source quality, or recovery of an
interrupted turn. No credentials or private message content are included.

## Live checks: 2026-10-10

Finrod moved from the local computer to a Contabo VPS. The checked deployment
used OpenRouter for conversation and Whisper transcription, with the Portuguese
language hint. The user reports account-wide OpenRouter zero data retention
(ZDR) enabled; each transcription request also requires ZDR in application code.

| Area | Evidence | Limit |
| --- | --- | --- |
| Text conversation | New requests completed and replies were sent on the VPS | Does not establish model accuracy |
| Web research | Successful Exa search tool results and delivered citations were inspected before migration | Cited facts were not independently audited |
| Conversation continuity | Post-reboot and post-migration summaries recalled earlier discussion from the same Durable conversation | Does not prove recovery of an interrupted turn |
| Saved topics | List/save/read tools succeeded locally; saved-topic files were restored on the VPS | Correction, linking, deletion, and a fresh saved-topic read on the VPS remain to be confirmed live |
| Feedback | A new positive vote on a VPS-generated reply was stored with its metadata | Changing a vote is covered locally, not yet confirmed live |
| Voice | A fresh post-migration voice note produced a nonempty stored transcript and a delivered answer | Local Whisper and other language overrides remain unverified live |
| Delivery state | `/status` reported no uncertain replies; inspected new requests completed and replies were marked sent | Not a guarantee of exactly-once delivery under network failure |
| Single active instance | VPS service was active and enabled; local service was inactive and disabled | Another manually launched instance is not prevented across hosts |

### Backup restore and migration

The user-run migration stopped and disabled the local service before making a
full state archive. It transferred the archive and private configuration over
SSH and restored them into the empty VPS data directory. The migration reported
a matching archive digest, successful SQLite integrity checks, and matching
record and topic counts before starting the VPS service.

Independent post-migration inspection confirmed successful startup and new
text, feedback, and voice activity. A summary on the VPS referenced conversation
from the local computer, including its earlier voice discussion. This verifies
a stopped-service backup restore and continuity across the host migration.
The original local data and private migration backup were retained, not deleted.

User lingering is enabled on the VPS. At inspection, the service had zero
restarts and no application errors in the checked log excerpt. Startup following
an actual VPS reboot has not yet been exercised; configuration alone does not
establish that result.

### Installer on the VPS

The actual Bash installer ran as the dedicated non-root service account on
Ubuntu 26.04 x86_64. It installed Node `v22.23.3` in the account's private runtime
directory alongside the existing system Node `v24.13.0`. It installed locked
application dependencies, built the application, verified the systemd unit, and
started the real user service with migrated configuration.

This validates automatic Node installation and actual service startup, beyond
the isolated smoke test. OS prerequisites were already present, so privileged
package installation remains untested. The arm64 bootstrap path was not exercised.

### Audio repair and answer quality

The initial local voice attempt timed out while downloading from Telegram,
before transcription. The bounded-retry repair passed its regression test, and
subsequent voice requests completed locally and on the VPS. The live requests
did not show retries, so retry behavior is established by the local test rather
than inferred from successful transcription.

Known answer-quality concerns remain: an earlier date answer relied on web
pages instead of reliable current-date and timezone context, and an ambiguous
spoken name was interpreted without clarification. Inspect the existing Pi
integration before proposing additional tools. Language hints do not guarantee
correct names, source claims, or interpretations.

## Local imported-source checks: unreleased

The one-time importer ran against the private ChatGPT export in a local staging data directory.
The index contains 793 conversations, 13,779 message records, and 9,287 searchable records.
The copied archive checksum matches the original checksum recorded before import.
The importer checked database integrity, foreign keys, and search-index integrity and record counts.
A second invocation recognized the same archive and changed no files.

TypeScript checking and compilation passed. Direct calls to the compiled extension verified user-only
keyword search, conversation excerpts, and message pagination against stored text.
Invalid FTS5 syntax propagated as an error. A read-only database connection rejected mutation.
The database checksum remained unchanged after retrieval. An absent source returned no imported store.
These were manual local checks, not a new automated regression test.

The local checks did not involve Telegram or a model provider.
Symlink rejection, unsupported schemas, and interrupted import have not received end-to-end verification.
The existing full test suites were not run for this change.

## Live imported-source checks: 2026-10-11

The operator transferred the prepared source directory and deployed the updated application on the VPS.
A request in the existing Telegram conversation invoked `source_search` with a user-role filter.
The search returned four matches without a tool error. A subsequent `source_message` call returned
one complete user message with its source identifiers and timestamp.

Read-only inspection of Durable entries confirmed both successful tool results and the final answer.
The Telegram ledger recorded the answer as sent. The answer quoted the retrieved text and cited
its conversation and message identifiers. Independent timestamp conversion confirmed the selected date.
This verifies imported-source discovery and tool availability in an existing conversation after restart.

The service remained active, with no journal errors since deployment at inspection.
Earlier journal entries showed Telegram polling failures and automatic restarts before deployment.
The answer reversed the relative order of two retrieved messages. Correct retrieval does not establish
correct chronology in the model's explanation. Live conversation pagination remains unverified.

## Automated checks

Run the focused check for the changed area from the project folder:

| Command | Coverage |
| --- | --- |
| `npm run check` | TypeScript types across the application |
| `npm run test:install` | First-install prompts, real dependency installation/build, unit verification, and preservation on rerun |
| `npm run test:telegram` | Owner-only intake, replay deduplication, uncertain delivery after reopen, and per-message feedback |
| `npm run test:voice` | Interrupted download, clean retry, bounded exhaustion, and preservation of the final error |
| `npm run build && node --test test/knowledge.test.mjs` | Topic save, correction, reopen, request deduplication, path restrictions, and deletion |

Application integration checks use local HTTP endpoints, real SQLite, and
Markdown files. The knowledge test uses Pi's scripted provider, not a paid model.
It passed during initial implementation and was not rerun for the voice-only
repair. The voice and Telegram checks passed after that repair.

The installer smoke test passed with a temporary project copy, home, runtime
directory, and fake credentials. Real installation, compilation, catalog
validation, and unit verification ran twice; only service control was substituted.
Rerunning preserved edited configuration, `0600` permissions, a saved topic, and
the service unit. Test credentials were absent from terminal output and logs.
This test requires a non-root Linux user, Python 3, compatible Node/npm, systemd
verification tools, and npm registry access. Syntax and ShellCheck checks passed.

## Remaining checks

- Confirm the remaining topic operations and a changed feedback vote live.
- Inspect cited pages and diagnose the known context and ambiguity problems.
- Exercise controlled interrupted-turn recovery, separately from completed-turn continuity.
- Observe service startup after the next planned VPS reboot.
- Validate alternative transcription providers or installer platforms when selected.

Repeat text, voice, saved-topic, feedback, and `/status` checks after deployment
changes. Completed migration and ordinary continuity are not outstanding work.
See [the PRD](PRD.md#next-steps-in-order) for priorities and
[Operations](OPERATIONS.md) for backup and service procedures.
