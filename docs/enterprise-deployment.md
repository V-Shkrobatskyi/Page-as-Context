# Enterprise deployment

Page as Context can read administrator settings from `storage.managed`. This feature is part of the current development changes; do not assume an older store release supports these policies. Use a build that includes `managed-schema.json` and the policy enforcement code.

No application server, extension account, or company-specific build is required. Browser management delivers policy values; the extension enforces them. Personal preferences remain in `storage.local`. Never edit Chrome's internal profile files or import an ordinary filter file to establish administrator authority.

## Platform status

The implementation targets Chrome Desktop and Firefox Desktop. Automated tests cover policy evaluation, operation boundaries, UI state, and browser packaging. The supplied platform templates require a pilot on your actual managed browser and OS before production rollout. Real GPO, MDM, Google Admin, Linux and Firefox deployment checks are not certified by unit tests. See the [manual checklist](../tests/manual/enterprise-policies.md).

Firefox Android remains supported for ordinary extension use. Enterprise policy delivery on Android is not claimed. If a browser does not expose managed storage, the extension uses its ordinary mode. An empty policy set also uses ordinary mode. A failed read on a supported API blocks capture and export until a successful retry. Firefox's explicit `Managed storage manifest not found` response means no policy configuration, rather than a storage failure.

## Policy reference

Keys are case sensitive. A missing key leaves the corresponding behavior unchanged unless another policy constrains it. `PolicyVersion` is optional for partial deployments; use `1` in complete configurations. An unsupported version blocks capture and export. Unknown keys are ignored to allow future additions; verify spelling in `chrome://policy` or `about:policies`.

| Key | Type and accepted values | Meaning |
| --- | --- | --- |
| `PolicyVersion` | Integer `1` | Contract version. |
| `ElementPickerAllowed` | Boolean | Allow selecting an individual page element. Default: allowed on supported desktops. |
| `PreviewAllowed` | Boolean | Allow opening Preview & edit from popup or picker. False also blocks a directly opened or already open preview. Default: true. |
| `FilterSettingsAllowed` | Boolean | Allow opening Customize filter settings. False also blocks direct navigation, an already open settings page and personal filter saving. Filtering during capture still runs. Default: true. |
| `FileExportAllowed` | Boolean | Allow captured context and filter configuration downloads. Default: allowed. |
| `ClipboardExportAllowed` | Boolean | Allow copying context. Default: allowed. |
| `AllowedExportFormats` | Array of `semantic-text`, `markdown` | Limit format selection. Missing: both. Empty: export disabled. |
| `DefaultExportFormat` | `semantic-text` or `markdown` | Default when there is no permitted personal choice. Must be allowed. |
| `ForcedExportFormat` | `semantic-text` or `markdown` | Required format; must be allowed. |
| `AllowedCompressionLevels` | Array of `without`, `detailed`, `compact`, `maximum` | Limit compression selection. Missing: all. Empty: export disabled. |
| `DefaultCompression` | One of the compression levels above | Default when there is no permitted personal choice. Must be allowed. |
| `ForcedCompression` | One of the compression levels above | Required level; must be allowed. |
| `RedactionMode` | `user-controlled`, `force-on`, `force-off` | User choice, required redaction, or required disabled redaction. |
| `RequiredBuiltinFilters` | Array of built-in IDs below | Require original built-in matching behavior, including its original case setting. |
| `DisabledBuiltinFilters` | Array of built-in IDs below | Force selected built-ins off and prevent personal re-enabling. Must not overlap `RequiredBuiltinFilters`. |
| `ManagedRedactionRules` | Array of custom rules below | Required custom rules delivered by the administrator. |
| `UserRedactionRulesAllowed` | Boolean | Allow personal changes to built-ins and personal custom rules. False ignores stored personal modifications without deleting them. Default: true. |
| `UserPreferencesSaveAllowed` | Boolean | Allow saving personal popup preferences and personal filters. Default: true. |

For format and compression the order is: required value, permitted personal value, corporate default, extension default if permitted, then the first permitted value in the extension's stable order. Compression order is Without, Detailed, Compact, Maximum; format order is Semantic Text, Markdown. Contradictory forced/default values and allowed lists produce configuration errors.

