# Page as Context for GitHub Copilot app

Private experimental package for local sessions on macOS Apple silicon.
Requires the browser extension; includes its runtime. No VS Code, HFS or global
Node is needed. Chrome core flow is verified; Firefox live use is untested.

## Install

1. Obtain a verified release and unpack its ZIP. Keep the complete `marketplace/`
   tree, including `plugins/page-as-context/runtime/node`, with executable permissions.
2. In GitHub Copilot app open **Customize → Installed → Add plugin → Manage marketplaces**.
3. In **Source**, enter the full local path to the unpacked `marketplace` directory
   and click **Add**. The field accepts `owner/repo`, a Git URL, or a local path.
   Add the directory, not the ZIP and not its `plugins/page-as-context` subdirectory.
4. Close the dialog. Choose **Add plugin → Browse all plugins**, find
   **page-as-context** in **page-as-context-copilot-app**, and click **Install**.
5. Open a local session. Keep confirmation for `confirm_browser_setup` and browser
   actions enabled. No terminal, publication or Git repository is needed for this
   local UI installation. Do not move or delete the marketplace directory:
   this runtime loads local-source plugins live from their source path.

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
