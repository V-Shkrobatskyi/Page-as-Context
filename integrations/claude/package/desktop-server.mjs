// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { Server } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StdioServerTransport } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from './helper/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { MCP_INSTRUCTIONS, toolCatalog, validateToolArguments, toolResult, WRITE_TOOL_ACTIONS } from './helper/src/catalog.mjs';
import { browserSetup } from './helper/src/browser-setup.mjs';
import { packageClient } from './helper/src/package-client.mjs';
import { join } from 'node:path';

const browsers = ['chrome', 'firefox'];
const instructions = `${MCP_INSTRUCTIONS} This extension supports Chrome and Firefox together. Ask which browser the user wants to connect, then use chrome_* or firefox_* tools consistently. Never switch browsers or retry a write through the other route after a failure. Each browser needs separate pairing and tab grants. For setup, call the browser's setup_status, obtain its instance and extension IDs, then prepare_browser_setup. Show the returned changes and obtain explicit user approval before confirm_browser_setup; existing approval for that same current plan is sufficient. The user compares the pairing code and approves in the browser; never approve on their behalf. Automatic mode connects the bridge; use Retry connection if needed. Manual mode requires Start helper connection. After pairing, ask the user to grant Read or Write again on each tab. Adding another browser registration may restart the bridge and end existing tab connections; explain changes reported by preparation. Use cancel_browser_setup to cancel; failed or cancelled switches preserve the previous profile. Never reset profiles, transfer grants, or replay denied or outcome-unknown writes. No installation-time browser selection or extension restart is needed to choose the other browser.`;

// One MCPB process exposes two explicitly named routes. Opaque connection,
// snapshot, operation and setup request IDs stay inside their selected route.
export function createDesktopServer({ routes, version }) {
  const server = new Server({ name: 'page-as-context', title: 'Page as Context', version },
    { capabilities: { tools: { listChanged: true } }, instructions });
  const pageTools = toolCatalog();
  const names = new Map();
  for (const browser of browsers) {
    for (const tool of [...pageTools, ...routes[browser].setup.tools]) {
      names.set(`${browser}_${tool.name}`, { browser, tool, setup: routes[browser].setup.tools.includes(tool) });
    }
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const groups = await Promise.all(browsers.map(async browser => {
      const route = routes[browser];
      const allowed = await route.bridge.request({ tool: 'list-tools', arguments: {} }).catch(() => undefined);
      const tools = [...pageTools.filter(tool => allowed?.tools?.includes(tool.name) ?? tool.annotations.readOnlyHint), ...route.setup.tools];
      return tools.map(tool => ({ ...tool, name: `${browser}_${tool.name}`, description: `${browser === 'chrome' ? 'Chrome' : 'Firefox'}: ${tool.description}` }));
    }));
    return { tools: groups.flat() };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const target = names.get(request.params.name);
    if (!target) throw new McpError(ErrorCode.InvalidParams, 'Unknown browser tool.');
    const route = routes[target.browser], name = target.tool.name;
    if (target.setup) {
      let value;
      try { value = await route.setup.call(name, request.params.arguments ?? {}); }
      catch { throw new McpError(ErrorCode.InvalidParams, 'Invalid setup arguments.'); }
      // Setup has its own pending/cancelled status semantics, separate from writes.
      return { ...(value.error ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }] };
    }
    let args;
    try { args = validateToolArguments(name, request.params.arguments); }
    catch { throw new McpError(ErrorCode.InvalidParams, 'Invalid tool arguments.'); }
    try {
      const value = await route.bridge.request({ tool: name, arguments: args });
      if (!value) throw new Error('not-connected');
      return toolResult(value);
    } catch {
      return toolResult(Object.hasOwn(WRITE_TOOL_ACTIONS, name)
        ? { operationId: args.operationId, status: 'outcome-unknown', error: 'outcome-unknown' }
        : { error: 'not-connected', instructions: `Check ${target.browser} setup and tab sharing. Do not substitute another browser.` });
    }
  });
  const unwatch = browsers.map(browser => routes[browser].bridge.onToolsChanged(() => {
    void server.sendToolListChanged().catch(() => {});
  }));
  let closing;
  const close = () => closing ??= (async () => {
    for (const stop of unwatch) stop();
    await Promise.allSettled(browsers.map(async browser => {
      routes[browser].bridge.close();
      await routes[browser].setup.close();
    }));
    await server.close();
  })();
  return { server, close };
}

export async function serveDesktopMcp({ directory, licensePath, installOptions = {}, version, input = process.stdin, output = process.stdout }) {
  const profileDirectory = join(directory, 'claude/profiles');
  const routes = Object.fromEntries(browsers.map(browser => {
    const bridge = packageClient(browser, directory, profileDirectory);
    const setup = browserSetup({ browser, directory, profileDirectory, onActivated: () => bridge.refresh(),
      clientName: `Claude Desktop — ${browser === 'chrome' ? 'Chrome' : 'Firefox'}`, licensePath, installOptions });
    return [browser, { bridge, setup }];
  }));
  const session = createDesktopServer({ routes, version });
  input.once('end', () => { void session.close(); });
  try { await session.server.connect(new StdioServerTransport(input, output, { maxBufferSize: 64 * 1024 })); }
  catch (error) { await session.close(); throw error; }
  return session;
}
