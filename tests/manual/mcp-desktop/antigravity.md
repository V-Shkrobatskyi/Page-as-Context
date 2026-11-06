# Antigravity plugin acceptance

Date: 6 November 2026. Candidate: Page as Context 0.1.0, macOS arm64.

## Observed environment

- Installed `/Applications/Antigravity.app`: **2.29.0**, bundle identifier
  `com.google.antigravity`, package description “Agentic Desktop Application”.
- The user confirmed this is their target client. This is the App, not the
  standalone IDE. No `agy` executable was found in the checked command paths.
- A private global plugin directory exists. The candidate was copied from the
  extracted, checked ZIP to `~/.gemini/config/plugins/page-as-context` without
  overwriting an existing plugin. Existing HFS MCP configuration was untouched.
- The user confirmed Page as Context and both browser servers appear in the App.
  The App created nine tool descriptors and `instructions.md` for each namespaced
  server under its MCP cache. The instructions match this candidate and the
  appropriate browser, confirming actual-client initialization and path resolution.
  No `~/.page-as-context/antigravity` directory existed at that observation.
- The user supplied the App agent response: it called
  `page-as-context_browser-chrome/setup_status` and `prepare_browser_setup`.
  Status reported Antigravity — Chrome, native host installed/registered, no
  configured profile, pairing not started, and no recovery required. The plan
  proposed reusing the verified bridge and creating separate credentials, with
  activation only after successful pairing. It explicitly stopped before
  `confirm_browser_setup` and requested user approval. IDs are omitted here.
- The user subsequently confirmed pairing and granted tabs. The supplied App
  response reports pairing approved and successful `list_shared_tabs`: one
  read-only W3Schools fixture and one active read-write Web form fixture.
  Connection IDs and tab references are omitted. Page reading and writes were
  not performed in that reported step. No real page content was used in package
  checks.

## Evidence boundaries

The distributable ZIP was extracted before testing. Both browser checks passed
with its bundled Node 24.10.0 and a PATH without global Node. Temporary staging
paths contain spaces. Tests cover inventory and identity, MCP path expansion,
invalid browser rejection, setup confirmation rejection, synthetic pairing,
reads, denied writes, session preservation, profile switching, cancellation,
scoped disconnect and isolated uninstall. Other client profile fixtures must
remain byte-for-byte unchanged. These isolated checks do not establish actual-client behavior. Separate App
cache evidence, user-provided tool responses and browser observations below
confirm basic setup, pairing, discovery, reading, text fill/readback and Off for
both browsers. Chrome additionally has a tested write denial after downgrade to
Read; Firefox has tested empty discovery after pairing before any tab grant.
Action-approval policy and lifecycle scenarios remain separately qualified.

Rebuilt ChatGPT 1.2.1 and Claude Code 0.2.1 packages also passed the shared
installed-package check for Chrome after the builder/checker changes.

Release ZIP SHA256:
`56bc4c7a5607753872a3274a51c2969b6698df3d63213a1bfb7f3db507d4ee3b`.

The unchanged helper suite passed all 77 tests outside the sandbox. A sandboxed
attempt failed because Unix socket listening is blocked (`EPERM`); the package
checks also require local socket permission. Test registrations are isolated
from real browser native-host directories.

## Actual-client checklist

Do not mark a row passed from SDK or synthetic endpoint evidence.

