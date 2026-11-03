// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';
import type { ExecutionRequest, ExecutionTransport, TransportEvents } from '../transport';
const validId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
/** Native framing never escapes this adapter. A malformed peer closes only its route. */
export function nativeTransport(instanceId: string, events: TransportEvents): ExecutionTransport {
  const port = browser.runtime.connectNative('org.page_as_context.bridge');
  let ready = false, closed = false;
  const lease = crypto.randomUUID();
  const end = () => {
    void browser.runtime.lastError;
    if (closed) return;
    closed = true; ready = false; clearTimeout(timer); events.disconnected();
  };
  const timer = setTimeout(() => { if (!ready) { port.disconnect(); end(); } }, 5000);
  const result = (id: string, value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.length > 4 * 1024 * 1024) throw new Error('response-limit');
    const total = Math.ceil(bytes.length / 65536);
    for (let index = 0; index < total; index++) {
      let binary = '';
      for (const byte of bytes.subarray(index * 65536, (index + 1) * 65536)) binary += String.fromCharCode(byte);
      port.postMessage({ type: 'result-chunk', id, index, total, data: btoa(binary) });
    }
  };
  port.onDisconnect.addListener(end);
  port.onMessage.addListener((raw: unknown) => {
    if (closed || !raw || typeof raw !== 'object') return;
    const value = raw as ExecutionRequest & { protocol?: unknown };
    if (value.type as string === 'ready' && value.protocol === 1) { clearTimeout(timer); ready = true; events.ready(); return; }
    if (value.type as string === 'cancel') { events.cancel(value.id); return; }
    if (value.type as string === 'client-disconnected') { events.clientDisconnected(value.credentialId, value.credentialSecret); return; }
    if (value.type !== 'request' || !ready || !validId(value.id) || !validId(value.credentialId) || typeof value.credentialSecret !== 'string' || value.credentialSecret.length !== 43 ||
      !value.request || typeof value.request.tool !== 'string' || !value.request.arguments || typeof value.request.arguments !== 'object' || Array.isArray(value.request.arguments) ||
      new TextEncoder().encode(JSON.stringify(value)).length > 65536) { port.disconnect(); end(); return; }
    void events.request({ ...value, route: 'native', lease }).then(valueResult => {
      if (!closed) result(value.id, valueResult);
    }, () => { if (!closed) result(value.id, { error: 'request-rejected' }); }).catch(() => { port.disconnect(); end(); });
  });
  port.postMessage({ type: 'register', protocol: 1, browser: import.meta.env.BROWSER, instanceId });
  return { kind: 'native', lease, get ready() { return ready && !closed; },
    close() { if (closed) return; closed = true; ready = false; clearTimeout(timer); port.disconnect(); },
    toolsChanged(credentialId) { if (!closed) port.postMessage({ type: 'tools-changed', credentialId }); } };
}
