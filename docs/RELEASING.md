# Checks and releases

Finrod is a static browser application. GitHub automation publishes checked
source versions. Published, checked stable releases automatically deploy to the
existing Cloudflare Pages origin. Deployment changes application files, not users'
local chat data. Model keys, research keys, private histories, local configurations,
and screenshots must not become Actions secrets or artifacts.

## Workflow

`.github/workflows/ci-release.yml` runs on pull requests, pushes to `master` or `main`,
version-tag pushes, and manual dispatch. Release publication happens only for
a tag push, after all required jobs succeed.

| Gate | Required outcome |
| --- | --- |
| Build and types | Locked dependency installation, browser typecheck, and bundling succeed |
| Browser tests | The three controlled browser scenarios pass in Chromium |
| Dependency security | `npm audit` reports no high or critical advisories, including development dependencies |
| Code security | CodeQL analysis completes and its SARIF contains no high/critical security findings or error-level results |
| Release metadata | Tag and package/lockfile versions agree; optional versioned notes are not empty |

Lower-severity findings remain visible for review. Scan failures are not converted
to success, and a successful SARIF upload alone does not satisfy the findings gate.
These checks reduce risk; they do not certify security or establish phone
acceptance. CodeQL covers JavaScript/TypeScript. Automated checks do not prove
deployment correctness or replace threat modeling.

Actions are pinned to commit hashes. Workflow permissions are read-only by
default; CodeQL can upload security results, and only the gated publication job
can write a release. Checkout does not persist Git credentials. Automatic
dependency-update branches and pull requests are disabled. Security scanning remains
enabled. Commits, pushes, tags, and release publication require explicit approval.
Automatic deployment of published releases to the existing Pages project is approved.
Other hosting changes and manual uploads require separate approval.

## Publish a version

1. Update `package.json` and the root package metadata in `package-lock.json`.
2. Optionally write `docs/releases/vMAJOR.MINOR.PATCH.md` with user-facing changes,
   evidence, and limits.
3. Update `CHANGELOG.md`, commit the release changes, and review CI.
4. Create an annotated `vMAJOR.MINOR.PATCH` tag on that commit and push it.
5. Inspect the tag's workflow run. GitHub publishes the release only after its gates pass.
6. Inspect the Cloudflare deployment workflow and its hosted-file verification.

GitHub automatically generates release notes, including merged pull requests,
contributors, and a comparison link when available. If versioned notes exist,
they are prepended to the generated notes. For direct commits without pull
requests, use optional notes to explain important changes and known limitations.

Do not publish the GitHub release first: the tag push is the trigger, and
publication follows the release gates. Cloudflare deployment follows publication.
This workflow accepts stable three-part versions, not prerelease tags. Rerunning a successful tag workflow
recognizes its existing published release rather than creating a duplicate.

Never move a published tag to different code. Fix code failures in a new commit
and version. A transient infrastructure failure can be retried on the same tag.
A local tag that has never been pushed can be recreated before publication.

Repository administrators should protect release tags and the default branch
and require these checks. YAML alone does not prevent an administrator from
bypassing the workflow or publishing a release manually.

## Automatic Cloudflare deployment

`.github/workflows/deploy-cloudflare.yml` deploys to
**https://finrod-preview.pages.dev**. It accepts completed release workflows,
published-release events, and a manual dispatch for an existing release.

GitHub does not trigger a new release-event workflow when another workflow
publishes with `GITHUB_TOKEN`. The `workflow_run` trigger handles that path after
**CI and release** completes. PRs, ordinary branch pushes, and failed release
workflows do not deploy.

Before upload, the workflow requires:

- A published stable `vMAJOR.MINOR.PATCH` release that GitHub identifies as latest.
- A release tag that resolves to the exact immutable commit being built.
- Successful tag CI for that commit, including build, browser tests, audit, and CodeQL.
- Matching package, lockfile, and tag versions.
- Configured `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

The token needs Pages Read/Edit access to the hosting account. It needs no DNS
or Workers permissions. The build step does not receive Cloudflare credentials.
Only release assets enter the upload. The workflow pins Wrangler `4.149.0` and
uses the existing `finrod-preview` project and its `master` production branch.

Deployment runs share one concurrency group without cancelling an active upload.
Older releases leave production unchanged. The workflow verifies every static
asset at the stable HTTPS origin against its SHA-256 digest from the release build.
An upload or verification failure remains a failed workflow. Verification failure
after upload does not perform an automatic rollback.

To retry deployment after correcting an infrastructure problem, dispatch the
workflow with the latest published tag. Retry uses the same release commit;
it does not move the tag or publish a new release. An intentional rollback to
an older version requires a separate decision.

Keep the stable origin and export history before storage migrations or rollback.
See [Operations](OPERATIONS.md). Do not claim that an older application can read
state written by a newer release.

## References

- [Cloudflare Pages CI deployment](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/): Direct Upload and Pages credentials.
- [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow): events created with `GITHUB_TOKEN`.
- [GitHub workflow completion events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run): completion triggers and security boundaries.
