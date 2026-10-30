// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { serveMcp } from './helper/src/mcp.mjs';
import { browserSetup } from './helper/src/browser-setup.mjs';
import { packageClient } from './helper/src/package-client.mjs';
import { defaultDirectory } from './helper/src/security.mjs';

// Package configuration selects identity; tool arguments cannot change it or paths.
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  directory: { type: 'string' }, 'manifest-home': { type: 'string' }, client: { type: 'string', default: 'desktop' },
} });
if (positionals.length !== 1 || !['chrome', 'firefox'].includes(positionals[0])) {
  throw new Error('In the extension configuration, set Browser to exactly chrome or firefox, then restart the extension.');
}
if (values['manifest-home'] && !values.directory) throw new Error('Isolated manifests require an explicit state directory.');
if (!['desktop', 'code'].includes(values.client)) throw new Error('Invalid Claude entry point.');
const browser = positionals[0];
const codeClient = values.client === 'code';
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const directory = values.directory ?? defaultDirectory();
const profileDirectory = join(directory, codeClient ? 'claude-code/profiles' : 'claude/profiles');
const setup = browserSetup({ browser, directory, profileDirectory,
  clientName: `Claude${codeClient ? ' Code' : ' Desktop'} — ${browser === 'chrome' ? 'Chrome' : 'Firefox'}`,
  licensePath: fileURLToPath(new URL('./runtime/LICENSE', import.meta.url)),
  installOptions: values['manifest-home'] ? { manifestHome: values['manifest-home'] } : {},
});
await serveMcp(undefined, undefined, process.stdin, process.stdout, false, {
  bridge: packageClient(browser, directory, profileDirectory), setup, version: manifest.version,
  setupInstructions: `This extension is configured for ${browser}. For setup, call setup_status, ask for the browser instance ID and extension ID, then prepare_browser_setup. Show the returned changes and obtain explicit user approval before confirm_browser_setup. Keep client confirmation enabled for that mutating tool. Automatic mode connects the bridge; in Manual mode ask the user to click Start helper connection; call get_pairing_status for progress and the code. The user compares the code and approves pairing in the browser. Never approve pairing or page actions for the user. In Automatic, approved clients receive access to tabs already marked Read or Write; no extra shared-access opt-in is needed. The user may choose Read before pairing. If no tab is shared, ask the user to choose AI: Read or Write in the source tab popup. In Manual, pairing alone grants no tab access; the user must connect the selected tab in MCP settings. Use list_shared_tabs or resolve_shared_tab for current Connection IDs; never ask the user to copy them. Never substitute an instance or client ID for a Connection ID. If setup expires, prepare a new request. Never replay a denied action or an action with outcome-unknown. To switch browsers, change the extension configuration and restart it.`,
});
