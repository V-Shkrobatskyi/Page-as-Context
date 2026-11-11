// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
// Exercise the packaged router over MCP without browser registrations or grants.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
const plugin = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the unpacked MCPB bundle.');
const from = rel => import(pathToFileURL(join(plugin, rel)));
const { Client } = await from('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
const { StdioClientTransport } = await from('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
const { InMemoryTransport } = await from('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js');
const { ToolListChangedNotificationSchema } = await from('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js');
const { createDesktopServer } = await from('desktop-server.mjs');
const { toolCatalog } = await from('helper/src/catalog.mjs');
const names = toolCatalog().map(tool => tool.name);
const models = Object.fromEntries(['chrome', 'firefox'].map(browser => [browser, {
  calls: [], listeners: new Set(), connected: browser === 'chrome', fail: false, closed: false, setupClosed: false,
}]));
const routes = Object.fromEntries(Object.entries(models).map(([browser, model]) => [browser, {
  bridge: {
    async request(request) {
      model.calls.push(request);
      if (!model.connected || model.fail) throw new Error('not-connected');
      if (request.tool === 'list-tools') return { tools: names };
      if (request.tool === 'read_page_context') return { context: browser, connectionId: request.arguments.connectionId };
      return { status: 'applied', operationId: request.arguments.operationId };
    },
    onToolsChanged(listener) { model.listeners.add(listener); return () => model.listeners.delete(listener); },
    close() { model.closed = true; },
  },
  setup: {
    tools: [{ name: 'setup_status', description: 'Fixture setup status.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }],
    async call(name, args) { model.calls.push({ setup: name, args }); return { browser, status: 'pending' }; },
    async close() { model.setupClosed = true; },
  },
}]));
const session = createDesktopServer({ routes, version: '1.2.4' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'dual-browser-routing-check', version: '1' });
try {
  await session.server.connect(serverTransport); await client.connect(clientTransport);
  const initial = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(initial.includes('chrome_fill_element'));
  assert.ok(initial.includes('firefox_read_page_context'));
  assert.ok(!initial.includes('firefox_fill_element'), 'Unconfigured Firefox must not inherit Chrome write capability.');
  let notifications = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => { notifications++; });
  models.firefox.connected = true;
  for (const notify of models.firefox.listeners) notify();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(notifications > 0);
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'firefox_fill_element'));
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const decode = value => JSON.parse(value.content[0].text);
  const connectionId = 'same_connection_00001';
  for (const browser of ['chrome', 'firefox']) assert.equal(decode(await call(`${browser}_read_page_context`, { connectionId })).context, browser);
  const otherCalls = models.firefox.calls.length;
  models.chrome.fail = true;
  assert.equal(decode(await call('chrome_read_page_context', { connectionId })).error, 'not-connected');
  const operationId = randomUUID(), before = models.chrome.calls.length;
  const write = decode(await call('chrome_fill_element', { connectionId, snapshotId: randomUUID(), elementRef: randomUUID(), operationId, text: 'Fixture' }));
  assert.equal(write.status, 'outcome-unknown'); assert.equal(write.operationId, operationId);
  assert.equal(models.chrome.calls.length, before + 1, 'Never replay an uncertain write.');
  assert.equal(models.firefox.calls.length, otherCalls, 'No read or write fallback to the other browser.');
  await assert.rejects(call('read_page_context', { connectionId }));
  await assert.rejects(call('firefox_read_page_context', { connectionId, browser: 'chrome' }));
  const pending = await call('firefox_setup_status');
  assert.equal(pending.isError, undefined, 'Pending setup is not a failed write.');
  assert.equal(decode(pending).browser, 'firefox');
} finally {
  await session.close(); await client.close();
}
for (const model of Object.values(models)) {
  assert.equal(model.listeners.size, 0); assert.equal(model.closed, true); assert.equal(model.setupClosed, true);
}
// Existing Claude Code routes remain unprefixed and browser-specific.
const root = await mkdtemp('/private/tmp/pac-claude-code-regression-');
try {
  const code = new Client({ name: 'claude-code-entry-check', version: '1' });
  try {
    await code.connect(new StdioClientTransport({ command: join(plugin, 'runtime/node'),
      args: [join(plugin, 'server.mjs'), 'chrome', '--client', 'code', '--directory', root, '--manifest-home', join(root, 'home')], stderr: 'pipe' }));
    const tools = (await code.listTools()).tools;
    assert.equal(tools.length, 9); assert.ok(tools.some(tool => tool.name === 'setup_status'));
    assert.ok(tools.every(tool => !tool.name.startsWith('chrome_') && !tool.name.startsWith('firefox_')));
  } finally { await code.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ passed: true, concurrentBrowserRoutes: true, perBrowserWriteGating: true,
  noCrossBrowserFallbackOrReplay: true, identicalConnectionIdsIsolated: true, toolListChangeNotification: true,
  pendingSetupNotError: true, invalidRoutesAndArgumentsRejected: true, bothRoutesClosed: true, claudeCodeUnchanged: true }));
