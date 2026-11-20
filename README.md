# Finrod

### A personal AI assistant that lives on your home server.

Finrod runs on a home server, and you talk to it in Element, the Matrix
messenger, on your phone and computers. The Matrix server runs on the same
home server and is reachable only over your tailnet. Chats and memory stay on
the server in files you own, models stay interchangeable, and nothing about
the assistant belongs to a vendor.

**[Roadmap](docs/ROADMAP.md)** · **[Documentation](#documentation)**

## What it does

- Answers text messages and voice notes in an encrypted direct chat in
  Element. Voice notes are transcribed on the server.
- Web research through Exa's free tier.
- Remembers by searching everything you said before, and keeps a wiki of
  notes about you: after the chat has been quiet for half an hour, Finrod
  updates its notes about you, each fact with the message it came from. It
  tells you what changed, and a 👎 undoes it.
- Searches and learns from your imported ChatGPT history.
- Shows typing while it answers, and answers with Markdown.
- Answers messages sent while it was restarting, once each.
- A server restart loses no saved message; an answer cut off by it shows as
  interrupted.

## Setup

You need a Linux home server on your tailnet with Node 22.19 or later and
Podman, the Matrix server from `deploy/matrix-install.sh`, and an OpenRouter
API key with zero data retention set in the OpenRouter account. The steps are
in [Operations](docs/OPERATIONS.md#first-install).

To work on Finrod locally:

```sh
npm ci
npm test
```

## Privacy boundaries

Finrod and the Matrix server have no public address; only tailnet devices
reach them, and Tailscale encrypts that traffic. Messages between Element and
the bot are end-to-end encrypted. Chats stay on the server, and what you
write or say never reaches a system log. Model requests go through OpenRouter
to zero-data-retention providers only: the provider receives the context of
each request but does not keep it. Exa receives research queries and the URLs
Finrod reads. iPhone notifications pass through matrix.org and Apple with
event IDs only. Chats and notes are encrypted on the server's disk, with a passphrase that
the server reads from Proton Pass at each start and never stores.

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
| [Roadmap](docs/ROADMAP.md) | What comes next |
| [Architecture](docs/ARCHITECTURE.md) | Components, request flow, storage, and files |
| [Operations](docs/OPERATIONS.md) | Configuration, install, voice, the Matrix server, updates, backup, and troubleshooting |
| [Changelog](CHANGELOG.md) | Versioned changes |
