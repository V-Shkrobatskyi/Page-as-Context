// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

// Use the installed app's own SDK/runtime, without its account or persistent profile.
const { values } = parseArgs({ options: {
  sdk: { type: 'string' }, runtime: { type: 'string' }, marketplace: { type: 'string' }, probe: { type: 'boolean', default: false },
} });
if (!values.sdk || !values.runtime || !values.marketplace) throw new Error('Pass --sdk APP_SDK_INDEX --runtime APP_COPILOT --marketplace BUILT_MARKETPLACE [--probe].');
const runtime = resolve(values.runtime), marketplace = resolve(values.marketplace);
const catalog = JSON.parse(await readFile(join(marketplace, '.github/plugin/marketplace.json'), 'utf8'));
assert.equal(catalog.name, `page-as-context-copilot-app${values.probe ? '-probe' : ''}`);
const { CopilotClient, RuntimeConnection } = await import(pathToFileURL(resolve(values.sdk)));
const root = await mkdtemp('/private/tmp/pac-copilot-app-loader-');
const env = { ...process.env, HOME: root, COPILOT_HOME: root, NODE_OPTIONS: '', NODE_PATH: '', GH_TOKEN: '', GITHUB_TOKEN: '', COPILOT_GITHUB_TOKEN: '' };
const run = args => {
  const result = spawnSync(runtime, args, { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
};
let session, client;
const timer = setTimeout(() => { console.error('App runtime loader check timed out.'); process.exit(2); }, 60000);
try {
  run(['plugin', 'marketplace', 'add', marketplace]);
  const specification = `page-as-context@${catalog.name}`;
  run(['plugin', 'install', specification]);
  const listed = JSON.parse(run(['plugin', 'list', '--json']));
  assert.ok(listed.some(plugin => plugin.name === 'page-as-context' && plugin.enabled));
  client = new CopilotClient({
    connection: RuntimeConnection.forStdio({ path: runtime, env }),
    baseDirectory: root, workingDirectory: root, useLoggedInUser: false,
  });
  await client.start();
  const names = values.probe ? ['loader-probe'] : ['browser-chrome', 'browser-firefox'];
  const discovered = await client.rpc.mcp.discover({ workingDirectory: root });
  assert.deepEqual(discovered.servers.filter(server => server.sourcePlugin === 'page-as-context').map(server => server.name).sort(), names);
  // No prompt or model inference is sent. Approve only the fixture tool under test.
  const toolName = values.probe ? 'loader_probe' : 'setup_status';
  session = await client.createSession({
    model: 'gpt-4.1', enableConfigDiscovery: true,
    onPermissionRequest: async request => request.kind === 'mcp' && names.includes(request.serverName) && [toolName, `${request.serverName}-${toolName}`].includes(request.toolName)
      ? { kind: 'approve-once' } : { kind: 'reject', feedback: 'Only the isolated fixture check is authorized.' },
  });
  if (!values.probe) {
    await session.rpc.skills.ensureLoaded();
    const skills = await session.rpc.skills.list();
    assert.ok(skills.skills.some(skill => skill.name === 'github-copilot-app-browser-setup'));
  }
  for (const serverName of names) {
    await session.rpc.mcp.startServer({ serverName });
    const tools = await session.rpc.mcp.listTools({ serverName });
    assert.ok(tools.tools.some(tool => tool.name === toolName));
    if (values.probe) assert.deepEqual(tools.tools.map(tool => tool.name), ['loader_probe']);
    else assert.equal(tools.tools.length, 9);
  }
  await session.rpc.tools.initializeAndValidate();
  const metadata = await session.rpc.tools.getCurrentMetadata();
  for (const serverName of names) {
    const tool = metadata.tools.find(tool => tool.mcpServerName === serverName && tool.mcpToolName === toolName);
    assert.ok(tool, `${serverName}/${toolName} must be offered by the real runtime.`);
    const nonce = randomUUID();
    const result = await session.rpc.tools.execute({ name: tool.name, arguments: values.probe ? { nonce } : {} });
    assert.equal(result.resultType, 'success', result.error);
    assert.ok(result.textResultForLlm.includes(values.probe ? nonce : 'nativeInstalled'), JSON.stringify(result));
  }
  if (!values.probe) assert.equal(await readdir(join(root, '.page-as-context')).then(entries => entries.length).catch(error => { if (error.code === 'ENOENT') return 0; throw error; }), 0);
  await session.disconnect(); session = undefined;
  await client.stop(); client = undefined;
  run(['plugin', 'disable', specification]);
  assert.equal(JSON.parse(run(['plugin', 'list', '--json'])).find(plugin => plugin.name === 'page-as-context').enabled, false);
  run(['plugin', 'uninstall', specification]);
  run(['plugin', 'marketplace', 'remove', catalog.name]);
  const afterRemoval = JSON.parse(run(['plugin', 'list', '--json']));
  assert.ok(!afterRemoval.some(plugin => plugin.name === 'page-as-context'), JSON.stringify(afterRemoval.filter(plugin => plugin.name === 'page-as-context')));
  console.log(JSON.stringify({ passed: true, probe: values.probe, appRuntime: runtime, sdk: resolve(values.sdk), localMarketplaceInstalled: true, pluginDiscovery: true, mcpLaunch: true, toolsInvoked: names.map(name => `${name}/${toolName}`), disableAndUninstall: true, isolatedProfile: true, modelInference: false, appUiAcceptance: false, liveBrowserAcceptance: false }, null, 2));
} finally {
  await session?.disconnect().catch(() => {});
  await client?.stop().catch(() => {});
  clearTimeout(timer);
  await rm(root, { recursive: true, force: true });
}
