# MCP integration

Page as Context shares explicitly permitted tabs through a local MCP bridge.
MCP starts disabled. New installations select **Automatic** connection; existing
settings stay **Manual** until you switch. The compact popup switch shows
**AI Off**, **AI Read** or **AI Write**. Write includes reading and supported
page actions. The toolbar keeps the full-size original icon with a yellow R
badge for Read or red W badge for Write; Off has no badge. The popup arrow remains
white, yellow or red. The toolbar tooltip explains the state. Temporary keyboard
shortcut feedback restores the current MCP indicator when it ends.

**Mode** applies to both connection types: **Read only** permits reading;
**Read and write** also enables explicit Write grants. New settings default to
Read only. Select Read and write before choosing Write in the popup; per-action
approval remains independent. Connection controls only Automatic versus Manual
bridge startup. The former Allow page actions checkbox has been removed; saved
restrictions migrate without expanding permissions.

In Automatic, choose Read in a source tab popup even before a client connects.
The selected access and arrow color remain visible while waiting for a client.
Each new client must complete one-time code comparison and approval in MCP
settings. Automatic opens the Pairing and clients section in an active browser
tab for a new request, reusing its pairing tab for later requests. Repeated
polling of the same request does not open more tabs. The popup only shows a
pending indicator; use its MCP footer link to reopen settings if needed. Approval gives that client
access to all tabs marked Read or Write; there is no separate shared-access
checkbox. Previously approved clients also participate automatically. Unknown
clients cannot discover or read tabs. Revoke removes one client's access; Off
removes every client's access to that tab. Ask before each action remains the
default, and adding a client never inherits another client's session approval.
Automatic connects the helper without Start; Retry is available in MCP settings.
Manual retains Start helper connection and per-client Connect selected tab.

### Automatic inactivity timeout

In Access and approval, **Auto-disconnect tabs** appears whenever Connection is
Automatic, independently of Mode or Enable MCP. Its default is **1 hour** for
both Read and Write. Choose 1–999 minutes, hours or days, or **unlimited** (the
amount field is disabled). Existing Automatic settings without this option
also use one hour. Apply settings before granting tab access again. The Shared
tabs table shows each tab's remaining time in a separate column: minutes,
seconds in the final minute, or Unlimited. This countdown runs locally without
MCP polling and updates when successful activity changes the deadline.

A successful `read_page_context` or an actually applied action restarts the
inactivity timer for that tab and its current client grants. Discovery, status
checks, pairing, failed/denied actions and cached action receipts do not renew
access. Activity on another tab does not extend it. Off and Revoke cannot be
undone by a late response. Manual retains its existing fixed session duration.

Unlimited removes only the inactivity timeout. Explicit Off, tab close/discard,
browser/extension restart and Stop still clear access;
transport recovery still downgrades Write. A managed `McpMaxSessionMinutes` remains
an absolute session cap, including for unlimited, and is never extended by
activity. Discovery and connection status return `expiresAt: null` when there
is no expiry. Pairing trust persists independently of tab access.

The assistant calls `list_shared_tabs` or `resolve_shared_tab` to obtain current
connection IDs; you do not copy IDs into chat. Only authorized tabs are returned.
Selectors include `only`, `last-focused` and `active-per-window`. An unshared
active tab produces `tab-not-shared`; focus does not authorize another tab.
Discovery respects title exclusions/redaction and returns no raw URLs.

Automatic Read and Write follow the shared tab across reloads and navigation,
including different sites, without renewing the inactivity timer. A new tab starts
Off, including tabs opened from a shared tab. Navigating to a private site in the
same tab keeps its selected access, subject to privacy filters and source policies.
Document grants, snapshots and pending approvals are invalidated on navigation;
clients discover fresh connection IDs and read a fresh snapshot before acting.
Close/discard, browser restart and extension reload clear access. Short transport recovery can restore only validated Read, with fresh IDs
and snapshots. Unverified background recreation clears shares. Pause all blocks
page access until Resume, which never restores Write. Off affects this tab for
all approved clients; Revoke affects only one client. Stop clears all sharing and
cancels retries. Privacy/policy changes invalidate previous access. No action is
automatically replayed, including actions with an unknown outcome.

When Chrome hides tab metadata after cross-site navigation, MCP resolves the
selected tab through the existing debugger API without attaching. No extra
`tabs` or host permission is requested. Other targets are not exposed to clients;
unavailable metadata blocks execution without clearing the sharing intent.

Browser permissions remain separate. Firefox may require fresh user-granted
site access after navigation even while an MCP sharing intent remains active.

For packaged ChatGPT desktop setup on macOS Apple silicon, install the **Page as
Context** plugin and ask it to set up your browser in chat. Review the prepared
plan, approve the local setup, then compare the pairing code with the request in
the extension. See [the package guide](../integrations/chatgpt/PACKAGE-README.md).
Claude Code uses the [shared Claude integration](../integrations/claude/PACKAGE-README.md); Claude Desktop retains its MCPB. The manual commands below remain available for development and recovery.

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
   a `connectionId` obtained by `list_shared_tabs`; this is an opaque session reference, not a
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

The discovery tools are `list_shared_tabs()` and `resolve_shared_tab({selector|tabRef})`; neither grants access. Page tools include `get_connection_status(connectionId)` and
`read_page_context(connectionId)`. They return only this authorized connection.
There is no unshared/all-tabs catalog, arbitrary URL navigation, JavaScript evaluation,
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
Per-action approval opens an active tab in the source browser window and requests
that window to come forward. A prompt expires after 45 seconds.
**Allow this action** approves only the requested operation. The separate
**Allow for this connection** button approves it and skips further prompts for
that exact client/tab grant, without changing the saved Write approval setting.
Navigation, expiry or revocation ends this approval. Other clients and tabs do
not inherit it. The button is hidden when organization policy requires each-action
approval, and the background independently enforces that restriction.
For Automatic tabs, **Shared tabs → Skip prompts** shows a checkbox for each connected
client. Toggle it to change only that live connection; Read and managed
each-action connections cannot enable it. It reflects approval granted from the
action prompt, does not change global settings or renew the timer, and does not
approve a request that is already waiting for a decision. Receipts distinguish
`approval-denied`, `approval-timeout` and `approval-unavailable`; none authorizes
the action, and denied or uncertain operations must not be replayed automatically.
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
on all navigation in Manual mode. Automatic keeps the tab's selected mode across navigation as described above. Reconnect through the popup after access ends.
Browser/extension/background recreation clears tab grants. Short helper transport recovery can restore only validated Read in Automatic. **Stop** closes the
native port and clears live access. **Revoke** removes only the selected client's
approval, grants, snapshots and pending actions; it leaves the helper and other
clients connected. Revoking while the helper is stopped does not start it.
Renaming a client ends that client's tab grants without affecting other clients.
Neither Stop nor Revoke can retract data already delivered to a client.

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
