// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { domOperation } from '@/src/adapters/actions/dom-operation';
import { createDomActionRegistry } from '@/src/adapters/firefox/actions';
import type { SemanticNode } from '@/src/core/model';
function fixture(html: string) {
  const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
  const doc = dom.window.document, element = doc.querySelector<HTMLElement>('#target')!;
  element.scrollIntoView = () => {};
  element.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 80, bottom: 40, width: 70, height: 30, toJSON() {} });
  doc.elementFromPoint = () => element;
  const invoke = (action = 'click') => domOperation.call(element, { action, sensitivePattern: '' });
  return { dom, doc, element, invoke, close: () => dom.window.close() };
}
describe('click preflight and constrained custom buttons', () => {
  it.each(['<button id="target">Next<span>Text</span><svg><path></path></svg></button>', '<div id="target" role="button" tabindex="0">Next<span>Text</span><svg><path></path></svg></div>'])('accepts decorative span/SVG descendants and emits one effect: %s', html => {
    const f = fixture(html);
    try {
      const effect = vi.fn(); f.element.addEventListener('click', effect);
      for (const child of f.element.querySelectorAll('span,svg,path')) { f.doc.elementFromPoint = () => child; expect(f.invoke()).toEqual({ applied: true }); }
      expect(effect).toHaveBeenCalledTimes(3);
    } finally { f.close(); }
  });
  it.each(['<span role="button" tabindex="0">Nested</span>', '<a href="/next">Nested</a>', '<input>', '<span tabindex="0">Focusable</span>'])('rejects another interactive descendant: %s', child => {
    const f = fixture(`<div id="target" role="button" tabindex="0">Next${child}</div>`);
    try { const effect = vi.fn(); f.element.addEventListener('click', effect); f.doc.elementFromPoint = () => f.element.firstElementChild; expect(f.invoke()).toHaveProperty('error'); expect(effect).not.toHaveBeenCalled(); }
    finally { f.close(); }
  });
  it.each(['role="button"', 'role="button" tabindex="-1"', 'role="link" tabindex="0"', 'role="menuitem" tabindex="0"', 'role="button" tabindex="0" contenteditable="true"', 'role="button" tabindex="0" aria-disabled="true"', 'role="button" tabindex="0" hidden', 'role="button" tabindex="0" inert'])('does not capture or click an ineligible custom target: %s', attrs => {
    const f = fixture(`<div id="target" ${attrs}>Next</div>`);
    try {
      const remember = createDomActionRegistry(f.doc), node: SemanticNode = { role: 'button', name: 'Next', children: [] };
      remember({ owner: 'test', snapshotId: crypto.randomUUID(), expires: Date.now() + 1000 }, f.element, node);
      expect(node.actionRef).toBeUndefined(); expect(f.invoke()).toHaveProperty('error');
    } finally { f.close(); }
  });
  it('captures a named custom button, prunes hidden refs and refuses stale identity and text', () => {
    const f = fixture('<div id="target" role="button" tabindex="0">Next</div>');
    try {
      const lease = { owner: 'test', snapshotId: crypto.randomUUID(), expires: Date.now() + 1000 }, remember = createDomActionRegistry(f.doc);
      const node: SemanticNode = { role: 'button', name: 'Next', children: [] }; remember(lease, f.element, node); expect(node.actionRef).toBeDefined();
      const send = (mode: string) => (f.dom.window as any).__pageAsContextActions({ mode, lease, deadline: Date.now() + 5000, command: { action: 'click', snapshotId: lease.snapshotId, elementRef: node.actionRef }, refs: [] });
      f.element.textContent = 'Different'; expect(send('apply')).toMatchObject({ status: 'rejected', error: 'stale-snapshot' });
      f.element.textContent = 'Next'; expect(send('prune')).toEqual({ pruned: true }); expect(send('locate')).toEqual({ found: false }); send('release');
    } finally { f.close(); }
  });
  it.each(['replace', 'disable', 'hide', 'rename'])('rechecks changes caused by scroll before dispatch: %s', change => {
    const f = fixture('<button id="target">Next</button>');
    try {
      const effect = vi.fn(); f.element.addEventListener('click', effect);
      f.element.scrollIntoView = () => {
        if (change === 'replace') f.element.replaceWith(f.element.cloneNode(true));
        if (change === 'disable') (f.element as HTMLButtonElement).disabled = true;
        if (change === 'hide') f.element.hidden = true;
        if (change === 'rename') f.element.textContent = 'Different';
      };
      expect(f.invoke()).toHaveProperty('error'); expect(effect).not.toHaveBeenCalled();
    } finally { f.close(); }
  });
});
