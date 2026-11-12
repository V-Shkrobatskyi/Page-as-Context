# Changelog

## 2.2.5 — unreleased

- Add `write_elements` for explicitly listed native fill/select/checkbox actions, executed sequentially with access/identity checks, stop-on-change behavior, per-step receipts and receipt-only retries. Add Maximum actions per write call (default 10, configurable 1–10) and the optional `McpMaxActions` organization ceiling. Existing single-action tools remain compatible. Development changes; installed clients and release packages are not updated automatically.

- Align the write limit and tab inactivity settings in equal-width columns and move their explanations into accessible help tooltips.

- Update desktop plugin packages to 1.2.5 and the common helper to 0.2.3 to distribute the grouped write catalog and transport changes. Existing installations require an explicit update.

## 2.2.4

- Preserve known empty Chrome AX values, expose filtered placeholder hints for unnamed Firefox native fields, and retain refs only for eligible partially masked text values with stable labels and node identities. Keep full hiding and mandatory exclusions fail-closed; distinguish filtered targets in fill fallback diagnostics.

- Remove installation-time browser configuration from Claude Desktop MCPB. One server exposes separate chrome_* and firefox_* setup/page tools for independent pairing and concurrent use; keep the Claude Code entry points unchanged. Rebuild package 1.2.4 at the user's request in a separate artifact directory.

- At the user's request, set all desktop plugin package versions to 1.2.4 alongside extension 2.2.4, retaining the latest branding, setup guide and ChatGPT archive packaging fixes. Earlier 1.2.4/1.2.5/1.2.6 build artifacts remain separate; installed releases are not replaced automatically.

- Align Claude Desktop/Code, Antigravity and GitHub Copilot app packages at 1.2.6. Add the project homepage and supported client icon metadata, preserving descriptions and setup skills. Copilot App retains its portable manifest without an unsupported icon field.

- Add the browser extension icon and GitHub website to ChatGPT package 1.2.6. Shorten its browser setup skill and add concise skill list metadata while preserving pairing and consent boundaries.

- Fix ChatGPT desktop packaging in client package 1.2.5: emit a single-plugin UI upload archive separately from the marketplace, omit macOS metadata and development-only dependency files, strip and ad-hoc sign the pinned Node runtime, and enforce published archive limits at build time. Desktop UI acceptance remains separate.

- Make compact scoped responses the default for `fill_element` when `responseMode` is omitted. Keep explicit `responseMode: "full"` and safe full fallbacks; leave other write-tools unchanged.
- Normalize the default at the shared browser execution boundary for native and HFS clients, and advertise it in the common tool catalog. Verify omitted/scoped/full behavior and retry protection.
- Update the common helper to 0.2.2 and affected desktop packages to 1.2.4 so existing 1.2.3 installations can receive the changed catalog without reusing a release version.

## 2.2.3 — unreleased

- Add optional `responseMode: scoped` to `fill_element`, preserving full responses by default and after other actions. Return the filled control, a bounded DOM-parent summary and changed status/alert regions; fall back to a full response with a reason when identity, privacy, capture completeness or other page changes prevent a safe scope.
- Preserve snapshot invalidation, grant/policy checks and receipt-only retry protection across native and HFS transports. Observe 150 ms before the post-fill capture without claiming application persistence or observing later asynchronous changes.
- Focus native text controls and emit a replacement InputEvent for text fills. Keep existing unsupported control types unchanged.
- Update the extension to 2.2.3, common helper to 0.2.1 and affected desktop package sources to 1.2.3. Installed packages are not changed automatically.

## 2.2.2 — unreleased

- Distinguish app plugins with a native helper from the universal Local HTTP (HFS) MCP server in the bundled guide, with separate setup links and connection requirements.
- Align ChatGPT, Claude Desktop/Code, Antigravity and GitHub Copilot app packages at 1.2.2, shipping the streamlined English guides with web links usable outside the repository. Keep existing installed releases intact.
- Add Copy setup info to MCP Helper connection controls, copying Browser, Instance and Extension ID without expanding setup details, with success and clipboard-error feedback.
- Add the private GitHub Copilot app plugin with separate client profiles, bundled runtime and local marketplace installation. Record user-verified Chrome pairing, read/write, restart downgrade, revocation and re-pairing; Firefox live acceptance remains untested.
- Simplify the shared MCP user guide, move developer setup and maintenance into a separate reference, and shorten client installation guides. Keep one copyable pairing request with setup info appended at the end.
- Synchronize extension release metadata and privacy version/date for 2.2.2. Client package versions are aligned separately at 1.2.2; the helper version is unchanged.

