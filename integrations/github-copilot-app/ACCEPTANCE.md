# GitHub Copilot app acceptance status

Updated 9 November 2026. Chrome live evidence below used version 0.1.0 on
macOS Apple silicon; the current distribution is 1.2.2.
Chrome core acceptance completed with user-operated UI and user-reported tool
results. Firefox live testing was explicitly skipped at the user's request.

## Environment and completed evidence

- Installed app: `/Applications/GitHub Copilot.app`, version 1.1.35.
- App SDK runtime: `1.0.102-0.unstable.r41779900948.gf482387`.
- Packaged Node: official 24.10.0 darwin-arm64, archive checksum pinned and verified.
- Independent production and content-free probe ZIPs were built and checksummed.
- Both ZIPs were extracted and their copied contents tested in paths with spaces.
- Installed-copy SDK/native-fixture checks passed for Chrome and Firefox: setup
  confirmation, synthetic pairing/read, denied write, revocation, shared leases,
  instance switching/cancellation and isolated uninstall.
- Final checks were repeated from the primary project checkout using its current
  shared checker. Other client profile sentinels remained byte-for-byte unchanged.
- A ChatGPT Chrome package regression check passed after the checker extension.
- The installed app's own runtime/SDK registered a local marketplace and installed
  each plugin into a temporary COPILOT_HOME. Runtime discovery found the packaged
  MCP servers. The probe echoed a nonce through the runtime's native invocation
  pipeline. Production servers executed setup_status for both browsers. The
  production setup skill was discovered by the live runtime.
- Disable and uninstall followed by local marketplace removal passed. A disabled
  live-source plugin can remain visible until its marketplace is unregistered;
  the check qualifies the complete teardown, not immediate row disappearance.
- The automated checks sent no model prompt/inference and did not modify real
  browser hosts, pairing, grants, application accounts or persistent app settings.
  The subsequent user-operated live checks below used the real app and browser.
- JavaScript syntax and git diff whitespace checks passed. No commits or push.

The local marketplace loads the plugin live from its source path, which must
remain available. On 9 November the user demonstrated the app UI supports a local
path in **Add plugin → Manage marketplaces → Source**, added the marketplace and
installed the production package. Direct ZIP import is not claimed.

## Chrome live evidence — 9 November 2026

Evidence is the user's screenshots, reported actual UI effects and copied Copilot
responses in this chat. Not every RPC was independently captured by this agent.

- [x] Local marketplace added through the app UI; production Install selected.
- [x] During the misleading installed/not-installed details transition, local
  settings retained enabledPlugins and real Copilot logs showed both MCP servers
  initializing. The cause of the UI inconsistency has not been established.
- [x] Copilot invoked Chrome setup_status: existing bridge registered/healthy,
  no Copilot profile before setup. Existing bridge reuse was exercised; this was
  not a clean real native-host installation.
- [x] User approved pairing; the intended W3Schools tab was discovered and its
  YouTube iframe example was correctly read.
- [x] On the Selenium Web form fixture, Copilot set Text input to the agreed test
  text. The user saw the change and Copilot reported confirming it by re-reading.
  No Submit or unrelated field changes were reported. The exact browser approval
  prompt/policy for the action was not separately recorded.
- [x] After user Cmd+Q/relaunch, profileConfigured remained true. Both previously
  shared tabs were read-only with fresh Connection IDs; prior Write did not return.
- [x] When asked to write without restoring Write, the agent declined based on
  read-only discovery. This tests agent behavior, not a native write-denial RPC.
- [x] After user Revoke, list_shared_tabs returned request-rejected.
- [x] A separate read_page_context with an old Connection ID returned request-rejected.
- [x] User paired again after Revoke. Before new tab grants list_shared_tabs was
  empty; after explicitly granting AI: Read, the fixture was read successfully.

pairing.status = not-started in setup_status denotes no current pairing attempt;
it does not by itself mean that an already active profile has lost trust.

## Files and receipts

Primary release directory:
`artifacts/mcp/GitHub Copilot app 0.1.0 verified macOS arm64/`.
It contains the marketplace, distributable ZIP, SHA256SUMS.txt,
`package-check.log`, `app-runtime-check.log` and `verification.json`.
The content-free artifact is in
`artifacts/mcp/GitHub Copilot app 0.1.0 verified loader probe macOS arm64/`.
Generated artifacts and receipts are intentionally not source-controlled.

The wrapper uses shared helper code, but the new package has its own fixed
`github-copilot-app/profiles` identity. Native setup and cache replacement remain
separate operations. The shared checker adds only the new client kind and reuses
its existing foreign-profile protection; unrelated Antigravity changes are retained.

## Untested and deferred scope

Firefox live acceptance is deliberately untested: the user ended manual testing
for lack of time. Synthetic Firefox checks remain passed and are not live evidence.
No further Firefox testing is planned in this task.

Other untested cases: clean real native-host installation, detailed privacy-filter
assertions, actual RPC write rejection after restart, action approval/denial UI,
browser/extension restart, TTL/navigation, switching instances, live cross-client
coexistence, package update/cache replacement and disable/uninstall in the app UI.
These are limitations of qualification, not a claim of failures. Chrome core flow
is accepted within the evidence above; full platform/lifecycle qualification is
not claimed. No public marketplace submission or commits were performed.

## Distribution refresh 1.2.2

The four client integrations now share package version 1.2.2. All new archives
were checksum-verified, unpacked and checked against their package inventories.
The revised English guide is included inside each package and at the output root;
repository-relative documentation links become web links in these release copies.
ChatGPT, Claude Code, Antigravity and Copilot Chrome/Firefox synthetic checks,
Claude Desktop MCPB checks and the content-free probe passed. Copilot app 1.1.35's
own runtime also loaded production 1.2.2 and its setup skill and invoked status
tools in an isolated profile, without model inference or real account changes.

Reports: `artifacts/mcp/plugin-release-1.2.2-checks/`. This does not relabel the
0.1.0 live-browser evidence as a 1.2.2 acceptance run. Installed 0.1.0 files and
all older release directories are unchanged. Firefox live acceptance is still
untested at the user's request.
