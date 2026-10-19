# Finrod

### A personal AI assistant that lives on your home server.

Finrod runs on a home server and talks through Telegram: one shared bot, a
separate Finrod for each person, with separate memory, history, and
credentials. Models stay interchangeable, memory stays in files you own, and
nothing about the assistant belongs to a vendor.

**Status:** v0.3.0 is agreed but not implemented. The v0.2.0 browser chat is
retired; its history was test data and there is no migration.

**[Roadmap](docs/ROADMAP.md)** · **[v0.3.0 requirements](docs/PRD-v030.md)** · **[Documentation](#documentation)**

## Where Finrod is going

| Phase | Document | State |
| --- | --- | --- |
| v0.3.0 Telegram assistant | [PRD-v030.md](docs/PRD-v030.md) | Agreed, not implemented |
| V2 connectors (MCP, OAuth, approval-gated writes) | [V2-CONNECTORS.md](docs/V2-CONNECTORS.md) | Sketch |
| V3 memory (portable second brain) | [V3-MEMORY.md](docs/V3-MEMORY.md) | Sketch, intentionally imprecise |

## v0.2.0 browser (retired)

The v0.2.0 chat ran entirely in the phone browser with OpenRouter inference
and Exa research. It is retired in favor of the server product. Its history
was test data and there is no migration.

## v0.3.0 setup (not implemented yet)

Setup will mean: one Finrod process per person on the home server, one shared
Telegram bot token, and per-profile provider keys. The exact procedure lands
here once v0.3.0 is built. The agreed requirements are in
[v0.3.0 requirements](docs/PRD-v030.md).

## Privacy boundaries (v0.3.0)

Telegram's cloud sees every chat; bot chats are not end-to-end encrypted.
The transcription provider receives voice clips transiently under zero data
retention, but keeps usage metadata. The model provider receives submitted
context. Profiles never share logs, keys, memory, or connectors. Details are
in [v0.3.0 requirements](docs/PRD-v030.md).

## Retired browser source

The `web/` source and its build (`npm run build`, `npm run web:serve`,
`npm test`) belong to the retired v0.2.0 product. They remain in the checkout
as a reference until a separate cleanup decision removes them.

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
| [v0.3.0 requirements](docs/PRD-v030.md) | Telegram assistant outcomes, scope, and privacy boundaries |
| [V2 connectors](docs/V2-CONNECTORS.md) | Sketch: MCP connectors, OAuth, approval-gated writes |
| [V3 memory](docs/V3-MEMORY.md) | Sketch: portable second brain |
| [Product requirements](docs/PRD.md) | Retired v0.2.0 browser outcomes and phone acceptance |
| [Browser](docs/BROWSER.md) | Retired v0.2.0 chat behavior and export/restore |
| [Architecture](docs/ARCHITECTURE.md) | Retired v0.2.0 components and persistence |
| [Operations](docs/OPERATIONS.md) | Retired v0.2.0 hosting, updates, and recovery |
| [Validation](docs/VALIDATION.md) | v0.2.0 evidence and phone checks |
| [Releasing](docs/RELEASING.md) | Retired v0.2.0 CI, releases, and Cloudflare deployment |
| [Changelog](CHANGELOG.md) | Versioned changes and release notes |