Any required built-in filter or nonempty managed rule list implies `force-on` when `RedactionMode` is omitted. If it is present, it must be `force-on` in this case. `force-off` and `user-controlled` conflict with required rules. `force-on` also makes previews read-only: field-aware filtering cannot safely be repeated on arbitrary manually edited serialized text.

`UserPreferencesSaveAllowed: false` does not force a particular format or compression. Temporary choices remain available within the allowed values. When saving is allowed, only editable preferences are saved. Required values never overwrite a user's personal preferences. Removing a policy restores any still-permitted personal choice.

Preview and filter-settings access are independent of export permissions and required redaction. Denying Customize does not turn off filtering. Denying Preview does not prevent direct Copy or Save when those actions are allowed.

File and clipboard permissions are independent. If both are false, capture, preview and element selection are disabled. A single allowed format/level is shown without allowing changes. The interface displays `Managed by your organization` and explanations for unavailable controls.

## Built-in filter IDs

Use IDs, rather than display labels:

- `sensitive-fields`, `authorization`, `jwt`, `github`, `aws`, `openai`, `assignments`, `query-values`
- `email-mask-domain`, `email-hide`
- `phone-mask`, `phone-numbers`, `payment-cards`, `iban`
- `personal-fields-mask`, `personal-fields`

Administrators can force each built-in on with `RequiredBuiltinFilters` or off with `DisabledBuiltinFilters`. These policies change only the on/off state, without accepting changes to matching rules or case settings. Managed rows show their effective state and are read-only, even if personal customization is otherwise allowed. A filter in both lists is a configuration error that blocks export. Missing or empty lists impose no corresponding on/off restrictions.

For example, replace partial email/phone masking with full hiding:

```json
{
  "RequiredBuiltinFilters": ["email-hide", "phone-numbers"],
  "DisabledBuiltinFilters": ["email-mask-domain", "phone-mask"]
}
```

Unlisted built-ins retain personal settings, or extension defaults when personal customization is disabled. To define an exact complete set, explicitly list every built-in as on or off. Disabled built-ins remain off through personal import/reset/save and demo drafts. Disabling a built-in does not prohibit another enabled rule from matching the same content. A disabled-only list does not force redaction on; use `RedactionMode: force-on` when redaction must run. Removing policies restores preserved personal choices.

The [packaged Chrome schema](../public/managed-schema.json) contains the supported ID list. Required built-ins use their original semantics, regardless of saved disable flags and case overrides. Other built-ins follow personal preferences, or standard defaults when personal modifications are prohibited. This retains the existing masking/full-hiding precedence.

## Corporate custom rules

Supply rules as structured objects, not an escaped JSON string inside `ManagedRedactionRules`:

```json
{
  "PolicyVersion": 1,
  "RedactionMode": "force-on",
  "ManagedRedactionRules": [
    {
      "id": "internal-project",
      "name": "Internal project name",
      "type": "text",
      "text": "SYNTHETIC_PROJECT_NAME",
      "caseSensitive": false,
      "enabled": true
    }
  ],
  "UserRedactionRulesAllowed": true
}
```

All six fields are required. IDs must be unique within the managed list and match `[a-zA-Z0-9_-]{1,64}`. Names must be nonempty and at most 80 characters. `enabled` must be true. Supported types: `text`, `literalText`, `fieldLabels`, `fieldWords`, `urlParameters`, `regex`, `authorization`, `jwt`, `assignedSecrets`.

Literal alternatives are separated by ` / ` (space, slash, space). `literalText` uses the whole text as one literal. `urlParameters` takes parameter names without `?`, `&`, `=`, `#`, tabs or line breaks. Regex uses the extension's existing RE2-compatible engine, without executable code, delimiters or flags. Use `caseSensitive` for case matching.

The combined managed and personal custom-rule budget is 400 rules and 131072 text characters. Each literal rule is limited to 256 characters and each Regex to 4096. Exceeding combined limits or receiving an invalid required rule blocks preparation; the extension does not silently omit corporate rules. When personal rules are prohibited, old personal settings are not loaded or applied. When allowed, personal rules supplement required rules. Corporate rules appear separately and read-only, and do not become part of personal imports, resets, saved files or demo drafts.

## Configuration presets

These files contain extension policy values, without platform wrappers:

