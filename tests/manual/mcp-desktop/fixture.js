// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
const counts = { input: 0, textarea: 0, choice: 0, checkbox: 0, clicks: 0 };
const field = id => document.getElementById(id);
function render() {
  field('clicks').textContent = String(counts.clicks);
  field('state').textContent = JSON.stringify({ input: field('input').value, textarea: field('textarea').value,
    choice: field('choice').value, checked: field('checkbox').checked, events: counts }, null, 2);
}
for (const id of ['input', 'textarea', 'choice', 'checkbox']) {
  field(id).addEventListener(id === 'input' || id === 'textarea' ? 'input' : 'change', () => { counts[id]++; render(); });
}
field('increment').addEventListener('click', () => { counts.clicks++; render(); });
render();
