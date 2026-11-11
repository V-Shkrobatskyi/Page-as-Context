// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { domOperation } from '@/src/adapters/actions/dom-operation';
import { createDomActionRegistry } from '@/src/adapters/firefox/actions';
import type { SemanticNode } from '@/src/core/model';
function fixture(html: string) {
  const dom = new JSDOM(`<label>Display name${html}</label>`, { url: 'https://example.test/', pretendToBeVisual: true });
  const doc = dom.window.document, element = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')!;
  element.scrollIntoView = () => {};
  element.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 80, bottom: 40, width: 70, height: 30, toJSON() {} });
  doc.elementFromPoint = () => element;
  const fill = (text: string) => domOperation.call(element, { action: 'fill', text, sensitivePattern: 'password|secret' });
  return { dom, doc, element, fill, close: () => dom.window.close() };
}
describe('native text fill behavior', () => {
  it.each(['text', 'search', 'email', 'tel', 'url', 'textarea'])('replaces and clears Unicode in %s with focus and input/change events', type => {
    const f = fixture(type === 'textarea' ? '<textarea></textarea>' : `<input type="${type}">`);
    try {
      const events: string[] = [];
      for (const event of ['focus', 'input', 'change']) f.element.addEventListener(event, e => {
        events.push(event);
        if (event === 'input') expect((e as InputEvent).inputType).toBe('insertReplacementText');
      });
      const text = type === 'textarea' ? 'Ukraine 🌻\nSecond line' : 'Ukraine 🌻';
      expect(f.fill(text)).toMatchObject({ applied: true, parentTag: 'label' });
      expect(f.element.value).toBe(text); expect(f.doc.activeElement).toBe(f.element);
      expect(events).toEqual(['focus', 'input', 'change']);
      expect(f.fill('')).toMatchObject({ applied: true }); expect(f.element.value).toBe('');
    } finally { f.close(); }
  });
  it('updates a controlled-field tracker through the native setter and refuses focus-time replacements', () => {
    const f = fixture('<input>');
    try {
      const native = Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype, 'value')!;
      let tracked = '', appState = '';
      Object.defineProperty(f.element, 'value', { get() { return native.get!.call(this); }, set(value) { tracked = value; native.set!.call(this, value); } });
      f.element.addEventListener('input', () => { if (tracked !== f.element.value) appState = f.element.value; });
      expect(f.fill('Controlled text').applied).toBe(true); expect(appState).toBe('Controlled text');
    } finally { f.close(); }
    const replaced = fixture('<input>');
    try {
      replaced.element.addEventListener('focus', () => replaced.element.replaceWith(replaced.element.cloneNode()));
      expect(replaced.fill('must not apply')).toMatchObject({ error: 'stale-snapshot' });
      expect(replaced.element.value).toBe('');
    } finally { replaced.close(); }
  });
  it.each(['disabled', 'readonly', 'type="password"', 'type="number"', 'type="color"'])('refuses unsupported or protected input: %s', attrs => {
    const f = fixture(`<input ${attrs}>`);
    try { expect(f.fill('unsafe')).toHaveProperty('error'); } finally { f.close(); }
  });
  it('keeps Firefox node identity across snapshots and changes it after replacement', () => {
    const f = fixture('<input>');
    try {
      const remember = createDomActionRegistry(f.doc), owner = crypto.randomUUID();
      const node = (): SemanticNode => ({ role: 'textbox', name: 'Display name', children: [] });
      const first = node(), next = node(), replacement = node();
      const lease = () => ({ owner, snapshotId: crypto.randomUUID(), expires: Date.now() + 1000 });
      remember(lease(), f.element, first); remember(lease(), f.element, next);
      expect(first.captureIdentity).toBe(next.captureIdentity); expect(first.actionRef).not.toBe(next.actionRef);
      const copy = f.element.cloneNode() as Element; f.element.replaceWith(copy); const lastLease = lease(); remember(lastLease, copy, replacement);
      expect(replacement.captureIdentity).not.toBe(first.captureIdentity);
      (f.dom.window as any).__pageAsContextActions({ mode: 'release', lease: lastLease });
    } finally { f.close(); }
  });
});


it('rejects a field made sensitive by its focus handler before setting a value', () => {
  const f = fixture('<input>');
  try {
    f.element.addEventListener('focus', () => f.element.setAttribute('type', 'password'));
    expect(f.fill('must not apply')).toMatchObject({ error: 'stale-snapshot' }); expect(f.element.value).toBe('');
  } finally { f.close(); }
});
