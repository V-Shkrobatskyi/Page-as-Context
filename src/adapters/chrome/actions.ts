// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticNode } from '../../core/model';
import type { ChromeAxNode } from './types';
import { chromeDebuggerClient } from './capture';
import type { ChromeDebuggerSession } from './capture';
import { ACTION_ROLES, type ActionLease, type ActionSnapshot, type ActionCommand, type ActionOutcome } from '../actions/contract';
import { domOperation } from '../actions/dom-operation';
import { ACTION_SENSITIVE_PATTERN } from '../actions/sensitive';

interface Target { backend: number; frameId: string; loaderId: string; targetId?: string; name?: string }
const registries = new Map<string, Map<string, Target>>();
export function rememberChromeTarget(lease: ActionLease, raw: ChromeAxNode, node: SemanticNode, frame: { id: string; loaderId: string; targetId?: string }) {
  if (!raw.backendDOMNodeId || !ACTION_ROLES.has(node.role) || node.states?.disabled || new RegExp(ACTION_SENSITIVE_PATTERN, 'iu').test(node.name ?? '') || lease.expires <= Date.now()) return;
  const registry = registries.get(lease.snapshotId); if (!registry || registry.size >= 10000) return;
  const ref = crypto.randomUUID(); node.actionRef = ref;
  registry.set(ref, { backend: raw.backendDOMNodeId, frameId: frame.id, loaderId: frame.loaderId, ...(frame.targetId ? { targetId: frame.targetId } : {}), name: node.name });
}

