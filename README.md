# Finrod

### A personal assistant, one Telegram conversation.

Talk through an idea. Research a question. Save a topic and return to it later.
Finrod combines [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)
with [Telegram](https://telegram.org/) text and voice input, web research,
and knowledge you explicitly choose to keep.

**[Quick start](#quick-start)** · **[Usage](#usage)** · **[Why Finrod?](#why-finrod)** · **[Documentation](#documentation)**

> **v0 status:** live text, Portuguese voice transcription, feedback storage,
> and user-reported summaries work. Backup restore and VPS migration remain
> unverified. See the [validation record](docs/VALIDATION.md) for evidence and limits.

---

## Quick start

### Requirements

Finrod needs four components:

- **Telegram:** a bot token from [@BotFather](https://t.me/BotFather) and your
  numeric Telegram user ID.
- **Pi Durable:** the conversation engine, installed with the project dependencies.
- **An LLM provider supported by Pi:** the current Finrod configuration supports
  OpenRouter, Anthropic, and OpenAI. Configure credentials for your chosen provider.
- **A transcription service for voice input:** use OpenRouter or a local
  OpenAI-compatible service, such as [Whisper](https://github.com/openai/whisper).
  Text-only use does not call the transcription service.

To run the current implementation, use Linux with [Node.js](https://nodejs.org/)
22.22.1 or a later Node 22 release, and [npm](https://docs.npmjs.com/).

**Optional:** an [Exa API key](https://exa.ai/docs/get-started/exa-mcp) for
account-based web-search access; keyless access is supported. A
[systemd](https://systemd.io/) user service provides automatic startup but is not
needed for a foreground run.

No public HTTP port is required. Keep the machine awake and online.

### 1. Install

From the checkout:

```sh
npm ci --ignore-scripts
npm run build
```

### 2. Configure

Create `~/.config/finrod/environment` with mode `0600`. Keep credentials outside
Git. Follow the [configuration reference](docs/ARCHITECTURE.md#configuration-alternatives)
to configure:

1. Your Telegram bot token and numeric user ID.
2. Your chosen Pi model provider, model ID, and provider credentials.
3. Your transcription service and any overrides it needs.

The current implementation requires `FINROD_MODEL_PROVIDER` and `FINROD_MODEL`;
it does not choose a chat model automatically. Use values supported by the
installed Pi version and your provider account. Optional settings can be omitted
when their documented defaults suit your setup.

Finrod does not automatically load a checkout `.env`. For foreground use, pass
its path with `--env-file`. The user service reads only
`~/.config/finrod/environment`. Changing your checkout `.env` after installation
does not update the service configuration.

### 3. Start

For a foreground run:

```sh
node --env-file="$HOME/.config/finrod/environment" dist/main.js
```

Open your bot in Telegram and send `/start`. If startup fails, fix the setting
named in the error. Stop the foreground process before installing the service.

For automatic startup, follow [user-service setup](docs/OPERATIONS.md#install-the-user-service).
Never run a foreground instance and the service at the same time.

## Usage

- Send a normal text message.
- Ask for web research with source links.
- Send a short voice note; Finrod replies with text.
- Ask to save a topic, then list and resume your saved topics.
- Rate a new assistant reply with either feedback button. You can change your vote.
- Use `/status` to inspect uncertain reply deliveries.

A resumed topic brings its saved summary into the current conversation. Deleting
a saved topic does not delete conversation history or backups.

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
| [Operations](docs/OPERATIONS.md) | Service setup, feedback export, data retention, backup, and migration |
| [Architecture](docs/ARCHITECTURE.md) | Pi integration, components, storage, recovery, and provider configuration |
| [Validation](docs/VALIDATION.md) | Completed live checks, automated checks, and remaining gaps |
| [Product direction](PRODUCT.md) | Scope, principles, and deliberately deferred work |
