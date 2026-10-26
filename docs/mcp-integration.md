# MCP integration

Page as Context can share filtered context from one explicitly connected tab
with an external MCP client. MCP starts disabled. The implementation supports **Read only** and **Read and write**. Write access
requires a separate explicit grant when connecting the tab. Every action opens
an extension-owned approval page by default; closing or denying it prevents the
action. **Allow for this connection** lets the user approve supported actions for
one explicitly connected tab until navigation, expiry or disconnection. It is
available unless organization policy requires approval before each action. The
default remains **Ask before each action**; the AI client may also request its
own confirmations.

For packaged ChatGPT desktop setup on macOS Apple silicon, install the **Page as
Context** plugin and ask it to set up your browser in chat. Review the prepared
plan, approve the local setup, then compare the pairing code with the request in
the extension. See [the package guide](../integrations/chatgpt/PACKAGE-README.md).
The manual commands below remain available for development and recovery.

The connection is local, but your AI client may send the returned context to its
model provider. Page text is untrusted data. Filters cannot identify every
secret: check data controls and the local test output before sharing a page.
Private browsing and Android native integration are excluded.

## In-chat setup in the private ChatGPT plugin

The plugin package bundles the server, runtime and setup workflow. After
installing/enabling the plugin and restarting the desktop client, ask it to set
up Page as Context for Chrome or Firefox. Provide the browser instance ID from
the extension MCP page and the installed extension ID. The assistant prepares a
plan, asks for approval, then starts setup and returns the pairing code in chat.
Compare that code with **Pairing and clients → Pairing requests** in the
extension and approve there. If needed, use **Start helper connection** and
**Refresh status**. Finally select a source tab and **Connect selected tab**.

This flow uses no separate desktop setup application or remote server. It still writes
the local native-host registration and private runtime, which are necessary for
the browser bridge. A client profile alone does not establish approval or grant
a tab. Keep the client approval prompt enabled for `confirm_browser_setup`.
Claude packaging and actual installed ChatGPT assistant acceptance are separate
checks; SDK tests do not establish either.

## Install and pair on macOS (development and recovery)

Requires Node.js 24.10.x and npm 11.6.x. The helper is installed separately and
does not run remote code inside the extension. In the repository root:

```sh
npm ci --prefix helper
node helper/src/cli.mjs install --chrome-id EXACT_CHROME_EXTENSION_ID
```

For Firefox, use `--firefox-id '{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}'`.
You may provide both IDs to one install. Development Chrome IDs and store IDs
are different: select the actual ID shown in your extension manager. No
wildcards are accepted. For a non-default Chrome user data directory, pass
`--chrome-user-data /absolute/path/to/user-data`.

1. Open the extension popup on the web page you want to share. Choose **Connect
   this tab to MCP**. The selected source is remembered temporarily; opening
   settings directly does not choose a source tab.
2. On the MCP page, enable MCP and select inherited or custom export preferences.
   Choose **Apply**. Shared privacy filters, data controls and organization
   restrictions always apply; custom MCP data exclusions can only be stricter.
3. No separate broker terminal is needed for a new helper installation. The
   native host and MCP client start it automatically after explicit setup.
   Existing older installations require an explicit reinstall to obtain this
   behavior; the installer refuses to overwrite an unknown or existing install.
4. Choose **Start helper connection**. Approve the native permission and, in
   Firefox, the optional data-transmission permissions. Declining these keeps
   the external channel unavailable; ordinary exports remain usable.
5. Copy the **Instance** ID from the page and run:

   ```sh
   node helper/src/cli.mjs pair --browser chrome --instance INSTANCE_ID --credential /absolute/private/client.json
   ```

   Use `--browser firefox` for Firefox. Add `--name "ChatGPT — Firefox"` (or another
   display name) to label the pairing request. Without it the helper uses
   `page-as-context-<browser>`. Names are labels, not verified identities. The helper creates a mode-0600 credential
   file. Its parent should be private, such as `~/.page-as-context`. Never paste
   the credential contents into a model prompt or put them in arguments or URLs.
   Leave this command running. If it reports **Waiting for the selected browser
   instance**, click **Start helper connection** within 60 seconds. Starting the
   pair command before this button avoids the native-only idle window. After a
   code appears, the command keeps its connection alive and waits up to two
   minutes for explicit browser approval. It never approves pairing itself.
