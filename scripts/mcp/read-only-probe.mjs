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
import { install, uninstall } from '../../helper/src/install.mjs';
import { configuration, secret, createPrivateJson, PROTOCOL } from '../../helper/src/security.mjs';
import { startBroker } from '../../helper/src/broker.mjs';
import { bridgeClient } from '../../helper/src/client.mjs';
import { Client } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { ToolListChangedNotificationSchema } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { launch } from './browser-protocol.mjs';

const { values } = parseArgs({ options: { report: { type: 'string' }, targets: { type: 'string', default: 'chrome,firefox' }, write: { type: 'boolean', default: false } } });
const reports = [];
const http = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  if (_request.url === '/child') { response.end('<!doctype html><title>Synthetic child</title><button onclick="window.frameClicks=(window.frameClicks||0)+1">Frame action</button>'); return; }
  response.end('<!doctype html><title>Synthetic MCP form</title><main><h1>MCP_READ_SENTINEL_4242</h1><label>Email<input value="synthetic@example.test"></label><label>Password<input type="password" value="NEVER_RETURN_PASSWORD_9911"></label><button disabled>Submit</button><label>Nickname<input id="nickname"></label><label>Enabled<input id="enabled" type="checkbox"></label><label>Color<select size="2" id="color"><option>Blue</option><option>Green</option></select></label><button id="counter" onclick="window.clickCount=(window.clickCount||0)+1;document.getElementById(\'count\').textContent=String(window.clickCount)">Count action</button><p id="count">0</p><button>Duplicate</button><button>Duplicate</button><iframe src="/child" title="Synthetic action frame"></iframe><div id="shadow-host"></div><script>const root=document.getElementById(\'shadow-host\').attachShadow({mode:\'open\'});root.innerHTML=\'<button>Shadow action</button>\';root.querySelector(\'button\').onclick=()=>window.shadowClicks=(window.shadowClicks||0)+1;</script></main>');
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
    manifest.host_permissions = ['http://127.0.0.1/*'];
    const uuid = '397907a1-a530-440a-bcd5-91425c048ddd';
    if (browser === 'firefox') {
      manifest.browser_specific_settings.gecko.data_collection_permissions = { required: ['websiteContent', 'browsingActivity', 'personalCommunications', ...(values.write ? ['websiteActivity'] : [])] };
      await writeFile(join(profile, 'user.js'), `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: uuid }))});\nuser_pref("app.update.enabled", false);\n`);
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    let runtime, broker, installed = false, client, stage = 'launch';
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
      await install({ directory, ...(browser === 'chrome' ? { chromeId: extensionId, chromeUserData: profile } : { firefoxId: extensionId }) }); installed = true;
      const config = await configuration(directory); broker = await startBroker(config);
      const extensionUrl = browser === 'chrome' ? `chrome-extension://${extensionId}` : `moz-extension://${uuid}`;
      const source = await tab(sourceUrl);
      await source('new Promise(resolve => document.readyState === "complete" ? resolve(true) : addEventListener("load", () => resolve(true), {once:true}))');
      let popup = await tab(extensionUrl + '/popup.html');
      let ready;
      for (let attempt = 0; attempt < 100; attempt++) { ready = await popup('!!document.getElementById("mcp-connect")'); if (ready) break; await new Promise(resolve => setTimeout(resolve, 50)); }
      assert.ok(ready);
      stage = 'select-source';
      const selected = JSON.parse(await popup(`(async () => {
        const api = globalThis.browser ?? chrome;
        await api.storage.local.set({'mcp-settings-v1':{version:1, enabled:true, mode:${JSON.stringify(values.write ? 'read-write' : 'read-only')}, inherit:true}});
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
      assert.equal((await ui('start')).ok, true);
      let connected;
      for (let attempt = 0; attempt < 100; attempt++) { connected = await ui('read'); if (connected.transport === 'ready') break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert.equal(connected.transport, 'ready');
      stage = 'pairing';
      const credential = { protocol: PROTOCOL, browser, instanceId: state.instanceId, credentialId: randomUUID(), secret: secret() };
      const bridge = await bridgeClient(config, credential);
      let pair; try { pair = await bridge.request({ tool: 'pair', arguments: {} }); } finally { bridge.close(); }
      assert.equal(pair.status, 'pending'); assert.equal((await ui('approve', { clientId: credential.credentialId, code: pair.code })).ok, true);
      const grant = await ui('connect', { sourceId: selected.sourceId, clientId: credential.credentialId, allowWrite: values.write }); assert.equal(grant.ok, true);
      const credentialPath = join(directory, 'client.json'); await createPrivateJson(credentialPath, credential);
      const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('helper/src/cli.mjs'), 'stdio', '--directory', directory, '--credential', credentialPath], stderr: 'pipe' });
      client = new Client({ name: 'synthetic-production-read-client', version: '1' });
      let toolListChanges = 0;
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => { toolListChanges++; });
      await client.connect(transport);
      const toolList = await client.listTools();
      assert.deepEqual(toolList.tools.map(tool => tool.name), ['get_connection_status', 'read_page_context', ...(values.write ? ['click_element','fill_element','select_option','set_checked'] : [])]);
      stage = 'read-page';
      const result = await client.callTool({ name: 'read_page_context', arguments: { connectionId: grant.connectionId } });
      assert.notEqual(result.isError, true); const payload = JSON.parse(result.content[0].text);
      assert.ok(payload.context.includes('MCP_READ_SENTINEL_4242')); assert.ok(!payload.context.includes('NEVER_RETURN_PASSWORD_9911'));
      assert.equal(payload.mode, values.write ? 'read-write' : 'read-only');
      stage = 'local-preview';
      const preview = await ui('test', { sourceId: selected.sourceId }); assert.equal(preview.ok, true); assert.equal(preview.result.context.replace(/[a-f0-9-]{36}/g, 'REF'), payload.context.replace(/[a-f0-9-]{36}/g, 'REF'));
      await assert.rejects(client.callTool({ name: 'click_element', arguments: { connectionId: grant.connectionId } }));
      const actionCharacters = [];
      if (values.write) {
        const ref = (snapshot, label) => {
          const line = snapshot.context.split('\n').find(line => line.includes('"' + label + '"') && line.includes('ref='));
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
          const wire = await pending; actionCharacters.push(JSON.stringify(wire).length); const result = JSON.parse(wire.content[0].text); return {result,args};
        };
        const denied = await write('click_element', payload, 'Count action', {}, false); assert.equal(denied.result.status,'rejected');
        assert.equal(await source('window.clickCount||0'),0);
        let current = JSON.parse((await client.callTool({name:'read_page_context',arguments:{connectionId:grant.connectionId}})).content[0].text);
        const filled = await write('fill_element', current, 'Nickname', {text:'Synthetic replacement'}); assert.equal(filled.result.status,'applied',JSON.stringify(filled.result));
        assert.equal(await source('document.getElementById("nickname").value'),'Synthetic replacement'); current = filled.result.snapshot;
        const checked = await write('set_checked', current, 'Enabled', {checked:true}); assert.equal(checked.result.status,'applied',JSON.stringify(checked.result));
        assert.equal(await source('document.getElementById("enabled").checked'),true); current = checked.result.snapshot;
        const selected = await write('select_option',current,'Color',{optionRef:ref(current,'Green')}); assert.equal(selected.result.status,'applied',JSON.stringify(selected.result));
        assert.equal(await source('document.getElementById("color").selectedIndex'),1); current = selected.result.snapshot;
        const clicked = await write('click_element',current,'Count action'); assert.equal(clicked.result.status,'applied',JSON.stringify(clicked.result));
        assert.equal(await source('window.clickCount'),1);
        const frameAction = await write('click_element',clicked.result.snapshot,'Frame action'); assert.equal(frameAction.result.status,'applied',JSON.stringify(frameAction.result));
        assert.equal(await source('document.querySelector("iframe").contentWindow.frameClicks'),1);
        const shadowAction = await write('click_element',frameAction.result.snapshot,'Shadow action'); assert.equal(shadowAction.result.status,'applied',JSON.stringify(shadowAction.result));
        assert.equal(await source('window.shadowClicks'),1);
        const replay = JSON.parse((await client.callTool({name:'click_element',arguments:clicked.args})).content[0].text); assert.equal(replay.status,'applied'); assert.equal(await source('window.clickCount'),1);
        const stale = JSON.parse((await client.callTool({name:'click_element',arguments:{...clicked.args,operationId:randomUUID()}})).content[0].text); assert.equal(stale.status,'rejected');
      }
      stage = 'tool-list-change';
      const downgraded = await ui('connect', { sourceId: selected.sourceId, clientId: credential.credentialId, allowWrite: false });
      assert.equal(downgraded.ok, true);
      for (let attempt = 0; attempt < 100 && !toolListChanges; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(toolListChanges > 0, 'Missing SDK tools/list_changed notification');
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['get_connection_status','read_page_context']);
      if (values.write) {
        const forbidden = await client.callTool({ name: 'click_element', arguments: { connectionId: downgraded.connectionId, snapshotId: payload.snapshotId, elementRef: randomUUID(), operationId: randomUUID() } });
        assert.equal(JSON.parse(forbidden.content[0].text).error, 'read-only');
      }
      await ui('stop'); const stopped = await client.callTool({ name: 'read_page_context', arguments: { connectionId: downgraded.connectionId } }); assert.equal(stopped.isError, true);
      reports.push({ browser, version, read: true, pairing: true, localMatchesExternal: true, passwordAbsent: true, writeRejected: true, writeActions: values.write ? ['click','fill','select-option','set-checked'] : [], retryDeduplicated: values.write, stopRejected: true,
        toolListChanged: true, sameOriginFrame: values.write, openShadowRoot: values.write,
        wireCharacters: JSON.stringify(result).length, toolListCharacters: JSON.stringify(toolList).length, actionCharacters, limitations: ['Synthetic permission pregrants, programmatic pairing approval; real permission/consent prompts and a model application require manual checks.'] });
      console.log(`${browser}: production pairing, explicit read${values.write ? ", four approved writes, denial and retry protection" : ""}, privacy and Stop passed`);
    } catch (error) { console.error(`${browser} read-only probe failed at ${stage}: ${error.message}`); throw error; }
    finally { await client?.close(); runtime?.protocol.close(); await runtime?.stop(); await broker?.close(); if (installed) await uninstall(directory); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 }); }
  }
} finally { await new Promise(resolve => http.close(resolve)); }
if (values.report) { await mkdir(resolve(values.report, '..'), { recursive: true }); await writeFile(values.report, JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, sdk: '1.32.2', platform: process.platform, reports }, null, 2) + '\n'); }
