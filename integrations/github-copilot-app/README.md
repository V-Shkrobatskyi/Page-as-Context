# GitHub Copilot app integration

For installation, updates and removal, use the [app package guide](PACKAGE-README.md).
Current source package version: **1.2.7**. Build examples below use that version;
dated acceptance records and release notes retain the versions actually tested.

Experimental Agent Plugins 1.0 package for local GitHub Copilot app sessions on
macOS Apple silicon. Source version 1.2.7 is independent of the browser extension,
ChatGPT and Claude packages. Uses the same `serveMcp`, `packageClient`,
`browserSetup`, profile store, broker and Native Messaging host as those clients.
No HFS, HTTP listener or browser adapter is added. See [the user guide](PACKAGE-README.md)
and [acceptance status](ACCEPTANCE.md).

## Build

Requires Node 24.10.0, npm with cached locked helper production dependencies and
the official `node-v24.10.0-darwin-arm64.tar.gz`. Its pinned checksum is verified.
End users receive the runtime and do not need these build tools.

```sh
node scripts/mcp/build-github-copilot-app-package.mjs \
  --archive /private/tmp/node-v24.10.0-darwin-arm64.tar.gz \
  --output 'artifacts/mcp/GitHub Copilot app 1.2.7 verified macOS arm64'
```

Add `--probe` with a different new output directory for the content-free loader
probe. Optional `--version X.Y.Z` overrides the manifest version for a new release.
Never change bytes of an already installed version. Output contains a marketplace
with `.github/plugin/marketplace.json`, a ZIP, README and SHA256SUMS.txt.
`PACKAGE.json` hashes all marketplace files except itself. The ZIP is a distribution
container; direct ZIP import in the app is not claimed.

The app documents GitHub/Git marketplace sources. Publication, app account access,
loader validation and real browser approval are separate from building an
artifact. User-operated Chrome core acceptance is recorded in ACCEPTANCE.md. No publication or client settings changes are performed by the builder.

## Check the actual artifact

```sh
'artifacts/mcp/GitHub Copilot app 1.2.7 verified macOS arm64/marketplace/plugins/page-as-context/runtime/node' \
  scripts/mcp/check-github-copilot-app-package.mjs \
  'artifacts/mcp/GitHub Copilot app 1.2.7 verified macOS arm64/marketplace'
```

For a probe output use its runtime and append `--probe`. The checker copies the
artifact into a temporary path with spaces, verifies inventory and fixed manifest
contracts, and launches MCP using the packaged configuration without global Node.
Production checks reuse the shared installed-package scenarios for Chrome and
Firefox: explicit confirmation, synthetic pairing/read/denied write, revocation,
shared leases, browser instance switching/cancellation and isolated uninstall.
Only temporary native manifests and state are used. This is not Copilot app
loader or live browser acceptance. The shared checker's staging directory name
is historically `chatgpt` but is temporary; runtime credentials are independently
stored under `github-copilot-app/profiles`.

## Design boundaries

Two fixed browser servers use `./runtime/node`, plugin-root script expansion and
plugin-relative `cwd`. Both clear NODE_OPTIONS/NODE_PATH. Invalid browser/config
fails before setup. `server.mjs` fixes the client identity and profiles; tool
arguments cannot choose another client's state. No setup lifecycle hooks exist.
Shared native runtime remains stable outside plugin caches. Discovery/preparation
are side-effect free; installation, pairing and tab grants are distinct approvals.

## References reviewed 7 November 2026

- [Copilot app customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [Plugin/marketplace reference](https://docs.github.com/en/copilot/reference/plugin-and-marketplace-reference)
- [Marketplace catalog format](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Agent Plugins 1.0](https://agent-plugins.org/specification)

Catalog syntax is based on GitHub's shared/CLI reference. Actual app acceptance,
including supported private sources and runtime permissions, must be recorded.

## Installed app runtime qualification

`check-github-copilot-app-loader.mjs` accepts `--sdk APP_SDK_INDEX`,
`--runtime APP_COPILOT` and `--marketplace BUILT_MARKETPLACE`; add `--probe` for
the content-free artifact. Obtain the runtime path belonging to the installed
app version; do not substitute a different global CLI and claim app evidence.
The test uses a temporary HOME/COPILOT_HOME, no logged-in user, and no inference.
It verifies marketplace installation, discovery, configured MCP launches, native
tool invocation, setup skill discovery for production, disable and full teardown.
Only the named fixture/read-only status tools are eligible for automatic one-call
approval. Real setup confirmation and browser approvals are never automated.

App 1.1.35 runtime qualification passed on 7 November 2026. User-operated local
UI installation and Chrome core acceptance passed on 9 November 2026. Firefox
live testing was skipped at the user's request. See ACCEPTANCE.md for exact scope.

## Historical aligned release 1.2.2

This release aligns the four client package versions and ships the revised user
guide inside each package, with web links that work outside the source checkout.
The unpacked distribution checks passed on 9 November 2026. These are SDK and
synthetic-endpoint checks, not a new live-browser qualification of 1.2.2. Prior
live evidence retains its original package version. Existing installed packages
are not modified or automatically upgraded.