6. Pairing requests appear automatically in MCP settings under **Pairing and clients
   → Pairing requests**. **Refresh status** remains available as a manual fallback. The `Code:` row and **Approve pairing** button are there.
   Compare the code with the terminal and approve within two minutes while the
   terminal command is still running. Names supplied by clients are
   not verified identities. Each client must have its own credential file.
   The terminal reports **Pairing approved** when the browser accepts it. A timeout
   or rejection is printed explicitly. An existing credential for another browser
   or instance is rejected without being overwritten.
7. Choose **Connect selected tab** for the approved client. Give the assistant
   the displayed `connectionId`; this is an opaque session reference, not a
   credential. Each client grant addresses one tab. A different active tab does
   not change that target.

Pairing requests and approved clients show the display name alongside the ID.
The selected tab title is labeled **not connected** until a tab grant exists;
an approved client with a live grant shows its connected tab title instead.
These titles are shown locally, not added to pairing requests sent to the client
or persisted in the client registry. Existing clients without names remain valid;
use **Edit client name** to add a local label. Saving a name invalidates current
tab connections, so connect the tab again afterwards. Names do not affect
credential checks or grant authority.

Configure the MCP client to launch Node with arguments:

```json
{
  "mcpServers": {
    "page-as-context": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/repository/helper/src/cli.mjs",
        "stdio",
        "--credential",
        "/absolute/private/client.json"
      ]
    }
  }
}
```

This is a generic configuration example; applications differ in how they accept
MCP configuration. For a custom installation directory, supply the same
`--directory /absolute/private/bridge` to install, broker, pair and stdio.
The current SDK is pinned to 1.32.2, negotiating protocol 2025-11-25 in the live
test. Compatibility with a particular model application must be checked there.
No compatibility with protocol 2026-07-28 is claimed.

The managed broker exits 30 seconds after its last MCP connection closes,
including closing idle native connections. Before pairing, a native-only session
has a 30-second setup window; use **Start helper connection** again if it expires.
Simultaneous clients share one broker. A graceful restart can start on demand;
in-flight actions are never replayed automatically. A hard crash may leave a
stale socket, which is preserved for explicit recovery rather than deleted blindly.
`doctor` checks authenticated readiness and does not start a broker. See the
[helper lifecycle notes](../helper/README.md) for runtime and recovery details.

These commands are the developer setup/pairing route. The separate historical
installation-check plugin uses synthetic fixtures and cannot grant browser
access. Use the full Page as Context plugin for in-chat setup and acceptance.

## Read, interact, test and revoke

The tools are `get_connection_status(connectionId)` and
`read_page_context(connectionId)`. They return only this authorized connection.
There is no all-tabs tool, arbitrary URL navigation, JavaScript evaluation,
screenshot, cookies, storage, file or shell tool. Results use one canonical text
envelope, without a duplicate `structuredContent` copy. In a write-authorized connection, `click_element`, `fill_element`,
`select_option` and `set_checked` are available. Each accepts the connection,
current snapshot, issued element reference and a unique `operationId`; fill
adds `text`, select adds an issued `optionRef`, and checkbox adds `checked`.
Never retry an unknown outcome with a new operation ID: the operation may have
already happened. Repeating the same operation ID/arguments returns the previous
receipt; reusing it with different arguments is rejected. Receipts distinguish
`applied`, `rejected` and `outcome-unknown`. An applied action with failed
post-action capture remains applied and reports an unavailable snapshot.

Supported targets are native buttons/links, text inputs/textarea, checkboxes and
native selects/options. Password, file and recognized credential/payment fields
are excluded. Custom ARIA widgets, closed shadow roots, cross-origin action
frames, transformed/clipped frame coordinate boundaries and stale, disabled or
overlaid targets fail closed. Accessible same-origin frames and open shadow
roots are checked at action time. Chrome pointer actions use CDP input, while
fill/select use fixed native setters/events in an isolated world. Firefox uses
programmatic DOM events; these do not provide trusted input or user activation.
Capabilities expose this difference. No equivalence with human input is claimed.

