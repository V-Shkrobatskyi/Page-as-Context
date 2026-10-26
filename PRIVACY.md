# Privacy policy for Page as Context

Last updated: 2026-10-26. Applies to version 2.0.0.

## Purpose and local processing

Page as Context exports semantic content from the active page for your AI conversations or notes. Capture, compression, credential redaction, and serialization run locally on your device after you request an export. The extension has no capture backend, analytics, advertising SDK, or LLM API integration.

## Information processed

An export can contain page text, title, URL, accessible labels, semantic roles, form values and states, capture time, browser/platform/version metadata when available, and the extension version and selected settings. This information can include personal or sensitive information present on the page. Chrome reads accessibility-tree snapshots of the main document and eligible embedded documents; Firefox reads HTML/ARIA semantics. Both browser builds omit password input values, including values in captured embedded documents.

The extension uses this information to create requested exports or respond to an explicitly authorized MCP connection. It does not monitor your browsing history in the background or upload captured pages to the developer.

## Storage and retention

Personal capture-site allowed/blocked lists are stored locally as preferences. They can only add restrictions to organization policy. Actual site lists are excluded from diagnostic JSON reports. They restrict future captures and do not erase existing history.

Capture history is a separate, optional feature, off by default. If you or your organization enable it, the extension keeps captured headers (title, URL, browser, capture time, page/selection scope, selected element tag, extension version and compact export settings), without page/element contents. URL credentials are removed; data exclusions and redaction apply. Titles and full URLs can still contain sensitive information. Private/incognito tabs and the synthetic demo are excluded. Defaults are 60 days and 10 MiB of compact JSON, configurable from 1–365 days and 1–50 MiB, with a further 100,000-entry safety limit. Oldest records expire during history access. History is held in a separate local IndexedDB database. Off stops new records; Clear history removes retained records unless your organization prohibits manual clearing. You may explicitly copy or save its JSON, subject to organization restrictions. History is never included in the technical diagnostic report, uploaded or synchronized automatically. Administrators can enforce values and lock settings. Existing records are sanitized when current restrictions require more metadata removal; deleted data is not restored.

The extension also stores your personal data controls and a bounded local technical journal. The default journal level is Error. Events contain fixed technical codes, timestamps, optional temporary random operation IDs, duration and repeat counts, without page content, URLs, titles, field values, filenames, rule text or raw errors. The journal is stored in extension-origin IndexedDB, with default limits of 1000 events, 2 MiB of serialized event data and seven days; an administrator can lower the limits or set the logging level. Expired entries are removed during journal access. Personal Debug expires after 30 minutes, including across restart. Off stops new entries; Clear journal deletes retained entries unless your organization prohibits manual clearing. Automatic retention continues under these restrictions. Storage and browser shutdown can lose recent entries. No journal is uploaded automatically.

Diagnostics previews a versioned report of local runtime capabilities, safe policy status, restriction flags and counts, effective settings and journal usage. It excludes internal source lists and rule text. Journal events are included only by explicit choice. You choose whether to copy/save this JSON; organization export restrictions apply. The journal is a troubleshooting aid, not browsing history, stored copied content or tamper-proof audit evidence.


The extension persists your compression, format, and privacy preferences in browser-local extension storage when you choose Save preferences. It does not maintain a persistent archive of captured pages. Capture data is held temporarily for processing; runtime and browser cleanup determine when memory is reclaimed.

Preview holds the prepared context, its initial text for Reset, and your edits only in the editor tab's memory. The extension does not persist drafts or put captured text in preview URLs. Closing or reloading the tab loses the draft. Manual edits are not automatically checked for sensitive data. Opening a preview does not write to the clipboard; Copy does so only when you choose it.

Desktop Select element keeps one temporary element reference and an opaque marker on the chosen page during selection and export. The choice is not saved as a site rule or browsing record. The session ends on cancellation, navigation, disconnection, or after five minutes. Chrome uses temporary DOM descriptions to identify the chosen block and filters its bounded accessibility snapshot before export; Firefox captures the chosen DOM subtree. Accessible names can include labels outside the chosen block. Existing redaction settings apply before copying, saving, or opening Preview.

Redaction filter settings, including custom literal text, are stored in browser-local extension storage when you choose Save filters. Sample text and test results stay only in the settings tab and are not saved. Filter JSON exports contain your custom text; review them before sharing. Filters are not automatically synchronized or downloaded from external lists.

