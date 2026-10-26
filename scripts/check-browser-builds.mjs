// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const projectLicense = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const thirdPartyNotices = await readFile(new URL('../public/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
assert.equal(pkg.license, 'GPL-3.0-only');

async function javascript(directory) {
  const contents = await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javascript(path);
    return entry.name.endsWith('.js') ? readFile(path, 'utf8') : '';
  }));
  return contents.join('\n');
}

for (const target of ['chrome', 'firefox']) {
  const firefox = target.startsWith('firefox');
  const build = `${target}-mv3`;
  const directory = new URL(`../.output/${build}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  if (firefox) assert.equal(manifest.storage, undefined);
  else {
    assert.equal(manifest.storage.managed_schema, 'managed-schema.json');
    const schema = JSON.parse(await readFile(new URL(manifest.storage.managed_schema, directory), 'utf8'));
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, undefined);
    assert.ok(schema.properties.ManagedRedactionRules);
  }
  assert.ok(manifest.action.default_popup);
  assert.equal(Object.keys(manifest.commands).length, 4);
  for (const [name, key] of [['preview-context', 'P'], ['copy-page-context', 'C'], ['save-context-file', 'S'], ['select-element', 'E']]) {
    assert.deepEqual(manifest.commands[name].suggested_key, { default: `Alt+Shift+${key}`, mac: `Alt+Shift+${key}` });
  }
  assert.equal(await readFile(new URL('LICENSE', directory), 'utf8'), projectLicense);
  assert.equal(await readFile(new URL('THIRD_PARTY_NOTICES.txt', directory), 'utf8'), thirdPartyNotices);
  const licensePage = await readFile(new URL('license.html', directory), 'utf8');
  assert.ok(!licensePage.includes('__EXTENSION_VERSION__'), 'License page has unresolved version placeholders');
  const licenseDocument = new JSDOM(licensePage);
  try {
    const links = [...licenseDocument.window.document.querySelectorAll('a')].map(link => link.getAttribute('href'));
    assert.ok(links.includes('LICENSE'), 'License page does not link to the bundled license');
    assert.ok(links.includes('THIRD_PARTY_NOTICES.txt'), 'License page does not link to third-party notices');
    for (const path of ['releases/tag', 'tree']) {
      assert.ok(links.includes(`https://github.com/V-Shkrobatskyi/Copy-as-Context/${path}/v${pkg.version}`), 'License page links to the wrong source version');
    }
  } finally { licenseDocument.window.close(); }
  assert.ok((await readFile(new URL(manifest.action.default_popup, directory), 'utf8')).length > 0);
  const filtersDocument = new JSDOM(await readFile(new URL('filters.html', directory), 'utf8'));
  try {
    assert.equal(filtersDocument.window.document.documentElement.lang, 'en');
    assert.ok(filtersDocument.window.document.querySelector('#builtins'), 'Missing built-in filter controls');
    assert.ok(filtersDocument.window.document.querySelector('#save-filters'), 'Missing filter save action');
  } finally { filtersDocument.window.close(); }
  const demoDocument = new JSDOM(await readFile(new URL('demo.html', directory), 'utf8'));
  try {
    assert.equal(demoDocument.window.document.documentElement.lang, 'en');
    assert.ok(demoDocument.window.document.querySelector('#examples'), 'Missing live filter demo examples');
  } finally { demoDocument.window.close(); }
  const previewDocument = new JSDOM(await readFile(new URL('preview.html', directory), 'utf8'));
  try {
    assert.equal(previewDocument.window.document.documentElement.lang, 'en');
    assert.ok(previewDocument.window.document.querySelector('textarea#context'), 'Missing plain-text preview editor');
    assert.ok(previewDocument.window.document.querySelector('button#copy'), 'Missing preview Copy action');
    assert.ok(previewDocument.window.document.querySelector('button#save'), 'Missing preview Save action');
    assert.ok(previewDocument.window.document.querySelector('#compression-metrics'), 'Missing preview compression metrics');
  } finally { previewDocument.window.close(); }
  const diagnosticsDocument = new JSDOM(await readFile(new URL('data-controls.html', directory), 'utf8'));
  try {
    assert.equal(diagnosticsDocument.window.document.documentElement.lang, 'en');
    assert.equal(diagnosticsDocument.window.document.title, 'Data controls — Page as Context');
    assert.equal(diagnosticsDocument.window.document.querySelector('h1')?.textContent, 'Data controls');
    for (const id of ['data-form', 'include-title', 'include-values', 'level', 'clear', 'journal-save', 'include-log', 'report', 'copy', 'save', 'sources-form', 'sources-allowlist', 'sources-allowed', 'sources-blocked', 'save-sources', 'history-form', 'history-enabled', 'history-days', 'history-size', 'history-entries', 'history-copy', 'history-save']) assert.ok(diagnosticsDocument.window.document.getElementById(id), `Missing diagnostics control: ${id}`);
    assert.equal(diagnosticsDocument.window.document.querySelector('#include-log').checked, false);
    assert.equal(diagnosticsDocument.window.document.querySelector('#sources-allowlist').checked, false);
    assert.equal(diagnosticsDocument.window.document.querySelector('#history-enabled').checked, false);
    assert.equal(diagnosticsDocument.window.document.querySelector('#history-days').max, '365');
    assert.equal(diagnosticsDocument.window.document.querySelector('#history-size').max, '50');
  } finally { diagnosticsDocument.window.close(); }
  assert.ok(!manifest.host_permissions?.length);
  assert.ok(!manifest.content_scripts?.length);
  const source = await javascript(fileURLToPath(directory));
  assert.ok(!/\bimport\s*\(/u.test(await readFile(new URL('background.js', directory), 'utf8')), 'Background requires runtime dynamic imports');
  if (firefox) {
    assert.equal(manifest.minimum_chrome_version, undefined);
    assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'clipboardWrite', 'storage'].sort());
    assert.deepEqual(manifest.optional_permissions, ['downloads', 'nativeMessaging']);
    assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
    assert.ok((await readFile(new URL('frame-capture.js', directory), 'utf8')).includes('__pageAsContextFrames'), 'Missing isolated frame helper');
    assert.ok(manifest.background.scripts?.length);
    assert.equal(manifest.background.service_worker, undefined);
    assert.ok(manifest.browser_specific_settings.gecko.id);
    assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '140.0');
    assert.deepEqual(manifest.browser_specific_settings.gecko_android, { strict_min_version: '142.0' }, 'Incorrect Firefox target compatibility');
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.optional, ['websiteContent', 'browsingActivity', 'personalCommunications', 'websiteActivity']);
    assert.ok(!source.includes('Accessibility.getFullAXTree'), 'Firefox includes Chrome AX capture');
    assert.ok(!source.includes('debugger.attach'), 'Firefox includes debugger attach');
    const collector = await readFile(new URL('dom-capture.js', directory), 'utf8');
    assert.ok(collector.length > 0, 'Missing DOM capture script');
    assert.ok(!source.includes('Firefox page capture is not available'), 'Firefox still uses the capture placeholder');
    assert.ok(!/\bimport\s*\(/u.test(collector), 'DOM collector requires runtime dynamic imports');
    const fixture = new JSDOM('<title>Synthetic</title><main><h1>Settings</h1><button aria-label="Save settings">Save</button><label>Password<input type="password" value="synthetic-private-value"></label></main>', { url: 'https://example.test/', runScripts: 'outside-only' });
    try {
      let passwordReads = 0;
      Object.defineProperty(fixture.window.document.querySelector('input'), 'value', { get() { passwordReads++; throw new Error('Password read'); } });
      const result = fixture.window.eval(collector);
      assert.equal(result.ok, true, 'Injected bundle did not return capture data');
      assert.ok(JSON.stringify(result).includes('Save settings'), 'Built collector lost control names');
      assert.ok(!JSON.stringify(result).includes('synthetic-private-value'), 'Built collector leaked a password');
      assert.equal(passwordReads, 0);
      assert.equal(fixture.window.domCapture, undefined, 'Collector retains capture data globally');
    } finally { fixture.window.close(); }
  } else {
    assert.equal(manifest.optional_host_permissions, undefined);
    assert.ok(!source.includes('getFrameId'), 'Chrome includes Firefox frame API');
    assert.ok(!source.includes('Include frames from other sites'), 'Chrome includes Firefox site access UI');
    assert.ok(!source.includes('Other-site frames enabled'), 'Chrome includes Firefox permission controller');
    assert.equal(manifest.minimum_chrome_version, '125');
    assert.deepEqual([...manifest.permissions].sort(), ['debugger', 'activeTab', 'scripting', 'clipboardWrite', 'downloads', 'storage'].sort());
    assert.ok(manifest.background.service_worker);
    assert.equal(manifest.browser_specific_settings, undefined);
    assert.ok(source.includes('Accessibility.getFullAXTree'), 'Chrome AX capture was removed');
    assert.ok(!source.includes('Firefox page capture is not available'), 'Chrome includes Firefox placeholder');
  }
  console.log(`${target}: manifest and bundled capture boundary verified`);
}
