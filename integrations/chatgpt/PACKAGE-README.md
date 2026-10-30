# Page as Context for ChatGPT desktop

Private macOS Apple silicon plugin. Requires macOS 13.5 or newer and Page as
Context in Chrome and/or Firefox. Local plugins must be permitted by your
workspace. The validation machine runs macOS 15.8.1; 13.5 is the bundled runtime
binary minimum, not a claim that every intermediate macOS release was tested.
This package is not listed in the public plugin directory.

## Install and pair

1. Install and enable **Page as Context** from the private local plugin catalog
   supplied with this package, then fully quit and reopen the desktop client.
   Use the full plugin, not the historical **Installation check** plugin.
2. In the browser extension, open **MCP settings**, enable MCP and apply settings.
   Ask the assistant to set up Page as Context for Chrome or Firefox.
3. Provide the **Browser instance** ID shown on the MCP page and the installed
   extension ID. Chrome's ID is shown in `chrome://extensions`; Firefox uses
   `{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}`, not the UUID in its extension URL.
4. Review the changes returned by `prepare_browser_setup` and explicitly approve
   them before the assistant calls `confirm_browser_setup`. Keep the client's
   confirmation prompt enabled for this tool. Adding a second browser may
   restart the shared bridge and end existing tab connections.
5. Automatic mode connects the bridge. Use **Retry connection** if setup is still
   pending; only Manual mode needs **Start helper connection**. Compare the code
   from `get_pairing_status` with the browser pairing request and approve yourself.
   In Automatic, approval includes this app in access to tabs marked Read or Write.
6. On a source tab use the arrows beside **AI Off** to select **Read** or **Write**. Write includes
   reading and supported actions; approvals remain enabled by default. The assistant
   uses `list_shared_tabs` or `resolve_shared_tab` for connection IDs. Manual mode
   retains **Connect MCP → Connect selected tab**; discovery also works there.


Setup runs through the plugin; there is no separate setup application. The
package contains its Node runtime, production dependencies and license notices.
No global Node/npm, development checkout, startup downloads, HTTP listener, login
service or broker terminal is needed for normal use. Browser native messaging
still requires a registered local bridge, installed after explicit confirmation.
Never copy credential files into chat. Your client may forward shared context
to its model provider.

## Updates and recovery

Install the new plugin version through its private catalog and restart the
desktop client. Existing compatible browser registrations and private profiles
are reused. Reconnect tabs explicitly; grants and action references are temporary.
Changed or unrecognized installations are preserved rather than overwritten.

If pairing times out or the client closes, ask to prepare setup again and approve
the new request. Wrong instance IDs do not replace an existing profile; stop and
revoke the old client and use the documented developer maintenance route for
profile changes. The plugin does not expose automatic profile deletion, native
runtime replacement or a general-purpose uninstall tool. A saved profile is not
proof of browser approval.

## Disable and removal

Use **Stop all MCP access** or **Revoke** in the extension to end access. Disable
or remove the plugin in the desktop client, then restart it; existing sessions
may retain tools until closed. Removal does not automatically erase the shared
bridge or private credentials, and no uninstall hook is assumed.

For developer cleanup of a bridge that no client needs, see
[local maintenance](../../docs/mcp-integration.md#removal-and-recovery). Removing
a local plugin catalog must affect only Page as Context; preserve other plugins.
Old downloaded application bundles and old package releases are not removed by
this package. Do not delete the current registered plugin source or the shared
runtime to remove an obsolete installer.

## Scope and verification

Manual servers named `page-as-context-chrome`/`page-as-context-firefox` and the
content-free spike are independent. They are not removed silently. For acceptance
use only this plugin's browser servers. Claude, Windows, Linux and Android
packages are not included; standard MCP compatibility does not establish support
until the corresponding client is packaged and tested.

`marketplace/PACKAGE.json` records package files and hashes. `SHA256SUMS.txt`
identifies the ZIP. Build, SDK and loader results are separate from actual
assistant/browser acceptance.
