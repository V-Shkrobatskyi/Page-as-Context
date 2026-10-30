# Changelog

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