- [Built-in on/off example](enterprise/builtin-filters.json): force full email/phone hiding and disable partial masking.
- [Recommended defaults](enterprise/recommended.json): Markdown and Compact, with user choice.
- [Required redaction](enterprise/required-redaction.json): corporate rules plus permitted personal additions.
- [Strict](enterprise/strict.json): Semantic Text, Compact, required redaction, no element picker, preview, filter settings or files, and no personal customization/saving.

Keep the JSON in your organization's configuration repository and deliver it through existing management tooling. Do not put confidential rule text or real credentials in public configuration examples. No remote filter URL is used by the extension.

## Chrome deployment

Use the actual extension ID from `chrome://extensions`. The published Chrome Web Store ID linked from this repository is `ghkjolcdeccimnjhdebaklffpekfmojd`; development unpacked builds may have a different ID. Replace `REPLACE_WITH_CHROME_EXTENSION_ID` in the templates. Do not deliver policies to the store ID when testing a different unpacked ID.

### Google Admin console

Select the extension under Chrome Apps & extensions for a pilot organizational unit/group, and configure **Policy for extensions**. Use [chrome-admin-console.json](enterprise/chrome-admin-console.json), which wraps each policy value in `{"Value": ...}`. This wrapper belongs to the Admin console format; it must not be copied into Linux policy files or native OS policy values. Confirm the resulting extension policies appear with their actual values in `chrome://policy` after delivery.

