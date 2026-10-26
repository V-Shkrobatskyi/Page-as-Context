# ChatGPT desktop plugin

The package contains Chrome/Firefox MCP servers, a pinned Node runtime, locked
production dependencies and an explicit in-chat browser setup workflow. Only
ChatGPT packaging is currently implemented; Claude is deferred until ChatGPT
acceptance is complete. The shared setup service uses standard MCP tools and
accepts client-specific profile paths and display names for future packages.

See [the user guide](PACKAGE-README.md) for pairing and access management.
No separate desktop setup application or remote server is built or required.

## Build

Requires macOS Apple silicon, Node.js 24.10.0/npm 11.6.0, cached locked npm
dependencies and the official Node archive. No Swift compiler or Xcode build
is involved. End users do not need the build tools or a globally installed Node.

```sh
node scripts/mcp/build-chatgpt-package.mjs \
  --archive /path/to/node-v24.10.0-darwin-arm64.tar.gz \
  --output 'artifacts/mcp/ChatGPT plugin 1.1.1'
```

The default version comes from `package/plugin.json`. The output contains
`marketplace/`, a distributable plugin ZIP, `README.md` and `SHA256SUMS.txt`.
The archive hash is checked before the runtime is extracted. Existing output
folders and installed versions are preserved; changed package bytes require a
new version after installation. Register/install `marketplace/` as a private
local plugin source using the supported desktop plugin tooling. This build is
not submitted to a public directory.

## Verify the installed copy

```sh
'artifacts/mcp/ChatGPT plugin 1.1.1/marketplace/plugins/page-as-context/runtime/node' \
  scripts/mcp/check-chatgpt-package.mjs \
  'artifacts/mcp/ChatGPT plugin 1.1.1/marketplace'
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