## 2.2.1 — unreleased

- Normalize empty Chrome accessibility names consistently during capture and action validation, preventing false stale-snapshot rejections for unnamed controls. Custom editors still need a supported input mechanism.
- Support explicitly confirmed browser-instance changes in the shared plugin helper with separate instance credentials, activation after successful code pairing, and preservation of the previous profile after cancellation or failure. Running updated plugin servers switch profiles without restarting the chat.
- Require a fresh Read or Write choice for newly paired clients before they can access previously shared tabs; preserve existing clients' grants while a new pairing is pending.
- Return normal cancelled setup results without a generic operation error; retain diagnostics for actual failures and incomplete cleanup.
- Show Extension ID beside Browser instance in Helper connection setup details.
- Package the updated shared helper in ChatGPT plugin 1.2.1 and Claude Desktop / Claude Code 0.2.1.
- Update the bundled guide and README to the new v2.2.0 demo video, including the README thumbnail; synchronize release and privacy metadata for 2.2.1.

## 2.2.0 — unreleased

- Clarify platform support: the ChatGPT Desktop, Claude Desktop and Claude Code packages target macOS Apple Silicon only. Local HTTP (HFS) reads and actions were verified in Chrome and Firefox on macOS and Windows 10 x64; Linux startup remains unverified. Windows x64, Intel Mac and Linux desktop packages are not provided.

- Show a live HFS lease retry countdown using the background retry deadline, without restarting it on settings refresh or blocking Native helper controls. Refresh status automatically when the wait ends and while HFS reconnects.

- Serialize first-time browser identity initialization and retry failed persistence; send explicitly empty HTTP 202/204 replies through HFS and accept SDK DELETE requests without a POST-only Accept requirement.

- Show the saved client addition date beside Client ID in Approved clients; preserve older clients without inventing historical dates.

- Recover HTTP MCP reconnects at session capacity by replacing only the same credential's least recently used idle session; preserve active requests and other clients.
- Add HTTP client Copy URL and Copy Authorization controls; keep credentials out of the settings display and shorten Export config / Revoke labels.
- Group Local HTTP setup, connection settings and clients in one consistent panel; match existing form styles and collapse advanced controls.

- Add an opt-in Local HTTP (HFS) transport alongside Native Messaging, with a shared execution controller and independent route leases.
- Generate a private HFS YAML from tracked relay source; authenticate providers with replay-protected HMAC and isolate client/profile/session routing and cancellation.
- Separate HFS setup downloads (YAML and OS launcher) from Add client, which immediately authorizes a new key without downloading files. Support copying connection details or optional JSON export; retain native pairing, explicit legacy HTTP authorization, revoke, JSON-only MCP sessions and per-client action restrictions.
- Keep HTTP tool discovery stable across Read/Write changes, enforcing current permissions and action approval on every invocation.
- Download HFS YAML and an OS-specific launcher independently of clients; resume a cancelled launcher save without downloading YAML again. Linux startup remains unverified.
- Add narrow optional loopback access for Chrome, transport-aware consent, managed transport/endpoint controls, and HTTP trust/setup documentation.
- Manually verify Chrome/Firefox HTTP reads and actions on macOS and Windows 10 x64, Antigravity reads and actions, and Goose/Ollama/Llama reads with explicit connection IDs. Linux startup, broader lifecycle recovery and reliable local-model tool chaining remain unverified.

## 2.1.0 — unreleased

- Resolve shared-tab metadata with Chrome's existing debugger API after activeTab access ends, without requesting extra tabs/host permissions or exposing unshared targets.

- Preserve Automatic tab access when browser URL state arrives before navigation events; invalidate old document grants without clearing the selected mode or renewing expiry.

- Label Shared tabs columns and add per-client Skip prompts controls for live Write connections, synchronized with action approval and limited by organization policy.

- Add Allow for this connection to action approval prompts, scoped to the current client/tab grant without changing global settings and subject to organization policy.

- Show the original Connect MCP button while MCP is disabled; open the top of MCP settings without selecting or capturing a tab.

- Show a local auto-disconnect countdown in a separate Shared tabs column, including Unlimited, without polling MCP.

- Open action approval actively in the source browser window and focus it; distinguish approval-timeout and approval-unavailable from an explicit denial.

- Add Automatic tab auto-disconnect with minutes/hours/days/unlimited, defaulting to one hour of inactivity; renew only after successful reads and applied actions while respecting organization session caps. Shorten and index the MCP user guide.

