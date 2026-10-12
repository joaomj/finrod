# Phone-local browser prototype

**Status:** unreleased agent-core prototype. Desktop Brave checks pass, including
live OpenRouter inference and Exa research. Actual phone acceptance remains open.
The existing VPS and Telegram mode is unchanged.
See [Phone PRD](PHONE-PRD.md) for the approved requirements.

## Intended experience

Open Finrod in the phone's browser, enter a personal OpenRouter key, and exchange
text messages. Open **Settings** to enter the key. The initial default is
`anthropic/claude-haiku-5.5` through OpenRouter.
Pi agent-core runs the conversation and tool loop in the browser.
Requests go directly to OpenRouter and Exa; no Finrod backend processes messages.
A static website distributes application files only.

The interface is dark-only. Select **New chat** to start a separate conversation.
Open the sidebar with the top-left button to select a saved chat. The sidebar
starts hidden and closes after selection. Settings contains
credentials, export, restore, and privacy information. Answers support Markdown
and clickable source links. Raw HTML cannot execute, links allow only HTTP or
HTTPS, and model-supplied images do not load. Web research appears in a collapsed
activity disclosure, not as separate tool cards.

The composer expands as you type. On desktop, Enter sends and Shift+Enter adds a
line. On touch devices, Enter adds a line; select Send to submit. During an
answer, Stop replaces Send. You can draft another message without submitting it.
Scrolling up pauses automatic following. Select **Jump to latest** to follow
new output again. There is no task dashboard or unattended agent operation.

Each chat has a sequential `session_id` and its own model context. IDs belong to
this browser's history, not to a shared account. Starting a new chat does not send
messages from other chats. An unused empty chat is reused to avoid duplicate
blank entries. Selecting a chat restores its saved context. Stop an
active answer before switching chats. Unsent drafts survive switching during the
open page, but are not saved across reloads.

New chats start with the title **New chat**. After the first successful reply,
one small OpenRouter request generates a title from the first successful exchange.
The request uses the configured model and key, no tools, and bounded text input.
It does not enter conversation history or block another message or chat switch.
Title generation adds a small provider charge. A failed or interrupted title
stays **New chat**, shows an error, and is not automatically retried.
Migrated conversations use **Previous conversation** without a model request.

Finrod supplies the device's current date and timezone to the model. Exa's
`web_search_exa` and `web_fetch_exa` tools provide search and page retrieval.
Source content is untrusted evidence, not an instruction channel.

In **Settings**, enter the OpenRouter key and select **Done** to save it in this
browser. Finrod restores the key after reload or reopening. Select **Forget key**
to remove it without changing conversation history. Closing Settings without
selecting Done discards key edits.

The key uses localStorage under `finrod.openrouter-key`, separate from the
IndexedDB conversation records. History export and restore do not include or
replace the key. Clearing site data removes both history and the saved key.
Use a personal key with a spending limit. Do not embed a shared operator key in
the website. Provider error strings are redacted before saving history or
exporting backups.

The saved key is not application-encrypted. Anyone with access to this browser
profile or malicious website updates could read it. Private browsing does not
provide storage that survives the end of the private session.

OpenRouter and its selected inference provider receive submitted conversation
context. Exa receives search queries and requested URLs. Their charges, retention
policies, rate limits, and availability are separate from local storage.

The Exa connection uses free, rate-limited access when no personal Exa key is saved.
In Settings, enter an optional Exa API key and select Done. The same Exa API key
also authenticates the hosted MCP service. Requests send it in an `x-api-key`
header, not in a URL. Keyed requests use the user's Exa account and can incur charges.
Select **Forget Exa key** to return to free access without changing history.
The Exa key is saved in localStorage under `finrod.exa-key`, separately from
conversation storage and the model key. History export and restore do not
include or replace either saved key. Both keys are readable by this browser's
application code and are not application-encrypted.

The adapter reports Exa's known free-access limit as a failed tool call, even
when the service returns ordinary text rather than an MCP error. The research
activity marks the turn incomplete and identifies the failed search or page
retrieval. Existing saved rate-limit responses also display as failures without
rewriting history. Finrod does not remove a configured key or silently switch
to free access after a keyed request fails.

