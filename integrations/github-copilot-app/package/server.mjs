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
  directory: { type: 'string' }, 'manifest-home': { type: 'string' },
} });
if (positionals.length !== 1 || !['chrome', 'firefox'].includes(positionals[0])) {
  throw new Error('Select exactly chrome or firefox through the packaged browser server.');
}
if (values['manifest-home'] && !values.directory) throw new Error('Isolated manifests require an explicit state directory.');
const browser = positionals[0];
const manifest = JSON.parse(await readFile(new URL('./plugin.json', import.meta.url), 'utf8'));
const directory = values.directory ?? defaultDirectory();
const profileDirectory = join(directory, 'github-copilot-app/profiles');
const bridge = packageClient(browser, directory, profileDirectory);
const setup = browserSetup({ browser, directory, profileDirectory, onActivated: () => bridge.refresh(),
  clientName: `GitHub Copilot app — ${browser === 'chrome' ? 'Chrome' : 'Firefox'}`,
  licensePath: fileURLToPath(new URL('./runtime/LICENSE', import.meta.url)),
  installOptions: values['manifest-home'] ? { manifestHome: values['manifest-home'] } : {},
});
await serveMcp(undefined, undefined, process.stdin, process.stdout, false, {
  bridge, setup, version: manifest.version,
  setupInstructions: `This GitHub Copilot app server is configured for ${browser}. Use a local desktop session on the browser computer; never copy credentials into cloud, SSH or container sessions. For setup, call setup_status, ask for the browser instance ID and extension ID, then prepare_browser_setup. Show the returned changes and obtain explicit user approval before confirm_browser_setup. Keep client confirmation enabled for that mutating tool. Automatic mode connects the bridge; in Manual mode ask the user to click Start helper connection; call get_pairing_status for progress and the code. The user compares the code and approves pairing in the browser. Never approve pairing or page actions for the user. Pairing alone grants no tab access. In Automatic, ask the user to choose AI: Read or Write again in each source tab popup after approval, even if the tab was already shared. To switch browser instances, prepare setup for the requested instance and show the returned reason; confirm only after explicit approval. New credentials become active only after successful pairing; failure or cancel_browser_setup preserves the previous profile. No tab grants, Write or session approvals transfer. In Manual, pairing alone grants no tab access; the user must connect the selected tab in MCP settings. Use list_shared_tabs or resolve_shared_tab for current Connection IDs; never ask the user to copy them. Never substitute an instance or client ID for a Connection ID. If setup expires, prepare a new request. Never replay a denied action or an action with outcome-unknown. To switch browsers, use the other packaged browser server and complete its setup separately.`,
});