Read-only output has no refs. Write output preserves distinct refs for repeated
controls. Maximum currently reports an explicit action-safe fallback to an
allowed Compact/Detailed/Without representation; a forced Maximum policy returns
`unsupported-combination` rather than ignoring the policy. Local test refs use
a separate preview-only registry and cannot be used by external tools.

The production helper advertises a stable catalog of read and action tools, even
before the browser connects or a tab grant exists. A listed tool is not permission
to use it: each invocation still requires the browser's current policy, client
approval, tab grant and, for actions, write access and any required confirmation.
This avoids missing action tools in clients that cache their initial catalog.
Disconnecting the last session with the same browser, instance, client ID and
secret revokes that client's live grants. Closing one of several matching
sessions preserves the others. Reconnecting after the last session closes
requires another explicit tab connection.

**Test MCP output** invokes the same resolver, capture handler and renderer
locally. It works while transport is disabled and without a helper or external
client. It requires a source selected through the popup and permitted preview
access. Draft settings do not affect external reads until Apply. Test payloads
are not stored in preferences, history or diagnostics. Copy and Save are
separately governed by clipboard and file-export policies.

Navigation, tab closure/discard, permission revocation, settings or policy changes
invalidate access. This implementation conservatively disconnects tab grants
on all navigation, including same-origin changes. Reconnect through the popup.
Browser/background/helper restarts never restore tab grants. **Stop** closes the
native port and clears live access; **Revoke** also removes the approved client.
Neither can retract data already delivered to a client.

## Removal and recovery

Run `node helper/src/cli.mjs doctor` for a basic configuration/socket check.
If the broker was killed and left a stale socket, verify no broker is running
before removing `~/.page-as-context/broker.sock`; the helper will not silently
replace that path. Stop MCP, stop the broker, then run
`node helper/src/cli.mjs uninstall` to remove this installation's manifests and
native runtime. Credential files are retained for explicit user removal.

## Organization policy and release limits

MCP uses separate `McpAllowed`, modes, clients, source restrictions, TTL and size
limits in addition to existing export/privacy policy. Disabling clipboard and
file export does **not** disable an explicitly allowed MCP channel. Conversely,
`PreviewAllowed=false` blocks the local test but does not disable an authorized
external read. Empty allowed format/compression lists disable reads. Stop and
Revoke remain available when preferences are locked. See
[the read-only policy example](enterprise/mcp-read-only.json).

The automated live read/write checks passed on macOS with Chrome 155.0.8059.86 and Firefox
158.0.1, using temporary extension copies with synthetic permission pregrants
and programmatic pairing approval. These are not tests of the real permission
dialogs, store installation or a production AI application. Linux registration
paths are implemented but unverified. Windows is explicitly rejected until
named-pipe ACLs and registration are implemented and tested. Android's existing
exports are preserved.

Firefox optional data declarations follow its
[built-in consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
Native Messaging counts as transmission under
[Mozilla's add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).
Store listing/privacy declarations and manual consent testing are required
before release; the published store names are unchanged.

See [the transport ADR](adr/0001-mcp-native-transport.md) and
[helper development notes](../helper/README.md) for the private IPC protocol,
failure bounds, exact-version dependencies and synthetic test commands.

## Verification and release checklist

```sh
npm run check
npm --prefix helper run check
node scripts/mcp/transport-spike.mjs --report /tmp/pac-transport.json
node scripts/mcp/read-only-probe.mjs --report /tmp/pac-read.json
node scripts/mcp/read-only-probe.mjs --write --report /tmp/pac-write.json
```

The write fixture performs only synthetic form changes and counts clicks. It
checks browser approval/denial, four actions, stale references and retry
coalescing. Unit/memory checks cover redaction, repeated controls, isolated-world
identity, receipt retention, policy checks and post-action capture failure.
Before publishing a store build, test the real permission/data-consent prompts,
a supported AI application, and the complete install → pair → read → approved
write → revoke → uninstall path. No model answer-quality benchmark or untested
OS/client combination is presented as release validation. Store names and
extension IDs remain unchanged.
