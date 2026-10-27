# Operations

Finrod runs on the home server as a systemd user service. The server runs
released builds only. Code is written and built elsewhere, and GitHub Actions
builds each release archive.

## Configuration

Finrod reads its settings from the environment and refuses to start when one
is wrong. The error names the setting and how to fix it.

| Setting | Required | Default | Meaning |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | Yes | None | OpenRouter API key |
| `FINROD_PUBLIC_URL` | For Exa sign-in | `http://127.0.0.1:<port>` | HTTPS origin the phone opens; Exa sign-in returns there |
| `FINROD_MODEL` | No | `deepseek/deepseek-v4.1-flash-1017` | OpenRouter model ID |
| `FINROD_PORT` | No | `8787` | Port on `127.0.0.1` |
| `FINROD_DATA_DIR` | No | `.finrod` | Data directory; the service sets it |
| `FINROD_PROFILE` | No | `default` | Profile name: lowercase letters, digits, hyphens |

Zero data retention is an OpenRouter account setting. Enable it there before
use. Finrod does not set it per request.

## Layout on the server

```text
~/.local/opt/node/                   Node 22.19 or later, installed by hand
~/.local/bin/finrod-update           update script
~/.config/systemd/user/              finrod.service, finrod-update.service, finrod-update.timer
~/.local/share/finrod/
  finrod.env                         settings, mode 0600
  data/                              all chats and files (the only state)
  releases/finrod-vX.Y.Z/            unpacked releases, the newest 3 kept
  current -> releases/finrod-vX.Y.Z  the running release
```

Updates and rollbacks change only `releases/` and `current`. They do not
touch `finrod.env` or `data/`.

## First install

Prerequisites: a published release with a `finrod-vX.Y.Z.tar.gz` archive,
lingering enabled for the user (`loginctl enable-linger`), and Tailscale on
the server.

1. Install Node 22.19 or later under `~/.local/opt/node`.
2. Copy `deploy/finrod-update` to `~/.local/bin/` and make it executable.
3. Copy the three files in `deploy/systemd/` to `~/.config/systemd/user/`.
4. Write `~/.local/share/finrod/finrod.env` with `OPENROUTER_API_KEY` and
   `FINROD_PUBLIC_URL`. Set its mode to `0600`.
5. Run `systemctl --user daemon-reload`.
6. Run `systemctl --user enable finrod.service finrod-update.timer`.
7. Run `finrod-update`. It installs the latest release and starts Finrod.
8. Publish `127.0.0.1:8787` over HTTPS with Tailscale Serve, at the address
   in `FINROD_PUBLIC_URL`.
9. On the iPhone, open that address in Safari and use **Add to Home Screen**.

Success: `finrod-update` prints `Finrod vX.Y.Z is installed and answering.`

## Updates

The timer runs `finrod-update` once a day. To update now from another
machine:

```sh
tailscale ssh <user>@<server> finrod-update
```

`finrod-update` does these steps:

1. Read the latest release from the public GitHub API. No credentials.
2. Download the archive and its SHA-256 file, and verify the checksum.
3. Unpack the release and point `current` at it.
4. Restart Finrod and wait up to 30 seconds for it to answer on `127.0.0.1`.
5. If it does not answer, point `current` back at the previous release and
   restart again. The script exits with an error in both failure cases.

Only one update runs at a time. Node updates are manual.

**Caution:** a restart ends all temporary conversations. Permanent
conversations continue; an answer cut off by the restart shows as
interrupted.

## Releases

Pushing a `vX.Y.Z` tag that matches `package.json` runs the checks and then
publishes a GitHub release with the archive and its checksum. The archive
holds `dist/`, production `node_modules`, and `deploy/`. The server never
runs npm or builds anything.

## Backup and restore

The data directory is the only state. Back it up with the service stopped,
so the SQLite file is consistent:

```sh
systemctl --user stop finrod.service
tar -C ~/.local/share/finrod -czf finrod-data-$(date +%F).tar.gz data
systemctl --user start finrod.service
```

**Warning:** the backup holds all chats, files, and the Exa sign-in in plain
form. Store it privately and keep it out of Git.

To restore, stop the service, replace `data/` with the backup's copy, and
start the service. Restoring replaces every conversation on the server.

## Troubleshooting

- **Finrod does not start:** run `journalctl --user -u finrod.service`. A
  configuration error names the setting to fix.
- **Model not found at startup:** set `FINROD_MODEL` to a current OpenRouter
  model ID.
- **Update failed:** run `journalctl --user -u finrod-update.service`, or run
  `finrod-update` by hand to see its message.
- **Research rate limit:** connect your own Exa account from the app menu.
- **Exa sign-in expired:** reconnect Exa from the app menu.
- **Storage failure:** Finrod exits so systemd restarts it. Check disk space
  and the journal.
