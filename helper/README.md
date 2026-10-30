# Page as Context helper — local MCP integration

This package exposes `get_connection_status` and `read_page_context` for an
explicitly authorized browser connection. Write-authorized connections also expose four bounded interaction tools, with browser approval and current snapshot references.
See [setup and pairing](../docs/mcp-integration.md) and
[the transport ADR](../docs/adr/0001-mcp-native-transport.md).

Checkout development requires Node.js 24.10.x. The ChatGPT test package bundles
the official runtime. From the repository root:

```sh
npm ci --prefix helper
npm --prefix helper run check
node scripts/mcp/transport-spike.mjs --report /tmp/page-as-context-spike.json
```

The live spike temporarily registers the native host in the current user's
standard Chrome/Firefox directories. It refuses to replace an existing host,
uses isolated synthetic extension profiles and removes its registration on
completion. It launches headless browsers and opens browser automation endpoints
only for this test; the helper itself uses Unix sockets exclusively.

For manual development, install a host for exact extension IDs:

```sh
node helper/src/cli.mjs install --chrome-id EXACT_CHROME_ID --firefox-id EXACT_FIREFOX_ID
```

After this explicit installation, the browser-launched native host, `pair`, and
MCP requests start the broker automatically. No broker terminal is required.
`node helper/src/cli.mjs doctor` checks authenticated readiness without starting
anything; `ensure-broker` is an optional development diagnostic. The explicit
`broker` command remains available for foreground debugging.

Managed startup uses a detached process with ignored stdio, a bounded five-second
startup wait and authenticated protocol/version readiness. Concurrent clients
share the kernel-elected socket owner. Each live MCP connection holds a lease;
one disconnect does not stop other clients. Thirty seconds after the last client
disconnects, the broker closes native connections and exits. A native connection
alone is allowed an initial 30-second setup window. Connecting again starts it
again; browser grants are not restored. Requests are never replayed on transport
failure; writes keep their unknown-outcome semantics.

New installs copy the native modules, Node binary and Node license into their
private runtime directory. The fixed exec wrapper supports spaces and quotes in
paths and does not depend on the plugin cache. Install from the bundled official
Node package for a self-contained macOS runtime; copying a Homebrew Node still
requires its external Homebrew libraries. Existing installs are not overwritten
or silently upgraded. Reinstall them explicitly with the new installer to obtain
the stable runtime and native autostart.

After a graceful shutdown the next request can start again. A hard crash can
leave a stale socket: startup fails closed rather than unlinking an unknown path.
Stop all related clients and verify ownership before explicit recovery. Symlinks,
regular files, wrong installation secrets and incompatible brokers are rejected;
startup does not kill unrelated PIDs or install an OS login service.

`node helper/src/cli.mjs uninstall` removes manifests belonging to this install;
stop the broker first (or close MCP clients and wait for managed idle shutdown).
Configuration defaults to `~/.page-as-context`; use
`--directory /absolute/private/directory` to select another installation. The
directory must be mode 0700 and current-user owned. Credentials are separate
0600 files, referenced using `stdio --credential /absolute/path/to/client.json`.
Do not put credential values in arguments, URLs, logs or model prompts.

Use `pair --browser chrome --instance INSTANCE_ID --credential /absolute/private/client.json`
to create a credential, compare its short code with the extension and approve
the pairing there. Keep the command running: it waits up to 60 seconds for the
chosen browser, then up to two minutes for approval while keeping the bridge
lease alive. If needed, start this command first and click **Start helper
connection** in the browser while it is waiting. Polling is restricted to the
idempotent pairing handshake; page/write requests are never replayed. Changed
codes and credentials targeting another instance fail explicitly. The command
does not authorize access on the user's behalf.
The live harness creates synthetic credentials privately and
deletes them. `spike-stdio` is a separate content-free test role that exposes only
`transport_probe`; ordinary `stdio` never advertises the probe. Windows explicitly
fails until named-pipe ACLs, executable launchers and registration are validated;
Linux registration paths are implemented but unverified. Android is excluded.


Pairing display names: add `--name "ChatGPT — Firefox"` to `pair`. The default
is `page-as-context-<browser>`. Names are bounded display labels, not verified
identities or authorization. Existing unnamed browser approvals remain valid;
the extension can give them a local name without changing their credential.

## Authorized tab discovery

`list_shared_tabs` and `resolve_shared_tab` expose only currently authorized
connections for the authenticated client, including active/window hints. They
never grant access, enumerate unshared metadata or return raw URLs. Page tools
still require a concrete connection ID and write tools require a fresh snapshot.
Automatic mode connects the browser after setup; Manual retains Start. The
browser owns shared-access membership, tab expiry, Pause/Resume and recovery.
ChatGPT, Claude Desktop and Claude Code use independent profiles/credentials.
