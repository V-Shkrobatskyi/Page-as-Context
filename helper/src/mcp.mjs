// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { MCP_INSTRUCTIONS, toolCatalog, validateToolArguments, toolResult, WRITE_TOOL_ACTIONS } from './catalog.mjs';
import { managedClient } from './managed-client.mjs';

// Deliberately content-free. Production tools are gated on the two-browser spike.
export const probeTool = {
  name: 'transport_probe',
  description: 'Check the explicitly configured Page as Context browser instance. Returns a synthetic nonce only; never reads a page.',
  inputSchema: { type: 'object', properties: { nonce: { type: 'string', pattern: '^[a-zA-Z0-9_-]{16,80}$', minLength: 16, maxLength: 80 } }, required: ['nonce'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export async function serveMcp(config, credential, input = process.stdin, output = process.stdout, spike = false, options = {}) {
  const bridge = options.bridge ?? managedClient(config, credential);
  const server = new Server({ name: spike ? 'page-as-context-transport-spike' : 'page-as-context', title: 'Page as Context', version: options.version ?? '0.2.0' }, { capabilities: { tools: { listChanged: true } },
    instructions: spike ? 'Development transport probe only. No page capture or interaction capabilities are available.' :
      MCP_INSTRUCTIONS +
        (options.setupInstructions ? ` ${options.setupInstructions}` : '') });
  const tools = toolCatalog();
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (spike) return { tools: [probeTool] };
    const allowed = await bridge.request({ tool: 'list-tools', arguments: {} }).catch(() => undefined);
    return { tools: [...tools.filter(tool => allowed?.tools?.includes(tool.name) ?? tool.annotations.readOnlyHint), ...(options.setup?.tools ?? [])] };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const args = request.params.arguments;
    if (!spike) {
      if (options.setup?.tools.some(tool => tool.name === request.params.name)) {
        try {
          const value = await options.setup.call(request.params.name, args ?? {});
          return { ...(value.error ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }] };
        } catch { throw new McpError(ErrorCode.InvalidParams, 'Invalid setup arguments.'); }
      }
      let values;
      try { values = validateToolArguments(request.params.name, args); }
      catch { throw new McpError(ErrorCode.InvalidParams, 'Invalid tool arguments.'); }
      try {
        const value = await bridge.request({ tool: request.params.name, arguments: values });
        if (!value) throw new Error('not-connected');
        return toolResult(value);
      } catch {
        const value = Object.hasOwn(WRITE_TOOL_ACTIONS, request.params.name)
          ? { operationId: values.operationId, status: 'outcome-unknown', error: 'outcome-unknown' }
          : { error: 'not-connected', instructions: 'Connection unavailable. Check browser setup and sharing in the extension popup.' };
        return toolResult(value);
      }
    }
    if (request.params.name !== probeTool.name || !args || Object.keys(args).length !== 1 || typeof args.nonce !== 'string' ||
      !/^[a-zA-Z0-9_-]{16,80}$/u.test(args.nonce)) throw new McpError(ErrorCode.InvalidParams, 'Invalid transport probe request.');
    try {
      const value = await bridge.request({ tool: probeTool.name, arguments: args });
      if (value?.ok !== true || value.nonce !== args.nonce || value.instanceId !== credential.instanceId || value.browser !== credential.browser ||
        Object.keys(value).sort().join(',') !== 'browser,instanceId,nonce,ok') throw new Error('permission-denied');
      return { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Transport probe failed or this browser instance is not authorized.' }] };
    }
  });
  const transport = new StdioServerTransport(input, output, { maxBufferSize: 64 * 1024 });
  const unwatch = bridge.onToolsChanged(() => { void server.sendToolListChanged().catch(() => {}); });
  const close = async () => { unwatch(); bridge.close(); await options.setup?.close(); await server.close(); };
  input.once('end', () => void close());
  await server.connect(transport);
  return { server, close };
}
