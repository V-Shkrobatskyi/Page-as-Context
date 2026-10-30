# Data controls and local diagnostics

Open **Data controls** from the popup. This page is available even when your organization disables Customize or Preview. It does not grant access to those tools.

## Export data settings

You can exclude document titles, reduce document URLs to an origin or remove them, strip query strings and fragments from structured link URLs, and exclude current form values. Save personal data settings to apply them to future captures. Defaults preserve the existing export. Organization restrictions are minimum exclusions: a personal choice may remove more information, but cannot restore information an administrator excludes. Removing organization policy restores your saved personal choice.

Changing data settings or source policy invalidates prepared results in preview and save transfers. Prepare context again. Managed exclusions make preview read-only, including find/replace and Reset. Personal exclusions do not prevent you from manually adding text in preview. Existing mandatory redaction rules still apply independently.

Exclusions run on the normalized tree before compression, optional credential redaction and serialization, including Maximum dictionaries and reduction counters. Titles include nested document titles. Link settings affect structured URL attributes, not arbitrary addresses written in page text. Reduced HTTP/HTTPS/file links lose query, fragment and credentials; origin mode omits local file URLs. Non-web structured links such as `mailto:` and `tel:` are excluded in reduced/excluded modes. A title or URL header may show its usual unavailable placeholder after exclusion.

With form values disabled, labels and control roles remain. Input, textarea, select/listbox values, editable text, slider/spinbutton values and checked/selected states are excluded; control descendants are omitted to avoid repeated values. This includes a picked descendant of editable content. Button captions remain useful labels. Custom widgets that do not expose editable/control semantics can still appear as ordinary page text. Password input values remain excluded independently of the new setting. Chrome's browser-supplied raw accessibility response can contain control values before the adapter removes them; the extension cannot promise that Chrome never produces those raw values internally.

## Capture source restrictions

In **Capture sources**, save personal **Blocked sites**, or enable **Only allow these sites** and supply an allowed list. Both lists start empty with the allowed-list switch off, preserving ordinary capture. An enabled empty allowed list blocks all external captures; a disabled allowed list is retained for later use but does not restrict capture. Each list accepts at most 500 origin patterns of at most 512 characters, one per line. Examples: `https://example.com`, `https://*.example.com` (the base domain and subdomains), `*://example.com`, or `https://example.com:8443`. A single final `/` is optional and removed on save, so `https://example.com/` and `https://example.com` are equivalent in both lists. Paths such as `/html/`, query strings, fragments, credentials and regular expressions are not accepted. Optional `:*` matches any port; omitted ports mean the scheme's standard port.

Personal and organization rules are checked independently: a source must pass both allowed lists, and a match in either blocked list rejects it. Clearing personal lists cannot relax organization restrictions. `UserPreferencesSaveAllowed=false` prevents saving personal site settings but keeps existing personal restrictions active. Site settings are local preferences, and actual domain lists never enter the diagnostic JSON report. Invalid/unreadable saved settings block capture until explicitly replaced with valid settings.

Changes invalidate prepared previews/save transfers and close the picker through the shared settings revision. The same rules apply to page capture, selected elements and embedded documents. They govern future captures; existing history records are not removed by changing site restrictions. When source restrictions are active, unsupported or opaque origins are omitted or blocked conservatively, including local file URLs. The extension-owned synthetic filter demo remains available.

See the [policy reference](enterprise-deployment.md) and [example](enterprise/data-controls.json). A forbidden main document is rejected before content capture. A forbidden nested document and its descendants are omitted, with a generic warning. An omitted frame does not expose its label or address in the export. Browser permissions remain separate from organization rules.

Rules address document origins, not where every sentence in a page originally came from. Content already incorporated into an allowed document, including script-provided text, remains within that document's capture. Chrome can include incidental embedded nodes in a raw AX response; normalized output removes excluded document boundaries. These controls are not universal DLP and do not govern other applications.

## Local technical journal

The default level is **Error**. **Info** adds successful technical outcomes; **Debug** adds operation starts. **Off** stops new entries and retains existing entries until expiry or Clear journal. Personal Debug lasts 30 minutes, is checked again after restart, and falls back to Error when its expiry is invalid or past. An administrator can force a level; managed Debug remains active until policy changes. `UserPreferencesSaveAllowed=false` prevents saving both data and logging preferences. Clearing the journal remains available unless `TechnicalLogClearAllowed=false`.

The background owns a bounded queue and serializes journal updates in extension-origin IndexedDB. It is not stored in synchronized storage or the local storage area exposed to content scripts. Only approved extension pages can send validated technical events or request diagnostics. Picker content scripts can acknowledge known operations; they cannot read or append arbitrary journal entries.

Each event contains a format version, UTC epoch time (displayed locally), component, fixed event/result/reason codes, optional temporary random operation ID, bounded duration and repeat count. It never accepts page content, trees, URL/title/hostname, field values, copied text, previews, filenames, filter text, raw errors or stack traces. Repeated adjacent outcomes are aggregated for one minute. The writer accepts at most 64 queued operations and batches up to 32 events per write, with at most two event batches in flight. Excess events are dropped without delaying capture/export. Defaults retain at most 1000 events, 2 MiB of serialized event data and seven days, whichever limit is reached first. Administrators may lower these limits. Entries expire during journal reads and writes; no periodic browsing monitor runs. The page shows count and serialized event bytes, not the browser database's physical disk usage.

