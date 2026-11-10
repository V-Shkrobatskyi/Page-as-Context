# Page as Context for ChatGPT desktop

Private plugin for macOS Apple silicon (macOS 13.5+). Requires the browser
extension and a workspace that permits local plugins. Includes its runtime;
no global Node or separate setup app is needed.

## Install and pair

1. Install and enable **Page as Context** from the private local plugin catalog
   supplied with this package, then fully quit and reopen the desktop client.
   Use the full plugin, not the historical **Installation check** plugin.
2. In the browser extension, open **MCP settings**, enable MCP and apply settings.
   Ask the assistant to set up Page as Context for Chrome or Firefox.
3. In MCP settings use **Helper connection → Copy setup info** and give the
   copied Browser, Instance and Extension ID to the assistant. Older builds show
   the same line under **Setup and browser instance**. Firefox needs the add-on's
   Gecko ID shown there, not the UUID in its extension URL.
4. Review the changes returned by `prepare_browser_setup` and explicitly approve
   them before the assistant calls `confirm_browser_setup`. Keep the client's
   confirmation prompt enabled for this tool. Adding a second browser may
   restart the shared bridge and end existing tab connections.
5. Automatic mode connects the bridge. Use **Retry connection** if setup is still
   pending; only Manual mode needs **Start helper connection**. Compare the code
   from `get_pairing_status` with the browser pairing request and approve yourself.
   Pairing alone grants no tab access. In Automatic, choose Read or Write again on each source tab after approval, even if it was already shared.
6. On a source tab use the arrows beside **AI Off** to select **Read** or **Write**. Write includes
   reading and supported actions; approvals remain enabled by default. The assistant
   uses `list_shared_tabs` or `resolve_shared_tab` for connection IDs. Manual mode
   retains **Connect MCP → Connect selected tab**; discovery also works there.

## After installation

Use the [pairing request and connection steps](../../docs/mcp-integration.md#copy-and-paste-pairing-messages).
Shared access controls, reconnect and troubleshooting are in the [MCP user guide](../../docs/mcp-integration.md).

## Update or remove

Install a new version through the private catalog and restart ChatGPT.
To remove it, revoke its client in the browser, remove the plugin and restart
the app. Keep the shared bridge and other clients' profiles intact.
