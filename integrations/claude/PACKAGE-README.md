# Page as Context for Claude

Private, unsigned package for macOS Apple silicon. Requires the browser extension;
includes its runtime, with no global Node or separate setup app needed.

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
   The server provides setup, cancellation and page tools and setup instructions through MCP;
   this package does not depend on ChatGPT skills.

## Install in Claude Code

This is the same Page as Context for Claude integration and version, packaged
with the Code installation manifest. Extract the supplied plugin ZIP, add its
`marketplace` directory with `/plugin marketplace add`, and install
`page-as-context@page-as-context-local` through `/plugin`. For a local preview,
launch `claude --plugin-dir /absolute/path/marketplace/plugins/page-as-context`.
The plugin provides Chrome and Firefox routes; explicitly choose which one to
set up. Then follow the shared connection guide below.

## After installation

Use the [pairing request and connection steps](../../docs/mcp-integration.md#copy-and-paste-pairing-messages).
In Claude Desktop the browser in the setup info must match the configured browser.
Shared access controls, reconnect and troubleshooting are in the [MCP user guide](../../docs/mcp-integration.md).

## Update or remove

For Desktop, install a new versioned MCPB; for Code, use its plugin update flow.
To remove it, revoke the relevant Claude client in the browser and remove the
package in that client. Desktop and Code have independent profiles; preserve
the shared bridge and any profiles still used by other clients.
