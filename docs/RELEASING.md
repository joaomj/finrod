# Checks and releases

Finrod is a static browser application. GitHub automation publishes checked
source versions; it does not deploy to Cloudflare or change users' browser data.
Provider keys, private histories, local configurations, and screenshots must not
become Actions secrets or artifacts for this workflow.

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
dependency-update branches and pull requests are disabled. Security scanning remains enabled. Commits, pushes, tags, release publication,
and deployments require explicit approval each time.

## Publish a version

1. Update `package.json` and the root package metadata in `package-lock.json`.
2. Optionally write `docs/releases/vMAJOR.MINOR.PATCH.md` with user-facing changes,
   evidence, and limits.
3. Commit the release changes, including the workflow itself, and review CI.
4. Create an annotated `vMAJOR.MINOR.PATCH` tag on that commit and push it.
5. Inspect the tag's workflow run. GitHub publishes the release only after its gates pass.

GitHub automatically generates release notes, including merged pull requests,
contributors, and a comparison link when available. If versioned notes exist,
they are prepended to the generated notes. For direct commits without pull
requests, use optional notes to explain important changes and known limitations.

Do not publish the GitHub release first: the tag push is the trigger, and
publication is the final gated operation. This workflow currently accepts stable
three-part versions, not prerelease tags. Rerunning a successful tag workflow
recognizes its existing published release rather than creating a duplicate.

Never move a published tag to different code. Fix code failures in a new commit
and version. A transient infrastructure failure can be retried on the same tag.
A local tag that has never been pushed can be recreated before publication.

Repository administrators should protect release tags and the default branch
and require these checks. YAML alone does not prevent an administrator from
bypassing the workflow or publishing a release manually.

## Static distribution and updates

A successful release makes source available on GitHub. It does not change a
running website or browser installation. Build the selected revision and publish
`web-dist/` only after deployment approval. Keep the stable origin and export
history before storage migrations or rollback. See [Operations](OPERATIONS.md).

Do not claim that an older application can read state written by a newer release.
The current `0.1.0` package version has not been advanced by this cleanup. A new
browser release needs its own approved version, notes, checks, and publication.
