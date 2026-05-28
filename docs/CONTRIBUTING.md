# Contributing

[简体中文](./CONTRIBUTING.zh-CN.md)

Thank you for contributing to DeepSeek GUI.

This document explains how contributors should collaborate on the project, what standards to follow, and how changes should be proposed.

## Project Taste

Code is easy. Good taste is rare.

For DeepSeek GUI, taste means clear workflows, restrained interfaces, humane copy, and behavior that feels obvious after one use. Strong contributions show judgment, not just implementation.

## Contribution Scope

Contributions are welcome for:

- bug fixes
- UI and UX improvements
- runtime integration improvements
- documentation
- localization
- build and release workflow improvements

## Branch Strategy

The expected branch flow is:

- `develop`: current default branch for active collaboration and daily integration
- `master`: stable release branch, updated by maintainers from `develop`
- feature branches: optional short-lived branches created from `develop`

Rules:

- Do not develop directly on `master`
- Prefer starting work from the latest `develop`
- If you create a feature branch, branch off from `develop`
- Open pull requests into `develop` unless maintainers explicitly request another base branch

## Before You Start

1. Make sure your local repository is up to date.
2. Switch to `develop`.
3. Install dependencies with `npm install`.
4. Confirm the project starts or builds successfully before making changes.

## Shape of a Typical PR

A well-structured PR for DeepSeek GUI is focused and self-contained. It typically:

- Touches **1-3 new files** and modifies **2-5 existing files** for wiring
- Scopes to a single feature, fix, or documentation update
- Includes a video or GIF if the UI changed
- Includes unit tests if project logic changed
- Passes `npm run typecheck`, `npm run build`, and `npm run test`

If you discover related work that needs doing, open a separate issue rather than expanding the PR scope.

## Local Development Checklist

Before opening a PR, contributors should verify:

- the app still runs in development with `npm run dev`
- type checking passes with `npm run typecheck`
- production build passes with `npm run build`
- unit tests pass with `npm run test`
- UI changes include a video or GIF that shows the changed flow
- logic changes include unit tests for the changed behavior
- documentation is updated if behavior, setup, or workflow changed
- localization is updated if user-facing text changed

### CI Verification Commands

```bash
# Type checking
npm run typecheck

# Production build
npm run build

# Unit tests
npm run test

# Full development smoke test
npm run dev
```

## Coding Expectations

- Keep changes focused and scoped
- Avoid unrelated refactors in the same PR
- Follow existing project structure and naming conventions
- Prefer readable code over clever code
- Preserve cross-platform behavior where possible
- Do not commit secrets, API keys, tokens, or machine-specific private paths

## Documentation Expectations

When your change affects project usage or collaboration, update the relevant docs:

- `README.md` and `README.en.md` for project-level usage
- `docs/DEVELOPMENT.md` and `docs/DEVELOPMENT.zh-CN.md` for workflow/process updates
- this contributing guide when standards change

## Pull Request Standards

Each PR should:

- have a clear and specific title
- explain what changed and why
- describe user-facing impact
- mention any setup, migration, or compatibility notes
- stay reasonably small when possible

Recommended PR structure:

```text
## Summary

What this PR does in 1-2 sentences.

## Why

The problem or gap it addresses.

## Validation

How you verified the change (commands run, manual tests performed).

## Media

Attach a video or GIF if UI changed. Screenshots are welcome as extra context.

## Tests

List unit tests added or updated if project logic changed.
```

For most contributions, opening the PR from a short-lived feature branch is preferred over pushing directly to `develop` or `master`.

## Review Standards

Reviewers should evaluate:

- correctness
- regressions
- product taste and interaction quality
- clarity and maintainability
- consistency with current architecture
- documentation completeness
- whether validation steps were actually performed

## Commit Guidance

Good commits are:

- small enough to review
- logically grouped
- written with clear commit messages

Follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `style:` Formatting, UI polish
- `chore:` Maintenance tasks

Examples:

- `docs: rewrite README and contribution guides`
- `feat: improve runtime connection recovery`
- `fix: handle missing DeepSeek binary path`

## Reporting Issues

When reporting issues, please include:

- Operating system and version
- DeepSeek GUI version (from Settings or the About dialog)
- Bundled `codewhale` version (`codewhale --version` in the same directory)
- Steps to reproduce the issue
- Expected vs actual behavior
- Relevant error messages, logs, or screenshots

## Contributor Behavior

Please collaborate in a way that is:

- respectful
- clear
- constructive
- open to feedback

If a change is large or risky, align with maintainers before investing heavily in implementation.

## Need Help?

If requirements are unclear, ask for clarification before making broad architectural or workflow changes. Feel free to open an issue for any questions about contributing.

## License

By contributing to DeepSeek GUI, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
