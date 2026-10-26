# Rebuilding release packages

This source archive builds the unsigned Chrome and Firefox packages with public,
open-source tooling. It includes the exact npm lockfile. No account, API key,
signing credential, Android SDK or external backend is needed to build it.

Use Node.js **24.10.0** and npm **11.6.0** for reproducible builds.
CI reads Node 24.10.0 from `.nvmrc`; package engines require Node 24 and npm 11.
Use `npm ci` with the supplied lockfile to keep dependencies fixed.
Use a normal Linux, macOS or Windows shell with npm available. Build prerequisites
are downloaded from the public npm registry by `npm ci`; after dependency
installation, compilation and packaging use local files.

Extract the source ZIP into an empty directory, then run from its root:

```sh
npm ci
npm run zip:firefox
```

The installed extension files are in `.output/firefox-mv3/`. The unsigned archive
is `.output/page-as-context-2.0.0-firefox.zip`; the accompanying source archive is
`.output/page-as-context-2.0.0-sources.zip`. Filenames use the package version, so
they change when the version changes. Compare uncompressed file paths and bytes
with the submitted extension ZIP; ZIP container timestamps are not build content.

For local package verification:

```sh
npm run check:firefox-package
NO_UPDATE_NOTIFIER=1 npm run lint:firefox
```

Use the source archive's `package-lock.json` and `npm ci`, without upgrading
dependencies or running `npm audit fix`. Build and test tools are development
dependencies; production code includes only the project and small WXT helpers.
Project GPLv3-only license and third-party notices are copied into every browser build.
The bundled `license.html` links to the matching version's public source tag
and release archive. See [LICENSING.md](LICENSING.md) for licensing scope.

The source ZIP uses an explicit allowlist. It excludes local plans and reports
in `dev_notes/`, `.git`, `.agents`, `.codex`, environment files, credentials,
`node_modules` and generated output. The archive is taken from the current local
source, including uncommitted files. Build submission artifacts from the intended release
revision with a clean working tree. WXT omits unit
test files from its reviewer archive; the build does not require those files.
Full contributor checks run from the repository with `npm run check`.

## Chrome build

```sh
npm run zip
```

The Chrome package is `.output/page-as-context-2.0.0-chrome.zip`, built from
`.output/chrome-mv3/`. Upload the extension ZIP, not the reviewer sources.

## Shared Firefox Desktop and Android package

`npm run zip:firefox` produces one extension ZIP and one matching source ZIP for
Firefox Desktop 140+ and Firefox Android 142+. Both platforms use the same add-on
ID and update stream. Upload the Firefox ZIP once to AMO and select Desktop and
Android compatibility; do not upload separate platform variants.

The popup detects the local platform at runtime. Desktop retains its 376px layout;
Android uses responsive sizing and touch controls. Both support Copy. Firefox
Desktop requests the optional `downloads` permission when the user clicks Save;
Android never requests it and keeps Save unavailable. Local platform detection
failure also keeps Save unavailable while leaving Copy usable.

## Loading and publishing

Load a development build using the [README installation steps](README.md).
Build commands produce unsigned packages. Publishing and signing are covered in
[the release guide](docs/releasing.md); Firefox-specific metadata is documented
[in the AMO guide](docs/firefox-release.md).
