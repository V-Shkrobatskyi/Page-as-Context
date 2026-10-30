# Licensing

Copyright (c) 2026 Vitalii Shkrobatskyi.

Starting with the upcoming 1.3.0 release, the original code, documentation,
fixtures, and assets in this repository are licensed under the GNU General
Public License version 3 only (`GPL-3.0-only`), except where separate notices
identify third-party material. The full terms are in [LICENSE](LICENSE).
Individual SPDX headers identify the same license; their absence does not
exclude an original project file from this statement.

Page as Context is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License version 3 as published by
the Free Software Foundation. It is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See LICENSE for details.

Personal and commercial use are permitted. Distribution of covered modified
programs must comply with GPLv3, including the corresponding-source requirements.
This is not a noncommercial license. Merely using the extension does not require
publishing your own work. Exported page content does not become GPL-licensed
merely because this extension processes it; rights in that content are separate.

## Previous MIT distributions

This change does not revoke permissions already granted for copies distributed
under MIT. Preserve old release tags and archives and their original license.
The new license applies to this distribution and subsequent GPL releases;
recipients can still use previously obtained MIT code under its MIT terms.

## Third-party material

Bundled WXT helpers, `@wxt-dev/browser`, and the RE2JS regular expression engine retain their MIT notices in
[public/THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt). Keep those
notices when distributing the extension. Development dependencies retain their
respective licenses and are recorded in `package-lock.json`; they are not all
included in the installed browser package.

The user guide includes Simple Icons brand SVGs under CC0 1.0 Universal.
Their source and modifications are listed in the bundled third-party notices;
the full license is included at `public/icon/brands/LICENSE.txt`.

## Corresponding source for releases

Each release must provide an archive of its corresponding source, including
the lockfile, assets, configuration, and scripts needed to build and modify it.
Use the version's `vX.Y.Z` tag and source archive in
[GitHub Releases](https://github.com/V-Shkrobatskyi/Page-as-Context/releases).
[BUILDING.md](BUILDING.md) documents the build procedure.

The bundled License page links to the release and source tag for the installed
version. Publish and verify those public links before distributing that version
through a store. Providing sources privately to store reviewers alone does not
provide sources to users. See [the release guide](docs/releasing.md).
