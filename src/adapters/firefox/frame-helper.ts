// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { sourceAllowed } from '../../policy/sources';
import { captureDomPage } from '../dom/capture';
import type { DomCaptureWork } from '../dom/capture';
import type { SemanticNode } from '../../core';
import { frameVisibility } from './frame-visibility';
import { FIREFOX_CAPTURE_LIMITS as LIMITS } from './limits';
import type { FrameCommand, FrameHandler, FrameOwner, FrameSnapshot, FrameVerification } from './frame-contract';
import type { PickerGlobal } from '../../element-picker-protocol';
import { createDomActionRegistry } from './actions';

interface OwnerRecord { element: Element; frameId: number; signature: string; changed: boolean; stop: () => void }
interface Lease { generation: string; root: Element; selected?: Element; url: string; valid: boolean; inventoryChanged: boolean; owners: OwnerRecord[]; dispose: () => void; flush: () => void }
const signature = (element: Element): string => `${(element.getAttribute('src') ?? '').slice(0, 2048)}\u0000${element.hasAttribute('srcdoc')}\u0000${(element.getAttribute('sandbox') ?? '').slice(0, 512)}`;
const pending = (element: Element): boolean => {
  try {
    const child = (element as HTMLIFrameElement).contentDocument;
    return !!child && child.location.href.startsWith('about:blank') &&
      (element.hasAttribute('srcdoc') || !!element.getAttribute('src')?.trim() && !/^about:blank(?:#|$)/iu.test(element.getAttribute('src')!.trim()));
  } catch { return false; }
};
function sourceHost(element: Element): string {
  try {
    const url = new URL(element.getAttribute('src') ?? '', element.ownerDocument.baseURI);
    return ['http:', 'https:'].includes(url.protocol) && element.hasAttribute('src') ? `${url.protocol}//${url.hostname}/*` : '';
  } catch { return ''; }
}

/** Each lease keeps structural references only, with explicit release and a fallback TTL. */
export function createFrameHandler(doc: Document, frameId: (target: Element | Window) => number): FrameHandler {
  const leases = new Map<string, Lease>();
  let rememberAction: ReturnType<typeof createDomActionRegistry> | undefined;
  return (command: FrameCommand): unknown => {
    if (!command || typeof command.operation !== 'string' || command.operation.length > 64) return undefined;
    const previous = leases.get(command.operation);
    if (command.mode === 'release') { previous?.dispose(); return true; }
    if (command.mode === 'verify') {
      if (!previous || previous.generation !== command.generation) return undefined;
      previous.flush();
      return { operation: command.operation, generation: previous.generation,
        valid: previous.valid && doc.documentElement === previous.root && doc.location.href === previous.url && (!previous.selected || previous.selected.isConnected),
        inventoryChanged: previous.inventoryChanged,
        owners: previous.owners.map(owner => ({ frameId: owner.frameId, visibility: frameVisibility(owner.element),
          changed: owner.changed || !owner.element.isConnected || signature(owner.element) !== owner.signature || frameId(owner.element) !== owner.frameId,
          pending: pending(owner.element) })),
      } satisfies FrameVerification;
    }
    if (command.mode !== 'capture' || previous || leases.size >= 2 || !doc.defaultView || !doc.documentElement) return undefined;
    if (!sourceAllowed(doc.location.href, command.controls?.sources, doc.defaultView?.origin ?? 'null')) {
      return { operation: command.operation, generation: crypto.randomUUID(), outcome: { ok: false, error: { code: 'policy-blocked', message: 'Capture of this source is disabled by site restrictions.' } }, owners: [], work: { nodes: 0, visited: 0, nameWork: 0, characters: 0, milliseconds: 0 } } satisfies FrameSnapshot;
    }
    const limits = command.limits;
    if (!limits || Object.keys(limits).some(key => !(key in LIMITS)) ||
      Object.entries(limits).some(([key, value]) => !Number.isFinite(value) || value < 0 || value > LIMITS[key as keyof typeof LIMITS]) ||
      !Number.isInteger(command.maxOwners) || command.maxOwners < 0 || command.maxOwners > LIMITS.owners) return undefined;
    const picker = (globalThis as PickerGlobal).__pageAsContextPicker;
    const selected = command.selection ? picker?.token === command.selection ? picker.root() : undefined : undefined;
    if (command.selection && (!selected || selected.ownerDocument !== doc || !selected.isConnected)) return undefined;
    const generation = crypto.randomUUID();
    const ownerNodes = new Map<SemanticNode, OwnerRecord>();
    const records: OwnerRecord[] = [];
    const lease: Lease = { generation, root: doc.documentElement, selected, url: doc.location.href, valid: true, inventoryChanged: false, owners: records, dispose: () => {}, flush: () => {} };
    const mutations = (items: MutationRecord[]): void => {
      let inspected = 0;
      for (const item of items) {
        if (++inspected > 1024) { lease.inventoryChanged = true; break; }
        if (item.type === 'attributes') {
          const owner = records.find(record => record.element === item.target);
          if (owner) owner.changed = true;
          continue;
        }
        const stack = [...item.addedNodes, ...item.removedNodes];
        while (stack.length) {
          const node = stack.pop()!;
          if (++inspected > 1024) { lease.inventoryChanged = true; return; }
          if (node.nodeType === 1 && ['iframe', 'frame'].includes((node as Element).localName)) { lease.inventoryChanged = true; break; }
          for (const child of node.childNodes) { if (stack.length >= 1024) { lease.inventoryChanged = true; return; } stack.push(child); }
        }
      }
    };
    const observer = new doc.defaultView.MutationObserver(mutations);
    observer.observe(selected ?? doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcdoc', 'sandbox'] });
    lease.flush = () => mutations(observer.takeRecords());
    const pagehide = () => { lease.valid = false; };
    doc.defaultView.addEventListener('pagehide', pagehide);
    const timer = setTimeout(() => lease.dispose(), LIMITS.helperMs);
    lease.dispose = () => {
      clearTimeout(timer); observer.disconnect(); doc.defaultView?.removeEventListener('pagehide', pagehide);
      for (const owner of records) owner.stop();
      records.length = 0; ownerNodes.clear(); leases.delete(command.operation);
    };
    leases.set(command.operation, lease);
    let work: DomCaptureWork = { nodes: 0, visited: 0, nameWork: 0, characters: 0, milliseconds: 0 };
    const outcome = captureDomPage(doc, limits, {
      ...(command.controls?.actions ? { onNode(element: Element, node: SemanticNode) {
        rememberAction ??= createDomActionRegistry(doc);
        rememberAction(command.controls!.actions!, element, node);
      } } : {}),
      ...(selected ? { root: selected } : {}),
      dataControls: command.controls?.data,
      embedded: frameId(doc.defaultView) !== 0,
      includeFrame(element) { return !['hidden', 'technical'].includes(frameVisibility(element)); },
      onFrame(element, node) {
        const id = frameId(element);
        if (id <= 0) { node.value = 'Not captured: position unresolved'; return; }
        if (records.length >= command.maxOwners) { node.value = 'Not captured: limit exceeded'; return; }
        const record: OwnerRecord = { element, frameId: id, signature: signature(element), changed: false, stop: () => {} };
        const load = () => { record.changed = true; };
        element.addEventListener('load', load);
        record.stop = () => element.removeEventListener('load', load);
        records.push(record); ownerNodes.set(node, record);
        observer.observe(element, { attributes: true, attributeFilter: ['src', 'srcdoc', 'sandbox'] });
      },
      reportWork(value) { work = value; },
    });
    const owners: FrameOwner[] = [];
    if (outcome.ok) {
      const stack = [{ node: outcome.tree.root, path: [] as number[] }];
      while (stack.length) {
        const { node, path } = stack.pop()!;
        const owner = ownerNodes.get(node);
        if (owner) owners.push({ frameId: owner.frameId, path,
          visibility: frameVisibility(owner.element) === 'visible' ? 'visible' : 'unknown', source: sourceHost(owner.element), pending: pending(owner.element) });
        for (let index = node.children.length - 1; index >= 0; index--) stack.push({ node: node.children[index]!, path: [...path, index] });
      }
    } else { for (const record of records) record.stop(); records.length = 0; }
    ownerNodes.clear();
    const response: FrameSnapshot = { operation: command.operation, generation, outcome, owners, work };
    if (JSON.stringify(response).length > LIMITS.maxPayloadCharacters) {
      lease.dispose();
      return undefined;
    }
    return response;
  };
}
