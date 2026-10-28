# Page as Context for Claude Desktop

Private, unsigned desktop extension for macOS Apple silicon. Includes Node
24.10.0 and production dependencies; no global Node/npm or separate setup app
is needed. Requires the Page as Context browser extension. Actual client and
account availability must be verified in Claude Desktop; SDK checks are separate.

## Install and select a browser

1. In Claude Desktop open **Settings → Desktop app → Extensions → Manage**
   (or **Settings → Extensions** in the older layout).
2. Choose **Advanced settings → Install Extension…**, select the supplied
   `.mcpb`, review its permissions and follow the installation prompts.
3. In **Browser: chrome or firefox**, enter exactly `chrome` or `firefox`.
   This is a required text field with no automatic browser selection. The
   package exposes one browser at a time. Changing this configuration requires
   restarting the extension (restart Claude if necessary) and connecting tabs
   explicitly. Each browser has a separate private Claude profile.
4. Start a chat and ask Claude to set up Page as Context for the chosen browser.
   The server provides ten setup/page tools and setup instructions through MCP;
   this package does not depend on ChatGPT skills.

## Pair and connect a tab

Enable MCP in the browser extension and apply settings. Give Claude the
**Browser instance** ID from MCP settings and the extension ID. Chrome uses
the ID in `chrome://extensions`; Firefox uses the Gecko ID
`{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}`, not the internal extension URL UUID.

Claude calls `setup_status`, then `prepare_browser_setup`. Review the changes
and explicitly approve them before `confirm_browser_setup`; keep Claude's
confirmation enabled for that mutating tool. Adding another browser can restart
the shared bridge and end live connections; the plan must disclose this.

Click **Start helper connection** in the extension. Ask Claude to call
`get_pairing_status`, compare the code with **Pairing requests** in the browser,
and approve there yourself. Existing approved credentials may report approval
without a new code. Setup and pairing do not grant access to a tab.

On the page to share, choose **Connect MCP** in the extension popup. In
**Approved clients**, choose **Claude — Chrome** or **Claude — Firefox** and
connect the selected tab. The button shows the applied mode: **read only** or
**read and write**. Actions use the applied write-approval setting; the default
is **Ask before each action**. Give Claude only the displayed **Connection ID**.
Never share credential files. Your AI client may forward context to its provider.

## Recovery, updates and removal

If setup times out, prepare a new request and review it again. A saved profile
does not prove browser approval. Wrong instance IDs do not replace profiles.
Do not delete or overwrite credentials to recover silently.

Use browser **Stop all MCP access** or **Revoke** before disabling/removing this
extension in Claude. Shared bridge files and private profiles are retained;
no uninstall hook or automatic credential deletion is assumed. Do not delete
the shared runtime while another client uses it. Restarting clients never
restores a tab grant. Install a new versioned `.mcpb` for updates; reconnect tabs.

Claude credentials are under `~/.page-as-context/claude/profiles/`; ChatGPT's
profiles remain independent. Client display names are self-declared, not proof
of application identity. This package uses only stdio and private local IPC/
Native Messaging. The temporary HTTP test fixture is not its MCP transport.
