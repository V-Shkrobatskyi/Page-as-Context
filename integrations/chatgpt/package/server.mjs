// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { serveMcp } from './helper/src/mcp.mjs';
import { packageClient } from './helper/src/package-client.mjs';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { browserSetup } from './helper/src/browser-setup.mjs';
import { defaultDirectory } from './helper/src/security.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// No setup, registration, credentials or tab selection may be changed by discovery.
const { positionals, values } = parseArgs({ allowPositionals: true, options: { directory: { type: 'string' }, 'manifest-home': { type: 'string' } } });
if (positionals.length !== 1) throw new Error('Select chrome or firefox.');
if (values['manifest-home'] && !values.directory) throw new Error('Isolated manifests require an explicit state directory.');
const manifest = JSON.parse(await readFile(new URL('./plugin.json', import.meta.url), 'utf8'));
const directory = values.directory ?? defaultDirectory(), profileDirectory = join(directory, 'chatgpt/profiles');
const setup = browserSetup({ browser: positionals[0], directory, profileDirectory, clientName: `ChatGPT — ${positionals[0] === 'chrome' ? 'Chrome' : 'Firefox'}`,
  licensePath: fileURLToPath(new URL('./runtime/LICENSE', import.meta.url)), installOptions: values['manifest-home'] ? { manifestHome: values['manifest-home'] } : {} });
await serveMcp(undefined, undefined, process.stdin, process.stdout, false, { bridge: packageClient(positionals[0], directory, profileDirectory), setup, version: manifest.version });
