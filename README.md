# Finrod

### An AI chat companion that runs in your browser.

Talk through an idea. Research a question. Return to your saved conversations.
Finrod provides a simple, dark chat interface with separate chats, streamed
answers, source links, and local feedback. No central Finrod account or
conversation backend is required.

The browser runs the assistant and stores your chats on your device. OpenRouter
provides model inference; Exa provides web research. Static hosting distributes
application files only. Local execution is not offline operation.

**[Try Finrod](https://finrod-preview.pages.dev)** · **[Quick start](#quick-start)** · **[Why Finrod?](#why-finrod)** · **[Documentation](#documentation)**

## Quick start

1. Open **https://finrod-preview.pages.dev** in a normal browser window.
2. Open **Settings** and enter your personal OpenRouter API key.
3. Optionally enter a personal Exa API key for research using your Exa account.
4. Select **Done**, then send a message.

The initial model is `anthropic/claude-haiku-5.5`. Blank Exa credentials use free,
rate-limited access. Personal keys use your provider accounts and can incur
charges. Use spending-limited keys.

Finrod saves keys separately from chat history and restores them on reopening.
**Forget key** and **Forget Exa key** remove the respective saved credentials
without changing chats. Neither history export nor restore includes saved keys.

## Usage and limits

- Select **New chat** for a separate conversation.
- Open the sidebar to return to a saved chat.
- Ask for web research with source links. Failed research remains visible.
- Select **Stop** to interrupt an answer. Keep Finrod visible during a request.
- Rate answers locally. A negative vote can include an optional comment.
- In **Settings**, select **Export all chats** to make a private backup.
- Use **Restore backup** to replace the local chat library after confirmation.

History belongs to this browser, device, and website origin. There is no automatic
synchronization. Use the same URL when returning. Avoid private browsing for
chats you want to retain. Export a backup before clearing site data or changing
origins. Restore requires separate provider-key setup on a new browser.

History, keys, and exported backups are not application-encrypted. OpenRouter
and its inference provider receive submitted context. Exa receives research
queries and requested URLs. The browser profile, static host, and software updates
remain trust boundaries. See [privacy and recovery](docs/BROWSER.md).

User-reported iPhone/Brave checks confirm conversation, reopening, live research
with a personal Exa key, and saved-key restoration. Full phone acceptance remains
open; see [Validation](docs/VALIDATION.md). Voice, imported-source retrieval,
background work, encryption, and complete execution-log export are not implemented.

## Build and preview locally

Use Node.js `22.22.1` or later and npm. From this checkout, run:

```sh
npm ci --ignore-scripts --include=dev --no-audit --no-fund
npm run build
npm run web:serve
```

Open `http://127.0.0.1:4173` on the development computer. The development server
serves only `web-dist/`; it does not proxy conversations or provider requests.
For phone access, publish the complete `web-dist/` directory on an HTTPS static
host. Publishing requires explicit approval. No credentials belong in the build.

`npm run check` checks browser types. `npm test` builds the application and runs
controlled browser checks without live provider calls by default. Install a
Chromium browser as described in [Browser](docs/BROWSER.md#verification).

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
| [Product requirements](docs/PRD.md) | Browser outcomes, scope, privacy boundaries, and phone acceptance |
| [Browser](docs/BROWSER.md) | Chat behavior, local preview, storage migration, and export/restore |
| [Architecture](docs/ARCHITECTURE.md) | Browser components, provider requests, persistence, and recovery |
| [Operations](docs/OPERATIONS.md) | Static hosting, updates, backups, and recovery |
| [Validation](docs/VALIDATION.md) | Automated evidence, user-reported phone checks, and remaining gaps |
| [Roadmap](docs/ROADMAP.md) | Phone acceptance, planned local encryption, and complete log export |
| [Releasing](docs/RELEASING.md) | Browser CI, security gates, and releases without automatic deployment |
| [Changelog](CHANGELOG.md) | Versioned changes and release notes |
