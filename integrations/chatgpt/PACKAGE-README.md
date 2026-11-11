# Page as Context for ChatGPT desktop

Private plugin for macOS Apple silicon (macOS 13.5+). Requires the browser
extension and a workspace that permits local plugins. Includes its runtime;
no global Node or separate setup app is needed.

## Install in ChatGPT

This archive-upload sequence was verified by the user with package **1.2.6**
on 11 November 2026. No Terminal commands or separate setup app are needed.

1. Open **Settings** and select **Plugins** in the menu.
2. Click **Browse directory**, then **Add → Upload plugin archive**.
3. In the **New Plugin** window, click **click to upload**.
4. Select the file ending in **-plugin.zip** and click **Open**. For example:
   `Page-as-Context-ChatGPT-1.2.4-macOS-arm64-plugin.zip`.
5. Back in **New Plugin**, click **Add plugin** when the button becomes active.
6. Wait for processing. In the verified installation this took about one minute,
   then ChatGPT opened **Plugins / Page as Context**.
7. Click **+ Install plugin** on that page. **Add plugin** adds the package to
   the directory; **+ Install plugin** installs it for use. Both steps are needed.
8. Return to the chat. A full app restart was not needed in the verified flow.

Use the single-plugin **-plugin.zip**, not **-marketplace.zip**. The latter is
for clients that offer local marketplace folder installation. The unpacked
folder choices are `marketplace/` for a local marketplace or
`marketplace/plugins/page-as-context/` for a local plugin. These are alternatives
only when the client provides those folder actions, not part of the upload flow.

## Connect a browser and share tabs

1. If the browser is already paired, try sharing a tab before repeating setup.
   Installing the plugin alone does not grant access to browser tabs.
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

Upload the new **-plugin.zip** through the same **Settings → Plugins →
Browse directory → Add → Upload plugin archive** flow. Finish the installation
on the plugin page; uploading the archive alone is not the final step.
If you installed through a local catalog instead, update through that source.
Return to the chat and ask the assistant to check plugin availability. If the
client still exposes old or missing tools, try a new chat or restart ChatGPT;
restarting is a troubleshooting step, not a required part of the verified flow.
If an archive is rejected, retain the exact error and client version; do not
remove runtime files or dependencies manually. Archive checks use published
portal limits and do not guarantee acceptance by every desktop client.
To remove it, revoke its client in the browser, remove the plugin and restart
the app. Keep the shared bridge and other clients' profiles intact.