The connection loads the two tool schemas before each conversation turn. If that connection
fails, Finrod reports the failure without starting an inference request.
Personal Exa keys are supported; an Exa OAuth flow is not implemented.

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

Normal operation uses IndexedDB database `finrod-browser`, version 3.
The `sessions` store contains chat metadata, partial replies, and turn status.
The `chatMessages` store uses keys `[session_id, message_index]` for completed
records. The `library` store tracks the active chat and the next sequential ID.
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

Both earlier browser formats migrate automatically into session 1 on first open.
The previous IndexedDB `messages` and `history` stores remain untouched as a
recovery copy. The multi-chat runtime does not write them.
Existing Durable prototype history also migrates automatically on first open.
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

In **Settings**, select **Export all chats** to download `finrod-history.json`.
The version 2 backup includes all chats, IDs, titles, and the active selection.
Keep this file private: it includes conversation and tool content and is not encrypted.
The backup is not a complete browser or execution log. Planned local encryption
and complete conversation-log export are defined in [Roadmap](ROADMAP.md).
The saved model and Exa keys are not included. Export is unavailable during a turn.

In **Settings**, select **Restore backup**, choose a file, and confirm replacement.
Restore replaces all chats, not only the active chat. Export current history
first if you need to retain it. Finrod validates the supported backup format
before replacement; invalid files leave current history unchanged. Earlier
single-chat version 1 backups restore as one conversation. Restoring an older
backup does not lower this browser's ID counter.
Restored unfinished work is marked interrupted. Restore does not start a request.

Local history is not application-encrypted. Device access, browser access, the
website distributor, and the update channel remain trust boundaries.
Clearing site data, device loss, or browser storage eviction can remove history,
including the retained migration snapshot. Keep an external backup.

## Verification

`npm run test:web` builds the browser application and runs three focused browser
scenarios with controlled provider responses. They cover:

- Migration from a database written by the real Durable storage implementation,
  research, context isolation, sequential IDs, delayed titles across chat switches,
  reopening, the single-page lock, all-chat export/restore, and saved-key removal.
- Interrupted tool recovery, absence of automatic replay, and valid next-turn context.
- Storage failure before paid work, conversation and title failures, absence of
  title retries, and credential redaction.

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

The multi-chat interface passes the same three controlled scenarios. No new test
cases were added. A separate desktop Brave walkthrough checked desktop and
phone-sized layouts, Markdown, safe links, image suppression, and scroll
navigation. Reduced viewport height was checked without a real phone keyboard.
An isolated previous-version database preserved all 22 conversation records and
its original recovery copy during migration. A phone-sized sidebar walkthrough
and persistent-profile restarts confirmed saved-key restoration and removal.
Brave restored duplicate tabs during one restart; closing the extra isolated tab
released the expected single-writer conflict. These checks made no live model or
tool calls. Live checks above describe the earlier runtime verification, not a
live title-generation check.

The Exa-key and rate-limit changes pass browser typechecking/bundling and the
same three controlled scenarios, extended at the browser boundary. The checks
verify key save/reopen/removal, independent model and research keys, header
rather than URL authentication, credential exclusion from model requests and
backups, and visible keyed connection failures without fallback to free access.
An upstream credential echo is redacted before the next model request.

The rate-limit regression fails on the pre-fix browser code for the intended
reason: ordinary Exa rate-limit text appears as successful research. It passes
on the fixed code. The checks also verify a saved failed-tool flag and correct
presentation of an older result without rewriting history. No additional test
cases or production test seams were added. This run made no live inference or
research requests.

An Exa preflight from the preview origin permits the `x-api-key` header. This
establishes browser transport permission, not successful live authentication.
Live research with a personal Exa key and actual-phone behavior of these changes
remain unverified. The deployed preview still uses the earlier build.

Still unverified for release acceptance: the complete iPhone flow, the second
user's Chrome phone session, phone-only setup, abrupt device termination, and
large-history performance.
The full server/installer suites and remote CI were not run for this change.
Desktop evidence does not close the phone release gate in [Phone PRD](PHONE-PRD.md).
