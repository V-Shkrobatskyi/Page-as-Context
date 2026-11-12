// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only

/** Hover/focus help also supports touch, Escape and viewport-safe placement. */
export function setupSettingHelp() {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const closeAll: (() => void)[] = [];
  for (const help of document.querySelectorAll<HTMLElement>('.setting-help')) {
    const button = help.querySelector<HTMLButtonElement>('button')!;
    const text = help.querySelector<HTMLElement>('[role="tooltip"]')!;
    let pinned = false;
    const close = () => { pinned = false; text.hidden = true; button.setAttribute('aria-expanded', 'false'); };
    closeAll.push(close);
    const show = () => {
      text.hidden = false; button.setAttribute('aria-expanded', 'true');
      const box = button.getBoundingClientRect(), width = text.getBoundingClientRect().width;
      text.style.left = `${Math.max(16, Math.min(box.right - width, window.innerWidth - width - 16))}px`;
      const height = text.getBoundingClientRect().height;
      const above = box.bottom + 8 + height > window.innerHeight - 16;
      text.dataset.side = above ? 'above' : 'below';
      text.style.top = `${Math.max(16, above ? box.top - height - 8 : box.bottom + 8)}px`;
    };
    help.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') show(); }, options);
    help.addEventListener('pointerleave', () => { if (!pinned && document.activeElement !== button) close(); }, options);
    button.addEventListener('focus', show, options);
    button.addEventListener('blur', () => { if (!pinned) close(); }, options);
    button.addEventListener('click', () => { if (pinned) close(); else { pinned = true; show(); } }, options);
    document.addEventListener('pointerdown', event => { if (!help.contains(event.target as Node)) close(); }, options);
  }
  const close = () => { for (const hide of closeAll) hide(); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, options);
  window.addEventListener('resize', close, options);
  document.addEventListener('scroll', close, { ...options, capture: true });
  return () => { close(); abort.abort(); };
}
