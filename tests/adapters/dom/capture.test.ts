// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { captureDomPage } from '@/src/adapters/dom/capture';
import { DOM_CAPTURE_LIMITS } from '@/src/adapters/dom/limits';
import { isDomCaptureOutcome } from '@/src/adapters/dom/validate';
import { prepareExport, type SemanticNode } from '@/src/core';

const windows: JSDOM[] = [];
function documentFor(html: string): Document {
  const dom = new JSDOM(`<title>Synthetic settings</title>${html}`, { url: 'https://example.test/settings' });
  windows.push(dom);
  return dom.window.document;
}
function nodes(node: SemanticNode): SemanticNode[] { return [node, ...node.children.flatMap(nodes)]; }
function capture(doc: Document) {
  const result = captureDomPage(doc);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(isDomCaptureOutcome(result)).toBe(true);
  return { ...result, all: nodes(result.tree.root) };
}
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

describe('DOM semantic capture', () => {
  it('produces an independently specified semantic tree with document metadata and ordered text', () => {
    const result = capture(documentFor('<main><h1>Settings</h1><button>Save</button></main>'));
    expect(result.tree).toEqual({
      schemaVersion: 1, title: 'Synthetic settings', sourceUrl: 'https://example.test/settings',
      root: { role: 'page', children: [{ role: 'main', children: [
        { role: 'heading', name: 'Settings', level: 1, children: [{ role: 'StaticText', name: 'Settings', children: [] }] },
        { role: 'button', name: 'Save', states: { disabled: false, focusable: true }, children: [{ role: 'StaticText', name: 'Save', children: [] }] },
      ] }] },
    });
  });

  it('uses ordered hidden references, HTML labels, alt, legend and captions without using placeholder as a label', () => {
    const result = capture(documentFor(`
      <span id="a" hidden>Security</span><span id="b" aria-hidden="true">options</span>
      <button aria-labelledby="a missing b" aria-label="wrong">Wrong</button>
      <label for="account">Account name</label><input id="account" placeholder="Not the label">
      <label>Notes<textarea>Initial</textarea></label><input placeholder="Unlabelled">
      <img alt="Architecture diagram"><fieldset><legend>Authentication</legend></fieldset>
      <table><caption>Sessions</caption><tr><th scope="row">Device</th><td>Local</td></tr></table>
    `));
    expect(result.all).toContainEqual(expect.objectContaining({ role: 'button', name: 'Security options' }));
    expect(result.all.filter((node) => node.role === 'textbox').map((node) => node.name)).toEqual(['Account name', 'Notes', undefined]);
    for (const [role, name] of [['img', 'Architecture diagram'], ['group', 'Authentication'], ['table', 'Sessions'], ['rowheader', 'Device']]) {
      expect(result.all).toContainEqual(expect.objectContaining({ role, name }));
    }
    expect(result.all.filter((node) => node.role === 'StaticText').map((node) => node.name)).not.toContain('Security');
  });

  it('terminates cyclic naming references and falls back after invalid roles or missing references', () => {
    const result = capture(documentFor('<span id="a" aria-labelledby="b">A</span><span id="b" aria-labelledby="a">B</span><button aria-labelledby="missing" aria-label="Save" role="invented button">Wrong</button><input type="checkbox">'));
    expect(result.all).toContainEqual(expect.objectContaining({ role: 'button', name: 'Save' }));
    expect(result.all.find((node) => node.role === 'checkbox')?.name).toBeUndefined();
  });

  it('preserves block boundaries and nested ARIA names when computing a control label', () => {
    const { all } = capture(documentFor('<span id="label" hidden>account</span><button>Add <span aria-labelledby="label">wrong</span><div>Security</div><div>options</div></button>'));
    expect(all.find((node) => node.role === 'button')?.name).toBe('Add account Security options');
  });

  it('reads current values and mixed/false states, disabled fieldsets and native selected options', () => {
    const doc = documentFor(`
      <input id="check" type="checkbox"><input id="text" aria-label="Account" value="Initial" aria-required="true">
      <textarea aria-label="Notes">Initial notes</textarea><select aria-label="Region"><option>A</option><option>B</option></select>
      <fieldset disabled><legend><button>Legend action</button></legend><button>Blocked</button></fieldset>
      <div role="tab" aria-selected="false">Security</div><div role="switch" aria-label="TOTP" aria-checked="false"></div>
      <details><summary>Advanced</summary><button>Hidden action</button></details>
    `);
    (doc.querySelector('#check') as HTMLInputElement).indeterminate = true;
    (doc.querySelector('#text') as HTMLInputElement).value = 'Current';
    (doc.querySelector('textarea') as HTMLTextAreaElement).value = 'Current notes';
    (doc.querySelector('select') as HTMLSelectElement).selectedIndex = 1;
    const { all } = capture(doc);
    expect(all.find((node) => node.role === 'checkbox')?.states?.checked).toBe('mixed');
    expect(all.find((node) => node.name === 'Account')).toMatchObject({ value: 'Current', states: { required: true } });
    expect(all.find((node) => node.name === 'Notes')?.value).toBe('Current notes');
    expect(all.find((node) => node.role === 'button' && node.name === 'Legend action')?.states?.disabled).toBe(false);
    expect(all.find((node) => node.role === 'button' && node.name === 'Blocked')?.states?.disabled).toBe(true);
    expect(all.find((node) => node.role === 'option' && node.name === 'B')?.states?.selected).toBe(true);
    expect(all.find((node) => node.role === 'tab')?.states?.selected).toBe(false);
    expect(all.find((node) => node.role === 'switch')?.states?.checked).toBe(false);
    expect(all.find((node) => node.name === 'Advanced')?.states?.expanded).toBe(false);
    expect(all.find((node) => node.name === 'Hidden action')).toBeUndefined();
  });

  it('does not read password values even through referenced or wrapping labels and with privacy disabled', () => {
    const doc = documentFor('<label id="label" for="pw">Password</label><input type="password" id="pw" value="synthetic-password"><label id="embedded">Private <input type="password" value="synthetic-embedded"></label><button aria-labelledby="embedded">Submit</button><button aria-labelledby="pw">Reference</button>');
    let reads = 0;
    for (const input of doc.querySelectorAll('input')) Object.defineProperty(input, 'value', { get() { reads++; throw new Error('Password must not be read'); } });
    const result = capture(doc);
    expect(reads).toBe(0);
    expect(result.all.filter((node) => node.role === 'textbox').every((node) => node.value === undefined)).toBe(true);
    for (const format of ['semantic-text', 'markdown'] as const) {
      for (const compression of ['without', 'detailed', 'compact', 'maximum'] as const) {
        const exported = prepareExport(result.tree, compression, format, false).serialized.content;
        expect(exported).not.toContain('synthetic-password');
        expect(exported).not.toContain('synthetic-embedded');
      }
    }
    expect(reads).toBe(0);
  });

  it('prunes inaccessible content but keeps offscreen UI and visibility overrides', () => {
    const { all } = capture(documentFor('<div hidden><button>Hidden</button></div><div aria-hidden="true"><button>ARIA hidden</button></div><div inert><button>Inert</button></div><div style="display:none"><button>CSS hidden</button></div><div style="visibility:hidden">Hidden text<button style="visibility:visible">Visible child</button></div><button style="position:absolute;left:-10000px">Offscreen</button><dialog><button>Closed dialog</button></dialog>'));
    expect(all.filter((node) => node.role === 'button').map((node) => node.name)).toEqual(['Visible child', 'Offscreen']);
  });

  it('captures open shadow roots and assigned slots once in composed order, without iframe or canvas contents', () => {
    const doc = documentFor('<div id="host"><button slot="action">Slotted</button></div><iframe title="Embedded"></iframe><canvas>Fallback</canvas>');
    doc.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<h2>Shadow settings</h2><slot name="action"></slot>';
    const result = capture(doc);
    expect(result.all.filter((node) => node.role === 'button').map((node) => node.name)).toEqual(['Slotted']);
    expect(result.all).toContainEqual(expect.objectContaining({ role: 'heading', name: 'Shadow settings', level: 2 }));
    expect(result.warnings).toEqual(['embedded-frames', 'canvas-content']);
    expect(JSON.stringify(result.tree)).not.toContain('Fallback');
  });

  it('preserves native and explicit interactive roles, list context, and safe resolved links', () => {
    const result = capture(documentFor('<ol><li>One<ul><li>Nested</li></ul></li></ol><a href="/settings">Settings</a><a href="javascript:alert(1)">Unsafe</a><div role="combobox" aria-label="City" aria-expanded="false"></div><div role="slider" aria-label="Zoom" aria-valuenow="125"></div><div role="dialog" aria-label="Confirm"><button role="presentation">Confirm</button></div><select multiple aria-label="Tags"><option selected>First</option></select>'));
    expect(result.all.filter((node) => node.role === 'listitem').map((node) => node.level)).toEqual([1, 2]);
    expect(result.all.find((node) => node.name === 'Settings')?.href).toBe('https://example.test/settings');
    expect(result.all.find((node) => node.name === 'Unsafe')?.href).toBeUndefined();
    expect(result.all.find((node) => node.name === 'City')).toMatchObject({ role: 'combobox', states: { expanded: false } });
    expect(result.all.find((node) => node.name === 'Zoom')).toMatchObject({ role: 'slider', value: '125' });
    expect(result.all.find((node) => node.role === 'button' && node.name === 'Confirm')).toBeDefined();
    expect(result.all.find((node) => node.name === 'Tags')?.role).toBe('listbox');
  });

  it.each([
    { maxNodes: 2 }, { maxVisited: 2 }, { maxDepth: 1 }, { maxCharacters: 3 }, { maxMilliseconds: -1 }, { maxPayloadCharacters: 1 },
  ])('fails explicitly rather than returning a partial tree when a budget is exceeded: %j', (overrides) => {
    const result = captureDomPage(documentFor('<main><div><button>Save settings</button></div></main>'), { ...DOM_CAPTURE_LIMITS, ...overrides });
    expect(result).toEqual({ ok: false, error: { code: 'capture-limit', message: 'This page exceeds the capture limits.' } });
  });

  it('runs credential redaction on DOM text, values and metadata through the shared export pipeline', () => {
    const doc = documentFor('<input aria-label="API key" value="synthetic-private-value"><p>Bearer abcdefghijklmnopqrstuvwxyz</p><a href="/?token=synthetic-private-token">Manage</a>');
    doc.title = 'Bearer abcdefghijklmnopqrstuvwxyz';
    const result = capture(doc);
    const exported = prepareExport(result.tree, 'compact', 'semantic-text', true);
    expect(exported.serialized.content).toContain('[REDACTED]');
    expect(exported.serialized.content).not.toContain('synthetic-private');
    expect(exported.serialized.content).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});

describe('DOM result validation', () => {
  it('rejects cycles, malformed states, unknown warnings and excessive depth', () => {
    const value = () => ({ ok: true, tree: { schemaVersion: 1, sourceUrl: 'https://example.test/', root: { role: 'page', children: [] as unknown[] } } });
    for (const malformed of [null, {}, { ...value(), warnings: ['invented'] }, { ...value(), warnings: ['embedded-frames', 'embedded-frames'] }]) expect(isDomCaptureOutcome(malformed)).toBe(false);
    const cycle = value(); cycle.tree.root.children.push(cycle.tree.root);
    expect(isDomCaptureOutcome(cycle)).toBe(false);
    const badState = value(); badState.tree.root.children.push({ role: 'button', states: { selected: 'false' }, children: [] });
    expect(isDomCaptureOutcome(badState)).toBe(false);
    const deep = value(); let current = deep.tree.root;
    for (let i = 0; i < 132; i++) { const child = { role: 'group', children: [] as unknown[] }; current.children.push(child); current = child; }
    expect(isDomCaptureOutcome(deep)).toBe(false);
  });
});

it('does not read current values or editable descendants when form values are excluded', () => {
  const doc = documentFor('<main><label>Account<input value="SECRET-INPUT"></label><label>Notes<textarea>SECRET-TEXTAREA</textarea></label><button><span contenteditable="true">SECRET-EDITABLE</span>Submit</button><select aria-label="Choice"><option selected>SECRET-CHOICE</option></select><input type="checkbox" checked aria-label="Agree"><div contenteditable="plaintext-only" aria-label="Comment">SECRET-PLAIN</div></main>');
  for (const control of doc.querySelectorAll('input,textarea,select')) Object.defineProperty(control, 'value', { get() { throw new Error('Current value must not be read'); } });
  const result = captureDomPage(doc, DOM_CAPTURE_LIMITS, { dataControls: { includeTitle: true, pageUrl: 'full', linkUrls: 'full', includeFormValues: false } });
  expect(result.ok).toBe(true); expect(isDomCaptureOutcome(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('SECRET'); expect(JSON.stringify(result)).not.toContain('checked'); expect(JSON.stringify(result)).not.toContain('selected');
  expect(JSON.stringify(result)).toContain('Account'); expect(JSON.stringify(result)).toContain('Comment');
});

it('captures visible supporting relationships without promoting hints to names or exposing hidden errors', () => {
  const doc = documentFor('<label>Display name<input aria-describedby="help" aria-errormessage="error" aria-invalid="true"></label><p id="help">Public name only</p><p id="error">Too short</p><input placeholder="Public hint"><input placeholder="Invisible hint" value="filled"><input aria-describedby="hidden"><p id="hidden" hidden>Hidden supporting text</p>');
  const all = capture(doc).all;
  expect(all.find(node => node.name === 'Display name' && node.role === 'textbox')).toMatchObject({ description: 'Public name only', errorMessage: 'Too short' });
  expect(all.find(node => node.placeholder === 'Public hint')).not.toHaveProperty('name');
  expect(all.some(node => node.placeholder === 'Invisible hint')).toBe(false);
  expect(all.some(node => node.description?.includes('Hidden supporting text'))).toBe(false);
  const excluded = captureDomPage(doc, DOM_CAPTURE_LIMITS, { dataControls: { includeTitle: true, includeFormValues: false, pageUrl: 'omit', linkUrls: 'omit' } });
  expect(excluded.ok).toBe(true);
  if (excluded.ok) expect(nodes(excluded.tree.root).some(node => node.description || node.errorMessage)).toBe(false);
});
