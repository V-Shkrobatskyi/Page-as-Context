# Release guide

Use this checklist for each release. Build instructions belong in
[BUILDING.md](../BUILDING.md), store text in [store-listing.md](store-listing.md),
and Firefox submission details in [firefox-release.md](firefox-release.md).
[CHANGELOG.md](../CHANGELOG.md) records source changes and dated GitHub release
history. This guide records the release procedure. Keep public rollout status,
browser verification results and artifact hashes in the GitHub Release; keep
private reviewer correspondence in the store submission or private release notes.
GitHub publication, store submission, store approval and local acceptance are
separate events; do not infer one date from another.

## 1. Prepare the version

Work on a focused branch and merge changes through a PR into `main`.
`package.json` is the version source for WXT manifests and export attribution.
For a new package version:

```sh
npm version X.Y.Z --no-git-tag-version
```

This updates package metadata without creating a Git commit or tag. Update the
changelog with user-visible changes under the current unreleased version.
Before committing or pushing, review the changelog and this guide; update entries
for relevant changes and revise the procedure only when the workflow changes.
Do not add empty edits merely to touch both files.
Documentation corrections alone do not need a version bump; rebuild the matching source archive if they precede submission.
Use a higher version for an update to an already published package.

Check that README, the offline guide, privacy policy and store descriptions agree
with the implementation. Preserve previously submitted packages and release tags;
release history must identify the code and files actually distributed.

Prepare the version's changelog and release-history row before the final merge.
For immediate publication, set the release date (`YYYY-MM-DD`) as part of that
preparation; distinguish a prepared release from confirmed GitHub publication.
If publication moves to another day, correct the date before the final build.
Otherwise retain `unreleased` until the release is ready. No separate post-release
commit is required when the prepared date matches publication. Record the actual
GitHub publication timestamp (UTC) in the Release description; do not infer it
from a commit, tag or test date.
If several source versions ship together, identify intermediate entries as
`development milestone, included in X.Y.Z`; do not assign them separate release
dates. Historical publication dates must be verified against the GitHub Release.

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

Build from one intended merged commit with a clean working tree. Record its full
SHA; use that same commit for all extension/plugin packages and matching sources
included in this release. Keep the pinned toolchain and lockfiles. Tag that commit
as `vX.Y.Z`; creating a tag does not edit source files or require another merge.
`main` can continue moving after the release commit is chosen.

Run the browser packaging commands:

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

The current source is GPL-3.0-only; the license transition was introduced for
1.3.0. Keep previously distributed MIT artifacts unchanged. Include LICENSE,
LICENSING.md and third-party notices in sources; verify LICENSE, license.html and
THIRD_PARTY_NOTICES.txt in both browser packages. Check that license.html contains the actual package version
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
to match. The reviewer archive includes allowlisted test subsets (including MCP,
fixtures, helpers, manual and performance files), not the entire test suite. Use
the build commands rather than the full contributor suite for this reproduction.

If source changes before publication, merge the fix and rebuild affected packages
and matching sources from the new chosen commit. Do not mix old and new artifacts.
Once published, preserve the tag and distributed files; changed package bytes
require a new version. Release-description and store-status updates can be made
on GitHub without changing the source commit.

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

Publish the GitHub Release for the chosen tag and attach the checked packages,
matching sources and SHA-256 hashes before GPL builds are distributed through
stores. Record the actual GitHub publication timestamp (UTC), full source commit,
and extension/helper/plugin versions actually included; their versions are independent.
A successful local build or client installation is not public release evidence.

Track Chrome Web Store and Mozilla Add-ons separately in the Release description:
submitted version/date, approval or availability date when confirmed, and listing
link. Use `pending` or `not verified` when appropriate. These status updates do not
require a source commit or another merge. Avoid private reviewer correspondence.

After store publication, install on each listed platform and check the main export
flows. Record actual browser/device versions and results. Add or correct store
links in repository docs only when necessary, through a normal docs PR.

Reconcile the changelog heading and release-history table with the actual GitHub
publication date in the next docs PR only if a correction is needed. Preserve the release tag and
artifacts; do not rebuild an already published version merely to include this
historical bookkeeping correction. Future release builds use the updated docs.
