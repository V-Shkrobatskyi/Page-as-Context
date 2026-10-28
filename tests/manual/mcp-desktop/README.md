# Desktop MCP acceptance fixture

Start from the repository root with Node 24:

```sh
node scripts/mcp/serve-desktop-fixture.mjs
```

Open `http://127.0.0.1:8765/` in the browser under test. The server binds only
to loopback and serves four explicit public fixture routes. Stop with Ctrl+C.
Use `--port 8766` if the default port is occupied. This is a test-page server,
independent of the MCP transport. It has no external dependencies or persistence.

Use the installed full plugin's `browser-chrome` or `browser-firefox` tools.
Record the package version, browser/extension versions and current connection ID.
Keep setup confirmation and browser approvals enabled. Pairing, source grants
and action approvals must be performed by the person testing the extension.

1. Pair the selected browser through setup tools. First connect the fixture in
   read-only mode. Read `PAC-DESKTOP-20261026` and record any capture warnings,
   including whether `PAC-NEUTRAL-FRAME-20261026` was captured.
2. Confirm a write is rejected with no visible state change in read-only mode.
3. Apply read/write and **Ask before each action**, then choose
   **Connect selected tab (read and write)** in **Approved clients**.
   Record the new connection ID. Read a fresh snapshot before
   each action and use a new operation ID. Allow each requested browser action:
   click **Increment local counter** once; fill **Test input** with
   `PAC native input`; fill **Test textarea** with `PAC native textarea`;
   choose **Beta** in **Test choice**; set **Test checkbox** to checked.
4. Compare tool receipts with visible values and event counters. The click
   count must be exactly one. Record actual input events rather than assuming
   one event per key or one event per action.
5. Request another click and choose **Deny**. The count must remain one. Repeat
   with a fresh snapshot/operation and close the approval tab instead of
   answering. Do not automatically retry a denied or unknown operation.
6. Test disabled/password/file/custom-editor controls as negative cases when
   references exist. An omitted action reference is an unsupported target,
   not a successful write. Use the synthetic email to assess the configured
   privacy filters; do not enter real personal data.
7. Read successfully, select **Stop all MCP access**, and verify the same old
   connection ID fails for both read and write. Explicitly reconnect before
   testing Revoke. After Revoke verify old access fails and pairing is explicit.
   The helper must stay ready and other clients must keep their existing access.
   If the helper was already stopped, Revoke must not start it.
8. With a new grant, follow the navigation link, reload, or close the source
   tab. Old connections/references must fail. Restart tests require explicit
   reconnection, even when browser approval of the client remains saved.

Copyable prompts (replace the placeholders with the current server and ID):

```text
Use only SERVER.read_page_context with connectionId CONNECTION_ID. Report the public marker, warnings and current native-control state. Do not write.

Using only SERVER, read a fresh snapshot of CONNECTION_ID, then request exactly one click on "Increment local counter" with a new operationId. Wait for my browser approval. Do not retry if denied or outcome-unknown.

Using only SERVER, read a fresh snapshot of CONNECTION_ID and fill "Test input" with "PAC native input" once. Wait for my browser approval. Report the receipt and observed state.
```

Record actual-client observations separately from SDK, mock and loader checks.
For simultaneous clients use separate fixture tabs and independent profiles.
Never approve pairing or page actions through browser automation.

## Reconnect after applying settings

Start the helper and explicitly connect the fixture. Record the working
connection ID and snapshot. Change the applied MCP mode or write approval.
The helper should make one connection attempt and become ready again when
permissions allow, while the old connection/snapshot remain unusable. Connect
the tab explicitly again; no action should have been repeated.

If the helper was stopped before Apply, it must stay disconnected. Disabling
MCP, denying required permissions or an unavailable native host must leave it
disconnected with no retry loop. In Firefox, switching to write mode without
the required data permissions must wait for manual **Start helper connection**
and browser permission approval. Stop during a pending reconnection must win.
