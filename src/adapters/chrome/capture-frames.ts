// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { sourceAllowed } from '../../policy/sources';
import { FORM_ROLES } from '../../core/data-controls';
import type { CaptureControls } from '../types';
import type { CaptureErrorCode, SemanticNode } from '../../core';
import type { CaptureOutcome } from '../types';
import type { ChromeDebuggerClient } from './capture';
import { inspectFrameOwner } from './frame-visibility';
import { CHROME_CAPTURE_LIMITS as LIMITS } from './limits';
import { normalizeChromeAxTree } from './normalize-ax';
import type { ChromeAxNode, ChromeAxTreeResponse } from './types';
import { selectedDomIds, selectChromeAxTree } from './selection';
import { selectedElementReference } from '../../element-picker-protocol';
import { rememberChromeTarget } from './actions';

interface Session {
  targetId?: string;
  id?: string;
  live: boolean;
  ax: boolean;
  auto: boolean;
}
interface Frame {
  id: string;
  parentId?: string;
  loaderId: string;
  url?: string;
  origin?: string;
  session: Session;
  snapshot?: ChromeAxTreeResponse;
  owner?: number;
  omitted?: boolean;
  status?: string;
}
interface FrameTree {
  frame: { id: string; parentId?: string; loaderId: string };
  childFrames?: FrameTree[];
}
class CaptureFailure extends Error {
  constructor(public code: CaptureErrorCode, message: string) { super(message); }
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function fail(code: CaptureErrorCode, message: string): CaptureOutcome {
  return { ok: false, error: { code, message } };
}
function commandError(message: string): CaptureFailure {
  if (/another debugger|already attached/iu.test(message)) return new CaptureFailure('debugger-busy', 'Chrome debugging is already in use for this tab.');
  if (/cannot attach|cannot access|restricted|not allowed|chrome:\/\//iu.test(message)) return new CaptureFailure('unsupported-page', 'This Chrome page cannot be captured.');
  if (/permission|access denied/iu.test(message)) return new CaptureFailure('permission-denied', 'Chrome denied permission to capture this page.');
  return new CaptureFailure('capture-failed', 'Unable to capture this page’s accessibility tree.');
}

/** Finite asynchronous operation; a timeout also handles a late successful attach. */
function bounded<T>(start: (done: (value: T) => void) => void, ms: number, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new CaptureFailure('capture-timeout', 'Page capture took too long.'));
    }, Math.max(1, ms));
    try {
      start((value) => {
        if (settled) { late?.(value); return; }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      });
    } catch (error) {
      if (!settled) { settled = true; clearTimeout(timer); reject(error); }
    }
  });
}

/** Validates graphs and shared budgets before any recursive core traversal. */
function checkSnapshot(value: unknown, budget: { nodes: number; characters: number; bytes: number }): ChromeAxTreeResponse {
  const nodes = record(value).nodes;
  if (!Array.isArray(nodes) || !nodes.length) throw new CaptureFailure('invalid-tree', 'Chrome returned an invalid accessibility tree.');
  budget.nodes += nodes.length;
  if (budget.nodes > LIMITS.nodes) throw new CaptureFailure('capture-limit', 'The page exceeds the capture limit.');
  const byId = new Map<string, ChromeAxNode>();
  for (const raw of nodes) {
    const node = record(raw);
    if (typeof node.nodeId !== 'string' || !node.nodeId ||
        node.childIds !== undefined && (!Array.isArray(node.childIds) || !node.childIds.every((id) => typeof id === 'string'))) {
      throw new CaptureFailure('invalid-tree', 'Chrome returned an invalid accessibility tree.');
    }
    const encoded = JSON.stringify(raw);
    budget.bytes += new TextEncoder().encode(encoded).length;
    const url = Array.isArray(node.properties) ? node.properties.find((property) => record(property).name === 'url') : undefined;
    for (const text of [record(node.role).value, record(node.name).value, record(node.value).value, record(record(url).value).value]) {
      if (typeof text === 'string') budget.characters += text.length;
    }
    if (budget.bytes > LIMITS.rawBytes || budget.characters > LIMITS.characters) throw new CaptureFailure('capture-limit', 'The page exceeds the capture limit.');
    byId.set(node.nodeId, raw as ChromeAxNode);
  }
  // Detect cycles and depth without recursive calls, including disconnected components.
  const finished = new Set<string>();
  const heights = new Map<string, number>();
  const active = new Set<string>();
  for (const id of byId.keys()) {
    const stack: { id: string; depth: number; exit?: boolean }[] = [{ id, depth: 0 }];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.exit) {
        const height = Math.max(0, ...(byId.get(item.id)?.childIds ?? []).map((child) => 1 + (heights.get(child) ?? 0)));
        if (height > LIMITS.nodeDepth) throw new CaptureFailure('capture-limit', 'The page exceeds the capture depth limit.');
        heights.set(item.id, height);
        active.delete(item.id); finished.add(item.id); continue;
      }
      if (active.has(item.id)) throw new CaptureFailure('invalid-tree', 'Chrome returned an invalid accessibility tree.');
      if (item.depth > LIMITS.nodeDepth) throw new CaptureFailure('capture-limit', 'The page exceeds the capture depth limit.');
      if (finished.has(item.id)) continue;
      active.add(item.id);
      stack.push({ ...item, exit: true });
      for (const child of byId.get(item.id)?.childIds ?? []) if (byId.has(child)) stack.push({ id: child, depth: item.depth + 1 });
    }
  }
  return { nodes: nodes as ChromeAxNode[] };
}

