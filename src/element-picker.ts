// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { PICKER_TTL, selectionAttribute, type PickerHandle, type PickerAction } from './element-picker-protocol';
import { copySelectedContext } from './element-picker-clipboard';
import { isPreviewToken, MAX_PREVIEW_CHARACTERS } from './preview-message';
import { ELEMENT_PICKER_STYLE } from './element-picker-style';
import brandIcon from '../public/icon/page-as-context.svg?raw';

export interface PickerChannel {
  watchTheme?(listener: (preference: unknown) => void): () => void;
  send(type: 'ready' | 'capture' | 'copy' | 'save' | 'copied' | 'copy-failed' | 'cancel' | 'ping', details?: { operation: string }): void;
  beforeSave?(): Promise<boolean>;
  listen(listener: (message: unknown) => void): () => void;
  disconnected(listener: () => void): () => void;
  close(): void;
}

/** A single document owns the element reference; the background owns export work. */
export function installElementPicker(doc: Document, token: string, channel: PickerChannel): PickerHandle {
  const win = doc.defaultView!;
  const host = doc.createElement('div');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <div id="surface"></div><div id="outline"></div><section id="panel" data-mode="picking" role="region" aria-label="Select element">
    <header class="header"><span class="brand-mark" aria-hidden="true"></span>
      <div class="heading"><h2 id="picker-title">Select element</h2><p id="picker-intro" class="intro">Click a block · Esc cancels</p></div>
      <button id="cancel" type="button" aria-label="Cancel selection" title="Cancel (Esc)">×</button>
    </header><p id="status" role="status" hidden>Point to a block and click to select it. Esc cancels.</p>
    <div id="buttons" hidden><button id="parent" hidden disabled>Select parent</button><button id="back" hidden disabled>Back</button><button id="again" hidden disabled>Pick again</button>
      <div class="export-actions"><button id="preview" hidden disabled>Preview &amp; edit</button><button id="copy" title="Copy the selected element context" hidden disabled>Copy context</button><button id="save" title="Save the selected element context" hidden disabled>Save to file</button></div>
    </div></section>`;
  const sheet = doc.createElement('style');
  sheet.textContent = ELEMENT_PICKER_STYLE;
  shadow.prepend(sheet);
  // Parse only the packaged SVG asset; page content never enters UI markup.
  const icon = new win.DOMParser().parseFromString(brandIcon, 'image/svg+xml').documentElement;
  shadow.querySelector('.brand-mark')!.append(doc.importNode(icon, true));
  const outline = shadow.querySelector<HTMLElement>('#outline')!;
  const panel = shadow.querySelector<HTMLElement>('#panel')!;
  const status = shadow.querySelector<HTMLElement>('#status')!;
  const button = (id: string) => shadow.querySelector<HTMLButtonElement>(`#${id}`)!;
  let candidate: Element | undefined;
  let selected: Element | undefined;
  const history: Element[] = [];
  let busy = false;
  let previewAllowed = true;
  let copyAllowed = true;
  let saveAllowed = true;
  let pendingAction: PickerAction | undefined;
  let closed = false;
  let frame = 0;
  const attribute = selectionAttribute(token);
  const stops: (() => void)[] = [];
  const systemTheme = win.matchMedia?.('(prefers-color-scheme: dark)');
  let themePreference: unknown = 'system';
  const applyTheme = () => {
    const theme = themePreference === 'light' || themePreference === 'dark'
      ? themePreference : systemTheme?.matches ? 'dark' : 'light';
    host.dataset.theme = theme;
    // Override the defensive all:initial reset on the host itself.
    host.style.setProperty('color-scheme', theme, 'important');
  };
  applyTheme();
  systemTheme?.addEventListener('change', applyTheme);
  stops.push(() => systemTheme?.removeEventListener('change', applyTheme));
  if (channel.watchTheme) stops.push(channel.watchTheme(preference => { themePreference = preference; applyTheme(); }));
  const originalFocus = doc.activeElement;
  let previousFocus: Element | undefined;
  let pointerDown: { x: number; y: number } | undefined;
  let dragged = false;
  let resize: ResizeObserver | undefined;
  let observed: Element | undefined;
  const parent = (element: Element): Element | null => element.assignedSlot ?? element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null;
  const valid = (element: Element | null | undefined): element is Element => !!element?.isConnected &&
    element.ownerDocument === doc && element !== host && element !== doc.body && element !== doc.documentElement &&
    !['script', 'style', 'head', 'template'].includes(element.localName) && !!element.getClientRects().length;
  const selectableParent = (element: Element): Element | undefined => {
    let current = parent(element);
    for (let depth = 0; current && current !== doc.body && current !== doc.documentElement && depth < 128; depth++, current = parent(current)) {
      if (valid(current)) return current;
    }
    return undefined;
  };
  const draw = () => {
    frame = 0;
    const target = selected ?? candidate;
    if (observed !== target) {
      if (observed) resize?.unobserve(observed);
      observed = target;
      if (target) resize?.observe(target);
    }
    if (!valid(target)) { outline.style.display = 'none'; return; }
    const rect = target.getBoundingClientRect();
    Object.assign(outline.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const schedule = () => { if (!closed && !frame) frame = win.requestAnimationFrame(draw); };
  const refresh = () => {
    panel.dataset.mode = selected ? 'selected' : 'picking';
    shadow.querySelector('#picker-title')!.textContent = selected ? 'Page as Context' : 'Select element';
    shadow.querySelector('#picker-intro')!.textContent = selected ? 'Selected element' : 'Click a block · Esc cancels';
    status.hidden = !selected;
    shadow.querySelector<HTMLElement>('#buttons')!.hidden = !selected;
    for (const id of ['parent', 'back', 'again', 'preview', 'copy', 'save']) button(id).hidden = !selected;
    button('parent').disabled = busy || !selected || !selectableParent(selected);
    button('back').disabled = busy || history.length === 0;
    button('again').disabled = busy || !selected;
    button('preview').disabled = busy || !valid(selected) || !previewAllowed;
    button('preview').title = previewAllowed ? 'Preview the selected element context' : 'Preview is disabled by your administrator.';
    button('copy').disabled = busy || !valid(selected) || !copyAllowed;
    button('copy').title = copyAllowed ? 'Copy the selected element context' : 'Copying is disabled by your administrator.';
    button('save').disabled = busy || !valid(selected) || !saveAllowed;
    button('save').title = saveAllowed ? 'Save the selected element context' : 'File export is unavailable on this platform or restricted by your administrator.';
    schedule();
  };
  const choose = (element: Element) => {
    if (!valid(element)) return;
    selected = element; candidate = undefined; history.length = 0;
    status.textContent = ['iframe', 'frame'].includes(element.localName)
      ? 'Selected embedded document as one block. Open Preview to capture its available contents.'
      : `Selected <${element.localName}> and its contents. Adjust the block or open Preview.`;
    refresh(); button('preview').focus();
  };
  const ownEvent = (event: Event) => event.composedPath().includes(panel);
  const hit = (x: number, y: number, event: Event): Element | undefined => {
    // Open shadow roots expose their actual hit target in the composed event path.
    const path = event.composedPath();
    const actual = path.includes(host) ? undefined : path.find(node => node instanceof win.Element) as Element | undefined;
    if (actual) return valid(actual) ? actual : undefined;
    // The surface intercepts iframe events; hit-test the page underneath the overlay.
    let target = typeof doc.elementsFromPoint === 'function'
      ? doc.elementsFromPoint(x, y).find(element => element !== host && element.getRootNode() !== shadow) ?? null
      : doc.elementFromPoint(x, y);
    for (let depth = 0; target?.shadowRoot && depth < 32; depth++) {
      if (typeof target.shadowRoot.elementFromPoint !== 'function') break;
      const next = target.shadowRoot.elementFromPoint(x, y);
      if (!next || next === target) break;
      target = next;
    }
    return valid(target) ? target : undefined;
  };
  const move = (event: PointerEvent) => {
    if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) dragged = true;
    if (selected || busy || ownEvent(event)) return;
    candidate = hit(event.clientX, event.clientY, event); schedule();
  };
  const block = (event: Event) => {
    if (ownEvent(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === 'pointerdown') { const mouse = event as MouseEvent; pointerDown = { x: mouse.clientX, y: mouse.clientY }; dragged = false; }
    if (event.type === 'click' && !busy && !selected) {
      pointerDown = undefined;
      if (dragged) return;
      const mouse = event as MouseEvent;
      const target = hit(mouse.clientX, mouse.clientY, event);
      if (target) choose(target);
      else status.textContent = 'Point to a page block or an embedded document and click to select it.';
    }
  };
  const cancel = () => { try { channel.send('cancel'); } catch { /* The coordinator may already have disconnected. */ } finally { close(); } };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    else if (event.key === 'F2' && !busy) {
      event.preventDefault(); event.stopImmediatePropagation();
      let target = doc.activeElement;
      while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
      if (valid(target)) choose(target);
      else if (valid(previousFocus ?? originalFocus)) choose((previousFocus ?? originalFocus)!);
    }
  };
  const listen = (target: EventTarget, type: string, listener: EventListener, capture = false) => {
    target.addEventListener(type, listener, capture); stops.push(() => target.removeEventListener(type, listener, capture));
  };
  function close() {
    if (closed) return;
    closed = true; clearTimeout(timer); clearTimeout(startup); clearInterval(heartbeat); win.cancelAnimationFrame(frame);
    for (const stop of stops) stop();
    observer.disconnect(); resize?.disconnect(); selected?.removeAttribute(attribute);
    const restoreFocus = doc.activeElement === host;
    for (const control of shadow.querySelectorAll('button')) control.onclick = null;
    shadow.replaceChildren();
    host.remove(); selected = undefined; candidate = undefined; observed = undefined; previousFocus = undefined; history.length = 0;
    if (restoreFocus && originalFocus?.isConnected && 'focus' in originalFocus) (originalFocus as HTMLElement).focus();
    channel.close();
  }
  button('parent').onclick = () => { const next = selected ? selectableParent(selected) : undefined; if (selected && next) { history.push(selected); selected = next; refresh(); } };
  button('back').onclick = () => { const target = history.pop(); if (valid(target)) selected = target; refresh(); };
  button('again').onclick = () => { selected = undefined; candidate = undefined; history.length = 0; status.textContent = 'Point to a block and click to select it. Esc cancels.'; refresh(); };
  button('cancel').onclick = cancel;
  const exportSelection = (action: PickerAction) => {
    if (busy || !valid(selected)) return;
    busy = true; pendingAction = action;
    status.textContent = action === 'copy' ? 'Preparing selected context to copy…' : action === 'save' ? 'Preparing selected context to save…' : 'Preparing preview…'; refresh();
    const proceed = () => {
      if (closed || !valid(selected)) return;
      selected.setAttribute(attribute, '');
      // Remove all extension UI from the accessibility/DOM snapshot, retaining the target reference.
      host.remove();
      try { channel.send(action === 'preview' ? 'capture' : action); } catch { close(); }
    };
    if (action === 'save' && channel.beforeSave) {
      // Invoke synchronously from the click handler to preserve Firefox's permission gesture.
      try {
        void channel.beforeSave().then(granted => {
          if (closed) return;
          if (granted) proceed();
          else { busy = false; pendingAction = undefined; status.textContent = 'Download permission was not granted. Try Save again.'; refresh(); }
        }, () => { if (!closed) { busy = false; pendingAction = undefined; status.textContent = 'Unable to request download permission. Try Save again.'; refresh(); } });
      } catch { busy = false; pendingAction = undefined; status.textContent = 'Unable to request download permission. Try Save again.'; refresh(); }
    } else proceed();
  };
  button('preview').onclick = () => exportSelection('preview');
  button('copy').onclick = () => exportSelection('copy');
  button('save').onclick = () => exportSelection('save');
  const observer = new win.MutationObserver(() => {
    if (selected && !selected.isConnected) {
      selected.removeAttribute(attribute); selected = undefined; history.length = 0;
      if (busy) { cancel(); return; }
      status.textContent = 'The selected element was removed. Pick a block again.'; refresh();
    }
    schedule();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
  resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : undefined;
  resize?.observe(doc.documentElement);
  // At window level a closed shadow root retargets every UI event to the host.
  // Handle those inside the shadow tree, where panel and surface are distinguishable.
  listen(win, 'pointermove', ((event: Event) => { if (event.target !== host) move(event as PointerEvent); }) as EventListener, true);
  listen(shadow, 'pointermove', move as EventListener, true);
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
    listen(win, type, ((event: Event) => { if (event.target !== host) block(event); }) as EventListener, true);
    listen(shadow, type, block, true);
  }
  listen(win, 'keydown', key as EventListener, true);
  listen(win, 'focusin', ((event: Event) => { if (event.target !== host && !ownEvent(event) && event.target instanceof win.Element) previousFocus = event.target as Element; }) as EventListener, true);
  listen(win, 'scroll', schedule, true); listen(win, 'resize', schedule);
  listen(win, 'pagehide', cancel);
  stops.push(channel.listen(message => {
    if (typeof message !== 'object' || message === null) return;
    const reply = message as { previewAllowed?: boolean; copyAllowed?: boolean; saveAllowed?: boolean } & { type?: string; message?: string; content?: unknown; operation?: unknown };
    if (reply.type === 'active') { clearTimeout(startup); previewAllowed = reply.previewAllowed !== false; copyAllowed = reply.copyAllowed !== false; saveAllowed = reply.saveAllowed !== false; refresh(); }
    if (reply.type === 'complete') close();
    if (reply.type === 'copy-content' && busy && pendingAction === 'copy' && typeof reply.content === 'string' &&
      reply.content.length <= MAX_PREVIEW_CHARACTERS + 64 && typeof reply.operation === 'string' && isPreviewToken(reply.operation)) {
      const operation = reply.operation;
      if (!host.isConnected) doc.documentElement.append(host);
      const acknowledge = (type: 'copied' | 'copy-failed') => {
        if (!closed) { try { channel.send(type, { operation }); } catch { close(); } }
      };
      void copySelectedContext(doc, shadow, reply.content).then(() => {
        acknowledge('copied');
      }, () => acknowledge('copy-failed'));
    }
    if (reply.type === 'error') {
      selected?.removeAttribute(attribute); busy = false; pendingAction = undefined;
      if (!host.isConnected) doc.documentElement.append(host);
      status.textContent = typeof reply.message === 'string' ? reply.message : 'Unable to prepare the selection. Try again.';
      refresh();
    }
  }), channel.disconnected(close));
  const timer = setTimeout(cancel, PICKER_TTL);
  const startup = setTimeout(close, 8_000);
  // Port traffic keeps an active selection alive across Chrome's idle-worker deadline.
  const heartbeat = setInterval(() => { try { channel.send('ping'); } catch { close(); } }, 20_000);
  doc.documentElement.append(host);
  try { channel.send('ready'); } catch { close(); }
  return { token, root: () => selected?.isConnected ? selected : undefined, close };
}