| Scenario | Status | Required evidence |
| --- | --- | --- |
| App identifies Page as Context in Customizations | Passed: user confirmed | Visible plugin and both servers; candidate version 0.1.0 |
| Chrome and Firefox MCP entries load | Passed | User confirmation and App-generated MCP caches |
| Relative runtime command and expanded plugin path work in App | Passed | Both caches contain candidate-specific initialization instructions and nine tools |
| Chrome setup tools and approval boundary are usable | Passed: user-provided response | Agent called status/prepare and stopped before confirm; skill loading itself not independently verified |
| Chrome status and prepared plan are available in App | Passed: user-provided response | Existing bridge detected, profile not configured, pairing not started; proposed changes shown |
| Status/preparation leave filesystem unchanged in App | Pending direct observation | Synthetic tests pass; user-visible response alone is not a filesystem audit |
| Fresh browser bridge installation without global Node/HFS | Pending | Separate clean environment; existing bridge is not proof |
| Chrome setup and pairing approval | Passed: user confirmed pairing; App reports approved | Existing verified bridge reused; code comparison itself not independently recorded |
| Chrome shared-tab discovery and access modes | Passed: user-provided App response | Two authorized fixtures discovered with distinct read-only/read-write modes |
| Firefox setup and pairing approval | Passed: user confirmed browser approval and supplied App response | Firefox-specific status/prepare/confirm; bridge reused; subsequent status approved |
| Firefox pairing alone exposes no tabs in discovery | Passed: user-provided App response | Approved pairing followed by list_shared_tabs returning an empty list before any tab grant |
| Read attempt without tab grant | Pending in real client | Empty discovery is separate from direct read rejection; synthetic coverage exists |
| Chrome shared safe fixture can be read | Passed: user-provided App response | Agent refreshed discovery, read Selenium Web form and reported fields/current values without actions |
| Firefox shared safe fixture can be discovered and read | Passed: user-provided App response | Firefox-specific discovery/read reports Selenium Web form fields in read-only mode; no actions reported |
| Chrome controlled text fill and readback | Passed: user observed browser change and supplied App response | Fresh snapshot → fill_element applied → fresh read verifies expected value |
| Chrome action approval prompt/consent policy | Pending explicit observation | Successful fill does not establish whether a per-action prompt appeared |
| Firefox controlled text fill and readback | Passed: user observed browser change and supplied App response | Read-write discovery → fresh snapshot → one fill_element applied → new read verifies expected value |
| Firefox action approval prompt/consent policy | Pending explicit observation | Successful fill does not establish whether a per-action prompt appeared |
| Chrome write after downgrade to Read | Passed: user-provided App response | Discovery reports read-only; one fill_element returns read-only; agent stops without retry or escalation |
| User action-approval denial and unknown outcome are not replayed | Pending | Read-only rejection is separate from approval denial or unknown outcome |
| Chrome Off removes discovery and rejects stale connection | Passed: user-provided App response | Web form absent from refreshed discovery; one read through previous ID returns request-rejected, no retry/substitution |
| Firefox Off removes discovery and rejects stale connection | Passed: user-provided App response | Empty discovery; one read through previous ID returns request-rejected; agent stops without retry/reconnect |
| Per-client Revoke, navigation and closed tab invalidate access | Pending | Separate from the tested Off operation |
| Firefox Read after App restart | Observed: compatible with Automatic sharing | User reports profile configured and Web form read-only with a new connection ID; browser stayed open |
| Write and session approval do not survive the last MCP disconnect | Pending in live App | Prior Read-only share does not establish Write downgrade; separate regression covers the controller |
| Instance switch success/cancel/timeout | Pending | Old profile retained on unsuccessful switch |
| Concurrent ChatGPT/Claude retain access and profiles | Pending | Separate client sessions remain usable |
| Update and rollback preserve state | Pending | New version, prior version rollback |
| Plugin removal preserves shared bridge and other clients | Pending | Plugin absent; other clients still work |

## Suggested safe prompts

First verify loading without setting up a browser:

> Check whether the Page as Context browser-chrome and browser-firefox tools are
> available. Call setup_status for each. Do not install a bridge, start pairing,
> change permissions or read any page.

After loading is confirmed, explicitly request one browser:

> Connect Page as Context to Chrome. Prepare the setup plan and show its changes
> before asking me to approve them. I will compare the pairing code and grant a
> test tab separately.

Use a dedicated fixture, not personal tabs. A fixture can be served using the
existing `scripts/mcp/serve-desktop-fixture.mjs` after reviewing its CLI options.
Record only redacted outcomes, client/browser versions and error codes. Never
record credentials, pairing secrets, personal page data or unrelated MCP config.

## Current qualification

Basic actual-client acceptance passed for Antigravity App 2.29.0 on macOS arm64
with Chrome and Firefox: plugin loading, setup using an existing verified bridge,
approved pairing, authorized discovery, reading, one controlled text fill with
fresh readback, and Off rejecting the previous connection. Evidence consists of
App-generated MCP caches, user-provided App responses and user-observed text
changes, as distinguished in the checklist.

Remaining live scenarios include fresh native-host installation, action approval
policy/denial, Firefox downgrade to Read, per-client Revoke, navigation/closed-tab
invalidation, Write/approval reset across restart, instance switches, simultaneous clients, updates/rollback
and removal. Existing bridge reuse is not evidence of fresh installation.
Not submitted to a public Marketplace. Standalone IDE, CLI, other operating
systems and architectures remain unqualified. Remaining manual release
qualification was deferred at the user's request.


## Chrome read result

The user supplied an App response showing refreshed `list_shared_tabs` followed
by `read_page_context` through the Chrome plugin. The agent identified text
inputs, textarea, disabled/readonly fields, selects, checkboxes, radio buttons,
color/range/date/file controls and the submit button on the Selenium Web form
fixture. Existing field values and opaque IDs are intentionally not retained.
The response reported no edits, clicks or submission. This is user-provided
actual-client evidence, not an independently observed browser state diff.


## Chrome write result

The user observed the Text input value change to the requested test string in
the browser. The supplied App response shows fresh discovery/read, one
`fill_element` with status `applied`, and a new read snapshot confirming the
expected value. The agent reported no other changes or submission. Snapshot and
element IDs are omitted. This confirms a bounded write through the plugin and
readback; it does not independently establish a browser approval prompt or audit
every other field. Denial, revocation and policy checks remain separate.


## Chrome write downgrade result

After the user switched the fixture to Read, the supplied App response shows
`list_shared_tabs`, `read_page_context` and one `fill_element`. Discovery reported
read-only mode; the write returned `{"error":"read-only"}`. The agent explicitly
stopped without retrying or requesting broader access. The current field value
was not independently re-observed in this step. This is an authorization denial,
not evidence of a rejected action approval prompt or an unknown-outcome test.


