# Finrod

### A personal assistant, one Telegram conversation.

Talk through an idea. Research a question. Save a topic and return to it later.
Finrod combines Pi Durable with Telegram text and voice input, web research,
and knowledge you explicitly choose to keep.

**[Quick start](#quick-start)** · **[Usage](#usage)** · **[Why Finrod?](#why-finrod)** · **[Documentation](#documentation)**

> **v0 status:** live text, Portuguese voice transcription, feedback storage,
> and user-reported summaries work. Backup restore and VPS migration remain
> unverified. See the [validation record](docs/VALIDATION.md) for evidence and limits.

---

## Quick start

### Requirements

- Linux with Node.js 22.22.1 or a later Node 22 release, and npm.
- A Telegram bot token from `@BotFather` and your numeric Telegram user ID.
- An OpenRouter API key with access to your chosen chat and transcription models.
- An Exa API key for authenticated web search. Keyless access is optional but uses
  Exa's free shared limits.
- systemd user services if you want Finrod to run outside your terminal.

No public HTTP port is required. Keep the machine awake and online.

### 1. Install

From the checkout:

```sh
npm ci --ignore-scripts
npm run build
```

### 2. Configure

Create `~/.config/finrod/environment` with mode `0600`. Keep credentials outside
Git. Replace the placeholder values below:

```dotenv
TELEGRAM_BOT_TOKEN=[REDACTED]
TELEGRAM_USER_ID=replace-with-numeric-user-id
OPENROUTER_API_KEY=[REDACTED]
EXA_API_KEY=[REDACTED]
FINROD_MODEL_PROVIDER=openrouter
FINROD_MODEL=anthropic/claude-haiku-5.5
TRANSCRIPTION_PROVIDER=openrouter
TRANSCRIPTION_MODEL=openai/whisper-large-v3
TRANSCRIPTION_LANGUAGE=pt
```

`TRANSCRIPTION_LANGUAGE` defaults to `pt` (Portuguese), including Brazilian
Portuguese. Use a two-letter language code such as `en` for English; `pt-BR`
is not accepted by the transcription API. This setting guides speech recognition,
not the language of the assistant's replies.

Use the numeric user ID, not your Telegram username. This is the only user the
bot accepts, and only private chats are supported.

OpenRouter transcription requires zero data retention (ZDR) routing on every
request. Enable account-wide ZDR in OpenRouter if you also require it for chat.
Exa and Telegram have separate data policies. Authenticated Exa access uses your
account's billing and rate limits; it is not unlimited.

Finrod does not automatically load a checkout `.env`. For foreground use, pass
its path with `--env-file`. The service below reads only
`~/.config/finrod/environment`. Changing your checkout `.env` after installation
does not update the service configuration.

For local Whisper or another chat provider, see
[configuration alternatives](docs/ARCHITECTURE.md#configuration-alternatives).

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

Finrod Felagund, from J. R. R. Tolkien's *The Silmarillion*, is known for his
friendship with Men and his loyalty to Beren. He is a fitting namesake for an
assistant meant to accompany a person, not take over their decisions.

The name expresses three goals:

- **Thoughtful conversation.** Help explore ideas and ask when something is unclear.
- **Continuity.** Keep the conversation and return to the topics that matter.
- **Respect for your agency.** Save knowledge on request and keep external sources read-only.

These are design goals, not a claim that the assistant is infallible. Feedback
helps identify where its behavior falls short.

## Documentation

| Guide | What you will find |
| --- | --- |
| [Operations](docs/OPERATIONS.md) | Service setup, feedback export, data retention, backup, and migration |
| [Architecture](docs/ARCHITECTURE.md) | Pi integration, components, storage, recovery, and provider configuration |
| [Validation](docs/VALIDATION.md) | Completed live checks, automated checks, and remaining gaps |
| [Product direction](PRODUCT.md) | Scope, principles, and deliberately deferred work |
