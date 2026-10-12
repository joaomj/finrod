# Operations

Finrod is a static browser application. Users need an HTTPS URL and personal
provider access, not a VPS, service account, or conversation backend.
See [Browser](BROWSER.md) for Settings, local preview, and storage behavior.

## Static hosting

The current preview is **https://finrod-preview.pages.dev** on Cloudflare Pages.
Keep that stable origin for daily use. Deployment-specific URLs have independent
browser histories and credentials.

Build from the selected checkout with locked dependencies:

```sh
npm ci --ignore-scripts --include=dev --no-audit --no-fund
npm run build
```

Publish the complete `web-dist/` directory on an HTTPS static host. Include the
JavaScript chunks, styles, HTML, and SQLite WebAssembly used for earlier browser
migration. Do not publish the checkout, dependencies, private exports, credentials,
or screenshots. No functions, provider proxy, or hosting secrets are required.

Publishing or changing hosting requires explicit approval. The GitHub release
workflow does not deploy to Cloudflare or another static host.

## Updates

1. Export current chats before changing an installation or storage format.
2. Review checks and known migration limits for the selected revision.
3. Build and verify the browser application locally.
4. Publish only after deployment approval.
5. Reopen the stable origin and verify chat continuity and research.

Do not clear site data as an update step. Earlier browser records remain recovery
copies after migration. An older application version may not read newer storage.
Keep a usable export before rollback; do not assume rollback is automatic.

## Backup and restore

In Settings, select **Export all chats**. Keep `finrod-history.json` outside Git
and store it privately. The file includes chat text, research results, titles,
feedback, and completion state. It is not encrypted or a complete execution log.
Saved provider keys are excluded.

**Warning:** restore replaces all local chats. Export current history first if
those chats must remain available.

Select **Restore backup**, choose the file, and confirm replacement. Invalid
backups leave current history unchanged. Restore marks unfinished work interrupted
without replaying it. Restoring a backup does not restore saved provider keys.
Configure keys separately when moving to another browser or origin.

Site-data deletion, browser storage eviction, device loss, and private-session
termination can remove local data. Export/restore helps only when a usable backup
exists. There is no automatic synchronization or remote recovery service.

## Troubleshooting

- **Another Finrod page:** close the other tab, then reload. Only one page can write history.
- **Saving failed:** stop using the page, check device storage, and reload. Do not clear data to hide the error.
- **Research rate limit:** add a personal Exa key or wait for provider access to recover.
- **Rejected key:** check the respective provider account and replace the key in Settings.
- **Interrupted answer:** inspect saved progress and submit a new message explicitly. Finrod does not automatically retry unfinished work.
- **Missing history at another URL:** return to the original origin, export there, then restore at the intended origin.

A configured Exa key is not silently removed after failure. A research connection
failure prevents inference from starting. Cancellation does not guarantee that
external work or charges stop. Source links do not establish answer accuracy.

## Privacy

The browser stores readable history and credentials. Protect the device, browser
profile, backups, and update channel. Do not share diagnostic content without
checking it for private messages. Application redaction excludes configured keys;
it does not guarantee that arbitrary user text contains no sensitive information.

OpenRouter and its selected inference provider receive submitted context. Exa
receives research queries and requested URLs. Their billing, retention, and
availability policies are separate from local browser storage.

See [Validation](VALIDATION.md) for completed checks and remaining phone gaps.
