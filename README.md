# Finrod

### A personal AI assistant that lives on your home server.

Finrod runs on a home server and you open it as a web app on your phone,
installed on the home screen. It is reachable only over your tailnet. Chats
and memory stay on the server in files you own, models stay interchangeable,
and nothing about the assistant belongs to a vendor.

**Status:** v0.3.0 is built and in final checks; it is not released yet.
The v0.2.0 browser chat is retired; its history was test data and there is no
migration.

**[Roadmap](docs/ROADMAP.md)** · **[v0.3.0 requirements](docs/PRD-v030.md)** · **[Documentation](#documentation)**

## What it does

- Chat with streamed answers and Markdown, in separate conversations that
  any tailnet device can reopen.
- Web research through Exa, with the sources listed under each answer.
  Connect your own Exa account to avoid the free tier's rate limit.
- Send photos, screenshots, PDFs, and text files, up to 20 MB each.
- Thumbs up or down on each answer.
- Delete a conversation, or start a temporary one that is never written to
  disk.
- A server restart loses no saved message; an answer cut off by it shows as
  interrupted.

v0.3.0 has no voice input. See the voice decision in the
[v0.3.0 requirements](docs/PRD-v030.md#voice-decision).

## Setup

You need a Linux home server on your tailnet, Node 22.19 or later, and an
OpenRouter API key with zero data retention set in the OpenRouter account.
Install Finrod from a GitHub release as a systemd user service, then publish
it over HTTPS with Tailscale Serve. The steps are in
[Operations](docs/OPERATIONS.md#first-install).

To work on Finrod locally:

```sh
npm ci
npm run build
OPENROUTER_API_KEY=... npm start
```

Then open `http://127.0.0.1:8787`.

## Privacy boundaries

Finrod has no public address; only tailnet devices reach it, and Tailscale
encrypts that traffic. Chats and files stay on the server. Model requests go
through OpenRouter to zero-data-retention providers only: the provider
receives the context of each request but does not keep it. Exa receives
research queries and the URLs Finrod reads. Chats and files are not encrypted
on the server's disk. Details are in
[v0.3.0 requirements](docs/PRD-v030.md).

## Why Finrod?

[Finrod Felagund](https://tolkiengateway.net/wiki/Finrod) was a king of the Noldor,
founder of the hidden realm of Nargothrond, and one of the Elven leaders who
stood against Morgoth in J. R. R. Tolkien's
*[The Silmarillion](https://en.wikipedia.org/wiki/The_Silmarillion)*. But his
strength was not only that of a ruler or warrior. He was also a seeker of
understanding across the boundaries of his own people.

When Finrod encountered the first Men to enter Beleriand, he stayed among them,
learned their language, and shared his knowledge. His conversations with the
mortal woman Andreth explored the differences between Elves and Men: mortality,
loss, and hope. He did not merely have answers to give; he took another people's
experience seriously enough to listen and question.

His loyalty also had a cost. Bound by his promise to Barahir, Finrod aided
Barahir's son Beren even when his own people would not follow him. Captured by
Sauron, he ultimately broke his bonds and killed the werewolf sent to devour
Beren, receiving mortal wounds himself. His story joins wisdom and power to
responsibility: a promise mattered more than the safety of his throne.

That is the spirit behind this name. Finrod should be a capable companion in
thought: bringing knowledge to a conversation without replacing the person at
its center, helping ideas survive beyond a single exchange, and treating trust
as a responsibility rather than a claim of authority. The literary namesake
sets an aspiration—not a claim that software possesses his wisdom or virtue.

## Documentation

| Guide | What you will find |
| --- | --- |
| [Roadmap](docs/ROADMAP.md) | Phase index: v0.3.0, V2 connectors, V3 memory |
| [v0.3.0 requirements](docs/PRD-v030.md) | Outcomes, scope, decisions, and privacy boundaries |
| [Architecture](docs/ARCHITECTURE.md) | Components, request flow, storage, and files |
| [Operations](docs/OPERATIONS.md) | Configuration, install, updates, backup, and troubleshooting |
| [V2 connectors](docs/V2-CONNECTORS.md) | Sketch: MCP connectors, OAuth, approval-gated writes |
| [V3 memory](docs/V3-MEMORY.md) | Sketch: portable second brain |
| [STT eval](docs/STT-EVAL.md) | Transcription test results, kept for a later voice feature |
| [Retired v0.2.0 docs](docs/retired/) | The browser-only product's requirements, behavior, and evidence |
| [Changelog](CHANGELOG.md) | Versioned changes and release notes |
