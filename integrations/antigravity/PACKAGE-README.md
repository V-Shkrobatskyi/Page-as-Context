# Page as Context for Antigravity

Experimental private plugin for Antigravity App on macOS Apple silicon.
Requires the browser extension; includes its runtime and separate Chrome/Firefox
servers. No HFS app or terminal needs to remain open during use.

## Install a private plugin

1. Extract the release ZIP. Inside `bundle/plugins/`, locate `page-as-context`.
2. In Finder, use **Go → Go to Folder…** and enter
   `~/.gemini/config/plugins/`. Create this folder if it does not exist.
3. Copy the entire `page-as-context` folder into it. Do not flatten the folder,
   copy only its JSON files, or replace an existing installation without first
   following the update procedure below.
4. Open Antigravity's **Customizations → Installed** and check that
   **Page as Context** and its browser MCP servers are loaded. If they do not
   appear, restart the app and check again. Record the client version and error
   before changing any configuration; this candidate still needs client checks.
5. Continue with the shared connection guide below for your selected browser.

The documented alternative, if Antigravity CLI is installed, is
`agy plugin install /absolute/path/to/page-as-context`, followed by
`agy plugin list`. A ZIP itself is not the local directory argument. IDE-specific
installation must be checked separately from the App.

## After installation

Use the [pairing request and connection steps](../../docs/mcp-integration.md#copy-and-paste-pairing-messages).
Shared access controls, reconnect and troubleshooting are in the [MCP user guide](../../docs/mcp-integration.md).

## Update or remove

Close Antigravity before replacing the manually installed plugin with a new
version. Keep the old folder outside plugin discovery directories for rollback;
do not leave two discoverable copies. Never edit installed release files.

To remove it, revoke the Antigravity clients in the browser, close the app and
remove only `~/.gemini/config/plugins/page-as-context`. For a CLI-managed install,
use `agy plugin uninstall page-as-context`. Preserve the shared bridge and
other clients' credentials.