Storage failure or logging overload does not fail a permitted capture, copy or save. When policy/settings cannot be read, new journal writes are skipped rather than guessing a managed logging level. There is no recursive logging of logger errors. The most recent events can be lost when the browser terminates. The device owner can modify local storage; the journal is not a tamper-proof audit record or a content-export history.

## Diagnostic report

The page previews a versioned JSON report containing extension/browser/platform information, basic capability availability, safe policy status, restriction flags, rule/source counts, effective settings with their sources, and journal usage. It excludes actual source lists, organization rule text, policy hashes and page data. A policy load failure appears as a safe status code and keeps exports blocked.

Journal events enter the report only when you check **Include technical journal in report**. Copy and Save are explicit local actions. Organization clipboard/file restrictions also apply to the report, independently of allowed context formats and compression levels. The report stays visible when export is disabled. Save is unavailable on Firefox Android; Copy remains available when permitted. Nothing is uploaded or attached to a support request automatically.

## Verification scope

Automated tests cover source normalization, pre-capture rejection, mandatory data exclusions, stale configuration, journal bounds/expiry/concurrency/failure, message authentication and report fields. The [manual checklist](../tests/manual/enterprise-policies.md) covers managed deployment channels, screen readers, live iframe behavior and device-specific permissions. A successful build does not verify an MDM/GPO delivery channel or a physical Android device.

## Optional capture history

Capture history is separate from the technical journal and is **off by default**. Enable it explicitly in Data controls. Defaults are 60 days and 10 MiB, with manually configurable integer ranges of **1–365 days** and **1–50 MiB**. Both are limits: oldest records are removed when either is reached. The limit measures the UTF-8 bytes of the compact JSON export, including its envelope; browser database disk usage can be larger. An additional 100,000-entry safety limit bounds processing. Browser quota failures never block capture or export.

A record is created after successful context preparation, including preparation for Preview, regardless of whether the later copy/save succeeds. It contains only the header's title, URL, browser, captured time, page/selection scope and, for selection, the element tag. New records also keep the original `extensionVersion` and `exportSettings` suffix from the attribution line (for example, `2.1.0` and `/5/d`). These identify the compression/redaction profile and default/modified filters without storing rule text. Existing records without these fields remain unchanged; the current version is never substituted for an unknown historical version. It does not store content, DOM, AX trees, element text, selectors, screenshots or edited preview text. Private/incognito tabs and the synthetic filter demo are excluded. URL credentials are always removed. Data exclusions and the capture's redaction setting apply before recording; current exclusions and required corporate redaction also apply when accessing existing records, permanently removing newly prohibited metadata.

History stays in a separate extension-origin IndexedDB database. Content scripts cannot append arbitrary entries or read it. There is no automatic file, upload or sync. View recent captures shows up to 10 entries; Copy history JSON / Save history JSON explicitly export all retained entries, subject to clipboard/file restrictions. Technical diagnostic reports never include history, even when their technical-journal checkbox is selected. Off stops new records and retains existing records until expiry or Clear history. Expiry is processed on history reads/writes. Clear history remains available independently of settings locks unless `CaptureHistoryClearAllowed=false`.

Administrators can force individual values with `CaptureHistoryEnabled`, `CaptureHistoryRetentionDays` and `CaptureHistoryMaxMiB`. Unspecified fields remain personal. `CaptureHistorySettingsLocked=true` locks all history settings; unspecified locked values use the defaults. `UserPreferencesSaveAllowed=false` also prevents personal changes. Personal choices behind forced values remain stored and return after policy removal; data removed by retention or sanitization cannot return. Local history can be cleared or modified by the device owner and is not a tamper-proof corporate audit trail.

## Organization restrictions on manual clearing

`CaptureHistoryClearAllowed=false` disables Clear history; `TechnicalLogClearAllowed=false` independently disables Clear journal. Both default to true when absent. The page remains accessible, with an explanation beside disabled actions. The background checks current policy inside the serialized clear operation, so a direct message or a stale page cannot bypass the restriction. Policy-read failures block manual clearing. Automatic expiry, size/count pruning and required metadata sanitization continue. Removing the policy restores manual clearing.

To prevent users from shortening history retention through settings, also set `CaptureHistorySettingsLocked=true` and specify the required retention values. Clear permissions alone do not lock settings. These controls apply to extension actions; they do not prevent the device owner from removing extension data or uninstalling the extension.

## MCP tab discovery

Automatic connection does not capture pages on startup. MCP discovery returns
only already-shared tabs for the authenticated client. It respects title
exclusions and active redaction filters and returns no raw page URLs. Connection
mode, shared-client membership and Pause state are preferences; snapshots and
page payloads are never saved there. Retry/expiry alarms schedule lifecycle work
without reading page content. See [MCP integration](mcp-integration.md).