/** One root attachment owns all child sessions and releases them before normalization. */
export function createFrameCapturer(client: ChromeDebuggerClient) {
  const inFlight = new Set<number>();
  return async (tabId: number, selection?: string, signal?: AbortSignal, controls?: CaptureControls): Promise<CaptureOutcome> => {
    if (!Number.isInteger(tabId) || tabId < 0) return fail('unsupported-page', 'This page cannot be captured.');
    if (inFlight.has(tabId)) return fail('capture-failed', 'A capture is already running for this tab.');
    inFlight.add(tabId);
    const deadline = Date.now() + LIMITS.captureMs;
    const rootSession: Session = { live: true, ax: false, auto: false };
    const sessions = new Map<string, Session>([['', rootSession]]);
    const setup = new Set<Promise<void>>();
    const changed = new Set<string>();
    const frames = new Map<string, Frame>();
    const objectGroup = `page-as-context-${tabId}`;
    let attached = false;
    let attachPending = false;
    let releaseGuard = true;
    let closing = false;
    let detached = false;
    let partial = false;
    let policyPartial = false;
    let rootId: string | undefined;
    let result: CaptureOutcome | undefined;
    let cleanupDeadline = 0;
    let selectionIds: Set<number> | undefined;
    let selectedObject: string | undefined;
    let selectionContext: string | undefined;
    let runtimeEnabled = false;
    const pickerContexts = new Map<number, string>();
    const budget = { nodes: 0, characters: 0, bytes: 0 };

    const command = async (session: Session, method: string, params: Record<string, unknown> = {}, cleanup = false): Promise<Record<string, unknown>> => {
      const remaining = (cleanup ? cleanupDeadline : deadline) - Date.now();
      if (remaining <= 0) throw new CaptureFailure('capture-timeout', 'Page capture took too long.');
      if (!cleanup && (closing || detached || !session.live)) throw new CaptureFailure('page-changed', 'The page changed during capture.');
      if (!cleanup && signal?.aborted) throw new CaptureFailure('page-changed', 'Selection was cancelled.');
      const response = await bounded<{ value: unknown; error?: string }>((done) => {
        client.sendCommand({ tabId, ...(session.id ? { sessionId: session.id } : {}) }, method,
          (value, error) => done({ value, error }), params);
      }, Math.min(LIMITS.commandMs, remaining));
      if (response.error) throw commandError(response.error);
      return record(response.value);
    };
    const initialize = async (session: Session) => {
      await command(session, 'Page.enable');
      // Mark attempted enablement too, so a delayed response cannot evade cleanup.
      session.auto = true;
      await command(session, 'Target.setAutoAttach', {
        autoAttach: true, flatten: true, waitForDebuggerOnStart: false,
        filter: [{ type: 'iframe', exclude: false }, { exclude: true }],
      });
    };
    const event = (source: { tabId?: number; sessionId?: string }, method: string, payload: unknown) => {
      if (source.tabId !== tabId || closing || !sessions.has(source.sessionId ?? '')) return;
      const params = record(payload);
      if (method === 'Runtime.executionContextCreated' && !source.sessionId && selection && client.extensionOrigin) {
        const context = record(params.context);
        const auxiliary = record(context.auxData);
        if (Number.isInteger(context.id) && typeof context.uniqueId === 'string' && context.uniqueId &&
          context.origin === client.extensionOrigin && auxiliary.frameId === rootId &&
          auxiliary.isDefault === false && auxiliary.type === 'isolated') pickerContexts.set(context.id as number, context.uniqueId);
      } else if (method === 'Runtime.executionContextDestroyed' && !source.sessionId) {
        pickerContexts.delete(params.executionContextId as number);
      } else if (method === 'Runtime.executionContextsCleared' && !source.sessionId) {
        pickerContexts.clear();
      } else if (method === 'Target.attachedToTarget' && typeof params.sessionId === 'string') {
        if (record(params.targetInfo).type !== 'iframe') return;
        if (sessions.has(params.sessionId)) return;
        if (sessions.size >= LIMITS.documents) { partial = true; return; }
        const session: Session = { id: params.sessionId, live: true, ax: false, auto: false,
          ...(typeof record(params.targetInfo).targetId === 'string' ? { targetId: record(params.targetInfo).targetId as string } : {}) };
        sessions.set(params.sessionId, session);
        const task = initialize(session).catch(() => { session.live = false; partial = true; });
        setup.add(task);
        void task.finally(() => setup.delete(task));
      } else if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') {
        const session = sessions.get(params.sessionId);
        if (session) session.live = false;
        for (const frame of frames.values()) if (frame.session === session) changed.add(frame.id);
      } else if (method === 'Page.frameNavigated') {
        const frame = record(params.frame);
        if (typeof frame.id === 'string') changed.add(frame.id);
      } else if (method === 'Page.frameDetached' && typeof params.frameId === 'string') {
        changed.add(params.frameId);
      }
    };
    const stopEvents = client.onEvent(event);
    const stopDetach = client.onDetach((source) => { if (source.tabId === tabId) detached = true; });
    const drain = async () => { while (setup.size) await Promise.all([...setup]); };
    const inventory = async (): Promise<Map<string, Frame>> => {
      const collected = new Map<string, Frame>();
      for (const session of sessions.values()) {
        if (!session.live) continue;
        try {
          const data = await command(session, 'Page.getFrameTree');
          const stack: { tree: unknown; parent?: string; depth: number }[] = [{ tree: data.frameTree, depth: 0 }];
          while (stack.length) {
            const { tree, parent, depth } = stack.pop()!;
            const entry = record(tree);
            const frame = record(entry.frame);
            if (typeof frame.id !== 'string' || typeof frame.loaderId !== 'string') {
              throw new CaptureFailure('invalid-tree', 'Chrome returned an invalid frame tree.');
            }
            if (session === rootSession && depth === 0) rootId ??= frame.id;
            const parentId = typeof frame.parentId === 'string' ? frame.parentId : parent;
            if (!collected.has(frame.id) && collected.size >= LIMITS.documents * 4) { partial = true; continue; }
            // The session whose root is this frame is authoritative for its process.
            if (!collected.has(frame.id) || depth === 0) collected.set(frame.id, {
              id: frame.id, loaderId: frame.loaderId, parentId, session,
              ...(typeof frame.url === 'string' ? { url: frame.url } : {}),
              ...(typeof frame.securityOrigin === 'string' ? { origin: frame.securityOrigin } : {}),
            });
            if (entry.childFrames !== undefined && !Array.isArray(entry.childFrames)) throw new CaptureFailure('invalid-tree', 'Chrome returned an invalid frame tree.');
            if (depth > LIMITS.frameDepth) { if ((entry.childFrames as unknown[] | undefined)?.length) partial = true; continue; }
            for (const child of entry.childFrames as FrameTree[] ?? []) stack.push({ tree: child, parent: frame.id, depth: depth + 1 });
          }
        } catch (error) { if (session === rootSession) throw error; partial = true; }
      }
      return collected;
    };
    const inspect = async (session: Session, backendNodeId: number, declaration: string): Promise<unknown> => {
      const resolved = await command(session, 'DOM.resolveNode', { backendNodeId, objectGroup });
      const objectId = record(resolved.object).objectId;
      if (typeof objectId !== 'string') return undefined;
      const response = await command(session, 'Runtime.callFunctionOn', {
        objectId, functionDeclaration: declaration, returnByValue: true, silent: true,
      });
      if (response.exceptionDetails) return undefined;
      return record(response.result).value;
    };
    const snapshot = async (frame: Frame) => {
      if (!frame.session.ax) {
        frame.session.ax = true;
        await command(frame.session, 'Accessibility.enable');
      }
      const data = await command(frame.session, 'Accessibility.getFullAXTree', { frameId: frame.id });
      frame.snapshot = checkSnapshot(data, budget);
      if (frame.snapshot.nodes.some((node) => node.frameId !== undefined && node.frameId !== frame.id)) {
        throw new CaptureFailure('invalid-tree', 'Chrome returned an unexpected document.');
      }
      if (controls?.data?.includeFormValues === false) {
        const suppressedValues = new Set<string>();
        const byId = new Map(frame.snapshot.nodes.map(node => [node.nodeId, node]));
        const parents = new Map<string, ChromeAxNode[]>();
        for (const parent of frame.snapshot.nodes) for (const id of parent.childIds ?? []) parents.set(id, [...parents.get(id) ?? [], parent]);
        let comparisons = 0;
        for (const node of frame.snapshot.nodes) {
          const editable = node.properties?.some(p => p.name === 'editable' && ['plain', 'plaintext', 'richtext', true].includes(p.value?.value as string | boolean));
          if (FORM_ROLES.has(String(node.role?.value)) || editable) {
            const values = new Set<string>();
            if (typeof node.value?.value === 'string' && node.value.value) values.add(node.value.value);
            const queue = [...node.childIds ?? []];
            while (queue.length) {
              const id = queue.pop()!; if (suppressedValues.has(id)) continue;
              suppressedValues.add(id); const child = byId.get(id);
              for (const text of [child?.name?.value, child?.value?.value]) if (typeof text === 'string' && text) values.add(text);
              queue.push(...child?.childIds ?? []);
            }
            if (node.name?.value === node.value?.value || node.name?.sources?.some(source => source.type === 'contents' && !source.superseded) && !['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(String(node.role?.value))) delete node.name;
            delete node.value;
            // AX may repeat editable descendants in an ancestor's content-based name.
            const ancestors = [...parents.get(node.nodeId) ?? []];
            const seen = new Set<string>();
            while (ancestors.length) {
              const parent = ancestors.pop()!; if (seen.has(parent.nodeId)) continue; seen.add(parent.nodeId);
              if (typeof parent.name?.value === 'string') for (const value of values) {
                if (++comparisons > 100000) throw new CaptureFailure('capture-limit', 'The page exceeds the capture limits.');
                parent.name.value = parent.name.value.split(value).join('').trim();
              }
              ancestors.push(...parents.get(parent.nodeId) ?? []);
            }
            node.childIds = [];
          }
          node.properties = node.properties?.filter(p => !['checked', 'selected'].includes(p.name));
        }
        frame.snapshot.nodes = frame.snapshot.nodes.filter(node => !suppressedValues.has(node.nodeId));
      }
      // Only inspect input type, never DOM values. Suppress descendants of password controls.
      const suppressed = new Set<string>();
      for (const node of frame.snapshot.nodes) {
        if (node.value === undefined && node.role?.value !== 'textbox' && node.role?.value !== 'searchbox') continue;
        let password: unknown;
        if (typeof node.backendDOMNodeId === 'number') {
          password = await inspect(frame.session, node.backendDOMNodeId,
            'function() { return this.localName === "input" && this.type === "password"; }');
        }
        if (password !== false) {
          delete node.value;
          const queue = [...node.childIds ?? []];
          const byId = new Map(frame.snapshot.nodes.map((item) => [item.nodeId, item]));
          while (queue.length) {
            const id = queue.pop()!;
            if (suppressed.has(id)) continue;
            suppressed.add(id);
            queue.push(...byId.get(id)?.childIds ?? []);
          }
          node.childIds = [];
        }
      }
      frame.snapshot.nodes = frame.snapshot.nodes.filter((node) => !suppressed.has(node.nodeId));
    };

    try {
      attachPending = true;
      const error = await bounded<string | undefined>((done) => {
        try { client.attach({ tabId }, '1.3', (attachError) => { attachPending = false; done(attachError); }); }
        catch (error) { attachPending = false; throw error; }
      }, LIMITS.commandMs, (lateError) => {
        if (lateError) inFlight.delete(tabId);
        else client.detach({ tabId }, (detachError) => { if (!detachError) inFlight.delete(tabId); });
      });
      if (error) throw commandError(error);
      attached = true;
      await initialize(rootSession);
      await drain();
      for (const [id, frame] of await inventory()) frames.set(id, frame);
      if (!rootId || !frames.has(rootId)) throw new CaptureFailure('invalid-tree', 'Chrome returned no main document.');
      // Setup/inventory events are not changes to an AX snapshot that has not been read yet.
      changed.clear();
      if (selection) {
        // Runtime.enable reports existing contexts. Browser-provided origin and
        // frame identity select our content-script world, never page globals.
        if (!client.extensionOrigin) throw new CaptureFailure('capture-unavailable', 'The selection context is unavailable.');
        runtimeEnabled = true;
        await command(rootSession, 'Runtime.enable');
        // Reloaded extensions can leave another authenticated isolated world in
        // this document. Select the world retaining this session's exact token,
        // rather than rejecting a valid selection merely because two worlds exist.
        for (const candidate of pickerContexts.values()) {
          const response = await command(rootSession, 'Runtime.evaluate', {
            expression: `(${selectedElementReference.toString()})(${JSON.stringify(selection)})`,
            uniqueContextId: candidate, objectGroup, silent: true,
          });
          const objectId = record(response.result).objectId;
          if (response.exceptionDetails || typeof objectId !== 'string') continue;
          if (selectedObject) throw new CaptureFailure('page-changed', 'The selection session is ambiguous. Start Select element again.');
          selectionContext = candidate;
          selectedObject = objectId;
        }
        if (!selectedObject) throw new CaptureFailure('page-changed', 'The selected element is no longer available. Start Select element again.');
        const description = await command(rootSession, 'DOM.describeNode', { objectId: selectedObject, depth: -1, pierce: true });
        try {
          selectionIds = await selectedDomIds(description.node, async backendNodeId =>
            (await command(rootSession, 'DOM.describeNode', { backendNodeId, depth: -1, pierce: true })).node);
        } catch { throw new CaptureFailure('capture-limit', 'Unable to resolve the selected block within capture limits.'); }
      }
      if (!sourceAllowed(frames.get(rootId)!.url, controls?.sources, frames.get(rootId)!.origin ?? 'null')) throw new CaptureFailure('policy-blocked', 'Capture of this source is disabled by site restrictions.');
      await snapshot(frames.get(rootId)!);
      if (selectionIds) {
        try { frames.get(rootId)!.snapshot = selectChromeAxTree(frames.get(rootId)!.snapshot!, selectionIds); }
        catch { throw new CaptureFailure('capture-unavailable', 'The selected element has no accessible content. Pick another block.'); }
      }
      let documents = 1;
      const visit = async (parent: Frame, depth: number) => {
        for (const frame of frames.values()) {
          if (frame.parentId !== parent.id) continue;
          try {
            const owner = await command(parent.session, 'DOM.getFrameOwner', { frameId: frame.id });
            if (typeof owner.backendNodeId !== 'number') throw new Error('missing-owner');
            frame.owner = owner.backendNodeId;
            if (parent.id === rootId && selectionIds && !selectionIds.has(frame.owner)) { frame.omitted = true; continue; }
            const visibility = await inspect(parent.session, frame.owner, inspectFrameOwner.toString());
            if (visibility === 'hidden' || visibility === 'technical') { frame.omitted = true; continue; }
            if (visibility !== 'visible') { frame.status = 'Not captured: visibility unknown'; partial = true; continue; }
            if (!parent.snapshot?.nodes.some((node) => node.backendDOMNodeId === frame.owner)) {
              frame.status = 'Not captured: position unresolved'; partial = true; continue;
            }
            if (frame.url === '' || frame.url?.startsWith('about:blank')) {
              const pending = await inspect(parent.session, frame.owner,
                'function() { const src = this.getAttribute("src")?.trim(); return this.hasAttribute("srcdoc") || Boolean(src && !/^about:blank(?:#|$)/i.test(src)); }');
              if (pending !== false) {
                frame.status = 'Not captured: not loaded'; partial = true; continue;
              }
            }
            if (documents >= LIMITS.documents || depth >= LIMITS.frameDepth) {
              frame.status = 'Not captured: limit exceeded'; partial = true; continue;
            }
            // Reserve time for a final root identity check and session inventory.
            if (deadline - Date.now() < LIMITS.commandMs) {
              frame.status = 'Not captured: limit exceeded'; partial = true; continue;
            }
            if (!sourceAllowed(frame.url, controls?.sources, frame.origin ?? 'null')) { frame.omitted = true; policyPartial = true; continue; }
            documents++;
            if (changed.has(frame.id) || !frame.session.live) throw new CaptureFailure('page-changed', 'The embedded document changed.');
            await snapshot(frame);
            frame.status = 'Captured';
            await visit(frame, depth + 1);
          } catch (error) {
            frame.snapshot = undefined;
            frame.status = error instanceof CaptureFailure && error.code === 'page-changed'
              ? 'Not captured: document changed' : error instanceof CaptureFailure && /limit|timeout/u.test(error.code)
                ? 'Not captured: limit exceeded' : 'Not captured: unavailable';
            partial = true;
          }
        }
      };
      await visit(frames.get(rootId)!, 0);
      if (selection) {
        for (const frame of frames.values()) {
          let ancestor = frame.parentId ? frames.get(frame.parentId) : undefined;
          const seen = new Set<string>();
          while (ancestor) {
            if (seen.has(ancestor.id)) throw new CaptureFailure('invalid-tree', 'Chrome returned an invalid frame hierarchy.');
            seen.add(ancestor.id);
            if (ancestor.omitted) { frame.omitted = true; break; }
            ancestor = ancestor.parentId ? frames.get(ancestor.parentId) : undefined;
          }
        }
      }
      await drain();
      const current = await inventory();
      for (const frame of frames.values()) {
        if (changed.has(frame.id) || !frame.session.live || current.get(frame.id)?.loaderId !== frame.loaderId ||
            current.get(frame.id)?.session !== frame.session || current.get(frame.id)?.parentId !== frame.parentId ||
            current.get(frame.id)?.url !== frame.url || current.get(frame.id)?.origin !== frame.origin) {
          if (frame.id === rootId) throw new CaptureFailure('page-changed', 'The page changed during capture.');
          frame.snapshot = undefined;
          if (!frame.omitted) { frame.status = 'Not captured: document changed'; partial = true; }
        }
      }
      if (!selection && [...current.keys()].some((id) => !frames.has(id))) partial = true;
      if (selectedObject && selection) {
        if (!selectionContext || ![...pickerContexts.values()].includes(selectionContext)) throw new CaptureFailure('page-changed', 'The selection context changed during capture.');
        const currentSelection = await command(rootSession, 'Runtime.evaluate', {
          expression: `(${selectedElementReference.toString()})(${JSON.stringify(selection)})`,
          uniqueContextId: selectionContext, objectGroup, silent: true,
        });
        const currentObject = record(currentSelection.result).objectId;
        if (currentSelection.exceptionDetails || typeof currentObject !== 'string') throw new CaptureFailure('page-changed', 'The selected element changed during capture.');
        const verification = await command(rootSession, 'Runtime.callFunctionOn', {
          objectId: selectedObject, functionDeclaration: 'function(current) { return this === current && this.isConnected; }',
          arguments: [{ objectId: currentObject }], returnByValue: true, silent: true,
        });
        if (verification.exceptionDetails || record(verification.result).value !== true) throw new CaptureFailure('page-changed', 'The selected element changed during capture.');
        const currentRoot = await command(rootSession, 'DOM.describeNode', { objectId: selectedObject, depth: -1, pierce: true });
        const currentIds = await selectedDomIds(currentRoot.node, async backendNodeId =>
          (await command(rootSession, 'DOM.describeNode', { backendNodeId, depth: -1, pierce: true })).node);
        if (currentIds.size !== selectionIds?.size || [...currentIds].some(id => !selectionIds!.has(id))) throw new CaptureFailure('page-changed', 'The selected block changed during capture. Pick it again.');
      }
      if (detached) throw new CaptureFailure('page-changed', 'The page changed during capture.');
    } catch (error) {
      result = error instanceof CaptureFailure ? fail(error.code, error.message) : fail('capture-failed', 'Unable to capture this page’s accessibility tree.');
    } finally {
      closing = true;
      cleanupDeadline = Date.now() + LIMITS.cleanupMs;
      // Disable children first; disabling a parent's auto-attach detaches its children.
      for (const session of [...sessions.values()].reverse()) {
        if (!session.live || !attached || detached) continue;
        for (const [method, params] of [
          ['Runtime.releaseObjectGroup', { objectGroup }],
          ...(session === rootSession && runtimeEnabled ? [['Runtime.disable', {}]] : []),
          ...(session.ax ? [['Accessibility.disable', {}]] : []),
          ...(session.auto ? [['Target.setAutoAttach', { autoAttach: false, flatten: true, waitForDebuggerOnStart: false }]] : []),
          ['Page.disable', {}],
        ] as [string, Record<string, unknown>][]) {
          try { await command(session, method, params, true); } catch { result ??= fail('capture-failed', 'Unable to finish page capture.'); }
        }
      }
      if (attached && !detached) {
        try {
          const error = await bounded<string | undefined>((done) => client.detach({ tabId }, done), Math.max(1, cleanupDeadline - Date.now()),
            (lateError) => { if (!lateError) inFlight.delete(tabId); });
          if (error) { releaseGuard = false; result ??= fail('capture-failed', 'Unable to finish page capture.'); }
        } catch { releaseGuard = false; result ??= fail('capture-failed', 'Unable to finish page capture.'); }
      }
      stopEvents();
      stopDetach();
      if (!attachPending && releaseGuard) inFlight.delete(tabId);
    }
    if (result) return result;
    try {
      // Selection warnings describe only the retained document boundaries.
      if (selection) partial = false;
      const normalize = (frame: Frame, baseDepth = 0): SemanticNode | undefined => {
        if (!frame.snapshot) return undefined;
        const owners = new Map<number, SemanticNode>();
        const omittedOwners = new Set<SemanticNode>();
        const normalized = normalizeChromeAxTree(frame.snapshot, {
          frameId: frame.id,
          onNode(raw, node) {
            if (controls?.actions && (!frame.parentId || frame.origin && rootId && frame.origin === frames.get(rootId)?.origin)) {
              rememberChromeTarget(controls.actions, raw, node, { id: frame.id, loaderId: frame.loaderId, targetId: frame.session.targetId });
            }
            if (raw.backendDOMNodeId !== undefined) owners.set(raw.backendDOMNodeId, node);
            if (raw.role?.value === 'Iframe' || raw.role?.value === 'IframePresentational') {
              node.role = 'embedded-document';
              node.value = 'Not captured: unavailable';
              node.children = [];
            }
          },
        });
        if (!normalized.ok) return undefined;
        const depths = new Map<SemanticNode, number>();
        const pending = [{ node: normalized.tree.root, depth: baseDepth }];
        while (pending.length) {
          const { node, depth } = pending.pop()!;
          if (depth > LIMITS.nodeDepth) { frame.status = 'Not captured: limit exceeded'; return undefined; }
          depths.set(node, depth);
          for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
        }
        for (const child of frames.values()) {
          if (child.parentId !== frame.id || child.owner === undefined) continue;
          const owner = owners.get(child.owner);
          if (!owner) { if (!child.omitted) partial = true; continue; }
          // Always discard any incidental cross-document AX content first.
          owner.children = [];
          if (child.omitted) { omittedOwners.add(owner); continue; }
          owner.role = 'embedded-document';
          delete owner.href;
          const page = normalize(child, (depths.get(owner) ?? baseDepth) + 1);
          if (page) { owner.value = 'Captured'; owner.children = [page]; }
          else { owner.value = child.status === 'Captured' ? 'Not captured: unavailable' : child.status ?? 'Not captured: unavailable'; partial = true; }
        }
        const stack = [normalized.tree.root];
        while (stack.length) {
          const node = stack.pop()!;
          node.children = node.children.filter((child) => !omittedOwners.has(child));
          if (node.role === 'embedded-document' && node.value !== 'Captured') partial = true;
          stack.push(...node.children);
        }
        return normalized.tree.root;
      };
      const root = rootId ? normalize(frames.get(rootId)!) : undefined;
      if (!root) return fail('invalid-tree', 'Chrome returned an invalid accessibility tree.');
      return { ok: true, tree: {
        schemaVersion: 1, root,
        ...(root.name ? { title: root.name } : {}),
        ...(rootId && frames.get(rootId)?.url !== undefined ? { sourceUrl: frames.get(rootId)!.url } : {}),
      }, ...((partial || policyPartial) ? { warnings: [...(partial ? ['embedded-frames-partial' as const] : []), ...(policyPartial ? ['source-policy-omitted' as const] : [])] } : {}) };
    } catch { return fail('invalid-tree', 'Chrome returned an invalid accessibility tree.'); }
  };
}
