# Page as Context for Claude

Private, unsigned desktop extension for macOS Apple silicon. Includes Node
24.10.0 and production dependencies; no global Node/npm or separate setup app
is needed. Requires the Page as Context browser extension. Actual client and
account availability must be verified in Claude Desktop; SDK checks are separate.

## Install in Claude Desktop and select a browser

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
   The server provides twelve setup/page tools and setup instructions through MCP;
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

Automatic connects the bridge; use **Retry connection** if needed. Only Manual
mode requires **Start helper connection**. Ask for `get_pairing_status`, compare
the code with the browser popup and approve yourself. Explicitly include this
app in shared tab access if desired. Pairing alone grants no tab access.

On each source page choose **AI: Read** or **AI: Write** in the popup menu. Write
includes reading and supported actions, with approval before each action by
default. Claude obtains current connection IDs using `list_shared_tabs` or
`resolve_shared_tab`. Manual retains **Connect MCP → Connect selected tab**.


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

## Install in Claude Code

This is the same Page as Context for Claude integration and version, packaged
with the Code installation manifest. Extract the supplied plugin ZIP, add its
`marketplace` directory with `/plugin marketplace add`, and install
`page-as-context@page-as-context-local` through `/plugin`. For a local preview,
launch `claude --plugin-dir /absolute/path/marketplace/plugins/page-as-context`.
The plugin provides Chrome and Firefox routes; explicitly choose which one to
set up. Follow the same pairing and AI: Read/Write steps above.

Desktop MCPB and Code plugin directory have different installation entry points;
there is one shared server and release version. Desktop and Code keep independent
credentials (`claude/profiles/` and `claude-code/profiles/`) so either can be
revoked without affecting the other. One plugin does not imply shared secrets.