## Chrome Off result

After Off, the user-provided App response shows fresh `list_shared_tabs` with
only the other authorized fixture; Web form is absent. One `read_page_context`
using the previous connection returned `{"error":"request-rejected"}`. The
agent stopped without retry, requesting access or substituting another tab.
This confirms tab-level unsharing and stale-connection rejection. It does not
establish per-client Revoke, navigation invalidation or restart behavior.


## Firefox setup and pairing result

User-provided App responses show Firefox-specific setup status (native host
installed/registered, no configured profile, pairing not started, no recovery),
preparation with explicit instance and Gecko extension IDs, and a plan to reuse
the bridge and create separate credentials. The agent stopped before confirmation
and requested approval. A subsequent response shows confirmation and initially
pending pairing; the user approved in Firefox. A fresh pairing status then
reported approved and `list_shared_tabs` returned `[]` before tab access was
granted. This confirms the Firefox setup workflow and empty discovery after
pairing alone. It does not independently prove direct read rejection without
a grant or profile isolation under simultaneous sessions. Subsequent read/write
results are recorded below.
Request IDs, instance/extension IDs and pairing codes are not retained here.


## Firefox read result

After explicitly granting Read to the Firefox Selenium Web form, the user supplied
an App response showing `page-as-context_browser-firefox/list_shared_tabs` and
`read_page_context`. The response reports read-only mode and correctly describes
the fixture controls. No fill, click or submission was reported. Opaque
connection IDs and captured values are omitted. Subsequent write and Off results
are recorded below.


## Firefox write result

The user observed the requested single Text input change in Firefox. The supplied
App response shows Firefox-specific discovery with read-write mode, a fresh
snapshot, one `fill_element` returning applied, and a separate read snapshot
confirming the requested test value. The agent reported no other changes and no
submission. Opaque connection, snapshot, element and operation identifiers are
omitted. Browser approval policy and Firefox denial/revocation are separate
checks; a successful write does not establish that a per-action prompt appeared.


## Firefox Off result

The user supplied an App response after Off showing Firefox-specific
`list_shared_tabs` returning `[]` and one `read_page_context` through the previous
connection returning `{"error":"request-rejected"}`. The agent stopped without
retry, access requests or reconnection. This confirms Firefox tab unsharing and
stale-connection rejection. Per-client Revoke and restart remain separate tests.


## Firefox App restart result and corrected expectation

The user granted Read, quit Antigravity with Command-Q and reopened it while
Firefox remained running. The App response reports profileConfigured true and
the same Web form in read-only mode with a new connection ID. Current process
inspection found the App and both plugin MCP processes started together after
the restart; no pre-restart instance of those plugin MCP commands was present
in that snapshot. This is consistent with Automatic sharing intent retained in
the browser and fresh Read grants created by discovery. It does not by itself
prove all disconnect timing or behavior of a previous Write grant.

The original instruction to expect an empty list after this App restart was
incorrect. In `src/mcp/background.ts`, client disconnect invalidates live grants
and snapshots, marks the client Read-only on reconnect, and preserves the
Automatic tab share. `syncShares` can then create a new validated Read grant.
Off, browser/extension restart, new pairing and App restart are different cases.
No access-control production code was changed to force empty discovery.

A controller regression now covers prior Automatic Read and Write shares across
the last client disconnect: old connection rejected, fresh connection Read-only,
expiry unchanged by reconnect, write denied, and no skip-prompts approval. All
138 tests in `tests/mcp/background.test.ts` passed. Production permission code and
the installed 0.1.0 package were unchanged; the developer guide was clarified.


## Manual test closure and setup guidance revision

The user requested ending the extended manual test sequence after the basic
Chrome/Firefox flows passed. Remaining live lifecycle scenarios stay unqualified;
no additional manual acceptance steps are requested for this private candidate.

Version 0.1.1 updates only the manifest version, setup skill, MCP setup
instructions and package guide. Both instruction channels now consume browser,
instanceId and extensionId already supplied by the user, ask only for missing,
ambiguous or invalid values, and proceed through status/preparation without an
extra “shall I start?” turn. The guide contains complete Chrome/Firefox starting
prompts and a separate approval reply. Approval of actual prepared changes,
code comparison and tab grants remain explicit. The end-to-end observations above
are for 0.1.0; the fewer-question guidance in 0.1.1 has not been evaluated through
a fresh live agent conversation. The installed 0.1.0 is retained until the user
updates while the App is closed; existing profiles do not need resetting.

The 0.1.1 ZIP was built and extracted into a new temporary directory. Both
bundled-runtime package checks passed (Chrome and Firefox), including setup
confirmation, synthetic pairing/read/write denial and profile switching.
ZIP SHA256: `80deb5c9d090be29f6d1e13b55a1bce717ea48905d33b7c708ccc5ad7231ba5f`. JavaScript syntax, documentation links and
`git diff --check` passed. The new guidance has no live agent acceptance claim.
