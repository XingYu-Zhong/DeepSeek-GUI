# Development Workflow

[简体中文](./DEVELOPMENT.zh-CN.md)

This document defines how developers should work in this repository, especially around the default branch, pull requests, and contribution quality standards.

## Development Baseline

- `develop` is the active collaboration and daily integration branch
- `master` is the stable release branch, updated by maintainers from `develop`
- Routine feature and fix work should start from the latest `develop`
- Short-lived feature branches are encouraged for non-trivial changes

## Recommended Workflow

1. Update your local repository.
2. Switch to `develop`.
3. Pull the latest changes from `develop`.
4. Create an optional feature branch from `develop` for your work.
5. Implement and validate your changes locally.
6. Open a PR back into `develop`.
7. Merge after review and passing checks.

## Example Commands

### Sync `develop`

```bash
git checkout develop
git pull origin develop
```

### Create a feature branch from `develop`

```bash
git checkout develop
git pull origin develop
git checkout -b feat/short-description
```

### Push your branch

```bash
git push origin feat/short-description
```

## Pull Request Flow

Default target branch:

- `develop`

Typical PR path:

1. Develop on a short-lived feature branch created from `develop`
2. Push the branch to the remote
3. Open a PR into `develop`
4. Address review feedback
5. Merge after approval and passing checks

## Required Validation Before PR

At minimum, run:

```bash
npm run typecheck
npm run build
npm run test
```

If your change affects runtime behavior or UI, also run:

```bash
npm run dev
```

Manually verify the affected workflow before opening the PR.

## PR Quality Standard

Code is easy. Good taste is rare. Review should protect the product experience, not only the implementation.

A PR should be:

- focused on one main purpose
- easy to review
- supported by validation results
- documented when behavior changes

Your PR description should include:

- what changed
- why it changed
- how you verified it
- a video or GIF if UI behavior changed
- unit tests added or updated if project logic changed

## Change Scope Standard

Prefer:

- one topic per PR
- minimal unrelated formatting churn
- no opportunistic refactors unless they are necessary for the change

Avoid:

- mixing docs, refactors, and feature work without explanation
- large undocumented behavior changes
- bypassing normal review for risky changes

## Localization Standard

If you change user-facing text:

- update English and Chinese strings together when possible
- keep wording consistent across docs and UI

## Documentation Standard

Update documentation when changes affect:

- setup
- commands
- runtime requirements
- branch strategy
- release behavior
- contributor workflow

## Merge Guidance

Merge contribution changes into `develop` only after:

- review feedback is addressed
- checks pass
- the change is considered stable enough for the daily integration branch

`master` is reserved for stable releases. After maintainers decide the current `develop` state is ready to publish, they merge `develop` into `master`.

## Release Automation

Stable releases are published by GitHub Actions when a same-repository PR from `develop` into `master` is merged.

The release workflow:

- computes the next `vX.Y.Z` patch tag from the latest three-part semver tag
- reuses a tag that already points at the merge commit when a workflow is rerun
- builds signed and notarized macOS arm64/x64 packages, Windows arm64/x64 installers, and a Linux x64 AppImage
- uploads release assets and update metadata to GitHub Releases and the R2 `stable` channel
- promotes R2 `stable/latest` only after all platform uploads succeed

Repository maintainers must configure these GitHub Actions secrets before the first automated release:

- R2: `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`, and either `R2_ACCOUNT_ID` or `R2_ENDPOINT`
- Optional R2 override: `R2_RELEASE_PREFIX`
- macOS signing: `MAC_CODESIGN_P12_BASE64`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`

The repository Actions settings must allow `GITHUB_TOKEN` to write repository contents so the workflow can create tags and publish releases.

The local `npm run release:mac` and `npm run release:win` commands remain available as manual fallback tools.

## Suggested Branch Naming

Examples:

- `feat/runtime-settings`
- `fix/connection-probe`
- `docs/bilingual-readme`
- `refactor/chat-store`

## Maintainer Notes

If maintainers later adjust protected branches, required reviewers, or stricter automated gates, this document should be updated to match the repository rules.
