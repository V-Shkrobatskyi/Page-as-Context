# Store listing text

Use these descriptions and permission explanations when creating or updating a
store listing. The description below targets the shared Firefox Desktop/Android
package; adjust browser-specific details when preparing a Chrome listing.

## Shared metadata

- Name: Page as Context
- Suggested category: Productivity (select the closest available category in each dashboard)
- Support email: copyascontext@gmail.com
- Support website: https://github.com/V-Shkrobatskyi/Page-as-Context/issues
- Homepage: https://github.com/V-Shkrobatskyi/Page-as-Context
- License: GNU General Public License v3.0 only (GPL-3.0-only)
- Privacy policy: https://github.com/V-Shkrobatskyi/Page-as-Context/blob/main/PRIVACY.md

## Short description

Structured browser context for AI.

## Description

Turn the current page into useful context for an AI conversation or local notes. Page as Context reads semantic page structure, processes it locally, and exports the result as Semantic Text or Markdown.

Choose Without, Detailed, Compact, or Maximum compression. Optional credential redaction is enabled by default. Save preferences for your next export and see character counts, rough token estimates, and context reduction.

Firefox Desktop supports clipboard export and local UTF-8 downloads. Firefox Android supports clipboard export; file downloads are unavailable. Both platforms use the same extension package. Desktop asks for download permission the first time Save is clicked. Firefox uses a separate extension tab to keep the file available while the Save As picker is open; that tab closes after success.

There is no LLM service, capture backend, analytics, or advertising integration. The extension does not upload captured page content to the developer. You decide whether to share the exported text with another application.

Firefox approximates HTML/ARIA semantics in the main document, supported open web components, and eligible embedded documents. Same-origin frames are captured by default. Include frames from other sites requests optional access to all HTTP/HTTPS websites in one prompt. Turning it off removes site access. Browser-internal and protected pages may deny access. Capture does not perform OCR or guarantee complete page coverage.

Firefox always omits password input values. Credential redaction is heuristic and may miss sensitive information. Review exports before sharing them; page text can include untrusted instructions aimed at AI assistants. Token estimates are not model-specific tokenization.

Voluntary developer-support links do not unlock functionality or affect export behavior.

Free software licensed under GNU GPL version 3 only. Personal and commercial use
are permitted. The extension's License page provides the full terms and links to
the corresponding source for the installed version. When publishing, add the
verified public `https://github.com/V-Shkrobatskyi/Page-as-Context/releases/tag/vX.Y.Z`
URL for that release; replace X.Y.Z with the submitted version.

## Permission justifications

| Permission | Explanation |
| --- | --- |
| debugger (Chrome) | Reads one Accessibility.getFullAXTree snapshot from the active page after the user requests Copy or Save; detaches after capture. No background browsing-history collection. |
| activeTab (Firefox) | Grants temporary access to the active page when the user opens the extension action. |
| scripting (Firefox) | Injects bounded HTML/ARIA collectors into the active document and eligible embedded documents for a requested export. |
| clipboardWrite | Writes the user-requested context export to the clipboard. |
| downloads (Firefox optional; Chrome required) | Saves the requested export as a local UTF-8 text or Markdown file. Firefox requests it only from the Desktop Save button; Android never requests it. |
| Optional HTTP/HTTPS site access (Firefox) | Includes frames from other sites after the user enables the option; access is removed when the option is disabled. |
| storage | Persists compression, format, and privacy preferences locally when requested. |

Broad persistent HTTP/HTTPS host access is optional, off by default, and requested only from Include frames from other sites. No remotely hosted executable code is used.

## Reviewer notes

Build instructions are in BUILDING.md; use Node.js 24.10.0, npm 11.6.0, and npm ci with the included lockfile. The submitted Firefox source archive must match the selected extension archive. No account, LLM key, login, or paid service is needed to use the extension.

Open a regular page containing a heading, list, and form controls. Open the extension from the browser action/menu, choose a profile and format, and copy into a local text editor. Desktop also supports Save to file. Firefox capture requires an action-granted activeTab permission; opening popup.html as a browser tab does not grant it.

For synthetic fixtures, serve tests/manual/firefox-dom-quality.html or tests/fixtures/quality/desktop-holdout.html locally as documented in the verification guides. Do not use personal browsing profiles for automated probes.

The manifest declares Firefox Desktop 140+ and Firefox Android 142+ under one
add-on ID. Download permission is optional and requested before capture only when
the user clicks Save on Desktop. Declining permission starts no capture or
download and leaves Copy usable. Android never requests downloads permission and
keeps Save unavailable, including if the runtime exposes a downloads stub.

Firefox Save runs in a separate extension tab so the local file remains available
when the picker closes the popup. The tab closes after successful completion;
on cancellation or failure it displays a generic error.

## Listing assets

Use the packaged icon and screenshots from the browser being listed. Show
Firefox Desktop and Android separately so Copy-only Android support is clear.
Keep private page content and account details out of screenshots. See the
[release guide](releasing.md) for store submission and artifact requirements.

## Rename deployment

Page as Context is the new name of Copy as Context. Update the existing store listings; do not create new listings or change the Firefox add-on ID. Repository, store and support links retain their current addresses until those external destinations are updated.

The `popup-settings` storage key is unchanged from version 1.1.0. Theme keys and portable filter formats were introduced after that release and now use the `page-as-context` prefix. Files from unpublished development builds must be exported with the new build or recreated.

## MCP disclosure update for the next store submission

Optional MCP shares filtered content from explicitly permitted tabs with an external client through a separately installed local helper. The client may transmit it to its model provider. Read and write adds browser-approved native-control interactions. No developer-hosted capture service or analytics is introduced. Declare optional nativeMessaging, the additional debugger/scripting use, and Firefox optional websiteContent/browsingActivity/personalCommunications transmission consent, plus websiteActivity for write mode. Alarms schedule bounded MCP reconnect and expiry work without page capture. Automatic mode supports shared-tab discovery without listing unshared tabs, per-tab Off/Read/Write, and independent trusted clients. Validate store forms and real consent prompts before publication; published store names and extension IDs are unchanged.
