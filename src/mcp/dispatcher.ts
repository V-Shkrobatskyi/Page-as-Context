// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { MCP_INSTRUCTIONS, toolCatalog, validateToolArguments, toolResult } from '../../helper/src/catalog.mjs';
import type { ExecutionRequest } from './transport';
export const MCP_PROTOCOL = '2025-11-25';
export interface HttpCommand {
  type: 'request'; protocolVersion: number; instanceId: string; leaseId: string; generation: string; ticket: string;
  clientId: string; credentialSecret: string; method: string; sessionId?: string; protocol?: string; deadline: number; payload: unknown;
}
export interface HttpReply { status: number; body?: unknown; sessionId?: string }
interface Session { clientId: string; secret: string; initialized: boolean; expires: number; active: Map<string | number, string> }
/** Explicit JSON-only MCP subset; no Node transport, SSE, resumption or server notifications. */
export function createHttpDispatcher(instanceId: string, browserName: string, lease: string, execute: (request: ExecutionRequest) => Promise<any>, cancel: (ticket: string) => void, version: string) {
  const sessions = new Map<string, Session>();
  const closeSession = (id: string) => {
    const session = sessions.get(id); if (!session) return;
    for (const ticket of session.active.values()) cancel(ticket);
    sessions.delete(id);
  };
  const dispatch = async (command: HttpCommand): Promise<HttpReply> => {
    for (const [id, session] of sessions) if (session.expires <= Date.now()) closeSession(id);
    const base = { type: 'request' as const, id: command.ticket, instanceId, browser: browserName, credentialId: command.clientId, credentialSecret: command.credentialSecret, route: 'hfs' as const, lease };
    const call = (tool: string, args: Record<string, unknown> = {}) => execute({ ...base, request: { tool, arguments: args } });
    const session = command.sessionId ? sessions.get(command.sessionId) : undefined;
    if (command.sessionId && (!session || session.clientId !== command.clientId || session.secret !== command.credentialSecret)) return { status: 404 };
    if (command.protocol !== undefined && command.protocol !== MCP_PROTOCOL) return { status: 400 };
    if (command.method === 'DELETE') {
      if (!command.sessionId || command.protocol !== MCP_PROTOCOL) return { status: 400 };
      closeSession(command.sessionId); return { status: 204 };
    }
    const raw = command.payload;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 400 };
    const message = raw as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: any };
    const hasId = Object.hasOwn(message, 'id');
    const id = typeof message.id === 'string' || typeof message.id === 'number' && Number.isFinite(message.id) ? message.id : null;
    const error = (code: number, text: string, status = 200): HttpReply => ({ status, body: { jsonrpc: '2.0', id, error: { code, message: text } } });
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || hasId && id === null || message.params !== undefined && (!message.params || typeof message.params !== 'object' || Array.isArray(message.params))) return error(-32600, 'Invalid request.', 400);
    if (message.method === 'initialize') {
      if (!hasId || command.sessionId || typeof message.params?.protocolVersion !== 'string' || !message.params?.capabilities || typeof message.params.capabilities !== 'object' || Array.isArray(message.params.capabilities) ||
        typeof message.params?.clientInfo?.name !== 'string' || typeof message.params?.clientInfo?.version !== 'string') return error(-32602, 'Invalid initialization.', 400);
      const pairing = await call('pair');
      if (pairing?.error || pairing?.status !== 'approved') return { status: 403 };
      // Hosts can abandon sessions without DELETE when refreshing tools or reconnecting.
      // Reclaim only this credential's least recently used idle session, never active work.
      const owned = [...sessions].filter(([, value]) => value.clientId === command.clientId);
      if (sessions.size >= 128 || owned.length >= 8) {
        const idle = owned.find(([, value]) => value.secret === command.credentialSecret && value.active.size === 0);
        if (!idle) return { status: 429 };
        closeSession(idle[0]);
      }
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, { clientId: command.clientId, secret: command.credentialSecret, initialized: false, expires: Date.now() + 8 * 3600000, active: new Map() });
      return { status: 200, sessionId, body: { jsonrpc: '2.0', id, result: { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'page-as-context-hfs', version },
        instructions: MCP_INSTRUCTIONS + ' This HTTP client was explicitly authorized in browser settings; no pairing code is required. Tool discovery describes supported operations, not current tab permissions. Use get_connection_status for current capabilities. Read/Write changes do not require a catalog refresh; refresh tools after changing client action restrictions or organization policy.' } } };
    }
    if (!command.sessionId || command.protocol !== MCP_PROTOCOL) return { status: 400 };
    if (!session) return { status: 404 };
    // Map insertion order tracks recent use without extending the absolute lifetime.
    sessions.delete(command.sessionId); sessions.set(command.sessionId, session);
    if (message.method === 'notifications/initialized' && !hasId) { session.initialized = true; return { status: 202 }; }
    if (message.method === 'notifications/cancelled' && !hasId) {
      const ticket = session.active.get(message.params?.requestId); if (ticket) cancel(ticket);
      return { status: 202 };
    }
    if (!hasId) return { status: 202 };
    if (!session.initialized && message.method !== 'ping') return error(-32600, 'Session is not initialized.');
    if (session.active.has(id!)) return { status: 409 };
    if (session.active.size >= 4) return { status: 429 };
    session.active.set(id!, command.ticket);
    try {
      let result: unknown;
      if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list' || message.method === 'tools/call' && message.params?.name === 'get_pairing_status') {
        const pairing = await call('pair');
        if (pairing?.error || pairing?.status !== 'approved') return { status: 403 };
        if (message.method === 'tools/call') {
          const args = message.params.arguments ?? {};
          if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) return error(-32602, 'Invalid tool arguments.');
          result = { content: [{ type: 'text', text: JSON.stringify(pairing) }] };
        } else {
          const allowed = await call('list-tools');
          result = { tools: toolCatalog().filter(tool => allowed?.tools?.includes(tool.name)).map(tool => tool.annotations.readOnlyHint ? tool : {
            ...tool, description: tool.description + ' Requires an explicit Write grant on the tab and the configured browser approval. Tool discovery alone grants no access.',
          }) };
        }
      } else if (message.method === 'tools/call') {
        let args;
        try { args = validateToolArguments(message.params?.name, message.params?.arguments); } catch { return error(-32602, 'Invalid tool arguments.'); }
        result = toolResult(await call(message.params.name, args));
      } else return error(-32601, 'Method not found.');
      return { status: 200, body: { jsonrpc: '2.0', id, result } };
    } catch { return error(-32603, 'Request unavailable.'); }
    finally { session.active.delete(id!); }
  };
  return { dispatch, revoke(clientId: string) { for (const [id, session] of sessions) if (session.clientId === clientId) closeSession(id); }, close() { for (const id of sessions.keys()) closeSession(id); } };
}
