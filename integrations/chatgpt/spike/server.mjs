// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { Server } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StdioServerTransport } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuration, privateJson } from './helper/src/security.mjs';
import { managedClient } from './helper/src/managed-client.mjs';
import { probeTool } from './helper/src/mcp.mjs';

// Installation spike only. Never add production page tools or setup mutations here.
const root = dirname(fileURLToPath(import.meta.url));
const server = new Server({ name: 'page-as-context-package-spike', version: '0.1.0' }, {
  capabilities: { tools: {} },
  instructions: 'Content-free installation test. This package cannot read pages, interact with them, register a native host, or authorize access. Report failures accurately.',
});
const packageTool = { ...probeTool, name: 'package_probe',
  description: 'Echo a synthetic nonce and report bundled runtime and cache loading. Does not read a page or modify setup.' };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [packageTool, probeTool] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const args = params.arguments;
  if (![packageTool.name, probeTool.name].includes(params.name) || !args || Object.keys(args).length !== 1 ||
    typeof args.nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/u.test(args.nonce)) {
    throw new McpError(ErrorCode.InvalidParams, 'Provide one synthetic nonce of 16–80 letters, digits, underscores or hyphens.');
  }
  if (params.name === packageTool.name) return { content: [{ type: 'text', text: JSON.stringify({
    ok: true, nonce: args.nonce, node: process.version, platform: process.platform, arch: process.arch,
    bundledRuntime: process.execPath === join(root, 'runtime/node'),
    installedCache: /\/plugins\/cache\/[^/]+\/page-as-context-package-spike\/[^/]+$/u.test(root),
    pageAccess: false,
  }) }] };
  let bridge;
  try {
    // Test drivers provision this private synthetic route; a model cannot create it.
    const route = await privateJson(process.env.PAC_PACKAGE_SPIKE_ROUTE ?? join(homedir(), '.page-as-context/chatgpt-package-spike/route.json'));
    if (Object.keys(route).sort().join(',') !== 'credential,directory') throw new Error('invalid-route');
    const config = await configuration(route.directory), credential = await privateJson(route.credential);
    bridge = managedClient(config, credential);
    const value = await bridge.request({ tool: probeTool.name, arguments: args });
    if (value?.ok !== true || value.nonce !== args.nonce || value.instanceId !== credential.instanceId ||
      value.browser !== credential.browser || Object.keys(value).sort().join(',') !== 'browser,instanceId,nonce,ok') throw new Error('invalid-response');
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch {
    return { isError: true, content: [{ type: 'text', text: 'Synthetic browser probe unavailable. Complete the isolated installation test first. No page access was requested.' }] };
  } finally { bridge?.close(); }
});
const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 });
process.stdin.once('end', () => void server.close());
await server.connect(transport);
