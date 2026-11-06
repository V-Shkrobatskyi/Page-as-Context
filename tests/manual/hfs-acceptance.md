# HFS joint acceptance checklist

Use extension 2.2.1, pinned HFS 3.3.4, and a separate HTTP server entry in the AI
host. Record exact host/browser/OS versions and whether tools came from native or
HTTP. Keep secrets and page contents out of evidence and screenshots.

1. Reload the unpacked Chrome build. Generate private config, start HFS in its own
   working directory, enable Local HTTP, grant loopback permission, and Retry.
2. Add a new HTTP client without downloading files. Copy its URL/header to the local host without putting
   credentials in chat. Restart/reconnect the host as required. Initialize and
   tools/list must require no pairing and expose no page metadata. A new client
   becomes visible and authorized immediately after Add client. Optional JSON
   export is independent. A legacy unapproved profile fails until Authorize & export;
   Revoke invalidates its key. Adding another client does not require HFS restart.
3. Disable the old native plugin for the first HTTP test. Select Read on a harmless
   page; list/resolve must discover it without asking for copied IDs. Read it.
   An unshared second tab, wrong credential/profile, Off, Pause and Revoke must
   disclose no page data. Discovery/status/polls must not renew tab inactivity.
4. Open two host sessions with one credential and two independent clients. Equal
   JSON-RPC IDs must not collide; cancel/DELETE one session leaves the other usable.
5. Re-enable native. Test a pending HTTP read/action against a native request for
   the same tab: one shared per-tab lock. HFS Stop/crash must preserve native grants.
6. On the disposable `tests/fixtures/hfs-action-form.html`, served over HTTP, choose
   Write explicitly. Test click/fill/check/select and per-client unchecked actions.
   User approves every browser prompt unless explicitly choosing session approval.
   Read → Write → Read must work in the same host session without an app restart;
   tools/list remains stable and get_connection_status follows current grants.
   Cached forbidden tools must be rejected. Deny, approval expiry, cancel before/
   after dispatch, lost reply and repeated operationId must never cause replay.
7. Test idle >30 s without a debugger or settings page holding the worker; long
   approval, forced worker recreation, browser restart, HFS crash/reload/restart,
   OS sleep/wake, permission removal and endpoint/policy changes during a request.
   No old write or share is restored after a full worker/browser restart.
8. Repeat in desktop Firefox with real transmission consent and site permissions.
9. Verify Download HFS setup files is disabled until Local HTTP is enabled and
   saves only YAML and the current OS launcher. Cancel each save in turn: no new
   client should appear. Retry a cancelled launcher: only the launcher downloads.
   After success, another click downloads both again without changing client keys.
   Verify Add client asks for no downloads permission and creates no files; copied
   values and optional JSON agree. Cancelling JSON export does not revoke a client.
   macOS/Linux require execute permission. Repeat startup acceptance for newly
   claimed platform/version combinations; Linux startup remains unverified.
10. Separately test download/quarantine, normal start, login startup, Stop and
   uninstall with private files and bounded logs. Do not count a shell-only driver
   as GUI acceptance; retain exact OS/browser versions for each manual result.

Use statuses PASS / FAIL / NOT TESTED with the concrete limitation. SDK/contract/
build evidence is separate from real AI-host and OS acceptance.
