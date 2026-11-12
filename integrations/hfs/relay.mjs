// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { createAuthentication } from './auth.mjs';
/** Self-contained HFS middleware factory, embedded verbatim in generated server_code. */
export function createRelay(config, cryptoApi = globalThis.crypto) {
  const auth = createAuthentication(cryptoApi);
  const prefix = '/pac/v1', maxResponse = 4 * 1024 * 1024, maxMemory = 16 * 1024 * 1024;
  const instances = new Map(), challenges = new Map(), replay = new Map();
  let memory = 0, reading = 0, pendingTotal = 0, closed = false;
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
  const byteLength = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
  const wake = provider => { if (provider.waiter) provider.waiter(); };
  const finish = (provider, ticket, result, cancel = false) => {
    const job = provider.jobs.get(ticket);
    if (!job) return false;
    provider.jobs.delete(ticket); memory -= job.size; pendingTotal--; clearTimeout(job.timer); job.res.off('close', job.closed);
    if (cancel && job.dispatched) {
      if (provider.cancels.size < 64) provider.cancels.add(ticket);
      else { job.resolve(result); drop(provider); return true; }
      wake(provider);
    }
    job.resolve(result); return true;
  };
  const drop = provider => {
    if (instances.get(provider.instanceId) !== provider) return;
    instances.delete(provider.instanceId); clearTimeout(provider.timer);
    for (const ticket of [...provider.jobs.keys()]) finish(provider, ticket, { status: 503 });
    wake(provider);
  };
  const renew = provider => {
    clearTimeout(provider.timer);
    provider.timer = setTimeout(() => drop(provider), 45000);
    provider.expires = Date.now() + 45000;
  };
  const take = provider => {
    const events = [...provider.cancels].map(ticket => ({ type: 'cancel', ticket }));
    provider.cancels.clear();
    for (const job of provider.jobs.values()) {
      if (job.dispatched || events.length >= 8) continue;
      job.dispatched = true;
      events.push({ type: 'request', protocolVersion: 1, instanceId: provider.instanceId, leaseId: provider.leaseId, generation: provider.generation,
        ticket: job.ticket, clientId: job.clientId, credentialSecret: job.secret, method: job.method, sessionId: job.sessionId,
        protocol: job.protocol, deadline: job.deadline, payload: job.body });
    }
    return events;
  };
  const readBody = async (ctx, limit) => {
    const length = Number(ctx.get('content-length'));
    if (reading + memory + limit > maxMemory) throw Object.assign(new Error(), { status: 429 });
    if (length > limit) throw Object.assign(new Error(), { status: 413 });
    reading += limit;
    let size = 0, chunks = [];
    const timer = setTimeout(() => ctx.req.destroy(), 10000);
    try {
      for await (const chunk of ctx.req) {
        size += chunk.length;
        if (size > limit) throw Object.assign(new Error(), { status: 413 });
        chunks.push(chunk);
      }
      // HFS supplies Node Buffers; reject invalid UTF-8 rather than repairing bytes.
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      return body;
    } catch (error) { throw Object.assign(error, { status: error.status ?? 400 }); }
    finally { reading -= limit; clearTimeout(timer); }
  };
  const middleware = async ctx => {
    // This dedicated installation exposes no files, HFS administration or forwarding.
    ctx.stop(); ctx.set('Cache-Control', 'no-store'); ctx.set('X-Content-Type-Options', 'nosniff');
    const origin = ctx.get('origin');
    const providerPath = ctx.path.startsWith(prefix + '/provider/');
    if (closed || ctx.host !== new URL(config.endpoint).host || ctx.querystring ||
      origin && (!providerPath || !/^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/u.test(origin))) { ctx.status = 403; return; }
    if (ctx.path === prefix + '/health' && ctx.method === 'GET') { ctx.body = { relayProtocol: 1, configSchema: 1, compatibleHfs: '3.3.4' }; return; }
    if (!ctx.path.startsWith(prefix + '/')) { ctx.status = 404; return; }
    if (providerPath) {
      if (ctx.method !== 'POST') { ctx.status = 405; return; }
      if (ctx.get('content-type').split(';')[0].trim() !== 'application/json') { ctx.status = 415; return; }
      let body; try { body = await readBody(ctx, ctx.path.endsWith('/reply') ? maxResponse + 65536 : 65536); } catch (error) { ctx.status = error.status; return; }
      const scope = { instanceId: ctx.get('x-pac-instance'), leaseId: ctx.get('x-pac-lease'), nonce: ctx.get('x-pac-nonce'), time: Number(ctx.get('x-pac-time')) };
      const respond = async (status, value = {}) => {
        ctx.status = status; ctx.body = value;
        ctx.set('x-pac-mac', await auth.sign(config.providerSecret, 'response', ctx.path, scope, { status, body: value }));
      };
      for (const [nonce, expires] of replay) if (expires <= Date.now()) replay.delete(nonce);
      if (!validId(scope.instanceId) || !/^[a-f0-9]{64}$/u.test(scope.nonce) || !Number.isSafeInteger(scope.time) || Math.abs(Date.now() - scope.time) > 30000 ||
        !await auth.verify(config.providerSecret, 'request', ctx.path, scope, body, ctx.get('x-pac-mac'))) { ctx.status = 401; return; }
      if (replay.has(scope.nonce) || replay.size >= 4096) { await respond(409); return; }
      replay.set(scope.nonce, Date.now() + 65000);
      if (ctx.path === prefix + '/provider/challenge') {
        for (const [nonce, value] of challenges) if (value.expires < Date.now()) challenges.delete(nonce);
        if (challenges.size >= 64) { await respond(429); return; }
        const challenge = auth.random(); challenges.set(challenge, { instanceId: scope.instanceId, expires: Date.now() + 10000 });
        await respond(200, { protocolVersion: 1, challenge }); return;
      }
      if (ctx.path === prefix + '/provider/register') {
        const challenge = challenges.get(body.challenge); challenges.delete(body.challenge);
        if (!challenge || challenge.instanceId !== scope.instanceId || challenge.expires < Date.now() || body.protocolVersion !== 1 || !validId(body.generation)) { await respond(400); return; }
        if (instances.has(scope.instanceId)) { await respond(409); return; }
        if (instances.size >= 16) { await respond(429); return; }
        const provider = { instanceId: scope.instanceId, leaseId: auth.random(), generation: body.generation, clients: new Map(), jobs: new Map(), cancels: new Set() };
        instances.set(scope.instanceId, provider); renew(provider);
        await respond(200, { protocolVersion: 1, leaseId: provider.leaseId }); return;
      }
      const provider = instances.get(scope.instanceId);
      if (!provider || provider.leaseId !== scope.leaseId) { await respond(410); return; }
      renew(provider);
      if (ctx.path === prefix + '/provider/control') {
        if (body.disconnect === true) { drop(provider); await respond(200); return; }
        if (!Array.isArray(body.clients) || body.clients.length > 32 || body.clients.some(client => !validId(client.id) || !/^[a-f0-9]{64}$/u.test(client.hash)) || new Set(body.clients.map(client => client.id)).size !== body.clients.length) { await respond(400); return; }
        const clients = new Map(body.clients.map(client => [client.id, client.hash]));
        for (const job of [...provider.jobs.values()]) if (clients.get(job.clientId) !== provider.clients.get(job.clientId)) finish(provider, job.ticket, { status: 401 }, true);
        provider.clients = clients; await respond(200); return;
      }
      if (ctx.path === prefix + '/provider/poll') {
        if (provider.waiter) { await respond(409); return; }
        let events = take(provider);
        if (!events.length) await new Promise(resolve => {
          let timer;
          const done = () => { clearTimeout(timer); provider.waiter = undefined; ctx.res.off('close', done); resolve(); };
          timer = setTimeout(done, 20000); provider.waiter = done; ctx.res.once('close', done);
        });
        if (!events.length) events = take(provider);
        if (instances.get(scope.instanceId) !== provider) { await respond(410); return; }
        await respond(200, { events }); return;
      }
      if (ctx.path === prefix + '/provider/reply') {
        const job = provider.jobs.get(body.ticket);
        if (!job || !job.dispatched) { await respond(404); return; }
        if (![200, 202, 204, 400, 401, 403, 404, 405, 406, 409, 413, 429, 500, 503, 504].includes(body.status) || byteLength(body.body ?? {}) > maxResponse ||
          body.sessionId !== undefined && !validId(body.sessionId)) { await respond(400); return; }
        finish(provider, body.ticket, { status: body.status, body: body.body, sessionId: body.sessionId }); await respond(200); return;
      }
      await respond(404); return;
    }
    const match = /^\/pac\/v1\/mcp\/([a-zA-Z0-9_-]{16,80})\/([a-zA-Z0-9_-]{16,80})$/u.exec(ctx.path);
    if (!match) { ctx.status = 404; return; }
    const provider = instances.get(match[1]);
    const secret = ctx.get('authorization').replace(/^Bearer /u, '');
    if (!/^[a-zA-Z0-9_-]{43}$/u.test(secret)) { ctx.status = 401; return; }
    if (!provider) { ctx.status = 503; return; }
    if (provider.clients.get(match[2]) !== await auth.hash(secret)) { ctx.status = 401; return; }
    if (!['POST', 'DELETE'].includes(ctx.method)) { ctx.set('Allow', 'POST, DELETE'); ctx.status = 405; return; }
    if (ctx.method === 'POST' && (!ctx.get('accept').split(',').some(type => type.trim().split(';')[0] === 'application/json') || !ctx.get('accept').includes('text/event-stream'))) { ctx.status = 406; return; }
    const sessionId = ctx.get('mcp-session-id') || undefined, protocol = ctx.get('mcp-protocol-version') || undefined;
    if (sessionId && !validId(sessionId) || protocol && protocol !== '2025-11-25') { ctx.status = 400; return; }
    let body = {};
    if (ctx.method === 'POST') {
      if (ctx.get('content-type').split(';')[0].trim() !== 'application/json') { ctx.status = 415; return; }
      try { body = await readBody(ctx, 65536); } catch (error) { ctx.status = error.status; return; }
    }
    // All limits apply to UTF-8 wire bytes. No unbounded queue while a provider is absent.
    const size = byteLength(body) + 1024;
    const jobs = [...provider.jobs.values()];
    const control = ctx.method === 'DELETE' || body.method === 'notifications/cancelled';
    const clientJobs = jobs.filter(job => job.clientId === match[2]);
    const overloaded = control
      ? pendingTotal >= 80 || jobs.filter(job => job.control).length >= 16 || clientJobs.filter(job => job.control).length >= 2
      : pendingTotal >= 64 || jobs.filter(job => !job.control).length >= 32 || clientJobs.filter(job => !job.control).length >= 4;
    if (overloaded || memory + size + maxResponse > maxMemory) { ctx.status = 429; return; }
    if (sessionId && body.id !== undefined && jobs.some(job => job.clientId === match[2] && job.sessionId === sessionId && job.body.id === body.id)) { ctx.status = 409; return; }
    if (ctx.res.destroyed) { ctx.status = 499; return; }
    const ticket = auth.random(), deadline = Date.now() + (body.method === 'tools/call' && ['click_element', 'fill_element', 'select_option', 'set_checked', 'write_elements'].includes(body.params?.name) ? 95000 : 20000);
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => finish(provider, ticket, { status: 504 }, true), deadline - Date.now());
      const onClose = () => finish(provider, ticket, { status: 499 }, true);
      ctx.res.once('close', onClose); memory += size; pendingTotal++;
      provider.jobs.set(ticket, { ticket, clientId: match[2], secret, sessionId, protocol, body, control, method: ctx.method, deadline, timer, res: ctx.res, closed: onClose, size, resolve, dispatched: false });
      wake(provider);
    });
    // Explicit null suppresses Koa's default status text for bodyless MCP replies.
    if (result.status === 202 || result.status === 204) ctx.body = null;
    else if (result.body !== undefined) ctx.body = result.body;
    // Set status last: Koa's null body setter may otherwise change 202 to 204.
    ctx.status = result.status;
    if (result.sessionId) ctx.set('MCP-Session-Id', result.sessionId);
  };
  return { middleware, unload() { closed = true; for (const provider of [...instances.values()]) drop(provider); challenges.clear(); replay.clear(); } };
}
