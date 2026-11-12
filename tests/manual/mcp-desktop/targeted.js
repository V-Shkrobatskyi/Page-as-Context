// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
const counters = { native: 0, custom: 0, open: 0, close: 0, next: 0, back: 0, async: 0, step: 1 };
const dialog = document.querySelector('dialog');
const render = () => { document.getElementById('counters').textContent = JSON.stringify(counters); };
for (const element of document.querySelectorAll('[data-effect]')) {
  element.addEventListener('click', () => {
    const effect = element.dataset.effect; counters[effect]++;
    if (effect === 'open') dialog.showModal();
    if (effect === 'close') dialog.close();
    if (effect === 'next') counters.step++;
    if (effect === 'back') counters.step--;
    if (effect === 'async') setTimeout(() => { document.getElementById('error').textContent = 'Async observation completed.'; render(); }, 100);
    render();
  });
}
render();
