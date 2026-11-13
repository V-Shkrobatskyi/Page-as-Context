# ChatGPT desktop plugin

For installation, updates and removal, use the [app package guide](PACKAGE-README.md).
Current source package version: **1.2.7**. Build examples below use that version;
dated acceptance records and release notes retain the versions actually tested.

The package contains Chrome/Firefox MCP servers, a pinned Node runtime, locked
production dependencies and an explicit in-chat browser setup workflow.
The ChatGPT package has actual-client browser checks; an experimental
[Claude MCPB](../claude/README.md) is now available for separate acceptance.
The shared setup service uses standard MCP tools and
accepts client-specific profile paths and display names for future packages.

See [the user guide](PACKAGE-README.md) for pairing and access management.
No separate desktop setup application or remote server is built or required.

## Build

Requires macOS Apple silicon, Node.js 24.10.0/npm 11.6.0, cached locked npm
dependencies and the official Node archive. Python 3 and the macOS command-line strip/codesign tools are required to build
the upload-compatible package. No Swift application is built. End users do not need the build tools or a globally installed Node.

```sh
node scripts/mcp/build-chatgpt-package.mjs \
  --archive /path/to/node-v24.10.0-darwin-arm64.tar.gz \
  --output 'artifacts/mcp/ChatGPT plugin 1.2.7'
```

The default version comes from `package/plugin.json`. The output contains
`marketplace/`, a distributable plugin ZIP, `README.md` and `SHA256SUMS.txt`.
The archive hash is checked before the runtime is extracted. Existing output
folders and installed versions are preserved; changed package bytes require a
new version after installation. The [package guide](PACKAGE-README.md#install-in-chatgpt)
owns the verified archive-upload procedure and both installation steps. Keep
`marketplace/` for clients with folder-based installation. This build is not
submitted to a public directory.

## Verify the installed copy

```sh
'artifacts/mcp/ChatGPT plugin 1.2.7/marketplace/plugins/page-as-context/runtime/node' \
  scripts/mcp/check-chatgpt-package.mjs \
  'artifacts/mcp/ChatGPT plugin 1.2.7/marketplace'
node scripts/mcp/inspect-chatgpt-package.mjs \
  "$HOME/.page-as-context/chatgpt/.agents/plugins/marketplace.json"
```

The first check uses the bundled runtime, copied package, private temporary
state and isolated native manifests. It verifies explicit setup confirmation,
clean bridge installation through MCP, synthetic pairing, reads, shared leases,
denied writes and removal. The second checks the real desktop loader for an
already installed plugin. Neither proves an actual assistant/browser approval
workflow; that acceptance must be recorded separately.

## Setup boundaries

The bundled `browser-setup` skill guides `setup_status`, `prepare_browser_setup`,
explicit user confirmation, `confirm_browser_setup` and `get_pairing_status`.
Discovery and preparation do not install a bridge or create credentials. The
user compares the code and approves pairing in the extension, then grants a tab
separately. No lifecycle hooks are used.

The confirmation token prevents stale/cross-session requests; it does not prove
human consent. The assistant must ask the user, and the client should prompt for
`confirm_browser_setup`. Local filesystem permissions are still required.
Different instance IDs never overwrite existing profiles. Adding a previously
unregistered second browser restarts the authenticated bridge and ends current
tab connections, as disclosed in the prepared plan. Foreign manifests are never
replaced. Shared runtime update/recovery and developer maintenance remain in
`helper/`; they are not a second end-user setup application.

## Historical installation spike

The separate [content-free spike](spike/README.md) is retained for regression
checks. It cannot read pages or authorize access and is not the production
plugin. Actual installed-plugin acceptance must use `browser-chrome` or
`browser-firefox`, rather than older manually registered servers or spike tools.


## Browser instance profiles

To reconnect this client to another instance of the configured browser, prepare
setup with its instance ID and extension ID, review the switch and confirm it.
Compare the fresh pairing code and approve in the browser. The new identity is
activated only after successful pairing; denial, timeout or `cancel_browser_setup`
keeps the previous profile selected. Profiles are stored separately under
`profiles/<browser>/instances/<instanceId>/<credentialId>.json`, with an
`active.json` pointer per browser. Legacy `<browser>.json` remains readable until
replacement. Other AI clients and browser profiles keep separate credentials.

Pairing alone grants a new Native client no tab access. After approval choose
**AI: Read** or **AI: Write** again on each source tab, even if it was already
shared. Manual mode uses **Connect selected tab**. Tab grants, Write, connection
IDs and session approvals are never copied from the previous instance.

## Historical aligned release 1.2.2

This release aligns the four client package versions and ships the revised user
guide inside each package, with web links that work outside the source checkout.
The unpacked distribution checks passed on 9 November 2026. These are SDK and
synthetic-endpoint checks, not a new live-browser qualification of 1.2.2. Prior
live evidence retains its original package version. Existing installed packages
are not modified or automatically upgraded.

## Archive packaging fix 1.2.5

ChatGPT builds now emit a single-plugin `-plugin.zip` for the UI upload and a
separate `-marketplace.zip` for folder installation. ZIPs have no AppleDouble
metadata or directory entries. Runtime symbol stripping and ad-hoc signing
reduce the Node executable below the published 100 MiB member limit. The
original official archive hash, upstream executable hash, transformed hash and
transformation are recorded in DEPENDENCIES.json. Runtime version and signature
are checked during builds. Development-only dependency files are omitted; runtime
JS, package metadata, licenses and pinned versions remain. Other client builders
retain their existing behavior.

`ARCHIVE-CHECK.json` records compressed/extracted bytes, entries and largest member.
The builder rejects archives exceeding the published portal limits (100 MB ZIP,
100 MiB member, 512 MiB extracted, 5,000 entries, 20 path segments), unsafe paths
and case/Unicode collisions. These limits are not proof of desktop UI acceptance.
Use the bundled-runtime package check for each browser and separately accept the
actual archive upload in the desktop app. Never change an installed version's
bytes; the packaging fix is ChatGPT package 1.2.5, independent of extension 2.2.4.

## User-verified ChatGPT installation, 11 November 2026

Package 1.2.6 was uploaded and installed through the ChatGPT UI. The verified
sequence and distinct Add plugin / + Install plugin actions are in
[the user guide](PACKAGE-README.md#install-in-chatgpt). After installation the
user returned directly to the existing chat without a required restart.
The chat loaded the 1.2.6 skill and successfully invoked Chrome list/read tools.
This is not acceptance of write-tool discovery: fill_element was still absent
from the chat's callable tools; Chrome grants were read-only and Firefox had no
shared tabs. Do not infer write availability merely from the installed version.