See [Google's extension configuration guide](https://support.google.com/chrome/a/answer/6177447?hl=en) and [Chromium's extension policy examples](https://www.chromium.org/administrators/configuring-policy-for-extensions/).

### Windows

Use GPO/your endpoint management system to provision values under:

```text
HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\REPLACE_WITH_CHROME_EXTENSION_ID\policy
```

[chrome-windows.reg](enterprise/chrome-windows.reg) is a strict-policy template using DWORDs for booleans/integers, strings for enum values, and numbered string values in subkeys for lists. Replace the extension ID before importing in a pilot environment. HKCU is another supported scope; choose the scope according to your organization's browser policy precedence. Complex rule lists require corresponding nested registry keys; do not assume a raw REG_SZ JSON blob is interpreted as an object by Chrome. For large rule sets, use a management channel that supports structured extension policies.

### macOS

Deploy [chrome-macos.mobileconfig](enterprise/chrome-macos.mobileconfig) through your MDM after replacing the extension ID and assigning your own profile identifiers/UUIDs. It uses the `com.apple.ManagedClient.preferences` payload, the preference domain `com.google.Chrome.extensions.<extension-id>`, and `Forced`/`mcx_preference_settings`. Add structured rules under that preference dictionary when needed. Do not write a JSON file into a Chrome user profile. Existing organization profiles and their precedence still apply.

### Linux

Use [chrome-linux.json](enterprise/chrome-linux.json), with this structure:

```json
{
  "3rdparty": {
    "extensions": {
      "REPLACE_WITH_CHROME_EXTENSION_ID": {
        "PolicyVersion": 1,
        "FileExportAllowed": false,
        "RedactionMode": "force-on"
      }
    }
  }
}
```

Provision the file under `/etc/opt/chrome/policies/managed/` for Google Chrome or `/etc/chromium/policies/managed/` for Chromium, with permissions controlled by the administrator. Merge with existing policy files deliberately to avoid conflicting configuration.

### Prevent disabling or removal

The extension's own policies govern its features. To require installation and prevent disabling/removal, separately configure Chrome's `ExtensionSettings` with `installation_mode: force_installed` and the appropriate update URL. Review developer-mode, alternate-browser and device controls under your organization's existing management policy. See [Google's installation-policy documentation](https://support.google.com/chrome/a/answer/7532015?hl=en).

## Firefox Desktop deployment

Use [firefox-policies.json](enterprise/firefox-policies.json) as a `distribution/policies.json` template or provision equivalent enterprise policies. The structure is `policies` → `3rdparty` → `Extensions` → `{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}` → our policy values. The Firefox ID is defined in the manifest and differs from the Chrome ID.

Firefox does not use Chrome's `managed_schema`; the extension validates values itself. Prefer `3rdparty` enterprise policies to user-editable native manifests for enforced corporate settings. For Windows GPO/Intune or macOS, follow Mozilla's current instructions for delivering JSON configuration with correct value types; do not assume Chrome registry encodings also work in Firefox. See [Mozilla's 3rdparty reference](https://firefox-admin-docs.mozilla.org/reference/policies/3rdparty/) and [managed storage documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/managed).

## Updates, recovery and diagnostics

1. Deliver policies to a pilot scope and inspect `chrome://policy` (Chrome) or `about:policies` (Firefox).
2. Verify the extension ID, policy scope and every expected key/value. Chrome may discard schema-invalid values before the extension can see them. An absent value is indistinguishable from an intentionally omitted policy to the extension; do not treat an unvalidated deployment as protection.
3. Open the popup and confirm the management indicator, required values, blocked actions and read-only organization filters. Check popup, picker, preview and Firefox save separately.
4. Keep a preview open, change the policies, then attempt export. It must require a newly prepared context. Active picker sessions close on managed storage changes. No pending operation should silently use an older policy revision.
5. On a read/configuration failure, use **Retry organization policies**, **Reload organization policies**, or **Reload saved** on the relevant page. Errors identify policy keys without including rule content. Background capture diagnostics report the `policy-blocked` code without page content.
6. To roll back, remove/change the delivered policy through the same administrator channel and verify the result. Do not clear user preferences as a workaround. Old prepared results must be prepared again after policy removal too.

Policy revisions are SHA-256 fingerprints of the normalized configuration; captured text and rule text are not transported as revision metadata. An operation rechecks current policies before preparing/exporting. A clipboard write or download already handed to the browser cannot be recalled. Browser policy delivery latency and updates that occur after the final permission check are subject to the browser's scheduling.

## Security boundaries

This controls Page as Context in the managed browser. It does not stop manual page copying, another browser, a modified extension, an administrator of the operating system, or pasting allowed clipboard content into a text editor and saving it. It does not restrict where copied data is pasted. Redaction is heuristic and cannot guarantee discovery of every secret or personal value. Use browser/device management and organizational DLP for broader requirements.

## Source, data and diagnostic policies

These are additive version 1 fields. Deploy them only with a build that supports this feature; older builds ignore unknown fields. See [data controls and diagnostics](data-controls-and-diagnostics.md) and the [synthetic preset](enterprise/data-controls.json).

| Policy | Type | Behavior |
| --- | --- | --- |
| `AllowedCaptureSources` | Array of origin patterns | Missing: no allowlist. Empty: reject all external sources. Maximum 500 entries, 512 characters each. |
| `BlockedCaptureSources` | Array of origin patterns | Deny takes priority over allow. Same limits. |
| `IncludePageTitle` | Boolean | False excludes main/nested document titles. Default: true. |
| `PageUrlMode` | `full`, `without-query`, `origin`, `omit` | Minimum exclusion of document URL metadata, in increasing strictness. Default: full. |
| `LinkUrlMode` | `full`, `without-query`, `omit` | Minimum exclusion of structured link URLs. Default: full. |
| `IncludeFormValues` | Boolean | False excludes current values, editable descendants and checked/selected states. Default: true. |
| `LoggingLevel` | `off`, `error`, `info`, `debug` | Force the local technical journal level. Missing: personal choice, default Error. Managed Debug remains active until policy changes. |
| `LogMaxEvents` | Integer 1–1000 | Maximum retained event count. Default: 1000. |
| `LogMaxBytes` | Integer 2–2097152 | Maximum serialized event bytes. Default: 2 MiB. |
| `TechnicalLogClearAllowed` | Boolean | False blocks manual journal clearing in the UI and background. Default: true. Automatic retention continues. |
| `LogMaxAgeHours` | Integer 1–168 | Maximum retained age. Default: seven days. |

Patterns are `http://host`, `https://host` or `*://host`, optionally with `*.` before the hostname (includes both the base host and its subdomains), and optionally with `:port` or `:*`. Examples: `https://example.test`, `https://*.example.test:8443`, `*://localhost:*`. An omitted port matches only the scheme's standard port; `:*` matches all ports. With wildcard scheme and an explicit numeric port, that port matches literally. A single final `/` is accepted and normalized away. There are no path/query/fragment patterns, credentials, `<all_urls>` or regular expressions. Hostnames use URL/IDN normalization, case folding and terminal-dot normalization; matching respects hostname boundaries. Duplicate patterns are collapsed.

When any nonempty deny list or an allowlist is present, external capture supports only HTTP/HTTPS origins and nested blob documents with a known HTTP/HTTPS origin. `file:`, `data:`, `about:blank`, `srcdoc`, sandboxed opaque origins and unknown origins are blocked conservatively; inherited origins are not guessed. Without source rules, current browser capture behavior is preserved. The exact extension-owned synthetic filter demo remains available as an internal scenario, with data exclusions still applied. This exception cannot target an external page.

Users can add personal source restrictions in Data controls. A source must satisfy both personal and organization allowed lists, and either blocked list takes priority. Personal settings cannot override organization restrictions; `UserPreferencesSaveAllowed=false` prevents personal changes. Source/data changes invalidate prepared content. Mandatory data exclusions operate even with redaction forced off. A personal preference can be stricter than the organization setting. Forced exclusions make Preview read-only. `FileExportAllowed` and `ClipboardExportAllowed` also apply to diagnostic JSON exports; diagnostics viewing is always separate from Preview/Customize and context format restrictions. `UserPreferencesSaveAllowed` covers saved data and logging choices as well as popup/filter preferences.

## Optional capture metadata history

History is off by default and independent of the content-free technical journal. See [history behavior and privacy boundaries](data-controls-and-diagnostics.md#optional-capture-history).

| Policy | Type | Behavior |
| --- | --- | --- |
| `CaptureHistoryEnabled` | Boolean | Force local capture-header history on/off. Missing: personal choice, default off. |
| `CaptureHistoryRetentionDays` | Integer 1–365 | Force the retention period. Missing: personal choice, default 60 days. |
| `CaptureHistoryMaxMiB` | Integer 1–50 | Force the compact JSON byte limit in MiB. Missing: personal choice, default 10 MiB. |
| `CaptureHistoryClearAllowed` | Boolean | False blocks manual history clearing in the UI and background. Default: true. Automatic retention continues. |
| `CaptureHistorySettingsLocked` | Boolean | Lock all history settings. Unspecified locked values use defaults. Default: false. |

Each explicitly supplied value is mandatory. With no full lock, users can change fields the administrator has not supplied. `UserPreferencesSaveAllowed=false` also prevents saving history preferences. Clear history remains available unless `CaptureHistoryClearAllowed=false`. To prevent users from shortening retention, lock history settings as well. Neither clear permission blocks viewing the diagnostics page. Retention removes oldest entries at the first time/size/count limit; changing limits can delete older entries. Metadata exclusions and required corporate redaction apply to existing history on access as well as future captures. History never enters technical diagnostic reports automatically and exports honor file/clipboard restrictions. These policies do not make the local database an immutable audit log.

Example, in the usual browser-specific wrapper:

```json
{
  "CaptureHistoryEnabled": true,
  "CaptureHistoryRetentionDays": 120,
  "CaptureHistoryMaxMiB": 20,
  "CaptureHistorySettingsLocked": true,
  "CaptureHistoryClearAllowed": false,
  "TechnicalLogClearAllowed": false
}
```

## MCP access (separate external channel)

[MCP setup and migration](mcp-integration.md) describes the local helper.
`McpAllowed=false` disables the feature. `McpAllowedModes:["read-only"]` excludes
all writes. Allowing read-write never automatically grants interaction:
users must explicitly connect a tab with write access. `McpAllowedActions` limits
the four native-control operations. Without `McpWriteApproval`, users can choose
per-action or bounded connection approval; the user default is per-action.
Set `McpWriteApproval="each-action"` to require approval for every action;
`session` permits a user's bounded connection approval without forcing it. Stop/Revoke stay available
when settings are locked. Grant TTL defaults to 30 minutes (maximum policy
range 1–480); sanitized tool responses default to 4096 KiB (range 64–16384,
also bounded by transport). `McpAllowedClientIds` contains provisioned credential
IDs, not self-declared client names. Empty client/source/mode/action allowlists
deny their respective capability. Additional MCP source rules intersect global
and personal rules; they never expand access.

Clipboard/File export permissions do not control MCP. Use `McpAllowed` for that
channel. `PreviewAllowed` and `McpTestAllowed` control local output tests;
mandatory filters, exclusions, format/compression restrictions, preference save
policy and source rules remain effective in every channel. An incompatible
forced Maximum with write addressing fails closed. Policy/settings changes
invalidate refs and unsent results. See [the read-only preset](enterprise/mcp-read-only.json).