Copy places the result on your clipboard. Desktop Save writes a UTF-8 file to a destination controlled by your browser. Clipboard history, operating-system clipboard synchronization, browser download history, backups, and destination applications may retain copies under their own settings. Android supports Copy only.

You can change saved preferences in the popup or remove extension-local preferences by clearing the extension's data or uninstalling it. Delete exported files and clipboard/history entries separately using your browser, operating system, or destination application.

## Optional MCP integration

MCP is disabled by default. Enabling it, approving a local client and connecting
one tab allows that client to request filtered page context until access expires
or is revoked. The separately installed helper uses private local IPC and Native
Messaging. The AI client may forward the context to its model provider. A local
connection does not imply a local model. Previously delivered data cannot be
recalled.

Read and write additionally requires an explicit browser-side grant. Actions use
short-lived references and browser approval by default. Native-control click,
fill, selection and checkbox operations can submit data or cause irreversible
site changes. Entered values are not saved in approval history or diagnostics.
Post-action context is subject to the same filters and data controls as reads.
Transient references, operation receipts and page payloads are not persisted.
Pairing stores credential hashes in extension-local storage; the helper keeps
credentials in protected local files. Stop/revoke clears live grants and refs;
restarts never restore them. The helper retains credential files on uninstall
for explicit user removal. The extension has no developer-hosted MCP backend.

Firefox separately requests optional consent for website content, browsing
activity and personal communications sent to the helper, plus website activity in write mode. Declining or revoking
these permissions blocks MCP transmission while ordinary export remains usable.

## Sharing and external services

The extension does not send captured page content, URLs, or preferences to the developer, sell user data, or use it for advertising. You decide whether to paste or upload an export into another application; that application then handles it under its own policies.

Help, project, contact, and voluntary donation links are opened only when you choose them. GitHub, your email provider, and the payment provider may receive normal navigation/contact/payment information under their own privacy policies. Capture data is not attached to these links.

If you email a bug report or post a GitHub issue, the recipient/service receives the information you provide and may retain it for support. Do not include passwords, tokens, or private page content. Contact the developer to request deletion of information you sent directly; public GitHub content is also governed by GitHub's controls and policies.

## Permissions

- Chrome debugger: briefly reads the active page and eligible embedded documents after an export action or authorized MCP request, checks frame visibility and password input types, and detaches afterward.
- activeTab and scripting: obtain temporary page access and install the Desktop element picker on demand in both browsers. Firefox also uses these permissions to capture the current page and permitted embedded documents.
- Firefox optional site access: Include frames from other sites is off by default. Enabling it requests access to all HTTP/HTTPS websites in one browser prompt. The permission persists across tabs and browser restarts; turning the option off removes site access, including earlier individual host grants. Ordinary capture follows an explicit Copy, Preview or Desktop Save action; authorized MCP reads follow the separately granted connection. Protected frames may remain unavailable.
- clipboardWrite: writes the export you request to your clipboard.
- downloads (Desktop only): saves the export you request as a local file. In Firefox, this permission is optional and requested when you click Save; Android never requests it.
- nativeMessaging (optional): connects only to the separately installed local helper after explicit MCP enablement and consent.
- storage: persists export preferences and redaction filter settings locally.

Persistent access to all HTTP/HTTPS websites is optional and requested only when you enable Include frames from other sites in Firefox.

## Security and redaction

Credential redaction is enabled by default and replaces detected credential patterns before export. It is heuristic and cannot guarantee that all credentials or personal information are removed. Disabling redaction can expose original values. Review the output before sharing it. Page content is untrusted; the extension does not guarantee removal of instructions aimed at AI assistants.

Local diagnostics contain operational information such as capture status, root role, warning codes, and failure information; they do not log raw page text or the exported context.

## Chrome Web Store Limited Use

Page as Context uses information obtained through browser permissions solely for its user-requested page-context export feature. Its use of that information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension does not transfer captured data to the developer or third parties, use it for personalized advertising, or give the developer access to your captures.

## Changes and contact

Changes to data handling will be reflected in this policy with an updated date. The policy is included in the extension and maintained in the project repository.

For privacy questions, contact [copyascontext@gmail.com](mailto:copyascontext@gmail.com) or visit the [project repository](https://github.com/V-Shkrobatskyi/Copy-as-Context). Avoid sharing sensitive exports in public issues.
