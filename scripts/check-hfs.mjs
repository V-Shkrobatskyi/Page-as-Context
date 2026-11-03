// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const metadata = JSON.parse(await readFile(new URL('../integrations/hfs/compatibility.json', import.meta.url), 'utf8'));
assert.equal(metadata.relayProtocol, 1); assert.equal(metadata.configSchema, 1); assert.equal(metadata.hfsVersion, '3.3.4');
for (const name of ['relay.mjs', 'auth.mjs']) {
  const source = await readFile(new URL('../integrations/hfs/' + name, import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), metadata.sources[name], `Update reviewed source hash for ${name}`);
}
const config = await readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8');
for (const path of ['integrations/hfs/**', 'helper/src/catalog.mjs', 'helper/src/catalog.d.mts']) assert.ok(config.includes(path), `Source package omits ${path}`);
console.log('HFS protocol/schema/source hashes and source-package inputs verified.');
