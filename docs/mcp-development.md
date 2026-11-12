# MCP development and maintenance reference

For developers and administrators. For normal plugin installation and daily use,
start with the [MCP user guide](mcp-integration.md) and choose your AI app.
Packaged plugins include their runtime; users do not need the commands below.

This reference preserves manual setup, protocol/action details, policy constraints
and release checks separately from the user guide. Synthetic checks and real
client acceptance are different evidence; consult each integration's verification
notes before claiming support for an app, browser or platform.

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
sessions preserves the others. In Manual mode, reconnecting after the last session closes requires another
explicit tab connection. Automatic can recreate validated Read for an existing
unexpired sharing choice; Write and session approval are not restored.

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

## Optional Local HTTP transport

Version 2.2.0 adds opt-in HTTP through a dedicated local HFS 3.3.4
installation. Native remains available; existing settings do not enable HTTP.
Both routes use the same browser policy, privacy filters, tab grants and action
approvals. HTTP diagnostics show connection state without secrets or page metadata.
See [HFS setup, trust boundary and verification limits](hfs-integration.md).


### Switching a plugin to another browser instance

Call `prepare_browser_setup` with the new instance ID and review its explanation
and changes. After explicit confirmation, `confirm_browser_setup` creates fresh
credentials and starts code pairing. Only successful pairing activates the new
profile. `cancel_browser_setup` cancels a prepared or pending request; denial,
timeout and activation failure leave the previous profile selected. At the
activation commit boundary, cancellation waits and reports the committed result.
If the browser approved pairing but local activation failed, revoke the unused
pairing in the browser before retrying.

Profiles are isolated by client, browser and instance under
`<client>/profiles/<browser>/instances/<instanceId>/<credentialId>.json`.
`<browser>/active.json` selects the last successfully paired identity. Legacy
`<browser>.json` credentials remain readable until replacement; they are archived
when setup creates a candidate. A pending candidate never becomes the selected
profile through discovery. A running plugin notices selection changes without an
MCP restart. Old connection IDs, snapshots, Write and session approvals are not
transferred, and in-flight actions are never replayed on the new instance.

## Exact targeted reads

`read_target_context` shares the full read's capture, authorization, privacy and
snapshot lifecycle. Input is `connectionId`, `target: {role, name}` or an unnamed
native field's `target: {role, placeholder}`. Matching is exact and case sensitive
on sanitized semantics. Neither selectors nor positional/fuzzy matching are
accepted. An optional `group: {role, name}` must identify one semantic ancestor;
allowed group roles are form, dialog, alertdialog, group, region and search.
`context: "group"` requires that group and requests its bounded subtree;
`context: "target"` is the default.

The ordinary capture envelope gains `target` with `outcome` (found, not-found,
ambiguous, capture-incomplete, context-unavailable), scope (target, group, none),
omitted, observation, recovery and an optional reason. Ambiguity returns at most
five sanitized candidate summaries without refs. Group ambiguity is resolved
before matching the target. Document boundaries prevent an ancestor in another
frame from disambiguating a field. Partial captures never assert found or absent.

Target scope contains the target subtree, a semantic group summary and up to four
local status/alert roots. Accessible supporting text and exposed inline errors
are sanitized with their owning control. Missing errors do not establish validity;
use group or full read for dependencies outside the scope. Bounds are 10,000
sanitized search nodes / 512 KiB, 80 returned nodes, and 16 KiB including the tool
text envelope and reserved transport metadata, also subject to policy limits.
Exceeded bounds return an explicit unavailable result and `read_page_context`
recovery, without silently truncating context or automatically sending the page.
Maximum compression returns unavailable when reliable semantics are not exposed.

Read mode issues no refs. In Write, each read invalidates old refs and prunes
adapter addresses to targets actually shown. These refs identify controls but do
not promise support for every action. The internal capture remains full; this
feature bounds response size and does not claim faster browser capture.

Custom clicks support named visible div/span elements with exact role=button and
explicit nonnegative tabindex, excluding editable, disabled, inert, hidden and
occluded elements. Other custom widgets remain unsupported. Decorative span/SVG
hits are accepted; independent nested controls are rejected. Both adapters use
the same fixed eligibility/preflight; Chrome dispatches CDP pointer events and
Firefox uses programmatic DOM clicks. A short observation window precedes the
post-click full capture. Applied does not confirm async completion or persistence.
A lost result can remain outcome-unknown; retries return receipts without replay.
