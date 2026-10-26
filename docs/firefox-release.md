# Firefox Add-ons publication

The Firefox build supports Desktop and Android with one package and one add-on ID.
Use [the shared release checklist](releasing.md) for versioning, verification,
artifacts and GitHub Releases, and [BUILDING.md](../BUILDING.md) to reproduce the
submitted package. This document covers the Firefox-specific submission fields.

## Package and manifest

Generate the Firefox extension ZIP and matching reviewer source ZIP with
`npm run zip:firefox`, then run `npm run check:firefox-package`.
Use the filenames generated for the version in `package.json`.

| Field | Value |
| --- | --- |
| Name | Page as Context |
| Add-on ID | `{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}` |
| Desktop minimum | Firefox 140.0 |
| Android minimum | Firefox Android 142.0 |
| Required permissions | activeTab, scripting, clipboardWrite, storage |
| Optional permissions | downloads for Desktop Save; all HTTP/HTTPS hosts only when Include frames from other sites is enabled |
| Data collection | Required: `["none"]`; optional MCP transmission: `websiteContent`, `browsingActivity`, `personalCommunications`, with `websiteActivity` for write mode |
| License | GNU General Public License v3.0 only (GPL-3.0-only) |

The manifest declarations are defined in `src/platform/manifest.ts`. Desktop
supports Copy and Save; Android supports Copy only. Local capture and export
behavior is described in [capture-and-export.md](capture-and-export.md).

## Submit to AMO

1. Sign in to the [Add-ons Developer Hub](https://addons.mozilla.org/developers/).
   For a new listing, choose **Submit a New Add-on** and **On this site**.
   For an update, upload a new version through the existing listing.
2. Upload the Firefox extension ZIP and review validation results. Select both
   Firefox Desktop and Firefox for Android compatibility.
3. When asked for source code, select **Yes** and upload the matching source ZIP.
   WXT/Vite bundles and minifies the extension; readable sources and reproduction
   instructions are required. The archive includes BUILDING.md and the lockfile.
4. Fill in the name, summary, description, license, privacy policy and support
   details from [store-listing.md](store-listing.md). Add Firefox screenshots that
   show Desktop and Android behavior clearly.
5. Include the reviewer notes from that file. Explain that no account or external
   service is required, that capture needs the browser-action activeTab grant,
   and that Android never requests download permission.
6. Submit the version and follow the dashboard status and reviewer messages.
   After the listing becomes available, install it from AMO on both platforms
   and repeat the main Copy and Desktop Save flows.

Mozilla documents the current [submission process](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
and [source requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/).
Attach matching readable sources to each version built with bundling or
minification. Also publish corresponding sources for users as described in the
[release guide](releasing.md); reviewer-only uploads do not satisfy that step.
Select the GPL version 3 only license entry, not the "or later" variant.
The [built-in data consent guide](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
explains the manifest's declaration for extensions without data transmission.
