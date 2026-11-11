# Page as Context for GitHub Copilot app

Private experimental package for local sessions on macOS Apple silicon.
Requires the browser extension; includes its runtime. No VS Code, HFS or global
Node is needed. Chrome core flow is verified; Firefox live use is untested.

## Install

1. Download the **GitHub Copilot App** archive, for example
   `Page-as-Context-GitHub-Copilot-App-1.2.4-macOS-arm64-plugin.zip`.
   Do not use either ChatGPT archive (`ChatGPT-...-plugin.zip` or
   `ChatGPT-...-marketplace.zip`); those contain a different catalog format.
   Unpack the Copilot ZIP into its own folder so it is not mixed with a
   ChatGPT `marketplace/` folder. Keep the complete `marketplace/` tree,
   including `plugins/page-as-context/runtime/node`, with executable permissions.
2. In GitHub Copilot app open **Customize → Installed → Add plugin → Manage marketplaces**.
3. In **Source**, enter the full local path to the unpacked `marketplace` directory
   and click **Add**. The field accepts `owner/repo`, a Git URL, or a local path.
   Add the directory, not the ZIP and not its `plugins/page-as-context` subdirectory.
4. Close the dialog. In **Customize → Installed**, find **page-as-context**
   under **Plugins** (marketplace: **page-as-context-copilot-app**) and turn on
   the switch on the right. No separate **Browse all plugins → Install** step
   is needed in this verified flow.
5. In the **MCP Servers** section on the same **Installed** page, turn on
   **browser-chrome** and/or **browser-firefox** for the browsers you want to
   connect. In the user-verified app flow these switches remained off after
   enabling the plugin; they must be enabled separately. Their rows show
   **Plugin: page-as-context**. Enabling a server does not pair the browser
   or grant access to tabs.
6. Open a local session. Keep confirmation for `confirm_browser_setup` and browser
   actions enabled. No terminal, publication or Git repository is needed for this
   local UI installation. Do not move or delete the marketplace directory:
   this runtime loads local-source plugins live from their source path.

### If the app reports "File not found: marketplace.json"

Check that **Source** points to the `marketplace/` directory extracted from the
**GitHub Copilot App** ZIP. It must contain `.github/plugin/marketplace.json`
and `plugins/page-as-context/plugin.json`. The `.github` folder is hidden in
Finder; press **Cmd+Shift+.** to show hidden files if needed.

The ChatGPT marketplace instead contains `.agents/plugins/marketplace.json`.
Copilot does not look at that location in the reported error. The ChatGPT
single-plugin ZIP contains `page-as-context/`, with no marketplace catalog.
Use the Copilot ZIP rather than renaming files, moving catalog JSON by itself,
or editing manifests. If macOS extracted a folder such as `marketplace 2`,
select that actual Copilot folder, not an older `marketplace` folder beside it.

On app 1.1.35 the plugin details briefly showed enabled/version 0.1.0, then
incorrectly returned to “This plugin is not currently installed.” In this observed
case the saved enabled flag and MCP server initialization were present, and actual
setup/read/write succeeded. Do not assume every similar message is harmless or
repeatedly reinstall. Ask the local agent to invoke `browser-chrome/setup_status`;
if unavailable, quit with Cmd+Q, reopen and check again. Report a persistent failure.

## After installation

Use the [pairing request and connection steps](../../docs/mcp-integration.md#copy-and-paste-pairing-messages) in a local chat.
Shared access controls, reconnect and troubleshooting are in the [MCP user guide](../../docs/mcp-integration.md).

## Update or remove

Update through the marketplace using a new package version. Disable the plugin
under **Customize → Installed**; use its removal control to uninstall and revoke
the Copilot client separately in the browser. Keep the shared bridge and other
clients' profiles intact. UI update/removal has not been live-qualified; see
[acceptance notes](ACCEPTANCE.md).
