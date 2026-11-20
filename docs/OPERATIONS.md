# Operations

Finrod runs on the home server as systemd user services. You talk to it in
Element, through a Matrix server on the same machine. The server runs
released builds only. Code is written and built elsewhere, and GitHub Actions
builds each release archive.

Two processes make up Finrod:

- **Finrod** (`finrod.service`, `dist/server/main.js`): the conversation, the
  model, research, and voice transcription. It listens on `127.0.0.1` and
  answers only requests that carry the gateway token.
- **The gateway** (`finrod-gateway.service`, `dist/gateway/main.js`): the
  Matrix bot. It passes each message to Finrod and posts the answers back.

## Privacy of logs

What the user writes or says is kept only in Finrod's conversation storage,
never in the system log. Errors name the step that failed, not the message.
The transcription container runs with `--log-driver none`, because its
output is the transcript. A test (`test/server.test.ts`) fails if a typed
message or a transcript, from a success or a failure, reaches Finrod's
output.

## Configuration

Finrod reads its settings from the environment and refuses to start when one
is wrong. The error names the setting and how to fix it.

| Setting | Required | Default | Meaning |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | With `openrouter` | None | OpenRouter API key |
| `FINROD_PROVIDER` | No | `openrouter` | `openrouter`, or `claude-directsdk` to answer through the Claude Code login on the server; see [Claude subscription](#claude-subscription) |
| `FINROD_GATEWAY_TOKEN` | Yes | None | Secret the gateway sends with every request, at least 32 characters. Create it with `openssl rand -hex 32` |
| `FINROD_TRANSCRIBE_COMMAND` | For voice | None | Executable that gets `AUDIO` and prints `{"duration", "segments": [{"start", "end", "text"}]}`. On the server: `/home/joao/.local/share/finrod/current/deploy/stt/transcribe`; see [Voice](#voice) |
| `FINROD_MEMORY_KEY_FILE` | Yes | None | File with the passphrase, at least 16 characters, of `memories.enc`, the memories approved before the wiki. Finrod moves them into the wiki once and renames the file `memories.enc.imported`. `finrod.service` sets it; see [Encrypted data](#encrypted-data) |
| `FINROD_WIKI_MODEL` | No | `opus` with `claude-directsdk`, otherwise `FINROD_MODEL` | Model ID, from the same provider, that updates the wiki. Updates run after the conversation, so a slower, stronger model costs no wait |
| `FINROD_WIKI_CLEANUP_SECONDS` | No | `604800` (7 days) | How often Finrod checks the whole wiki against its sources, merges, and prunes. A cleanup also waits for a quiet chat |
| `FINROD_WIKI_IDLE_SECONDS` | No | `1800` | How long the chat stays quiet before Finrod updates the wiki from it |
| `FINROD_MODEL` | No | `deepseek/deepseek-v4.1-flash-1017`, or `sonnet` with `claude-directsdk` | Model ID in the provider's catalog |
| `FINROD_PORT` | No | `8787` | Port on `127.0.0.1` |
| `FINROD_DATA_DIR` | No | `.finrod` | Data directory; the service sets it |
| `FINROD_PROFILE` | No | `default` | Profile name: lowercase letters, digits, hyphens |
| `CLAUDE_DIRECTSDK_COMMAND` | With `claude-directsdk` on the server | `claude` on `PATH` | Path of the Claude Code executable. The user services do not have `~/.local/bin` on `PATH` |
| `DISABLE_AUTOUPDATER` | With `claude-directsdk` | None | `1` keeps Claude Code at the installed version; see [Claude subscription](#claude-subscription) |

Zero data retention is an OpenRouter account setting. Enable it there before
use. Finrod does not set it per request. Web research uses Exa's free tier.

## Layout on the server

```text
~/.local/opt/node/                   Node 22.19 or later, installed by hand
~/.local/bin/finrod-update           update script
~/.config/systemd/user/              finrod.service, finrod-data.service, finrod-gateway.service, finrod-update.service, finrod-update.timer
~/.local/share/finrod/
  finrod.env                         Finrod settings, mode 0600
  gateway.env                        gateway settings, mode 0600
  data/                              all chats (Finrod's only state)
  gateway/                           the bot's login and encryption keys
  stt/                               speech-to-text environment and model
  releases/finrod-vX.Y.Z/            unpacked releases, the newest 3 kept
  current -> releases/finrod-vX.Y.Z  the running release
```

Updates and rollbacks change only `releases/` and `current`.

## First install

Prerequisites: a published release with a `finrod-vX.Y.Z.tar.gz` archive,
lingering enabled for the user (`loginctl enable-linger`), Podman, and the
[Matrix server](#matrix-server).

1. Install Node 22.19 or later under `~/.local/opt/node`.
2. Copy `deploy/finrod-update` to `~/.local/bin/` and make it executable.
3. Copy the files in `deploy/systemd/` to `~/.config/systemd/user/`.
4. Write `finrod.env` with `OPENROUTER_API_KEY`, `FINROD_GATEWAY_TOKEN`, and
   `FINROD_TRANSCRIBE_COMMAND`, and `gateway.env` as in [Gateway](#gateway).
   Set both to mode `0600`.
5. Set up [encrypted data](#encrypted-data), with `deploy/data-encrypt` from the
   release archive.
6. Run `systemctl --user enable finrod.service finrod-gateway.service finrod-update.timer`.
7. Run `finrod-update`. It installs the latest release and starts Finrod and
   the gateway.
8. Run `~/.local/share/finrod/current/deploy/stt/setup` for voice.

Success: `finrod-update` prints `Finrod vX.Y.Z is installed and answering.`

## Encrypted data

All of Finrod's data, chats, the wiki, and recordings in progress, is in a
gocryptfs folder, `~/.local/share/finrod/data.crypt`. The files on disk and
in the cloud backup are always encrypted. Finrod sees them in plain form
only at `data/`, while it runs.

The passphrase is the `secret key` field of the Proton Pass item
`finrod-joao-encryption-key`, and it is nowhere on the server's disk. The
agent token sees that item only, through an item share, so the scripts find
it by title, not through the `minipc` vault.

`finrod.service` needs `finrod-data.service`, which holds the mount. When it
starts, `finrod-data-unlock` (`deploy/data-unlock`):

1. Logs in to Proton Pass with an agent token, in a throwaway session in
   `$XDG_RUNTIME_DIR/finrod/`, which is in memory.
2. Reads the passphrase, and logs out.
3. Mounts `data.crypt` at `data/`, and leaves the passphrase in the same
   runtime folder for `memories.enc`, the memory file of versions before
   the wiki, which is also encrypted with it (AES-256-GCM, key from scrypt).

A restart of Finrod keeps the mount. When `finrod-data.service` stops,
systemd stops Finrod, unmounts the folder, and deletes the runtime folder.
Finrod cannot start when Proton Pass is unreachable.

The agent token is sealed to this machine with `systemd-creds`
(`pass-token.cred`), so a copy of the disk cannot use it. Give it read
access to that one item only, and revoke it in Proton Pass if the server is
lost.

### Set up

1. Install gocryptfs: `sudo apt install gocryptfs`.
2. On a computer with your Proton Pass session, create the agent token and
   allow it to read only the passphrase item. The token is shown once:

   ```sh
   pass-cli agent create finrod-minipc --expiration 1y
   pass-cli agent access grant finrod-minipc --vault-name minipc --item-title finrod-joao-encryption-key --role viewer
   ```

3. On the server, run `~/.local/share/finrod/current/deploy/data-encrypt` and
   paste the token; it is not shown. The script seals the token, encrypts
   the existing data folder, checks the copy, and starts Finrod on it. It
   keeps the plain copy in `data.plain` until you delete it.

The token expires after one year. Before then, run
`pass-cli agent renew finrod-minipc --expiration 1y` and run `data-encrypt`
again with the new token. To restore on other hardware, restore
`data.crypt` and run the setup again.

## Voice

Voice notes are transcribed on the server with faster-whisper. The Python
environment cannot run on the host Python, so it is built and run inside
`python:3.12-slim` with Podman:

- `deploy/stt/setup` builds the venv from `deploy/stt/requirements.txt`
  (pinned versions) and downloads the Whisper model into
  `~/.local/share/finrod/stt/`. It takes several minutes and about 1 GB. It
  is safe to run again, and it rebuilds the venv when the requirements
  change.
- `deploy/stt/transcribe` runs `transcribe.py` in that image with no network
  and no container log.

A note of about 5 seconds takes about 4 seconds, container start included.
To check by hand, run the command on an audio file inside
`~/.local/share/finrod/`.

## Claude subscription

With `FINROD_PROVIDER=claude-directsdk`, Finrod answers through the Claude
Code executable and its login on the server, on the paid Claude plan,
instead of through OpenRouter. One `claude` process serves each
conversation. Research still uses Exa.

Claude Code is pinned, because the Agent SDK inside Finrod reads Claude
Code's messages and a new version can change them. The file
`claude-code-version` in the repository names the tested version, and each
release carries it. `finrod-update` installs that version if it is missing
and points `~/.local/bin/claude` at it before it restarts Finrod. A rollback
points it back at the previous release's version. Claude Code does not update
itself.

### Set up

1. Install the version in `claude-code-version`. It goes to
   `~/.local/bin/claude`:

   ```sh
   curl -fsSL https://claude.ai/install.sh | bash -s "$(cat ~/.local/share/finrod/current/claude-code-version)"
   ```

2. Stop it from updating itself when you run it by hand:
   put `{"env": {"DISABLE_AUTOUPDATER": "1"}}` in `~/.claude/settings.json`.
3. Log in as the user that runs Finrod. Open the link it prints in a
   browser, sign in to the Claude account, and paste the code back:

   ```sh
   claude auth login
   ```

   The login is in `~/.claude/.credentials.json`, mode `0600`. Claude Code
   renews it while Finrod uses it.
4. Add to `finrod.env`:

   ```sh
   FINROD_PROVIDER=claude-directsdk
   CLAUDE_DIRECTSDK_COMMAND=/home/joao/.local/bin/claude
   DISABLE_AUTOUPDATER=1
   ```

5. Run `systemctl --user restart finrod.service`.

Success: `journalctl --user -u finrod.service` shows
`Finrod listening on ... (profile default, model sonnet)`, and Finrod
answers in Element.

To go back to OpenRouter, remove `FINROD_PROVIDER` and restart Finrod.

### Update Claude Code

1. On another machine, install the new version, then run `npm run build` and
   `scripts/claude-smoke.sh` in the repository. It starts Finrod on the
   Claude Code login, sends one message, and prints the answer.
   The script warns when that version is not the one in
   `claude-code-version`.
2. Write the new version in `claude-code-version` and release Finrod. The
   next `finrod-update` installs it on the server.

## Updates

The timer runs `finrod-update` once a day. To update now from another
machine:

```sh
tailscale ssh <user>@<server> finrod-update
```

`finrod-update` does these steps:

1. Read the latest release of the public repository on GitHub.
2. Download the archive and its SHA-256 file, and verify the checksum.
3. Unpack the release and point `current` at it.
4. Restart Finrod and wait up to 30 seconds for it to answer on `127.0.0.1`,
   then restart the gateway.
5. If it does not answer, point `current` back at the previous release and
   restart again. The script exits with an error in both failure cases.

Only one update runs at a time. Node updates are manual.

A restart loses no saved message; an answer cut off by the restart shows as
interrupted.

## Releases

Pushing a `vX.Y.Z` tag that matches `package.json` runs the checks and then
publishes a GitHub release with the archive and its checksum. The archive
holds `dist/`, production `node_modules`, and `deploy/`. The server never
runs npm or builds anything.

## ChatGPT import

`data/profiles/default/chatgpt/` holds the user's ChatGPT conversations
(`chatgpt.sqlite`) and their recordings (`audio/`), imported once from
ChatGPT's data export. Finrod finds the folder at start. Search then covers
the import, and wiki updates read what the user wrote there. Each update
shows in Element and a 👎 undoes it, like any other.

The import takes conversations and recordings only. ChatGPT's saved memories
are not imported, and neither are images.

### Run the import

`deploy/chatgpt-import` builds the folder from the export's zip. It needs only
the host's `python3`, and it transcribes the recordings with
`FINROD_TRANSCRIBE_COMMAND`, so set up [Voice](#voice) first.

1. Make a [backup](#backup-and-restore).
2. Copy the export to the server, outside the repository and Git:
   `tailscale scp chatgpt-YYYYMMDD.zip <user>@<server>:`.
3. Stop Finrod and leave the data folder mounted, then import:

   ```sh
   systemctl --user stop finrod.service
   set -a; . ~/.local/share/finrod/finrod.env; set +a
   ~/.local/share/finrod/current/deploy/chatgpt-import ~/chatgpt-YYYYMMDD.zip \
     ~/.local/share/finrod/data/profiles/default
   systemctl --user start finrod.service
   ```

   The script prints how many conversations and messages it imported and
   which audio attachments the export left out. If a transcription fails, run
   it again: it keeps the database and transcribes only what is missing.
4. Delete the zip from the server: `rm ~/chatgpt-YYYYMMDD.zip`. The import
   is in the encrypted folder; the zip is not.

### Roll back

Make a [backup](#backup-and-restore) before the import; restoring it is the
complete rollback. To undo only the import and keep everything since:

1. Undo the wiki updates that read the import, newest first. `dream.json`
   lists them in `chatgptChanges`. An update that changed no page has
   nothing to undo and returns 404.

   ```sh
   set -a; . ~/.local/share/finrod/finrod.env; set +a
   profile=~/.local/share/finrod/data/profiles/default
   for id in $(~/.local/opt/node/bin/node -p "require('$profile/dream.json').chatgptChanges.reverse().join(' ')"); do
     printf 'header = "Authorization: Bearer %s"\n' "$FINROD_GATEWAY_TOKEN" |
       curl -sS -K - -X POST "http://127.0.0.1:${FINROD_PORT:-8787}/api/wiki/changes/$id/undo"; echo
   done
   ```

   A page changed again after an update keeps the newer version, as with 👎.
2. Stop Finrod, delete the folder, and start Finrod. At start, search drops
   the import's messages, and updates stop reading it.

   ```sh
   systemctl --user stop finrod.service
   rm -r ~/.local/share/finrod/data/profiles/default/chatgpt
   systemctl --user start finrod.service
   ```

## Backup and restore

The encrypted data folder is the only state. Back up `data.crypt` with
Finrod stopped, so the SQLite file is consistent:

```sh
systemctl --user stop finrod.service
tar -C ~/.local/share/finrod -czf finrod-data-$(date +%F).tar.gz data.crypt
systemctl --user start finrod.service
```

The data in the backup is encrypted; the passphrase is in Proton Pass. Backups
made before v0.7.0 hold the chats in plain form: keep them private and out of
Git.

To restore, stop the service, replace `data.crypt` with the backup's copy, and
start the service. Restoring replaces every conversation on the server.

## Matrix server

The messenger channel is a Matrix server on the mini PC. It runs as user
`joao`.

| Part | Where |
|---|---|
| Server name | `example.org`; user IDs are `@<name>:example.org`. Federation is off |
| Synapse | `127.0.0.1:8008`, published at `https://host.tailnet.ts.net:8448` |
| Matrix Authentication Service (MAS) | `127.0.0.1:8090`, published at `https://host.tailnet.ts.net:8449` |
| PostgreSQL, for MAS only | `127.0.0.1:5433` |
| Units | `~/.config/containers/systemd/matrix-{pg,mas,synapse}.container` (Podman Quadlet) |
| State | `~/matrix/`, mode `0700`: `secrets.env`, `mas/config.yaml`, `synapse/`, `pg/`, `accounts/` |
| Discovery | Cloudflare Worker `matrix-well-known` on `example.org` serves `/.well-known/matrix/client` and nothing else |
| Tailnet access | The policy grant from the iPhone, laptop, and Mac mini to `minipc` allows `tcp:8448-8449` |

### Install

Copy `deploy/matrix-install.sh` to the mini PC and run it as `joao`, with
`MATRIX_SERVER_NAME` set to the server name, `MATRIX_HOST` to the mini
PC's Tailscale Serve name, and `MATRIX_USERS` to the people's user names,
separated by spaces. It is
safe to run again: it keeps existing secrets, configs, and accounts. It:

1. Writes the MAS and Synapse configs. Two settings differ from the
   generated files: the MAS `issuer` must be the public address, and
   Synapse must bind to `127.0.0.1` without the federation listener. The
   script stops if either is wrong.
2. Writes and starts the three Quadlet units.
3. Publishes the ports with Tailscale Serve. On `:8448`,
   `/_matrix/client/v3/{login,logout,refresh}` go to MAS, so that password
   login works for the bot and for Element X.
4. Creates an account for each name in `MATRIX_USERS`, and `finrod` (the bot). Each
   first password is in `~/matrix/accounts/<name>`, mode `0600`.

After the first sign-in, each person changes their password at
`https://host.tailnet.ts.net:8449/account/` and deletes their
file in `accounts/`. Keep `accounts/finrod`: the gateway reads it.

### Clients

Element X on the iPhones; Element Desktop on the computers. Sign in with
the homeserver `example.org`. If the client cannot find it, enter the
server address `https://host.tailnet.ts.net:8448` instead; the
account is the same. Set up key backup and keep the recovery
key. For notifications, turn on **Settings > Notifications > Enable
notifications on this device** in Element X. Notifications need the mini
PC to reach `matrix.org`; they carry only event IDs.

### Gateway

The gateway is signed in as `finrod`. It joins a direct room only when a
known user invites it, and answers only in a room with exactly that user and
the bot. It sends text and voice notes to the user's Finrod; other files
get a reply that only text and voice work.

Settings, in `~/.local/share/finrod/gateway.env`, mode `0600`:

| Setting | Value |
| --- | --- |
| `MATRIX_HOMESERVER` | `https://host.tailnet.ts.net:8448`. Not `127.0.0.1:8008`: only this address sends password sign-in to MAS |
| `MATRIX_USER` | `@finrod:example.org` |
| `MATRIX_PASSWORD_FILE` | `/home/joao/matrix/accounts/finrod` |
| `FINROD_GATEWAY_TOKEN` | The same value as in `finrod.env`; create it with `openssl rand -hex 32` |
| `FINROD_GATEWAY_USERS` | `@marcos:example.org=http://127.0.0.1:8787`; separate more pairs with commas |

The unit sets `FINROD_GATEWAY_STATE` to `~/.local/share/finrod/gateway/`.
It holds the bot's login (`login.json`), its encryption and cross-signing
keys (`indexeddb/`), each user's room (`rooms.json`), and the reactions already handled (`reactions.json`). Keep it: with a
new state, the bot becomes a new device and cannot read older messages, and a
second cross-signing reset needs approval in MAS. The daily backup includes
it.

After the [first install](#first-install), start a direct chat with
`@finrod:example.org` in Element.
`finrod-update` restarts the gateway with each new release.

### Updates

The image versions are pinned in `deploy/matrix-install.sh`. To update,
change the version, run the script, and restart the three units with
`systemctl --user restart matrix-pg matrix-mas matrix-synapse`. Read the
Synapse and MAS upgrade notes first.

### Backup

The mini PC's daily backup (`minipc-backup.timer`, 03:15) includes
`~/matrix/`. It takes a read-only Btrfs snapshot of `/home` and uploads it
to Cloud Storage, so the PostgreSQL and SQLite files are crash-consistent.
A restore must bring back all of `~/matrix/`: the signing key and media in
`synapse/`, the MAS database in `pg/`, and `secrets.env`. Losing
`synapse/` or `pg/` loses every account and all history.

The archive is not encrypted before upload. It holds `secrets.env`, the
signing key, and the first passwords in `accounts/`. Messages in encrypted
rooms are stored encrypted. A restore of Matrix has not been tested.

## Troubleshooting

- **Finrod does not start:** run `journalctl --user -u finrod.service`. A
  configuration error names the setting to fix.
- **Model not found at startup:** set `FINROD_MODEL` to an ID in the provider's
  catalog. The error lists the first IDs of the catalog.
- **Update failed:** run `journalctl --user -u finrod-update.service`, or run
  `finrod-update` by hand to see its message.
- **Claude Code not found, or not logged in:** the error names the fix. Check
  `CLAUDE_DIRECTSDK_COMMAND` in `finrod.env`, and run `claude auth login`
  again as the user that runs Finrod.
- **Research rate limit:** Exa's free tier limits searches; wait and ask again.
- **Voice note answered with an error:** run the transcribe command by hand on an
  audio file in `~/.local/share/finrod/` to see its output. Finrod does not log it.
- **Gateway does not answer:** run `journalctl --user -u finrod-gateway.service`.
- **Storage failure:** Finrod exits so systemd restarts it. Check disk space
  and the journal.
