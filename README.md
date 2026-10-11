# Finrod

### A self-hosted personal assistant, one Telegram conversation.

Talk through an idea. Research a question. Save a topic and return to it later.
Finrod combines [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)
with [Telegram](https://telegram.org/) text and voice input, web research,
and knowledge you explicitly choose to keep. You choose where it runs and
control its configuration and stored data; no central Finrod account is required.

**[Quick start](#quick-start)** · **[Usage](#usage)** · **[Why Finrod?](#why-finrod)** · **[Documentation](#documentation)**

> **v0.1.0:** one authorized user per bot instance, running on a VPS. Text, voice, feedback, and conversation
> continuity after migration are verified. Saved topics and a stopped-service
> backup were preserved. See [Validation](docs/VALIDATION.md) for evidence and
> the remaining checks. [The v1 roadmap](docs/ROADMAP.md) targets one shared bot
> for hundreds of users on operator-controlled infrastructure; multi-user
> isolation and encrypted storage are not implemented in this release.

---

## Quick start

### Requirements

This release serves one Telegram user per instance. Finrod needs four components:

- **Telegram:** a bot token from [@BotFather](https://t.me/BotFather) and your
  numeric Telegram user ID.
- **Pi Durable:** the conversation engine, installed with the project dependencies.
- **An LLM provider supported by Pi:** the current Finrod configuration supports
  OpenRouter, Anthropic, and OpenAI. Configure credentials for your chosen provider.
- **A transcription service for voice input:** use OpenRouter or a local
  OpenAI-compatible service, such as [Whisper](https://github.com/openai/whisper).
  Text-only use does not call the transcription service.

### Install and start

Choose a published version from [Releases](https://github.com/joaomj/finrod/releases),
or use the latest `master` checkout below. On Linux, run as your normal user
from an interactive terminal:

```sh
git clone https://github.com/joaomj/finrod.git && bash finrod/scripts/install.sh
```

Already have the repository? Run this inside the Finrod project folder:

```sh
bash scripts/install.sh
```

The installer:

1. Checks prerequisites and installs a compatible [Node.js](https://nodejs.org/)
   runtime and [npm](https://docs.npmjs.com/) if needed.
2. Prompts for Telegram access, a chat provider and model, and transcription settings.
3. Writes private configuration outside Git, installs locked dependencies, and builds Finrod.
4. Installs and starts the [systemd](https://systemd.io/) user service.

API-key input is hidden. An [Exa API key](https://exa.ai/docs/get-started/exa-mcp)
is optional; leave it blank for keyless search. The installer does not create
provider accounts or install a local transcription server.

You need Git, Bash, and a working systemd user session. Missing operating-system
packages can be installed through `sudo` on Debian/Ubuntu after confirmation.
Automatic Node installation supports glibc Linux on x86_64 and arm64. Other hosts
need compatible prerequisites already installed.

Rerunning preserves configuration and data. It asks before stopping a running
service for an update or replacing a different service unit. After installation,
open your bot in Telegram and send `/start`, then try text and a short voice note.

For configuration locations, installation logs, manual setup, and VPS startup
without login, see [Operations](docs/OPERATIONS.md#installation).
No public HTTP port is required. Keep the machine awake and online.

## Usage

- Send a normal text message.
- Ask for web research with source links.
- Send a short voice note; Finrod replies with text.
- Ask to save a topic, then list and resume your saved topics.
- After an operator imports a ChatGPT archive, ask Finrod to search your earlier discussions.
  See [archive import](docs/OPERATIONS.md#import-a-chatgpt-archive). This does not create saved topics.
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

## Phone-local direction

The [roadmap](docs/ROADMAP.md#priority-phone-local-browser-operation) prioritizes running Finrod
inside an iPhone browser without a personal VPS or a native app.
A separate [browser prototype](docs/BROWSER.md) builds locally but is not yet verified on an iPhone.
The prototype uses Pi agent-core, direct Exa MCP research, and local export/restore.
The [phone PRD](docs/PHONE-PRD.md) defines its scope. The released Telegram installation remains the supported path.

## Documentation

| Guide | What you will find |
| --- | --- |
| [Phone requirements](docs/PHONE-PRD.md) | Independent phone execution, runtime decisions, and acceptance criteria |
| [Browser prototype](docs/BROWSER.md) | Phone-local scope, build, privacy boundaries, and unverified behavior |
| [Operations](docs/OPERATIONS.md) | Service setup, feedback export, data retention, backup, and migration |
| [Architecture](docs/ARCHITECTURE.md) | Pi integration, components, storage, recovery, and provider configuration |
| [Validation](docs/VALIDATION.md) | Completed live checks, automated checks, and remaining gaps |
| [Product requirements](docs/PRD.md) | Single-user v0 scope, acceptance criteria, and next steps |
| [Roadmap](docs/ROADMAP.md) | Self-hosted shared-bot v1, isolation, encryption, and release gates |
| [Releasing](docs/RELEASING.md) | CI checks, security gates, and tagged releases without automatic deployment |
