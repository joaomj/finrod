# Checks and releases

Finrod is self-hosted software. GitHub automation publishes checked versions;
it does not deploy to the VPS or any user's instance. No bot tokens, provider
keys, SSH credentials, or conversation databases belong in Actions secrets or
artifacts for this workflow.

## Workflow

`.github/workflows/ci-release.yml` runs on pull requests, pushes to `master`,
version-tag pushes, and manual dispatch. Release publication happens only for
a tag push, after all required jobs succeed.

| Gate | Required outcome |
| --- | --- |
| Build and types | Locked dependency installation, typecheck, and compilation succeed |
| Application tests | Telegram, knowledge, and voice integration tests pass |
| Installer checks | Bash/JavaScript syntax, ShellCheck, and the isolated installation/rerun test pass |
| Dependency security | `npm audit` reports no high or critical advisories, including development dependencies |
| Code security | CodeQL analysis completes and its SARIF contains no high/critical security findings or error-level results |
| Release metadata | Tag and package/lockfile versions agree; optional versioned notes are not empty |

Lower-severity findings remain visible for review. Scan failures are not converted
to success, and a successful SARIF upload alone does not satisfy the findings gate.
These checks reduce risk; they do not certify security or establish multi-user
privacy guarantees. CodeQL covers JavaScript/TypeScript; ShellCheck covers the
installer. Neither proves deployment correctness or replaces threat modeling.

Actions are pinned to commit hashes. Workflow permissions are read-only by
default; CodeQL can upload security results, and only the gated publication job
can write a release. Checkout does not persist Git credentials. Automatic
dependency-update branches and pull requests are disabled. Dependency changes
require explicit approval; security scanning remains enabled.

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

## Installation and updates

A successful release makes source available on GitHub; it does not change any
running instance. Operators select the release, back up their state, and use the
[installation and update procedure](OPERATIONS.md#installation). Do not assume
an older executable can read state written by a newer release, especially across
the future multi-user and encryption migration.
