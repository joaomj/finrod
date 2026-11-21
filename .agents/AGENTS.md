# Instructions for agents working on Finrod

Finrod is a personal assistant. The user talks to it in Element (Matrix), by
text and voice. It runs on one server, the mini PC. The repository is
public: `joaomj/finrod`. Keep server names, addresses, and personal details
out of it.

## Git workflow

- Work on `master` only. Do not create branches or pull requests. Commit
  each change to `master` and push it.
- Tag a release at each milestone, when the user asks for one: bump `version` in `package.json` (run
  `npm install --package-lock-only --ignore-scripts`), add a `CHANGELOG.md`
  entry, then push the tag `vX.Y.Z`.
  `release.yml` builds and publishes the release on that tag.
- Never commit `PLAN-*.md`. Do not use `git add -A`; name the paths.

## Documentation

- Keep `README.md`, `docs/`, `CHANGELOG.md`, and the comments in `deploy/`
  aligned with the code. Update them in the same commit as the change that
  makes them wrong.
- Before you push a branch, search the docs for every name, path, setting,
  and command that the change touches, and fix each one that is out of date.

## Checks

- Run checks and tests on the server: `scripts/server-test.sh` syncs this
  working tree to `~/finrod-dev` and runs `npm test` there;
  `scripts/server-test.sh test/server.test.ts` runs only that file. The
  tests use their own ports and temporary data, not the running Finrod.
- `FINROD_LIVE=1 scripts/server-test.sh test/live.test.ts` runs the memory
  tests on the real Claude models through the server's Claude Code login.
  They use subscription quota, so run them when a change affects how the
  models use memory; otherwise they are skipped.
- `npm test` runs the type check, the build, and the tests in `test/`.
- Each new test must fail on the old code. Show that it does.
- `test/gateway.test.ts` starts its own Synapse in Podman, so `npm test`
  needs Podman and pulls `matrixdotorg/synapse` on the first run.

## Server (mini PC)

- Connect with `tailscale ssh joao@minipc-linux`. The home folder is
  `/home/joao`. For interactive scripts, give the user
  `tailscale ssh -t joao@minipc-linux /home/joao/<full path>`. A `~` typed
  on the laptop expands to the laptop's home folder.
- The server runs released builds only, from `~/.local/share/finrod/current`.
  `finrod-update` installs them, and its timer runs it every day.
- User services: `finrod-data` (the gocryptfs mount), `finrod` (it needs
  `finrod-data`), `finrod-gateway`, `finrod-update.timer`.
- All data is in `data.crypt`, mounted at `data/`. The passphrase is in
  Proton Pass. The server reads it with the
  agent token `finrod-minipc` (sealed in `pass-token.cred`). The agent token
  sees each item only through an item share. Find the share by the item's
  title; a `pass://minipc/...` reference fails.
- `XDG_RUNTIME_DIR` is not set in a remote `tailscale ssh` command. Use
  `/run/user/$(id -u)`.
- Before you replace, delete, or stop anything on the server, keep a way
  back, and tell the user how long Finrod is down.

## Credentials

### Rules

- Never print, log, or pass a secret as a command argument, and never write
  it to a file in Git. Pipe it, for example to `curl -K -`, or pass it as an
  environment variable.
- To see which fields an item has, read the item as JSON and print only the
  field names. Do not print values.
- The user creates passphrases and tokens in Proton Pass. Do not generate
  them for the user.
- The permission system blocks commands that write `*.env` paths. Ask the
  user to edit those files.

### Items in Proton Pass

List only the items that Finrod's code or tests read. Other items in the
vault stay out of this public file.

All items are in the vault `minipc`. On the laptop, `pass-cli` is logged in
as the user. On the server, only the agent token `finrod-minipc` can read
items, and only the item it has access to.

| Item | Field | Used for | Read by |
|---|---|---|---|
| `finrod-joao-encryption-key` | Custom item, field `secret key` | Passphrase of `data.crypt` (gocryptfs) and of `memories.enc` | `finrod-data-unlock` on the server, at each start of `finrod-data.service` |
| `finrod-llm-key` | SSH key item, field `private key` | OpenRouter API key | Laptop tests with a live model only; read it with `pass-cli` into `OPENROUTER_API_KEY`, without printing it |
| `exa mcp key` | custom fields `API Key`, `Secret`, `Expiry Date`, `Permissions` | Exa API key | Not used: research uses Exa's keyless free tier (`server/research.ts`) |

The agent token `finrod-minipc` is a viewer of `finrod-joao-encryption-key`
only, and expires one year after 2026-11-08. It sees each item through an item share, not through the vault,
so scripts find the share by the item's title (see `deploy/data-unlock`).
Renewal steps are in `docs/OPERATIONS.md`.

### Secrets on the server only

These are in `~/.local/share/finrod/` on the mini PC, not in Proton Pass:

- `pass-token.cred`: the agent token, sealed to the server's TPM with
  `systemd-creds`.
- `finrod.env`: `OPENROUTER_API_KEY`, `FINROD_GATEWAY_TOKEN` (the bearer
  token for `/api/*`), `FINROD_TRANSCRIBE_COMMAND`.
- `canary` and `canary-manage.json`: the canary tokens that `FINROD_CANARY_FILE`
  in `finrod.env` names, and their management links on canarytokens.org.
  Never print the tokens: an agent's model provider would see them, and a
  leak there would look like a leak from Finrod.
- `gateway.env` and `gateway/login.json`: the gateway's Matrix login and
  device keys.

## Privacy

- Logs hold only status and metadata. Never log user text, speech, or
  transcriptions.

## Voice

- The transcription model runs on the mini PC (`deploy/stt/`).

## UI testing

- The UI is Element. To test it, use Pi's browser-use extension, which
  starts a Chrome browser, and take screenshots as proof.

## Prompts

- Keep each prompt in its own file in a separate folder. Never put a prompt
  in the application code.
- Do not use prompts to enforce rules or workflows. Use the native tools of
  Pi (pi-durable): hooks, extensions, and nudges.

## Research

- Use the Exa MCP server for web search and to read websites. Do not use
  curl for that.
