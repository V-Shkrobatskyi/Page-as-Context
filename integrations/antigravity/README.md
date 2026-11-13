# Page as Context for Google Antigravity

For installation, updates and removal, use the [app package guide](PACKAGE-README.md).
Current source package version: **1.2.7**. Build examples below use that version;
dated acceptance records and release notes retain the versions actually tested.

Experimental local plugin for macOS Apple silicon. The initial acceptance target
is **Antigravity App 2.29.0**, identified from the installed application on
6 November 2026. Standalone Antigravity IDE and CLI are separate acceptance
targets. Neither SDK checks nor installation instructions prove actual-client
support. See [the acceptance record](../../tests/manual/mcp-desktop/antigravity.md).

The plugin reuses `helper/` for stdio MCP, setup, profiles, native messaging,
automatic broker startup and browser permissions. No HFS process, remote server,
separate Setup app, global Node installation or login service is required.
Chrome and Firefox have independent MCP entry points and credentials under
`~/.page-as-context/antigravity/profiles/`. Existing clients keep their identities.

## Build

Use Node 24.10.0/npm 11.6.0, the official macOS arm64 Node archive and the cached,
locked helper production dependencies:

```sh
node scripts/mcp/build-antigravity-package.mjs \
  --archive /private/tmp/node-v24.10.0-darwin-arm64.tar.gz \
  --output 'artifacts/mcp/Antigravity 1.2.7 macOS arm64'
```

Output directories must be new. The shared builder checks the Node archive hash,
installs dependencies offline with scripts disabled, rejects symlinks and writes
`bundle/PACKAGE.json`, `DEPENDENCIES.json`, a distributable ZIP and SHA256SUMS.
The ZIP contains `bundle/`; the installable plugin is its nested
`plugins/page-as-context/` directory. The surrounding bundle is an integrity
wrapper, not an Antigravity marketplace. A README also ships in the plugin.
Never commit generated packages, runtimes, profiles, credentials or reports with
private page content. The plugin version is independent of the browser extension.
Changed installed release bytes require a new package version.

## Verify the distribution

Extract the ZIP to a new directory, then run both checks using that copy:

```sh
BUNDLE='/absolute/path/to/extracted/bundle'
"$BUNDLE/plugins/page-as-context/runtime/node" \
  scripts/mcp/check-antigravity-package.mjs "$BUNDLE" chrome
"$BUNDLE/plugins/page-as-context/runtime/node" \
  scripts/mcp/check-antigravity-package.mjs "$BUNDLE" firefox
```

Checks verify inventory hashes, manifest identity, both MCP definitions, invalid
browser rejection, execution with paths containing spaces, initialization,
explicit setup confirmation, synthetic pairing/read/write denial, shared leases,
instance switching, cancellation and isolated uninstall. They use temporary
state and synthetic native endpoints; no real browser registrations are written.
The reused staging utility's temporary `chatgpt/releases/` location is only a
package test fixture; real Antigravity credentials use `antigravity/profiles/`.

## Client loading and path resolution

The documented plugin format uses root `plugin.json`, `mcp_config.json` and
`skills/`. Both stdio definitions use `./runtime/node` with `${PLUGIN_ROOT}` as
`cwd`, and an absolute expanded script argument. Documentation specifies root
expansion in `args`, `cwd` and `env`, but does not promise it in `command`.
Actual App loading must verify that the relative executable resolves from cwd.
No installation hooks are used. Setup rules are also supplied as MCP server
instructions so correctness does not rely solely on skill invocation.

The documented private global directory is `~/.gemini/config/plugins/`.
Documented `agy plugin install` is an alternative only where the CLI is present;
`agy` was not found in this environment. Public Marketplace submission, signing
and other OS/architecture support are outside this candidate.

See [the package user guide](PACKAGE-README.md) for installation and lifecycle.

## Automatic access after an app restart

App restart is distinct from browser/extension restart or switching a tab Off.
In Automatic mode, an existing, unexpired tab-sharing choice can survive the MCP
disconnect in the still-running browser. Discovery can recreate validated Read
with a fresh connection ID. Old grants/snapshots and session approval are
invalidated; Write requires a fresh explicit choice. Off removes the sharing
choice and must not be undone by reconnecting. Profile configuration/pairing on
disk is separate from live tab grants. Do not require empty discovery merely
because Antigravity restarted while the browser retained a shared tab.

Official documentation reviewed 6 November 2026:

- [Plugins](https://antigravity.google/docs/plugins/)
- [Build plugins and path variables](https://antigravity.google/docs/build-plugins/)
- [MCP configuration](https://antigravity.google/docs/mcp)

## Initial setup prompt

The [shared connection guide](../../docs/mcp-integration.md#copy-and-paste-pairing-messages)
provides a pairing request to send with the browser setup info. Historically, version 1.2.2
updates both the setup skill and MCP initialization instructions to consume
valid supplied IDs without redundant questions and run status/preparation in
one response. Approval of the returned plan and browser code comparison remain
separate user steps. This changes setup guidance, not the permission model.

## Historical aligned release 1.2.2

This release aligns the four client package versions and ships the revised user
guide inside each package, with web links that work outside the source checkout.
The unpacked distribution checks passed on 9 November 2026. These are SDK and
synthetic-endpoint checks, not a new live-browser qualification of 1.2.2. Prior
live evidence retains its original package version. Existing installed packages
are not modified or automatically upgraded.
