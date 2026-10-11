# Phone-local browser prototype

**Status:** unreleased agent-core prototype. Desktop Brave checks pass, including
live OpenRouter inference and Exa research. Actual phone acceptance remains open.
The existing VPS and Telegram mode is unchanged.
See [Phone PRD](PHONE-PRD.md) for the approved requirements.

## Intended experience

Open Finrod in the phone's browser, enter a personal OpenRouter key, and exchange
text messages. The initial default is `anthropic/claude-haiku-5.5` through OpenRouter.
Pi agent-core runs the conversation and tool loop in the browser.
Requests go directly to OpenRouter and Exa; no Finrod backend processes messages.
A static website distributes application files only.

Finrod supplies the device's current date and timezone to the model. Exa's
`web_search_exa` and `web_fetch_exa` tools provide search and page retrieval.
Source content is untrusted evidence, not an instruction channel.

The OpenRouter key stays in the open page's memory. Enter it again after reloading
or closing the page. Use a personal key with a spending limit. Do not embed a
shared operator key in the website. Provider error strings are redacted before
saving history or exporting backups.

OpenRouter and its selected inference provider receive submitted conversation
context. Exa receives search queries and requested URLs. Their charges, retention
policies, rate limits, and availability are separate from local storage.

The current Exa connection uses keyless, rate-limited access. It connects and
loads the two tool schemas before each conversation turn. If that connection
fails, Finrod reports the failure without starting an inference request.
There is no configured Exa credential or OAuth flow in this prototype.

History persists in this browser on this device. Different browsers, devices,
and website origins have independent histories; there is no automatic sync.
Finrod interrupts active work when the page becomes hidden. On reopening,
unfinished work is marked interrupted, not automatically replayed.
The prototype has no background service, Telegram connection, voice, source
import, codemode, or dynamic tool-search interface.

## Build and preview

Use the project's supported Node version and locked development dependencies.
From the checkout, run:

```sh
npm run build:web
npm run web:serve
```

Open `http://127.0.0.1:4173` in a normal Brave window on the development computer.
Use the same address on return: `localhost` and `127.0.0.1` have separate storage.
Avoid private browsing for history you intend to keep.
The development server listens on loopback and serves only `web-dist/`.
It does not load Finrod's environment file, proxy requests, or start Telegram.
The browser build does not change the server application's `dist/` output.

For phone access, serve the complete `web-dist/` directory through HTTPS on a
host reachable from the phone. The phone's loopback address refers to the phone,
not the development computer. Plain HTTP on a LAN address is insufficient.
The host only distributes static files; Finrod still executes on the phone.

`FINROD_WEB_HOST` and `FINROD_WEB_PORT` configure the development server.
Binding to a non-loopback address exposes files to other reachable devices.
The development server does not provide TLS or authentication.

## Storage, migration, and recovery

Normal operation stores messages directly in IndexedDB. Completed messages are
appended as individual records; partial replies and turn status are stored
separately. User input is saved before inference. Final assistant and tool
messages are saved before the agent continues. Partial progress is saved at
most once per 500 ms during streaming. An abrupt shutdown can lose progress
since the most recent completed save.

A saving failure blocks further operations until reload. Transactions prevent
partial history replacement. A browser lock permits one page to own the history.
A second page reports the conflict instead of opening another writer.
The browser needs Web Locks, IndexedDB, and `AbortSignal.any` in a secure context.

Existing Durable prototype history migrates automatically on first open.
Only this migration loads the old Durable/sql.js code and SQLite WebAssembly.
The original snapshot remains untouched in IndexedDB as a recovery copy.
Normal agent execution does not use Durable, Chord, or SQLite.
Migration supports the original single-conversation prototype, not arbitrary
server databases or multi-conversation archives.

Interrupted tool calls receive explicit failed results when history is recovered.
This preserves usable model context without repeating the external operation.
Cancellation cannot guarantee that a provider stops processing or cancels charges.

The native Pi MCP `1.1.0` browser build excludes Node-only stdio exports and uses
`TextEncoder` for HTTP stream byte counting. This is a build adaptation, not a
new MCP client. The build fails if the pinned parser no longer matches the
expected adaptation. The server's third-party MCP adapter remains unchanged.

## Export and restore

Select **Export history** to download `finrod-history.json`. Keep this file
private: it includes conversation and tool content and is not encrypted.
The configured provider key is not included. Export is unavailable during a turn.

Select a file under **Restore backup** and confirm replacement. Export current
history first if you need to retain it. Finrod validates the supported backup
format before replacement; invalid files leave current history unchanged.
Restored unfinished work is marked interrupted. Restore does not start a request.

Local history is not application-encrypted. Device access, browser access, the
website distributor, and the update channel remain trust boundaries.
Clearing site data, device loss, or browser storage eviction can remove history,
including the retained migration snapshot. Keep an external backup.

## Verification

`npm run test:web` builds the browser application and runs three focused browser
scenarios with controlled provider responses. They cover:

- Migration from a database written by the real Durable storage implementation,
  research, reopening, the single-page lock, and export/restore.
- Interrupted tool recovery, absence of automatic replay, and valid next-turn context.
- Storage failure before paid work, provider failures, and credential redaction.

The checks use desktop Brave when `/usr/bin/brave-browser` exists, or Playwright's
installed Chromium otherwise. Set `FINROD_TEST_BROWSER` to select another Chromium
executable. Install Chromium with `npx playwright-core install chromium` when
neither browser is available. CI installs Chromium and runs the controlled checks.

Optional live checks are disabled by default:

- `FINROD_TEST_LIVE_EXA=1`: real keyless Exa search and page retrieval from the browser with controlled inference.
- `FINROD_TEST_LIVE_MODEL=1`: real Haiku inference and Exa research; requires `OPENROUTER_API_KEY` and incurs provider charges.

Passed locally: server typechecking, browser typechecking/bundling, all three
controlled scenarios, and both live browser checks. The live model completed a
research turn and cited a source. A provider-error credential leak found during
verification was repaired and its regression check passes.

Still unverified: actual iPhone behavior, the second user's Chrome phone session,
phone-only setup, abrupt device termination, and large-history performance.
The full server/installer suites and remote CI were not run for this change.
Desktop evidence does not close the phone release gate in [Phone PRD](PHONE-PRD.md).
