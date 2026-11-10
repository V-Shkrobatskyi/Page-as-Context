// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { McpServer } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import { StdioServerTransport } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { z } from './helper/node_modules/zod/index.js';
const { version } = JSON.parse(await readFile(new URL('./plugin.json', import.meta.url), 'utf8'));
const server = new McpServer({ name: 'page-as-context-loader-probe', version });
server.registerTool('loader_probe', {
  description: 'Echo a content-free test nonce. Cannot access browsers or credentials.',
  inputSchema: { nonce: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/) },
}, async ({ nonce }) => ({ content: [{ type: 'text', text: JSON.stringify({ nonce, browserAccess: false }) }] }));
await server.connect(new StdioServerTransport());
