// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
/** Live production read path. Only temporary browser profiles and synthetic content. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { StreamableHTTPClientTransport } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { install, uninstall, manifestDirectories } from '../../helper/src/install.mjs';
import { configuration, secret, createPrivateJson, PROTOCOL } from '../../helper/src/security.mjs';
import { startBroker } from '../../helper/src/broker.mjs';
import { bridgeClient } from '../../helper/src/client.mjs';
import { Client } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { ToolListChangedNotificationSchema } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { launch } from './browser-protocol.mjs';

const { values } = parseArgs({ options: { report: { type: 'string' }, targets: { type: 'string', default: 'chrome,firefox' }, write: { type: 'boolean', default: false }, 'hfs-binary': { type: 'string' }, 'capture-metrics': { type: 'boolean', default: false }, 'external-forms': { type: 'boolean', default: false } } });
const reports = [];
const hfsBinary = values['hfs-binary'];
if (hfsBinary) {
  const metadata = JSON.parse(await readFile(new URL('../../integrations/hfs/compatibility.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(await readFile(hfsBinary)).digest('hex'), metadata.hfsMacArm64BinarySha256, 'Unexpected HFS executable');
}

// Serialize ordinary JavaScript so editors can validate handlers without parsing escaped HTML.
function initializeSyntheticForm() {
  document.getElementById('replaceable').addEventListener('input', function replaceOnInput() {
    const replacement = this.cloneNode(true);
    replacement.addEventListener('input', replaceOnInput);
    this.replaceWith(replacement);
  });
  document.getElementById('rebuild').addEventListener('input', () => {
    document.getElementById('dependents').innerHTML = '<input aria-label="Dependent">';
  });
  document.getElementById('counter').addEventListener('click', () => {
    window.clickCount = (window.clickCount || 0) + 1;
    document.getElementById('count').textContent = String(window.clickCount);
  });
  const root = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
  root.innerHTML = '<button>Shadow action</button>';
  root.querySelector('button').addEventListener('click', () => {
    window.shadowClicks = (window.shadowClicks || 0) + 1;
  });
  const controlled = document.getElementById('controlled');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  let tracked = '';
  Object.defineProperty(controlled, 'value', {
    get() { return descriptor.get.call(this); },
    set(value) { tracked = value; descriptor.set.call(this, value); },
  });
  controlled.addEventListener('input', () => {
    if (tracked !== controlled.value) {
      window.appValue = controlled.value;
      tracked = controlled.value;
      setTimeout(() => {
        document.getElementById('fill-status').textContent = 'Validation: updated';
      }, 50);
    }
  });
  controlled.addEventListener('blur', () => { window.controlledBlurred = true; });
}

const http = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  if (_request.url === '/child') { response.end('<!doctype html><title>Synthetic child</title><input id="unnamed"><button onclick="window.frameClicks=(window.frameClicks||0)+1">Frame action</button>'); return; }
  response.end(`<!doctype html><title>Synthetic MCP form</title><main><h1>MCP_READ_SENTINEL_4242</h1><label>Email<input value="synthetic@example.test"></label><label>Password<input type="password" value="NEVER_RETURN_PASSWORD_9911"></label><button disabled>Submit</button><label>Notes<textarea id="notes"></textarea></label><label>Controlled<input id="controlled"></label><p role="status" id="fill-status">Ready</p><label>Replaceable<input id="replaceable"></label><label>Rebuild<input id="rebuild"></label><div id="dependents"></div><input id="large" aria-label="Large parent"><label>Nickname<input id="nickname"></label><label>First Name<input id="personal-name"></label><input id="hint-name" placeholder="Last Name"><label>Enabled<input id="enabled" type="checkbox"></label><label>Color<select size="2" id="color"><option>Blue</option><option>Green</option></select></label><button id="counter">Count action</button><p id="count">0</p><button>Duplicate</button><button>Duplicate</button><iframe src="/child" title="Synthetic action frame"></iframe><div id="shadow-host"></div></main><script>(${initializeSyntheticForm.toString()})();</script>`);
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const sourceUrl = `http://127.0.0.1:${http.address().port}/`;
try {
  for (const browser of values.targets.split(',')) {
    assert.ok(['chrome', 'firefox'].includes(browser));
    const root = await mkdtemp(join(tmpdir(), 'pac-read-')); await chmod(root, 0o700);
    const profile = join(root, 'profile'), extension = join(root, 'extension'), directory = join(root, 'bridge');
    await mkdir(profile); await cp(resolve(`.output/${browser}-mv3`), extension, { recursive: true });
    const manifestPath = join(extension, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // Synthetic automation fixture pregrants only the permissions under test. User-gesture prompts are a separate check.
    manifest.permissions.push('nativeMessaging'); manifest.optional_permissions = manifest.optional_permissions.filter(item => item !== 'nativeMessaging');
    manifest.host_permissions = ['http://127.0.0.1/*', ...(values['external-forms'] ? ['https://www.selenium.dev/*','https://demoqa.com/*','https://docs.google.com/*'] : [])];
    const uuid = '397907a1-a530-440a-bcd5-91425c048ddd';
    if (browser === 'firefox') {
      manifest.browser_specific_settings.gecko.data_collection_permissions = { required: ['websiteContent', 'browsingActivity', 'personalCommunications', ...(values.write ? ['websiteActivity'] : [])] };
      await writeFile(join(profile, 'user.js'), `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: uuid }))});\nuser_pref("app.update.enabled", false);\n`);
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    let runtime, broker, installed = false, client, hfs, testManifest, stage = 'launch';
    let hfsEndpoint;
    if (hfsBinary) {
      const port = createServer(); await new Promise(resolve => port.listen(0, '127.0.0.1', resolve));
      hfsEndpoint = `http://127.0.0.1:${port.address().port}`; await new Promise(resolve => port.close(resolve));
    }
    // A unique test host cannot overwrite the user's installed Firefox helper.
    const testHost = `com.page_as_context.s10_${randomUUID().replaceAll('-', '')}`;
    if (browser === 'firefox' && !hfsBinary) {
      const background = join(extension, 'background.js');
      const { HOST_NAME } = await import('../../helper/src/security.mjs');
      const bytes = await readFile(background, 'utf8'); assert.ok(bytes.includes(HOST_NAME));
      await writeFile(background, bytes.replaceAll(HOST_NAME, testHost));
    }

    try {
      runtime = await launch(browser, profile); const protocol = runtime.protocol;
      let extensionId, version;
      const tab = async (url, reuse = false) => {
        if (browser === 'chrome') {
          const { targetId } = reuse ? (await protocol.send('Target.getTargets')).targetInfos.find(target => target.url === url) : await protocol.send('Target.createTarget', { url });
          const { sessionId } = await protocol.send('Target.attachToTarget', { targetId, flatten: true });
          const evaluate = async expression => { const value = await protocol.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId); assert.equal(value.exceptionDetails, undefined); return value.result.value; };
          let loaded = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            try { loaded = await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`); } catch { /* Navigation replaces the initial about:blank realm. */ }
            if (loaded) break; await new Promise(resolve => setTimeout(resolve, 50));
          }
          assert.ok(loaded, 'Chrome extension or synthetic page did not finish navigation');
          return evaluate;
        }
        const { context } = reuse ? (await protocol.send('browsingContext.getTree')).contexts.find(item => item.url === url) : await protocol.send('browsingContext.create', { type: 'tab' });
        if (!reuse) await protocol.send('browsingContext.navigate', { context, url, wait: 'complete' });
        return async expression => { const value = await protocol.send('script.evaluate', { expression, target: { context }, awaitPromise: true, userActivation: true }); assert.equal(value.type, 'success'); return value.result.value; };
      };
      if (browser === 'chrome') { version = (await protocol.send('Browser.getVersion')).product; ({ id: extensionId } = await protocol.send('Extensions.loadUnpacked', { path: extension })); }
      else { version = (await protocol.send('session.new', { capabilities: { alwaysMatch: {} } })).capabilities.browserVersion; ({ extension: extensionId } = await protocol.send('webExtension.install', { extensionData: { type: 'path', path: extension } })); }
      let config;
      if (!hfsBinary) {
        const installation = await install({ directory, ...(browser === 'chrome' ? { chromeId: extensionId, chromeUserData: profile } : { firefoxId: extensionId, manifestHome: root }) }); installed = true;
        if (browser === 'firefox') {
          const manifest = JSON.parse(await readFile(installation.manifests[0], 'utf8')); manifest.name = testHost;
          const hosts = manifestDirectories(process.platform, homedir()).firefox; await mkdir(hosts, { recursive: true });
          testManifest = join(hosts, testHost + '.json');
          await writeFile(testManifest, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
        }
        config = await configuration(directory); broker = await startBroker(config);
      }

      const extensionUrl = browser === 'chrome' ? `chrome-extension://${extensionId}` : `moz-extension://${uuid}`;
      stage = 'open-source';
      const source = await tab(sourceUrl);
      await source('new Promise(resolve => document.readyState === "complete" ? resolve(true) : addEventListener("load", () => resolve(true), {once:true}))');
      stage = 'open-popup';
      let popup = await tab(extensionUrl + '/popup.html');
      let ready;
      for (let attempt = 0; attempt < 100; attempt++) { ready = await popup('!!document.getElementById("mcp-connect")'); if (ready) break; await new Promise(resolve => setTimeout(resolve, 50)); }
      assert.ok(ready);
      stage = 'select-source';
      const selected = JSON.parse(await popup(`(async () => {
        const api = globalThis.browser ?? chrome;
        await api.storage.local.set({'mcp-settings-v1':{version:1, enabled:true, mode:${JSON.stringify(values.write ? 'read-write' : 'read-only')}, inherit:true,${hfsBinary ? `nativeEnabled:false,hfs:{enabled:true,endpoint:${JSON.stringify(hfsEndpoint)}}` : ''}}});
        const target = (await api.tabs.query({})).find(tab => tab.url === ${JSON.stringify(sourceUrl)});
        await api.tabs.update(target.id, {active:true});
        await api.windows.update(target.windowId, {focused:true});
        return JSON.stringify(await api.runtime.sendMessage({type:'mcp-ui-v1',action:'source'}));
      })()`));
      assert.equal(selected.ok, true, `${selected.code}: ${selected.error}`);
      const settings = await tab(extensionUrl + '/mcp.html#' + selected.sourceId);
      const ui = (action, fields = {}) => settings(`(async()=>JSON.stringify(await (globalThis.browser ?? chrome).runtime.sendMessage(${JSON.stringify({ type: 'mcp-ui-v1', action, ...fields })})))()`).then(JSON.parse);
      stage = 'settings-read';
      const state = await ui('read'); assert.equal(state.ok, true);
      let hfsClient;
      if (hfsBinary) {
        const generated = await ui('hfs-generate', { endpoint: hfsEndpoint }); assert.equal(generated.ok, true);
        const serverDirectory = join(root, 'hfs'); await mkdir(serverDirectory);
        await writeFile(join(serverDirectory, 'config.yaml'), generated.content, { mode: 0o600 });
        hfs = spawn(hfsBinary, ['--cwd', serverDirectory, '--no-central'], { stdio: 'ignore' });
        let healthy = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try { const health = await (await fetch(hfsEndpoint + '/pac/v1/health')).json(); if (health.relayProtocol === 1) { healthy = true; break; } } catch {}
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(healthy, 'HFS health unavailable');
        hfsClient = await ui('hfs-add-client', { name: 'Synthetic scoped HFS test', endpoint: hfsEndpoint }); assert.equal(hfsClient.ok, true);
      }
      assert.equal((await ui('start')).ok, true);
      let connected;
      for (let attempt = 0; attempt < 100; attempt++) { connected = await ui('read'); if (connected.transport === 'ready') break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert.equal(connected.transport, 'ready');
      stage = 'pairing';
      let credential, grant, transport;
      if (hfsBinary) {
        credential = { credentialId: hfsClient.clientId };
        grant = await ui('connect', { sourceId: selected.sourceId, clientId: credential.credentialId, allowWrite: values.write }); assert.equal(grant.ok, true);
        const url = (await ui('hfs-client-value', { clientId: credential.credentialId, field: 'url' })).value;
        const authorization = (await ui('hfs-client-value', { clientId: credential.credentialId, field: 'authorization' })).value;
        transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: authorization } } });
      } else {
        credential = { protocol: PROTOCOL, browser, instanceId: state.instanceId, credentialId: randomUUID(), secret: secret() };
        const bridge = await bridgeClient(config, credential);
        let pair; try { pair = await bridge.request({ tool: 'pair', arguments: {} }); } finally { bridge.close(); }
        assert.equal(pair.status, 'pending'); assert.equal((await ui('approve', { clientId: credential.credentialId, code: pair.code })).ok, true);
        grant = await ui('connect', { sourceId: selected.sourceId, clientId: credential.credentialId, allowWrite: values.write }); assert.equal(grant.ok, true);
        const credentialPath = join(directory, 'client.json'); await createPrivateJson(credentialPath, credential);
        transport = new StdioClientTransport({ command: process.execPath, args: [resolve('helper/src/cli.mjs'), 'stdio', '--directory', directory, '--credential', credentialPath], stderr: 'pipe' });
      }
      client = new Client({ name: 'synthetic-production-read-client', version: '1' });
      let toolListChanges = 0;
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => { toolListChanges++; });
      await client.connect(transport);
      const toolList = await client.listTools();
      assert.deepEqual(toolList.tools.map(tool => tool.name), ['list_shared_tabs', 'resolve_shared_tab', 'get_connection_status', 'read_page_context', ...(values.write ? ['click_element','fill_element','select_option','set_checked'] : [])]);
      stage = 'read-page';
      const result = await client.callTool({ name: 'read_page_context', arguments: { connectionId: grant.connectionId } });
      assert.notEqual(result.isError, true); const payload = JSON.parse(result.content[0].text);
      assert.ok(payload.context.includes('MCP_READ_SENTINEL_4242')); assert.ok(!payload.context.includes('NEVER_RETURN_PASSWORD_9911'));
      assert.equal(payload.mode, values.write ? 'read-write' : 'read-only');
      stage = 'local-preview';
      const preview = await ui('test', { sourceId: selected.sourceId }); assert.equal(preview.ok, true); assert.equal(preview.result.context.replace(/[a-f0-9-]{36}/g, 'REF'), payload.context.replace(/[a-f0-9-]{36}/g, 'REF'));
      await assert.rejects(client.callTool({ name: 'click_element', arguments: { connectionId: grant.connectionId } }));
      const actionCharacters = [], measurementSamples = {}, externalForms = [];
      let activeWriteSourceUrl = sourceUrl;
      if (values.write) {
        const ref = (snapshot, label) => {
          const matches = snapshot.context.split('\n').filter(line => (label === null ? line.trimStart().startsWith('textbox [') && !line.includes('placeholder=') : label instanceof RegExp ? label.test(line) : line.includes('"' + label + '"')) && line.includes('ref='));
          // Placeholder-only fields are identified hints, not the anonymous
          // iframe fixture. Never pick an anonymous control just by its order.
          if (label === null) assert.equal(matches.length, 1, 'Anonymous iframe target must be unique');
          const line = matches[0];
          assert.ok(line, 'Missing issued reference for ' + label); return line.match(/ref="([a-f0-9-]{36})"/)[1];
        };
        const duplicateRefs = payload.context.split('\n').filter(line => line.includes('"Duplicate"') && line.includes('ref=')).map(line => line.match(/ref="([a-f0-9-]{36})"/)[1]);
        assert.equal(new Set(duplicateRefs).size, 2);
        const approve = async (allow, completed) => {
          let approval;
          for (let attempt = 0; attempt < 150; attempt++) {
            if (completed()) throw new Error('Write finished before approval: '+JSON.stringify(completed()));
            const found = JSON.parse(await settings(`(async()=>JSON.stringify((await (globalThis.browser??chrome).tabs.query({})).filter(tab=>tab.url?.startsWith(${JSON.stringify(extensionUrl + '/mcp-approval.html#')})).map(tab=>tab.url)))()`));
            if (found.length) { approval = found[0]; break; } await new Promise(resolve=>setTimeout(resolve,50));
          }
          assert.ok(approval, 'No browser approval page');
          const page = await tab(approval, true);
          const result = JSON.parse(await page(`(async()=>JSON.stringify(await (globalThis.browser??chrome).runtime.sendMessage({type:'mcp-ui-v1',action:'approval-read'})))()`));
          assert.equal(result.ok, true);
          await page(`(()=>{void (globalThis.browser??chrome).runtime.sendMessage({type:'mcp-ui-v1',action:'approval-answer',allow:${allow}}).catch(()=>{});return true})()`).catch(()=>{});
        };
        const write = async (tool, snapshot, label, extra = {}, allow = true) => {
          stage = tool;
          const args = { connectionId: grant.connectionId, snapshotId: snapshot.snapshotId, elementRef: ref(snapshot,label), operationId: randomUUID(), ...extra };
          let completed; const pending = client.callTool({name:tool,arguments:args}).then(value=>{completed=JSON.parse(value.content[0].text);return value;}); await approve(allow,()=>completed);
          // Keep the synthetic source foregrounded so the async fixture is not
          // subject to background-tab timer throttling after its approval closes.
          await settings(`(async()=>{const api=globalThis.browser??chrome;const target=(await api.tabs.query({})).find(tab=>tab.url===${JSON.stringify(activeWriteSourceUrl)});await api.tabs.update(target.id,{active:true});return true})()`);
          const wire = await pending; actionCharacters.push(JSON.stringify(wire).length); const result = JSON.parse(wire.content[0].text); return {result,args,wire};
        };
        const denied = await write('click_element', payload, 'Count action', {}, false); assert.equal(denied.result.status,'rejected');
        assert.equal(await source('window.clickCount||0'),0);
        let current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
        const filled = await write('fill_element', current, 'Nickname', {text:'Synthetic replacement',responseMode:'full'}); assert.equal(filled.result.status,'applied',JSON.stringify(filled.result));
        assert.equal(await source('document.getElementById("nickname").value'),'Synthetic replacement'); current = filled.result.snapshot;
        const scoped = await write('fill_element', current, 'Nickname', {text:'Synthetic replacement'});
        assert.equal(scoped.args.responseMode, undefined);
        assert.equal(filled.result.snapshot.scope, undefined);
        assert.equal(scoped.result.status, 'applied', JSON.stringify(scoped.result));
        assert.equal(scoped.result.snapshot.scope.kind, 'scoped', JSON.stringify(scoped.result.snapshot.scope));
        assert.ok(!scoped.result.snapshot.context.includes('Count action'));
        assert.equal(await source('document.getElementById("nickname").value'), 'Synthetic replacement');
        if (values['capture-metrics']) { measurementSamples.inputFull = filled.wire; measurementSamples.inputScoped = scoped.wire; }
        const scopedClear = await write('fill_element', scoped.result.snapshot, 'Nickname', {text:'', responseMode:'scoped'});
        assert.equal(scopedClear.result.snapshot.scope.kind, 'scoped', JSON.stringify(scopedClear.result));
        assert.equal(await source('document.getElementById("nickname").value'), '');
        const scopedReplay = JSON.parse((await client.callTool({name:'fill_element', arguments:scopedClear.args})).content[0].text);
        assert.equal(scopedReplay.status, 'applied'); assert.equal(scopedReplay.snapshot, undefined);
        const restored = await write('fill_element', scopedClear.result.snapshot, 'Nickname', {text:'Synthetic replacement', responseMode:'scoped'});
        assert.equal(restored.result.status, 'applied');
        // Real browser/MCP regression: masked ordinary text values keep a
        // fresh ref and can be cleared, including an unnamed placeholder target.
        for (const [label, elementId] of [['First Name', 'personal-name'], ['Last Name', 'hint-name']]) {
          const beforePersonal = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
          const personal = await write('fill_element', beforePersonal, label, {text:'SyntheticExample'});
          assert.equal(personal.result.status, 'applied', JSON.stringify(personal.result));
          assert.equal(personal.result.snapshot.scope.kind, 'scoped', JSON.stringify(personal.result.snapshot.scope));
          assert.ok(!personal.result.snapshot.context.includes('SyntheticExample'));
          assert.equal(await source(`document.getElementById(${JSON.stringify(elementId)}).value`), 'SyntheticExample');
          const clearPersonal = await write('fill_element', personal.result.snapshot, label, {text:''});
          assert.equal(clearPersonal.result.status, 'applied');
          assert.equal(await source(`document.getElementById(${JSON.stringify(elementId)}).value`), '');
          assert.ok(clearPersonal.result.snapshot.context.includes('value=""'));
        }
        const recovery = await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}});
        current = JSON.parse(recovery.content[0].text);
        if (values['capture-metrics']) measurementSamples.recoveryRead = recovery;
        const notes = 'First line 🌻\nSecond line\nThird line';
        const notesFull = await write('fill_element', current, 'Notes', {text:notes,responseMode:'full'});
        assert.equal(notesFull.result.status, 'applied'); assert.equal(await source('document.getElementById("notes").value'), notes);
        const clearedNotes = await write('fill_element', notesFull.result.snapshot, 'Notes', {text:''});
        const notesScoped = await write('fill_element', clearedNotes.result.snapshot, 'Notes', {text:notes, responseMode:'scoped'});
        assert.equal(notesScoped.result.snapshot.scope.kind, 'scoped', JSON.stringify(notesScoped.result));
        if (values['capture-metrics']) { measurementSamples.notesFull = notesFull.wire; measurementSamples.notesScoped = notesScoped.wire; }
        current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
        const controlled = await write('fill_element', current, 'Controlled', {text:'Controlled field 🌻', responseMode:'scoped'});
        assert.equal(controlled.result.snapshot.scope.kind, 'scoped', JSON.stringify(controlled.result));
        assert.equal(await source('window.appValue'), 'Controlled field 🌻');
        assert.ok(controlled.result.snapshot.context.includes('Validation: updated'), JSON.stringify({ snapshot: controlled.result.snapshot, status: await source('document.getElementById("fill-status").textContent') }));
        current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
        const replaced = await write('fill_element', current, 'Replaceable', {text:'Replacement node', responseMode:'scoped'});
        assert.equal(replaced.result.status, 'applied'); assert.equal(replaced.result.snapshot.scope.kind, 'full');
        assert.equal(replaced.result.snapshot.scope.fallbackReason, 'target-replaced-or-filtered');
        assert.equal(await source('window.controlledBlurred'), true);
        const rebuild = await write('fill_element', replaced.result.snapshot, 'Rebuild', {text:'New dependency', responseMode:'scoped'});
        assert.equal(rebuild.result.snapshot.scope.kind, 'full'); assert.ok(rebuild.result.snapshot.context.includes('Dependent'));
        const large = await write('fill_element', rebuild.result.snapshot, 'Large parent', {text:'Bounded parent', responseMode:'scoped'});
        assert.equal(large.result.snapshot.scope.kind, 'scoped'); assert.equal(large.result.snapshot.scope.parentTag, 'main');
        assert.ok(!large.result.snapshot.context.includes('Nickname'));
        assert.ok(Buffer.byteLength(JSON.stringify(large.wire)) <= 16384);
        current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
        const checked = await write('set_checked', current, 'Enabled', {checked:true}); assert.equal(checked.result.status,'applied',JSON.stringify(checked.result));
        assert.equal(await source('document.getElementById("enabled").checked'),true); current = checked.result.snapshot;
        const selected = await write('select_option',current,'Color',{optionRef:ref(current,'Green')}); assert.equal(selected.result.status,'applied',JSON.stringify(selected.result));
        assert.equal(await source('document.getElementById("color").selectedIndex'),1); current = selected.result.snapshot;
        const clicked = await write('click_element',current,'Count action'); assert.equal(clicked.result.status,'applied',JSON.stringify(clicked.result));
        assert.equal(await source('window.clickCount'),1);
        const frameAction = await write('click_element',clicked.result.snapshot,'Frame action'); assert.equal(frameAction.result.status,'applied',JSON.stringify(frameAction.result));
        assert.equal(await source('document.querySelector("iframe").contentWindow.frameClicks'),1);
        const unnamed = await write('fill_element', frameAction.result.snapshot, null, { text: 'Unnamed iframe replacement' });
        assert.equal(unnamed.result.status, 'applied', JSON.stringify(unnamed.result));
        assert.equal(await source('document.querySelector("iframe").contentDocument.getElementById("unnamed").value'), 'Unnamed iframe replacement');
        current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
        const shadowAction = await write('click_element',current,'Shadow action'); assert.equal(shadowAction.result.status,'applied',JSON.stringify(shadowAction.result));
        assert.equal(await source('window.shadowClicks'),1);
        const replay = JSON.parse((await client.callTool({name:'click_element',arguments:clicked.args})).content[0].text); assert.equal(replay.status,'applied'); assert.equal(await source('window.clickCount'),1);
        const stale = JSON.parse((await client.callTool({name:'click_element',arguments:{...clicked.args,operationId:randomUUID()}})).content[0].text); assert.equal(stale.status,'rejected');
        if (values['external-forms']) {
          const originalGrant = grant;
          const specs = [
            { site: 'Selenium', url: 'https://www.selenium.dev/selenium/web/web-form.html', fields: [
              { label: 'Text input', expression: 'document.querySelector("[name=my-text]")?.value', text: 'Page as Context S10 🌻' },
              { label: 'Textarea', expression: 'document.querySelector("[name=my-textarea]")?.value', text: 'First line\nSecond line 🌻' },
            ] },
            { site: 'DemoQA', url: 'https://demoqa.com/automation-practice-form', fields: [
              { label: 'First Name', expression: 'document.getElementById("firstName")?.value', text: 'Synthetic' },
              { label: 'Current Address', expression: 'document.getElementById("currentAddress")?.value', text: 'Synthetic test address\nNo submission' },
            ] },
            { site: 'Google Forms', url: 'https://docs.google.com/forms/d/e/1FAIpQLSciCcNILfeSdgUavm_GYuCFE_G8InD1YVkIWAiTU_B3-l9AkA/viewform', fields: [
              { label: /textbox "Your first name/, expression: 'Array.from(document.querySelectorAll("input")).find(input=>(input.getAttribute("aria-labelledby")??"").split(" ").some(id=>document.getElementById(id)?.textContent.includes("Your first name")))?.value', text: 'Synthetic S10' },
              { label: /textbox "Describe the perfect holiday destination/, expression: 'document.querySelectorAll("textarea").length===1?document.querySelector("textarea").value:undefined', text: 'Synthetic test paragraph with more than fifty characters. Ukraine 🌻' },
            ] },
          ];
          try {
            for (const spec of specs) {
              stage = 'external-open-' + spec.site;
              let externalSource;
              try { externalSource = await tab(spec.url); }
              catch { externalForms.push({ site: spec.site, status: 'navigation-unavailable' }); continue; }
              activeWriteSourceUrl = spec.url;
              // Navigation completion can precede the extension's onUpdated
              // delivery. Let that invalidation settle before issuing a source token.
              await new Promise(resolve => setTimeout(resolve, 500));
              await settings(`(async()=>{const api=globalThis.browser??chrome;const target=(await api.tabs.query({})).find(tab=>tab.url===${JSON.stringify(spec.url)});await api.tabs.update(target.id,{active:true});return true})()`);
              let chosen = JSON.parse(await popup(`(async()=>JSON.stringify(await (globalThis.browser??chrome).runtime.sendMessage({type:'mcp-ui-v1',action:'source'})))()`));
              assert.equal(chosen.ok, true);
              for (let attempt = 0; attempt < 3; attempt++) {
                grant = await ui('connect', { sourceId: chosen.sourceId, clientId: credential.credentialId, allowWrite: true });
                if (grant.ok || grant.code !== 'source-required') break;
                // A late public-page load can invalidate the source token before any write.
                await new Promise(resolve => setTimeout(resolve, 500));
                // source opens a settings tab. Re-select the public test tab
                // before retrying source discovery, never that settings tab.
                await settings(`(async()=>{const api=globalThis.browser??chrome;const target=(await api.tabs.query({})).find(tab=>tab.url===${JSON.stringify(spec.url)});await api.tabs.update(target.id,{active:true});return true})()`);
                chosen = JSON.parse(await popup(`(async()=>JSON.stringify(await (globalThis.browser??chrome).runtime.sendMessage({type:'mcp-ui-v1',action:'source'})))()`));
                if (!chosen.ok) break;
              }
              if (!grant.ok) { externalForms.push({site:spec.site,status:'connection-unavailable',code:grant.code}); continue; }
              for (const field of spec.fields) {
                stage = 'external-fill-' + spec.site + '-' + String(field.label);
                let current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
                const original = await externalSource(field.expression);
                let issued;
                try { issued = ref(current, field.label); } catch {}
                if (!issued || typeof original !== 'string') { externalForms.push({site: spec.site, field: String(field.label), status:'no-unambiguous-exported-text-target'}); continue; }
                let applied = false;
                try {
                  const filled = await write('fill_element', current, field.label, {text:field.text,responseMode:'scoped'});
                  assert.equal(filled.result.status, 'applied'); applied = true;
                  assert.equal(await externalSource(field.expression), field.text);
                  externalForms.push({site:spec.site,field:String(field.label),status:'passed',scope:filled.result.snapshot?.scope?.kind,fallbackReason:filled.result.snapshot?.scope?.fallbackReason,restored:false});
                } finally {
                  if (applied) {
                    current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
                    let restorable; try { restorable = ref(current,field.label); } catch {}
                    const last = externalForms.at(-1);
                    if (restorable) {
                      const restored = await write('fill_element',current,field.label,{text:original,responseMode:'scoped'});
                      assert.equal(restored.result.status,'applied'); assert.equal(await externalSource(field.expression),original);
                      if (last?.status==='passed') last.restored=true;
                    } else {
                      // A fully hidden or otherwise filtered target remains inaccessible.
                      // Never bypass privacy or substitute a direct DOM setter.
                      assert.ok(!current.context.includes(field.text), 'Missing restore reference without privacy filtering');
                      if (last?.status==='passed') last.restoreUnavailable='target-not-exported-after-privacy-filtering; disposable-profile-only';
                    }
                  }
                }
              }
              // Source tokens can expire during the two fill/restore cycles.
              // Refresh discovery for teardown; never replay the completed writes.
              stage = 'external-downgrade-' + spec.site;
              console.log(JSON.stringify({ browser, externalForms }));
              const teardownSource = JSON.parse(await popup(`(async()=>JSON.stringify(await (globalThis.browser??chrome).runtime.sendMessage({type:'mcp-ui-v1',action:'source'})))()`));
              assert.equal(teardownSource.ok, true);
              const downgrade = await ui('connect', {sourceId:teardownSource.sourceId,clientId:credential.credentialId,allowWrite:false});
              assert.equal(downgrade.ok,true, JSON.stringify(downgrade));
            }
          } finally { grant = originalGrant; activeWriteSourceUrl = sourceUrl; }
        }

      }
      stage = 'tool-list-change';
      const downgraded = await ui('connect', { sourceId: selected.sourceId, clientId: credential.credentialId, allowWrite: false });
      assert.equal(downgraded.ok, true);
      if (!hfsBinary) {
        for (let attempt = 0; attempt < 100 && !toolListChanges; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(toolListChanges > 0, 'Missing SDK tools/list_changed notification');
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['list_shared_tabs','resolve_shared_tab','get_connection_status','read_page_context']);
      } else {
        assert.equal(JSON.parse((await client.callTool({ name: 'get_connection_status', arguments: { connectionId: downgraded.connectionId } })).content[0].text).mode, 'read-only');
      }
      if (values.write) {
        const forbidden = await client.callTool({ name: 'click_element', arguments: { connectionId: downgraded.connectionId, snapshotId: payload.snapshotId, elementRef: randomUUID(), operationId: randomUUID() } });
        assert.equal(JSON.parse(forbidden.content[0].text).error, 'read-only');
      }
      stage = 'stop';
      await ui('stop');
      if (hfsBinary) { await assert.rejects(client.callTool({ name: 'read_page_context', arguments: { connectionId: downgraded.connectionId } })); }
      else { const stopped = await client.callTool({ name: 'read_page_context', arguments: { connectionId: downgraded.connectionId } }); assert.equal(stopped.isError, true); }
      reports.push({ browser, version, transport: hfsBinary ? 'hfs' : 'native', read: true, pairing: true, localMatchesExternal: true, passwordAbsent: true, writeRejected: true, writeActions: values.write ? ['click','fill','select-option','set-checked'] : [], retryDeduplicated: values.write, stopRejected: true,
        toolListChanged: !hfsBinary, hfsStableCatalog: !!hfsBinary, sameOriginFrame: values.write, unnamedIframeFill: values.write, openShadowRoot: values.write, scopedFill: values.write, defaultScopedFill: values.write, explicitFullFill: values.write, scopedClear: values.write,
        wireCharacters: JSON.stringify(result).length, toolListCharacters: JSON.stringify(toolList).length, actionCharacters, externalForms, ...(values['capture-metrics'] ? { measurementSamples } : {}), controlledFill: values.write, asyncValidation: values.write, textareaUnicode: values.write, replacedTargetFallback: values.write, rebuiltFormFallback: values.write, largeParentBounded: values.write, limitations: ['Synthetic permission pregrants, programmatic pairing approval; real permission/consent prompts and a model application require manual checks.'] });
      console.log(`${browser}: production pairing, explicit read${values.write ? ", four approved writes, denial and retry protection" : ""}, privacy and Stop passed`);
    } catch (error) { console.error(`${browser} read-only probe failed at ${stage}: ${error.message}`); throw error; }
    finally { await client?.close(); runtime?.protocol.close(); await runtime?.stop(); await broker?.close(); if (hfs) { const exited = new Promise(resolve => hfs.once('exit', resolve)); hfs.kill('SIGTERM'); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]); if (hfs.exitCode === null) hfs.kill('SIGKILL'); } if (testManifest) await unlink(testManifest); if (installed) await uninstall(directory); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 }); }
  }
} finally {
  await new Promise(resolve => http.close(resolve));
  // Preserve completed browser evidence even if another browser cannot start.
  if (values.report) { await mkdir(resolve(values.report, '..'), { recursive: true }); await writeFile(values.report, JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, sdk: '1.32.2', platform: process.platform, reports }, null, 2) + '\n'); }
}
