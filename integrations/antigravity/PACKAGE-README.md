# Page as Context for Antigravity

Experimental private plugin for Antigravity App on macOS Apple silicon.
Actual-client acceptance is required before claiming release support. The package
includes its Node runtime and browser bridge; no HFS app or terminal needs to
remain open during use. Chrome and Firefox are supported by separate servers.

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
5. Paste the appropriate **Connect a browser** prompt below, replacing both ID
   placeholders. Use only the server for the browser you selected.

The documented alternative, if Antigravity CLI is installed, is
`agy plugin install /absolute/path/to/page-as-context`, followed by
`agy plugin list`. A ZIP itself is not the local directory argument. IDE-specific
installation must be checked separately from the App.

## Connect a browser

Install the Page as Context browser extension first. Open its MCP settings and
copy **Browser Instance ID** and **Extension ID**. Firefox needs the add-on's
Gecko ID, including braces if shown, not the temporary `moz-extension` URL UUID.
These identify the extension instance; neither is a pairing code or tab
connection ID. Replace the placeholders before sending one initial message:

**Chrome:**

```text
Connect Page as Context using:
browser: chrome
instanceId: <Browser Instance ID from Chrome>
extensionId: <Extension ID from Chrome>

Use only browser-chrome, not HFS. Use the supplied IDs without asking again.
Call setup_status and prepare_browser_setup now. Show the proposed changes
and ask for my approval before confirm_browser_setup. Do not read or modify tabs.
```

**Firefox:**

```text
Connect Page as Context using:
browser: firefox
instanceId: <Browser Instance ID from Firefox>
extensionId: <Gecko Extension ID from Firefox>

Use only browser-firefox, not HFS. Use the supplied IDs without asking again.
Call setup_status and prepare_browser_setup now. Show the proposed changes
and ask for my approval before confirm_browser_setup. Do not read or modify tabs.
```

This starts status checking and prepares the plan in one message. The assistant
should ask again only for a missing, ambiguous or invalid value. The setup plan
still needs your approval after its actual changes are shown. You can reply:

```text
I approve the proposed setup. Call confirm_browser_setup, then
get_pairing_status and show me the pairing code. Do not read or modify tabs.
```

The assistant prepares a setup plan. Review its changes before approving local
bridge installation. Compare the pairing code shown in chat with the browser's
**Pairing and clients** request and approve it yourself. The assistant must never
approve pairing or browser actions for you.

Pairing does not share a tab. After approval, choose **AI: Read** or **AI: Write**
again in each source tab popup. In Manual mode, use **Start helper connection**
and **Connect selected tab** instead. Write access and action approval are
separate. In Automatic mode, restarting Antigravity while the browser remains
open can recreate validated Read access to an existing unexpired shared tab
with a new connection ID. Write and session approval are not restored after
the last matching MCP session disconnects. Off removes the sharing choice;
browser/extension restart clears tab access. Sharing another tab never silently
switches the requested one.

## Switch or disconnect

To use another browser, select its server explicitly. To switch instances of the
same browser, ask to reconnect with the new instance and extension IDs. Review
and approve the prepared switch, then compare the fresh code. Failure,
cancellation or timeout preserves the previous selected profile. Tab grants,
Write access and session approvals do not transfer.

Use **Revoke** in the extension to remove this client's access, or **Off** to stop
sharing a tab. Returned context may already have been sent to Antigravity's model
provider; local transport does not retract that data.

## Update

Stop the plugin's MCP servers/close Antigravity before replacing its files.
Keep the old plugin folder outside the discovery directories for rollback.
Extract the new release and place only its `page-as-context` folder in the global
plugin directory, then reopen the app and verify the version and servers.
Do not keep two discoverable copies with the same plugin name. Do not edit
installed release files; changes need a new version. Do not replace or delete
`~/.page-as-context` to update the plugin. An incompatible shared bridge update
requires its own reviewed setup plan; do not overwrite a bridge automatically.

## Remove

Revoke the Antigravity clients in the browser extension, stop the plugin servers
and close the app. Remove only `~/.gemini/config/plugins/page-as-context` for a
manual installation, or use `agy plugin uninstall page-as-context` for a
CLI-managed installation. Restart and verify the plugin no longer loads.
The shared bridge and credentials remain outside this directory. Do not remove
them while ChatGPT, Claude or other clients use them. Browser extension removal,
shared bridge uninstall and explicit credential cleanup are separate operations.

## Troubleshoot

- Plugin missing: verify that `plugin.json` is directly inside the installed
  `page-as-context` folder; the ZIP's outer `bundle` is not the plugin.
- Server fails to start: record the error and check runtime executable permission,
  macOS security prompts, and the installed App version. Do not bypass security
  controls or replace the bundled runtime with an arbitrary global Node.
- No tabs: pairing alone gives no tab access; share the source tab again.
- Read denied: check Read/Write, expiry, source restrictions and current grants.
- Write denied: respect the denial; never repeat an uncertain write automatically.
- Bridge unavailable: use setup/status diagnostics; never delete sockets or reset
  profiles automatically, and do not change other clients' credentials.

The initial validation target is App 2.29.0, macOS arm64. Windows, Linux, Intel
Mac, remote agents and public Marketplace installation are not qualified here.
