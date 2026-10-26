// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

/** Serialized by CDP. Keep free of imports, closures, arbitrary selectors and evaluation. */
export function domOperation(this: Element, args: { action: string; text?: string; checked?: boolean; sensitivePattern: string; signature?: string }, option?: Element): Record<string, unknown> {
  const element = this as HTMLInputElement;
  const doc = element.ownerDocument, win = doc.defaultView!;
  const label = [element.getAttribute('aria-label'), element.getAttribute('name'), element.id, element.getAttribute('autocomplete'),
    ...Array.from(element.labels ?? []).slice(0, 8).map(label => label.textContent?.slice(0, 2048))].join(' ').slice(0, 16384);
  const signature = JSON.stringify([element.localName, element.getAttribute('type'), element.getAttribute('role'), label,
    ['button', 'a', 'option'].includes(element.localName) ? element.textContent?.slice(0, 4096) : '', element.localName === 'option' ? element.getAttribute('value') : '']);
  if (args.action === 'signature') return { signature };
  if (!['input', 'textarea', 'button', 'a', 'select', 'summary'].includes(element.localName)) return { error: 'unsupported-action' };
  if (element.localName === 'input' && ['password', 'file', 'hidden'].includes(element.type)) return { error: 'unsupported-action' };
  let root = element.getRootNode();
  for (let depth = 0; root instanceof win.ShadowRoot && depth < 16; depth++) {
    if (root.mode !== 'open') return { error: 'unsupported-action' }; root = root.host.getRootNode();
  }
  if (args.signature && args.signature !== signature) return { error: 'stale-snapshot' };
  if (!element.isConnected || element.ownerDocument !== doc || element.closest('[hidden],[inert],[aria-hidden="true"]') ||
    element.matches(':disabled') || element.closest('[aria-disabled="true"]') || element.readOnly) return { error: 'unsupported-action' };
  const style = win.getComputedStyle(element);
  if (style.visibility !== 'visible' || style.display === 'none' || style.opacity === '0') return { error: 'unsupported-action' };
  if (element.localName === 'option') return { error: 'unsupported-action' };
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return { error: 'unsupported-action' };
  const x = Math.max(0, rect.left) + Math.min(rect.width, win.innerWidth - Math.max(0, rect.left)) / 2;
  const y = Math.max(0, rect.top) + Math.min(rect.height, win.innerHeight - Math.max(0, rect.top)) / 2;
  let hit = doc.elementFromPoint(x, y);
  for (let depth = 0; hit?.shadowRoot && depth < 16; depth++) { const deeper = hit.shadowRoot.elementFromPoint(x, y); if (!deeper || deeper === hit) break; hit = deeper; }
  if (!hit || hit !== element && !element.contains(hit)) return { error: 'unsupported-action' };
  // Verify accessible ancestor frames too. Cross-origin boundaries fail closed.
  let px = x, py = y;
  try {
    let current: Window = win;
    for (let depth = 0; current !== current.top; depth++) {
      if (depth >= 16 || !current.frameElement) return { error: 'unsupported-action' };
      const owner = current.frameElement as HTMLElement, box = owner.getBoundingClientRect();
      if (owner.ownerDocument.defaultView!.getComputedStyle(owner).transform !== 'none') return { error: 'unsupported-action' };
      if (Math.abs(owner.clientWidth - current.innerWidth) > 1 || Math.abs(owner.clientHeight - current.innerHeight) > 1) return { error: 'unsupported-action' };
      px += box.left + owner.clientLeft; py += box.top + owner.clientTop;
      if (owner.ownerDocument.elementFromPoint(px, py) !== owner) return { error: 'unsupported-action' };
      current = current.parent;
    }
  } catch { return { error: 'unsupported-action' }; }
  if (args.action === 'inspect-click') return { x: px, y: py };
  if (args.action === 'click') { element.click(); return { applied: true }; }
  if (args.action === 'fill' || args.action === 'prepare-fill') {
    const supported = element.localName === 'textarea' || element.localName === 'input' && ['text', 'search', 'email', 'tel', 'url'].includes(element.type);
    if (!supported || new RegExp(args.sensitivePattern, 'iu').test(label) || /(?:cc-|password|one-time-code)/iu.test(element.autocomplete)) return { error: 'unsupported-action' };
    if (args.action === 'prepare-fill') { element.focus(); element.select(); return { prepared: true }; }
    const prototype = element.localName === 'textarea' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, args.text);
  } else if (args.action === 'set-checked' || args.action === 'inspect-checked') {
    if (element.localName !== 'input' || element.type !== 'checkbox') return { error: 'unsupported-action' };
    if (args.action === 'inspect-checked') return { x: px, y: py, alreadyDesired: element.checked === args.checked };
    if (element.checked === args.checked && !element.indeterminate) return { applied: true };
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'checked')!.set!.call(element, args.checked);
    element.indeterminate = false;
  } else if (args.action === 'select-option') {
    if (element.localName !== 'select' || !option || option.localName !== 'option' || !option.isConnected || (option.closest('select') as Element | null) !== (element as Element) ||
      (option as HTMLOptionElement).disabled || option.parentElement?.matches('optgroup:disabled')) return { error: 'stale-snapshot' };
    (element as unknown as HTMLSelectElement).selectedIndex = (option as HTMLOptionElement).index;
  } else return { error: 'unsupported-action' };
  element.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
  return { applied: true };
}