export function createChromeActionSnapshot(tabId: number, lease: ActionLease): ActionSnapshot {
  const registry = new Map<string, Target>(); registries.set(lease.snapshotId, registry);
  let disposed = false;
  const dispose = () => { disposed = true; clearTimeout(timer); registry.clear(); targets.clear(); registries.delete(lease.snapshotId); };
  const timer = setTimeout(dispose, Math.max(1, Math.min(lease.expires - Date.now(), 480 * 60000)));
  const targets: ActionSnapshot['targets'] = new Map();
  const run = async (command: ActionCommand, signal: AbortSignal, authorize: () => Promise<void>): Promise<ActionOutcome> => {
    const target = registry.get(command.elementRef), option = command.optionRef ? registry.get(command.optionRef) : undefined;
    if (disposed || lease.expires <= Date.now() || command.snapshotId !== lease.snapshotId || !target || !targets.has(command.elementRef) ||
      command.optionRef && (!option || !targets.has(command.optionRef))) return { status: 'rejected', error: 'stale-snapshot' };
    const client = chromeDebuggerClient(); let attached = false, attachPending = false, sessionId: string | undefined, dispatched = false, finishedLease = false;
    const deadline = Date.now() + 6000;
    const bounded = <T>(start: (done: (value: T, error?: string) => void) => void, cleanup = false): Promise<T> => new Promise((resolve, reject) => {
      let finished = false;
      const complete = (value: T, error?: string) => { if (finished) return; finished = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); error ? reject(new Error('unsupported-action')) : resolve(value); };
      const abort = () => { if (!cleanup) complete(undefined as T, 'cancelled'); };
      const timeout = setTimeout(() => complete(undefined as T, 'timeout'), Math.max(1, Math.min(2000, deadline - Date.now())));
      if (!cleanup && signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, { once: true });
      start(complete);
    });
    const send = (method: string, params: Record<string, unknown> = {}, session: ChromeDebuggerSession = { tabId, ...(sessionId ? { sessionId } : {}) }, cleanup = false) =>
      bounded<Record<string, any>>(done => client.sendCommand(session, method, (result, error) => done(result as Record<string, any>, error), params), cleanup);
    try {
      await authorize();
      attachPending = true;
      await bounded<void>(done => client.attach({ tabId }, '1.3', error => {
        attachPending = false;
        if (!error) { attached = true; if (finishedLease || signal.aborted || Date.now() >= deadline) client.detach({ tabId }, () => {}); }
        done(undefined, error);
      }));
      if (target.targetId) sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, { tabId })).sessionId;
      const tree = await send('Page.getFrameTree');
      const stack = [tree.frameTree]; let matches = false;
      while (stack.length) { const frame = stack.pop(); if (frame?.frame?.id === target.frameId && frame.frame.loaderId === target.loaderId) matches = true; stack.push(...(frame?.childFrames ?? [])); }
      if (!matches || option && (option.frameId !== target.frameId || option.loaderId !== target.loaderId)) throw new Error('stale-snapshot');
      const world = await send('Page.createIsolatedWorld', { frameId: target.frameId, worldName: 'page-as-context-actions' });
      if (typeof world.executionContextId !== 'number') throw new Error('stale-snapshot');
      const resolve = async (value: Target) => {
        const current = await send('Accessibility.getPartialAXTree', { backendNodeId: value.backend, fetchRelatives: false });
        if (!current.nodes?.some((node: any) => node.backendDOMNodeId === value.backend && !node.ignored && node.name?.value === value.name)) throw new Error('stale-snapshot');
        const resolved = await send('DOM.resolveNode', { backendNodeId: value.backend, executionContextId: world.executionContextId, objectGroup: 'mcp-action' });
        if (!resolved.object?.objectId) throw new Error('stale-snapshot'); return resolved.object.objectId as string;
      };
      const objectId = await resolve(target), optionId = option ? await resolve(option) : undefined;
      const invoke = async (action: string, mutate = false) => {
        await authorize(); if (signal.aborted) throw new Error('cancelled');
        if (mutate) dispatched = true;
        const response = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: domOperation.toString(), returnByValue: true,
          arguments: [{ value: { ...command, action, sensitivePattern: ACTION_SENSITIVE_PATTERN } }, ...(optionId ? [{ objectId: optionId }] : [])] });
        if (response.exceptionDetails) throw new Error('unsupported-action');
        return response.result?.value as Record<string, any>;
      };
      if (command.action === 'click') {
        // The isolated preflight verifies every accessible ancestor frame and
        // returns top-level CSS coordinates. Cross-origin/transform boundaries fail closed.
        const hit = await invoke(command.action === 'click' ? 'inspect-click' : 'inspect-checked');
        if (hit.error) throw new Error(hit.error);
        if (!hit.alreadyDesired) {
          const verified = await invoke(command.action === 'click' ? 'inspect-click' : 'inspect-checked');
          if (verified.error || verified.x !== hit.x || verified.y !== hit.y) throw new Error('stale-snapshot');
          await authorize(); if (signal.aborted) throw new Error('cancelled');
          dispatched = true;
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, { tabId });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, { tabId });
        }
      } else {
        // Fixed native setters/events are used for fill and native select;
        // arbitrary page scripts are never accepted from the client.
        const result = await invoke(command.action, true);
        if (result.error) { dispatched = false; throw new Error(result.error); }
        if (!result.applied) throw new Error('unsupported-action');
      }
      return { status: 'applied' };
    } catch (error) {
      return { status: dispatched ? 'outcome-unknown' : 'rejected', error: error instanceof Error && ['stale-snapshot', 'unsupported-action'].includes(error.message) ? error.message : dispatched ? 'outcome-unknown' : 'unsupported-action' };
    } finally {
      finishedLease = true;
      if (attached) {
        try { await send('Runtime.releaseObjectGroup', { objectGroup: 'mcp-action' }, { tabId, ...(sessionId ? { sessionId } : {}) }, true); } catch { /* Detach releases the lease's handles too. */ }
        if (sessionId) { try { await send('Target.detachFromTarget', { sessionId }, { tabId }, true); } catch { /* Root detach releases child sessions. */ } }
        await bounded<void>(done => client.detach({ tabId }, error => done(undefined, error)), true).catch(() => {});
      }
      // A late successful attach always detaches in its callback above.
      if (!attachPending) attached = false;
    }
  };
  return { ...lease, tabId, targets, run, dispose };
}
