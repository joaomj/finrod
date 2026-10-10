# Finrod

A personal Telegram assistant for conversation, web research, voice notes, and
saved topics. Replies support private thumbs-up and thumbs-down feedback.

Finrod is an early v0. The local service runs and text replies have been observed.
Live voice, feedback, restart recovery, and backup restore still need verification.

## Requirements

- Linux with Node.js 22.22.1 or a later Node 22 release, and npm.
- A Telegram bot token from `@BotFather` and your numeric Telegram user ID.
- An OpenRouter API key with access to your chosen chat and transcription models.
- An Exa API key for authenticated web search. Keyless access is optional but uses
  Exa's free shared limits.
- systemd user services if you want Finrod to run outside your terminal.

No public HTTP port is required. Keep the machine awake and online.

## 1. Install

From the checkout:

```sh
npm ci --ignore-scripts
npm run build
```

## 2. Configure

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
```

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

## 3. Start

For a foreground run:

```sh
node --env-file="$HOME/.config/finrod/environment" dist/main.js
```

Open your bot in Telegram and send `/start`. If startup fails, fix the setting
named in the error. Stop the foreground process before installing the service.

### Run as a user service

Create `~/.local/share/finrod` and `~/.config/systemd/user` if needed.
Copy `deploy/finrod.service.in` to `~/.config/systemd/user/finrod.service`.
Replace `@PROJECT@` with the absolute checkout path and `@NODE@` with the
absolute Node executable path. Use paths without spaces.

Then enable and start the service:

```sh
systemctl --user daemon-reload
systemctl --user enable --now finrod.service
```

Check startup and recent errors:

```sh
systemctl --user status finrod.service
journalctl --user -u finrod.service -n 40 --no-pager
```

Never run two instances for the same bot. After changing code or service
configuration, rebuild if needed and restart `finrod.service`.

## 4. Try the bot

- Send a normal text message.
- Ask for web research with source links.
- Send a short voice note; Finrod replies with text.
- Ask to save a topic, then list and resume your saved topics.
- Rate a new assistant reply with either feedback button. You can change your vote.
- Use `/status` to inspect uncertain reply deliveries.

A resumed topic brings its saved summary into the current conversation. Deleting
a saved topic does not delete conversation history or backups.

## Next steps

- [Operations](docs/OPERATIONS.md): feedback export, service controls, live checks,
  backup, restore, and VPS migration.
- [Architecture](docs/ARCHITECTURE.md): components, extension boundaries, storage,
  recovery, privacy, and verification.
- [Product direction](PRODUCT.md): agreed scope and initial research.
