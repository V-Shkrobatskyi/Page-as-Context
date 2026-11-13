# Contributing to Page as Context

Thanks for contributing.

## License

Original project contributions are accepted under GPL-3.0-only. Only submit work
you have the right to contribute under those terms, and preserve third-party
copyright and license notices. See [LICENSING.md](LICENSING.md).

## Development setup

Use Node.js 24.10.0 (see `.nvmrc`) and npm 11.6.0. CI uses the same Node version:

```bash
npm ci
npm run dev
```

For code or shared popup changes, run the checks for both browser targets:

```bash
npm run check
```

This includes `npm run test:memory`, an isolated Node worker with garbage
collection enabled. It checks that repeated Chrome captures and exports release
raw snapshots, semantic results, and event listeners after success, partial
capture, navigation, cleanup failure, and a timeout with a late callback. A
retained-object control verifies that the test can detect retention. These are
object-lifetime regression checks, not measurements of Chrome's native memory
or proof that every possible leak is absent. See [the memory test notes](tests/memory/README.md).

For documentation-only changes, check relative links, commands and consistency
with the implementation. If the offline guide changes, rebuild the browser
packages to verify that it is included. See [BUILDING.md](BUILDING.md) for packaging.

Use `npm run dev:firefox` when developing the Firefox build. After rebuilding,
reload the development extension in the browser and reopen its popup. Android
setup is described in the [device guide](docs/firefox-android-testing.md).

## Git workflow

`main` is the stable, releasable branch. Make each logical change in a short-lived branch created from the latest `main`.

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
```

Use a descriptive prefix:

- `feature/...` for new functionality
- `fix/...` for bug fixes
- `docs/...` for documentation-only changes
- `chore/...` for maintenance

Before committing or pushing, review [CHANGELOG.md](CHANGELOG.md) and the
[release guide](docs/releasing.md). Update relevant changes, confirmed release
status or workflow details; keep unpublished work marked unreleased. GitHub
publication dates, store rollout and local build/test dates are separate facts.

Commit focused changes, push the branch, and open a pull request into `main`. Include a concise description of the change and the checks you ran. Merge only after the relevant checks pass, then delete the branch.

## Sensitive data

Never commit API keys, tokens, personal data, or local configuration. Local environment files such as `.env` and `.env.local` are ignored. If configuration is needed, add a tracked `.env.example` containing variable names and safe placeholder values only.

## Chrome accessibility fixtures

Chrome-specific AX/CDP data belongs in `src/adapters/chrome/`; only its normalized result may enter `src/core/`. The capture adapter owns one root debugger attachment per request, captures the main document and eligible embedded documents through frame-specific AX requests, and releases child sessions and the root attachment in every outcome. CDP identifiers remain adapter-local; document boundaries and partial-capture statuses use browser-independent semantic nodes.

When adding a raw AX fixture, use a small, hand-reviewed, de-identified sample. Never retain page URLs with query parameters, account names, personal data, or secrets. Pair it with the expected browser-agnostic semantic tree and add regression coverage. Live Chrome checks are manual smoke tests; unit tests must mock the debugger client and remain deterministic in CI.