- Show per-tab yellow R / red W badges over the full-size original toolbar icon, keep colored arrows in the popup, and restore MCP indicators after shortcut feedback.

- Brighten Read/Write arrow colors and improve the compact AI switch with matching button text size, hover feedback and edge separators.

- Replace the Automatic AI dropdown with previous/next arrows and a compact AI Off / Read / Write label; cycle in both directions while skipping unavailable Write access.

- In Automatic, select Read before clients connect and give paired clients access without a separate opt-in; open an active MCP pairing tab for new requests, with no approval controls hidden in the popup. Manual connections are unchanged.

- Use Mode (Read only / Read and write) for both Automatic and Manual MCP connections; remove the redundant Allow page actions checkbox.

- Restore the Connect MCP link icon and show visible, specific feedback when a browser-internal page cannot be shared.

- Add Automatic MCP connections, bounded recovery and Pause/Resume while retaining Manual mode for existing users.
- Replace Connect MCP in Automatic mode with a compact AI: Off / Read / Write menu and per-tab arrow colors with tooltips.
- Share multiple tabs with explicitly paired trusted clients; discover authorized connection IDs and active tabs through MCP tools.
- Keep Automatic Read/Write attached to the selected tab across reloads and site changes without renewing expiry; new tabs start Off. Invalidate old document grants and snapshots on navigation; transport recovery still downgrades Write to Read.
- Use one Claude integration/version for Desktop and Code, with shared sources and client-specific installation manifests and credentials; update ChatGPT.


## 2.0.1 — unreleased

- Show the applied access mode on the MCP tab connection button without a separate write checkbox.
- Reconnect an active helper once after applying MCP settings, preserving permission checks and requiring new tab connections.
- Keep the helper and other clients connected when revoking or renaming one client, and bind tab grants to its credentials.

## 2.0.0 — unreleased

- Add optional local MCP integration for explicitly shared Chrome and Firefox tabs, with read-only and read/write modes, pairing, per-tab grants, action approvals, Stop and Revoke.
- Apply shared privacy filters, data controls and organization policies to MCP context and supported page actions.
- Add MCP settings and approval pages, local output previews, and a private ChatGPT desktop plugin with in-chat browser setup.

## 1.6.0

- Rename the extension to Page as Context with the popup subtitle "Structured browser context for AI."
- Rename internal branding and file formats while preserving the published extension ID and popup preferences.

- Close temporary save tabs quietly when Save As is cancelled, and keep genuine download failures distinct.

- Close the element picker after successful Copy or transfer to the save tab, while keeping failed exports available for retry.

- Add desktop keyboard shortcuts for Preview, Copy, Save and element selection, with browser shortcut settings in the popup footer.

- Add personal capture-site allowed/blocked lists for page, element and embedded-frame captures, combined with organization restrictions.

- Add independent enterprise restrictions on manual capture-history and technical-journal clearing, enforced in the interface and background.

- Add opt-in local capture-header history with configurable 1–365 day / 1–50 MiB retention, explicit export and managed settings locks.
- Keep Chrome element exports working when an additional extension context has no matching picker session.

- Add managed capture source allow/deny lists, mandatory metadata and form-value exclusions, and personal data controls across page and element exports.
- Add a private bounded local technical journal with logging levels, temporary personal Debug, configurable managed retention and explicit clearing.
- Add a diagnostics page and previewed JSON reports with opt-in journal inclusion, safe policy summaries and export restrictions.

- Add browser-managed enterprise policies for export destinations, formats, compression, redaction, element selection, Preview and Customize access, and personal preference saving.
- Support mandatory corporate redaction rules and forced on/off states for individual built-in filters without changing their matching definitions.
- Apply policy checks across capture and export routes, invalidate stale prepared context after policy changes, and make previews read-only when redaction is required.
- Show managed settings and administrator restrictions in the interface, and add deployment documentation and configuration templates for Chrome and Firefox.

- Prevent sensitive form values from leaking through ancestor names, custom ARIA textboxes and named field descendants.
- Match encoded URL parameter names in built-in and custom privacy filters while preserving unrelated URL text.
- Update Vite and override vulnerable shell-quote and source-map-js dependencies used by development tools.
- Resolve Chrome selections from the extension's retained isolated-world reference and verify node identity before export.
- Keep backticks and untrusted markup literal in Markdown field values and links.
- Share download handling across save pages and release pending operations on history erasure, cancellation or page unload.
- Add desktop element selection with preview, clipboard copy and file export for one selected block in Chrome and Firefox.
- Add an Element header to selected-block exports in both formats and at every compression level.
- Match the picker panel to the popup theme and keep it minimal while choosing a block.
- Simplify preview and filter pages, expand the editor to the available height and keep preview actions at the bottom.
- Replace non-English test examples while preserving Unicode coverage.

