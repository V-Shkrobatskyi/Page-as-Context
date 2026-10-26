// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';
import type { SemanticNode } from '../../core/model';
import { ACTION_ROLES, type ActionCommand, type ActionLease, type ActionOutcome, type ActionSnapshot } from '../actions/contract';
import { domOperation } from '../actions/dom-operation';
import { ACTION_SENSITIVE_PATTERN } from '../actions/sensitive';

interface WorldCommand { mode: 'locate' | 'apply' | 'release'; lease: ActionLease; command?: ActionCommand; deadline?: number }
interface World { __pageAsContextActions?: (command: WorldCommand) => unknown }

/** Per-document weak registry; only the isolated world can install or call it. */
export function createDomActionRegistry(doc: Document) {
  const sessions = new Map<string, { lease: ActionLease; root: WeakRef<Element>; url: string; nodes: Map<string, { node: WeakRef<Element>; signature: string }>; timer: ReturnType<typeof setTimeout> }>();
  const release = (snapshotId: string) => { const session = sessions.get(snapshotId); if (session) { clearTimeout(session.timer); session.nodes.clear(); sessions.delete(snapshotId); } };
  const scope = doc.defaultView as Window & World;
  scope.__pageAsContextActions = (value: WorldCommand) => {
    if (!value || !value.lease) return { found: false };
    if (value.mode === 'apply' && (typeof value.deadline !== 'number' || value.deadline < Date.now())) return { status: 'rejected', error: 'stale-snapshot' };
    const session = sessions.get(value.lease.snapshotId);
    if (!session || session.lease.owner !== value.lease.owner) return { found: false };
    if (value.mode === 'release') { release(value.lease.snapshotId); return { released: true }; }
    if (session.lease.expires <= Date.now() || session.root.deref() !== doc.documentElement || session.url !== doc.location.href) { release(value.lease.snapshotId); return { found: false }; }
    const command = value.command, entry = command && session.nodes.get(command.elementRef), element = entry?.node.deref();
    if (!command || command.snapshotId !== session.lease.snapshotId || !entry || !element?.isConnected) return { found: false };
    if (value.mode === 'locate') return { found: true };
    const option = command.optionRef ? session.nodes.get(command.optionRef)?.node.deref() : undefined;
    if (command.optionRef && !option) return { status: 'rejected', error: 'stale-snapshot' };
    if (option && domOperation.call(option, { action: 'signature', sensitivePattern: ACTION_SENSITIVE_PATTERN }).signature !== session.nodes.get(command.optionRef!)?.signature) return { status: 'rejected', error: 'stale-snapshot' };
    const result = domOperation.call(element, { ...command, sensitivePattern: ACTION_SENSITIVE_PATTERN, signature: entry.signature }, option);
    return result.applied ? { status: 'applied' } : { status: 'rejected', error: result.error === 'stale-snapshot' ? 'stale-snapshot' : 'unsupported-action' };
  };
  doc.defaultView?.addEventListener('pagehide', () => { for (const id of sessions.keys()) release(id); });
  return (lease: ActionLease, element: Element, node: SemanticNode) => {
    try { if (doc.defaultView !== doc.defaultView?.top && !doc.defaultView?.frameElement) return; }
    catch { return; }
    if (!ACTION_ROLES.has(node.role) || node.states?.disabled || /^(?:password|file|hidden)$/u.test((element as HTMLInputElement).type ?? '') ||
      new RegExp(ACTION_SENSITIVE_PATTERN, 'iu').test(node.name ?? '') || lease.expires <= Date.now()) return;
    let session = sessions.get(lease.snapshotId);
    if (!session) {
      for (const [id, value] of sessions) if (value.lease.owner === lease.owner || value.lease.expires <= Date.now()) release(id);
      if (sessions.size >= 32) return;
      session = { lease, root: new WeakRef(doc.documentElement), url: doc.location.href, nodes: new Map(), timer: setTimeout(() => release(lease.snapshotId), Math.max(1, Math.min(lease.expires - Date.now(), 480 * 60000))) };
      sessions.set(lease.snapshotId, session);
    }
    if (session.nodes.size >= 10000) return;
    const signature = domOperation.call(element, { action: 'signature', sensitivePattern: ACTION_SENSITIVE_PATTERN }).signature as string;
    const ref = crypto.randomUUID(); node.actionRef = ref; session.nodes.set(ref, { node: new WeakRef(element), signature });
  };
}

/** Serialized by executeScript; this route has no page-controlled inputs. */
export function dispatchDomAction(command: WorldCommand): unknown {
  return (globalThis as World).__pageAsContextActions?.(command) ?? { found: false };
}

export function createFirefoxActionSnapshot(tabId: number, lease: ActionLease): ActionSnapshot {
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true; clearTimeout(timer); targets.clear();
    void browser.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: dispatchDomAction, args: [{ mode: 'release', lease }] }).catch(() => {});
  };
  const timer = setTimeout(dispose, Math.max(1, Math.min(lease.expires - Date.now(), 480 * 60000)));
  const targets: ActionSnapshot['targets'] = new Map();
  const run = async (command: ActionCommand, signal: AbortSignal, authorize: () => Promise<void>): Promise<ActionOutcome> => {
    if (disposed || lease.expires <= Date.now() || command.snapshotId !== lease.snapshotId || !targets.has(command.elementRef) || command.optionRef && !targets.has(command.optionRef)) return { status: 'rejected', error: 'stale-snapshot' };
    let dispatched = false;
    const wait = <T>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
      const abort = () => finish(undefined as T, new Error('cancelled'));
      const finish = (value: T, error?: unknown) => { clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => finish(undefined as T, new Error('timeout')), 6000);
      signal.addEventListener('abort', abort, { once: true });
      promise.then(value => finish(value), error => finish(undefined as T, error));
      if (signal.aborted) abort();
    });
    try {
      await authorize(); if (signal.aborted) throw new Error('cancelled');
      const locations = await wait(browser.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: dispatchDomAction,
        args: [{ mode: 'locate', lease, command: { ...command, text: undefined } }] }));
      const found = locations.filter(item => (item.result as { found?: boolean })?.found);
      if (found.length !== 1) return { status: 'rejected', error: 'stale-snapshot' };
      await authorize(); if (signal.aborted) throw new Error('cancelled');
      dispatched = true;
      const result = await wait(browser.scripting.executeScript({ target: { tabId, frameIds: [found[0]!.frameId] }, world: 'ISOLATED', func: dispatchDomAction, args: [{ mode: 'apply', lease, command, deadline: Date.now() + 5000 }] }));
      const value = result[0]?.result as ActionOutcome | undefined;
      if (!value || !['applied', 'rejected'].includes(value.status)) return { status: 'outcome-unknown', error: 'outcome-unknown' };
      return value;
    } catch { return { status: dispatched ? 'outcome-unknown' : 'rejected', error: dispatched ? 'outcome-unknown' : 'stale-snapshot' }; }
  };
  return { ...lease, tabId, targets, run, dispose };
}
