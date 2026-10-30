# Release guide

Use this checklist for each release. Build instructions belong in
[BUILDING.md](../BUILDING.md), store text in [store-listing.md](store-listing.md),
and Firefox submission details in [firefox-release.md](firefox-release.md).
Keep submission status, browser verification results, artifact hashes and reviewer
correspondence in the release PR or GitHub Release rather than repeating them in
user documentation.

## 1. Prepare the version

Work on a focused branch and merge changes through a PR into `main`.
`package.json` is the version source for WXT manifests and export attribution.
For a new package version:

```sh
npm version X.Y.Z --no-git-tag-version
```

This updates package metadata without creating a Git commit or tag. Update the
changelog with user-visible changes. Documentation corrections alone do not need
a version bump; rebuild the matching source archive if they precede submission.
Use a higher version for an update to an already published package.

Check that README, the offline guide, privacy policy and store descriptions agree
with the implementation. Preserve previously submitted packages and release tags;
release history must identify the code and files actually distributed.

## 2. Verify the release

Use the Node/npm versions in [BUILDING.md](../BUILDING.md), then run:

```sh
npm ci
npm run check
```

Follow the [Desktop](firefox-desktop-testing.md) and
[Android](firefox-android-testing.md) checklists for affected behavior. Cover Copy,
Desktop Save, both formats, all profiles, Unicode, redaction, settings, restricted
pages and navigation during capture. On Chrome, check debugger detach. On Firefox
Desktop, check download permission approval, denial and retry and the separate
save tab. Android must remain Copy-only without download permission prompts.
Record actual browser/device versions and results in the release PR. Repeat
relevant checks after further code changes.

## 3. Build the final packages

Build from the intended merged revision with a clean working tree:

```sh
npm run zip
npm run zip:firefox
npm run check:firefox-package
```

Archive names follow the version in `package.json`:

| Target | Extension ZIP | Reviewer sources |
| --- | --- | --- |
| Chrome Desktop | `.output/page-as-context-X.Y.Z-chrome.zip` | Not normally uploaded to Chrome Web Store |
| Firefox Desktop and Android | `.output/page-as-context-X.Y.Z-firefox.zip` | `.output/page-as-context-X.Y.Z-sources.zip` |

Verify manifest versions, permissions and target platforms. Upload the Firefox
ZIP once for Desktop and Android. Create extension and source ZIPs from the same
source revision, without edits between them. The Firefox package checker compares
uncompressed files with the build and prints hashes.

The upcoming 1.3.0 release is the first GPL-3.0-only release. Keep previously
distributed MIT artifacts unchanged. Include LICENSE, LICENSING.md and third-party
notices in sources; verify LICENSE, license.html and THIRD_PARTY_NOTICES.txt in
both browser packages. Check that license.html contains the actual package version
and links to its matching `vX.Y.Z` tag and release, with no template placeholders.

Before distributing a GPL build through either store, publish its `vX.Y.Z` tag
and corresponding-source archive in a public GitHub Release and verify anonymous
access to both links from the bundled License page. Include the lockfile and all
files needed by BUILDING.md. Link to that release in each store listing as well.
Private reviewer sources alone are not sufficient. Chrome users need public
corresponding sources too. If a version's code or packages change after publishing
these artifacts, prepare a new version instead of silently replacing old sources.

Rebuild a submitted source archive from a clean directory following BUILDING.md
and compare paths and bytes with the extension ZIP. ZIP timestamps do not need
to match. The reviewer archive omits unit tests, so use the build commands rather
than the full contributor suite for this reproduction.

## 4. Prepare the listing

Use [store-listing.md](store-listing.md) for descriptions, permissions and support
information. Capture screenshots in the actual target browser using synthetic or
public content without personal account details.

- Chrome Web Store: prepare the developer account, Chrome ZIP, listing assets,
  privacy declarations and permission explanations. Check the current
  [image requirements](https://developer.chrome.com/docs/webstore/images).
- Mozilla Add-ons: prepare the Mozilla account, shared Firefox ZIP, matching
  sources, Desktop/Android compatibility, GPLv3-only license and reviewer notes.

The privacy policy is [PRIVACY.md](../PRIVACY.md), included offline as
`privacy.html`. Its public URL is
`https://github.com/V-Shkrobatskyi/Page-as-Context/blob/main/PRIVACY.md`.
Verify anonymous access to privacy and support links before submission.
Describe local page processing accurately when completing data-handling forms;
see the [Chrome privacy guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
and the Firefox manifest's data-collection declaration.

## 5. Submit and publish

Upload the appropriate package to the existing listing for an update, or create
a listing for the first release. Follow the store's validation and review steps:
[Chrome publication](https://developer.chrome.com/docs/webstore/publish/) and
[Firefox submission](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
Keep the Firefox add-on ID unchanged across updates. Build commands do not sign
or publish packages; renaming an unsigned ZIP to XPI does not sign it.

After publication, install from the store on each listed platform and check the
main export flows. Add verified store links to README. Record the publication
date and platform in the GitHub Release, attach the distributed packages and
matching sources, and tag the source revision as `vX.Y.Z`. Preserve existing tags
and artifacts when publishing a release that was prepared earlier. Update the
changelog's unreleased heading when the version is released.