## 1.4.2

- Add compact Find and replace controls to Preview & edit, with literal text search, match counts, case matching, forward/backward navigation and replacement of one or all matches.
- Scroll the editor automatically to selected matches, including wrapped text and navigation after replacement.
- Support keyboard search shortcuts and prevent replacements that exceed the draft size limit.

## 1.4.1

- Move Preview & edit, Copy page context and Save to file above the popup preferences panel for quicker access.

## 1.4.0

- Add Regex filters using RE2JS, preset expressions, validation limits and migration of earlier token rule types.
- Add automatic email/domain, phone and English personal-field masking, plus full hiding for emails, phones, personal fields, payment card numbers and IBANs. Card and IBAN detection includes checksum validation.
- Apply full hiding before partial masking on overlapping original-text matches, independently of filter order.
- Restrict custom rules to configurable types and reject changes to automatic built-in definitions during import.
- Make the filters table responsive, reduce row and test-field heights, and describe automatic detection criteria.
- Add a live, capturable Demo with grouped examples for enabled filters and same-tab navigation that preserves unsaved filter drafts.
- Extend Try filters to test text, labelled fields, links, page titles and page URLs.
- Keep Customize compact on Firefox Android and dismiss the popup after Customize or Preview opens successfully.

## 1.3.0

- Improve Try filters with isolated selected-rule tests, independent matched-rule diagnostics, field-label results and synthetic matching/near-miss examples based on the selected type and current terms.

- Allow custom rules to reproduce every built-in detector: use one Rule type dropdown per row, editable literal names/prefixes and Duplicate actions. V7 import/export includes a catalog of code-defined types, accepts v1–6 files and splits older combined-mode rules without losing checks.
- Add Customize for redaction filters: toggle built-in groups, add literal text, Field labels or URL parameters rules with optional case matching and a shared ` / ` separator, test examples, and import/export filter files including built-in definitions. Unify exported matchingRule names and field order, and allow Case sensitive changes for built-in and custom rules. Saved filters apply locally to future exports when redaction is enabled.

- Add Preview: review prepared page context in a separate tab, edit it, reset changes, and copy or save the result. Show live counts with and without clipboard boundaries and the original compression reduction. Drafts stay in memory and disappear when the editor is closed or reloaded.

- License this release under GPL-3.0-only and add an offline license and source-code page. Previously distributed MIT versions retain their original license; bundled third-party notices are preserved.

## 1.1.0 — draft

- Capture eligible iframe documents in Chrome and Firefox while preserving their page positions and document boundaries.
- Capture available same-origin iframe documents by default in Firefox Desktop and Android.
- Add an optional Firefox switch for other-site frames with one request for access to all HTTP/HTTPS websites and access removal when disabled.
- Skip hidden frames and tracking pixels, apply shared capture limits, and report unavailable or changing documents.
- Keep Firefox popup content responsive and add extension branding to the file saving page.

- Keep Firefox Save files available after the Save As dialog closes the popup.
- Prevent sticky touch hover and show immediate button feedback after Android Compression changes.
- Show pressed button borders on Desktop without delaying release feedback.
- Use one Firefox package and stable add-on ID for Desktop 140+ and Android 142+.
- Request optional download permission only when Save is clicked on Firefox Desktop.
- Keep Android Copy-only and select responsive controls at runtime.
- Remove separate Android build and package commands.
- Update AMO source-package, submission, and manual verification instructions.

## 1.0.0

### Features

- On-demand local capture of semantic page content: Chrome accessibility-tree snapshots and Firefox HTML/ARIA extraction.
- Semantic Text and Markdown exports with Without, Detailed, Compact, and Maximum compression profiles.
- Clipboard export on all supported targets; local UTF-8 downloads on Desktop.
- Credential redaction enabled by default, persistent export preferences, export metrics, and browser/version attribution.
- Separate Android build with responsive controls and Copy-only export.

### Known limitations

- Android Save is unavailable because the downloads API is unsupported.
- Firefox capture approximates accessible names and excludes embedded frames, closed shadow roots, canvas pixels, CSS-generated content, and unmounted virtualized UI.
- Browser-internal and protected pages may reject capture; Chrome capture can conflict with another debugger connection.
- Redaction is heuristic; token counts are estimates. Review page content before sharing it with another service.
