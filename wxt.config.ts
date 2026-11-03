// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { defineConfig } from 'wxt';
import { browserManifest } from './src/platform/manifest';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from './package.json';

// noinspection JSUnusedGlobalSymbols
export default defineConfig({
  manifestVersion: 3,
  // Firefox uses platform-scoped responsive styles in one Desktop/Android package.
  vite: ({ browser }) => ({
    resolve: {
      alias: {
        '@popup-style.css': fileURLToPath(new URL(
          browser === 'firefox'
            ? './entrypoints/popup/firefox.css'
            : './entrypoints/popup/style.css',
          import.meta.url,
        )),
      },
    },
  }),
  manifest: ({ browser }) => browserManifest(browser),
  zip: {
    includeSources: [
      'package.json', 'package-lock.json', 'wxt.config.ts', 'tsconfig.json', 'vitest.config.ts',
      'README.md', 'CONTRIBUTING.md', 'LICENSE', 'LICENSING.md', 'BUILDING.md', 'CHANGELOG.md', 'PRIVACY.md', '.nvmrc',
      'helper/src/catalog.mjs', 'helper/src/catalog.d.mts', 'integrations/hfs/**',
      'entrypoints/**', 'src/**', 'public/**', 'scripts/**', 'tests/fixtures/**',
      'tests/mcp/**', 'tests/helpers/**', 'tests/manual/**', 'tests/performance/**', 'docs/**',
    ],
    excludeSources: ['**/dev_notes/**', '**/.env*', '**/node_modules/**', '**/.DS_Store', '**/*.log'],
  },
  hooks: {
    'zip:start': (wxt) => {
      // WXT excludes test modules by default; the explicit MCP test allowlist is
      // needed to reproduce check:hfs from the reviewer source archive.
      wxt.config.zip.excludeSources = wxt.config.zip.excludeSources.filter(pattern => pattern !== '**/*.+(test|spec).?(c|m)+(j|t)s?(x)');
    },
    'build:done': async (wxt) => {
      await copyFile(join(wxt.config.root, 'LICENSE'), join(wxt.config.outDir, 'LICENSE'));
      const licensePage = await readFile(join(wxt.config.root, 'public/license.html'), 'utf8');
      await writeFile(join(wxt.config.outDir, 'license.html'),
        licensePage.replaceAll('__EXTENSION_VERSION__', version));
    },
  },
});
