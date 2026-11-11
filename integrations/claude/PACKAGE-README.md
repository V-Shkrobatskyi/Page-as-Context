# Page as Context for Claude

Private, unsigned package for macOS Apple silicon. Requires the browser extension;
includes its runtime, with no global Node or separate setup app needed.

## Install in Claude Desktop

1. In Claude Desktop open **Settings → Desktop app → Extensions → Manage**
   (or **Settings → Extensions** in the older layout).
2. Choose **Advanced settings → Install Extension…**, select the supplied
   `.mcpb`, review its permissions and follow the installation prompts.
3. No browser name is required during installation. Start a chat and ask
   Claude to connect **Chrome**, **Firefox**, or both. Pair each browser
   separately, then grant Read or Write on each source tab.
4. The same installed extension supports both browsers concurrently. Claude
   uses `chrome_*` and `firefox_*` tools to keep their routes separate. Choosing
   another browser does not require changing extension settings or reinstalling.
   Adding a browser registration may restart the shared bridge and end active
   tab connections; setup preparation reports that change before confirmation.

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
The browser in the setup info must match the browser you asked Claude to pair.
Shared access controls, reconnect and troubleshooting are in the [MCP user guide](../../docs/mcp-integration.md).

## Update or remove

For Desktop, install a new versioned MCPB; for Code, use its plugin update flow.
To remove it, revoke the relevant Claude client in the browser and remove the
package in that client. Desktop and Code have independent profiles; preserve
the shared bridge and any profiles still used by other clients.
