# Phone-local browser prototype

**Status:** unreleased stage 1 prototype. Typechecking and bundling pass.
Browser execution, local persistence, streaming, and recovery have not been verified on an iPhone.
Do not use this prototype as the only copy of important information.
The existing VPS and Telegram mode is unchanged.

## Intended experience

Open Finrod in the phone's browser, enter an OpenRouter key, and exchange text messages.
The prototype provides one conversation with `openai/gpt-4o-mini` through OpenRouter.
Finrod runs inside the browser and sends model requests directly to OpenRouter.
The static website distributes files; it does not execute the assistant or proxy messages.

The provider key stays in the open page's memory. Enter it again after closing the page.
Use a personal key with a spending limit. Do not embed a shared operator key in the website.
OpenRouter and its selected inference provider receive the submitted conversation context.
Their charges and retention policies are separate from local storage.

History is intended to persist in this browser on this device.
The prototype interrupts active work when the page becomes hidden.
On reopening, it cancels unfinished work instead of automatically resuming a paid request.
It has no background service, Telegram connection, tools, voice, or source import.

## Build and preview

Use the project's supported Node version and install the locked development dependencies.
From the checkout, run:

```sh
npm run build:web
npm run web:serve
```

Open `http://127.0.0.1:4173` on the development computer.
The server listens on loopback by default and serves only `web-dist/`.
It does not load Finrod's private environment file or accept model requests.
The browser build does not change the server application's `dist/` output.

For an iPhone, serve the complete `web-dist/` directory through HTTPS on a host reachable from the phone.
Plain HTTP on a LAN address does not meet the prototype's secure-context requirement.
HTTPS setup and browser hosting are separate from deployment of the Telegram service.
Do not start a second Telegram bot instance to preview this interface.

`FINROD_WEB_HOST` and `FINROD_WEB_PORT` configure the development server's address and port.
Binding to a non-loopback address makes the static files accessible to other reachable devices.
The development server does not provide TLS or authentication.

## Storage and execution

The browser runtime reuses the pinned Pi Durable harness and Pi model provider.
It does not implement a separate model or tool execution loop.
The browser adapter runs SQLite through sql.js and saves each committed database snapshot in IndexedDB.
A commit resolves only after the local snapshot transaction completes.
Snapshot persistence failure blocks further database operations until reload.
The adapter is intended for a small conversation, not large archive ingestion or measured production capacity.

A browser lock allows one Finrod page at a time to own the local history.
A second page reports the conflict instead of opening a second writer.
The browser must support Web Locks, IndexedDB, and WebAssembly in a secure context.

Local history is not application-encrypted. Anyone with sufficient device or browser access may read it.
The website distributor and update channel are also trust boundaries.
Local execution does not protect against malicious client code.

## Verification and remaining work

Passed checks:

- Server application typechecking.
- Browser typechecking and browser-target bundling.
- Build and development-server JavaScript syntax checks.
- An unauthenticated OpenRouter preflight for direct browser requests returned permitted origin, method, and headers.

The preflight did not submit a prompt or incur an inference charge.
No real model conversation or browser session was exercised.
No automated regression tests were added, and the existing full suites were not run for this change.

The stage 1 acceptance remains open: complete a conversation on an iPhone, close and reopen Finrod,
and verify saved history and visible interruption behavior.
Also verify streaming, provider failures, storage failures, and the single-page lock in a browser.

Export, restore, stored credentials, simpler setup, source retrieval, and optional Home Screen polish remain later work.
Clearing site data, losing the device, or browser storage eviction can remove local history.
The current prototype has no export or restore path.
See [Roadmap](ROADMAP.md#priority-phone-local-browser-operation) for the agreed product outcomes.
