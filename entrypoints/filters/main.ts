// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { isManaged } from '@/src/policy/model';

import './style.css';
import { readPolicy, watchPolicy, policyMessage, type PolicySnapshot } from '@/src/policy/runtime';
import { assertAction, applyManagedBuiltinStates, hasManagedFilters, managedBuiltinState, mergeManagedFilters, PolicyError } from '@/src/policy/model';
import { readFilterDemoDraft, writeFilterDemoDraft } from '@/src/filter-demo-draft';
import { REGEX_EXAMPLES, compileRegex } from '@/src/core/privacy/regex';
import { isAutomaticType, PERSONAL_FIELD_TERMS } from '@/src/core/privacy/personal-data';
import { browser } from 'wxt/browser';
import { BUILTIN_FILTERS, builtinCaseSensitive, customRuleFromBuiltin, RULE_TYPES, CUSTOM_RULE_TYPES, isCustomRuleType, defaultRedactionSettings, exportRedactionSettings, importRedactionSettings, REDACTION_LIMITS, validateRedactionSettings, type CustomRedactionRule, type RuleType, type RedactionSettings } from '@/src/core/privacy/settings';
import { filterExample, testRedactionFilters, testRules, type FilterTestContext } from '@/src/core/privacy/test-filters';
import { loadPersonalRedactionSettings, saveRedactionSettings } from '@/src/redaction-settings';

const AUTOMATIC_MATCHING_DESCRIPTIONS: Partial<Record<RuleType, string>> = {
  emailMaskDomain: 'ASCII email addresses: name@example.com / name+tag@sub.example.com',
  emailHide: 'ASCII email addresses: name@example.com / name+tag@sub.example.com',
  phoneNumbersMask: '8–15 digits; + or 00 prefix, or Phone / Telephone / Tel / Mobile / Fax labels. Spaces, parentheses, dots and hyphens allowed.',
  phoneNumbers: '8–15 digits; + or 00 prefix, or Phone / Telephone / Tel / Mobile / Fax labels. Spaces, parentheses, dots and hyphens allowed.',
  paymentCards: '13–19 digits with a valid Luhn checksum; spaces or hyphens allowed. Repeated-digit numbers excluded.',
  iban: 'IBAN: country code + 2 check digits + account identifier; registered country length and valid MOD-97 checksum. Spaces allowed.',
  personalFieldsMask: PERSONAL_FIELD_TERMS,
  personalFieldsHide: PERSONAL_FIELD_TERMS,
};

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = get('status');
const fileInput = get<HTMLInputElement>('import-file');
const navigationDraft = readFilterDemoDraft();
const demoSession = navigationDraft?.session ?? crypto.randomUUID();
let hasNavigationDraft = !!navigationDraft;
let policySnapshot: PolicySnapshot | undefined;
let loadGeneration = 0;
let draft = defaultRedactionSettings();
let baseline: string | undefined;
let ready = false;
let modified = false;
let busy = true;
let disposed = false;
let leaving = false;
let downloadUrl: string | undefined;
let revokeTimer: ReturnType<typeof setTimeout> | undefined;

function feedback(message: string): void { status.textContent = message; get('save-feedback').textContent = message; }
function clearTestResult(): void {
  get<HTMLTextAreaElement>('test-output').value = '';
  get<HTMLInputElement>('test-label-output').value = '';
  get('test-label-result').hidden = true;
  get('test-count').textContent = '';
  get('test-matches').replaceChildren();
  get('test-match-results').hidden = true;
  get('example-feedback').textContent = '';
}
function refreshTestRules(): void {
  const select = get<HTMLSelectElement>('test-rule');
  const previous = select.value; select.replaceChildren();
  for (const source of ['builtin', 'custom'] as const) {
    const group = document.createElement('optgroup'); group.label = source === 'builtin' ? 'Built-in filters' : 'Custom filters';
    for (const item of testRules(policySnapshot ? applyManagedBuiltinStates(policySnapshot.policy, draft) : draft).filter(item => item.source === source)) {
      const option = document.createElement('option'); option.value = item.key;
      option.textContent = `${item.rule.name || 'Unnamed filter'} — ${RULE_TYPES.find(type => type.id === item.rule.type)?.label ?? 'Text'}${item.rule.enabled ? '' : ' (off)'}`;
      group.append(option);
    }
    if (group.children.length) select.append(group);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function changed(): void {
  modified = baseline === undefined || JSON.stringify(draft) !== baseline;
  clearTestResult(); refreshTestRules();
  feedback(modified ? 'Changes are not saved yet.' : 'Filters match the saved settings.');
  updateControls(); syncNavigationDraft();
}
function updateControls(): void {
  const accessBlocked = !policySnapshot || policySnapshot.policy.FilterSettingsAllowed === false;
  const blocked = busy || leaving || accessBlocked;
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>('button, input, textarea, select').forEach(control => { control.disabled = blocked || control.dataset.fixed === 'true'; });
  for (const id of ['open-demo', 'save-filters', 'add-rule', 'test-filters', 'test-selected', 'load-example', 'load-near-miss', 'export-filters']) {
    get<HTMLButtonElement>(id).disabled = blocked || !ready;
  }
  get<HTMLButtonElement>('show-import').disabled = blocked;
  fileInput.disabled = blocked;
  get<HTMLSelectElement>('test-rule').disabled = blocked || !ready;
  get<HTMLButtonElement>('save-filters').disabled = blocked || !ready || !modified;
  get<HTMLButtonElement>('add-rule').disabled = blocked || !ready || draft.customRules.length >= REDACTION_LIMITS.rules;
  document.querySelectorAll<HTMLButtonElement>('[data-duplicate]').forEach(button => { button.disabled = blocked || !ready || draft.customRules.length >= REDACTION_LIMITS.rules; });
  const policy = policySnapshot?.policy;
  const personalBlocked = !policySnapshot || policy?.UserRedactionRulesAllowed === false;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>('#builtins input, #builtins button, #builtins select, #custom-rules input, #custom-rules button, #custom-rules textarea, #custom-rules select')) {
    control.disabled ||= personalBlocked || control.closest('tr')?.getAttribute('data-managed') === 'true';
    if (personalBlocked || control.closest('tr')?.getAttribute('data-managed') === 'true') {
      control.title = 'Managed by your organization'; control.ariaDescription = control.title;
    }
  }
  for (const id of ['add-rule', 'show-import', 'restore-defaults']) get<HTMLButtonElement>(id).disabled ||= personalBlocked;
  fileInput.disabled ||= personalBlocked;
  get<HTMLButtonElement>('save-filters').disabled ||= personalBlocked || policy?.UserPreferencesSaveAllowed === false;
  get<HTMLButtonElement>('save-filters').ariaDescription = policy?.UserPreferencesSaveAllowed === false ? 'Saving personal filters is disabled by your administrator.' : null;
  get<HTMLButtonElement>('export-filters').disabled ||= !policySnapshot || policy?.FileExportAllowed === false;
  get<HTMLButtonElement>('export-filters').ariaDescription = policy?.FileExportAllowed === false ? 'File export is disabled by your administrator.' : null;
  document.querySelector<HTMLElement>('.filters-section')!.hidden = accessBlocked;
  get('test-panel').hidden = accessBlocked;
  if (accessBlocked) get('managed-filters').hidden = true;
  get<HTMLButtonElement>('reload-filters').disabled = busy || leaving;
  get<HTMLButtonElement>('close-filters').disabled = leaving;
  get('dirty').textContent = modified ? 'Unsaved changes' : ready ? 'Saved filters' : '';
}

function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void, mobileLabel?: string): HTMLLabelElement {
  const wrapper = document.createElement('label'); wrapper.className = 'table-toggle'; wrapper.title = label;
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
  input.addEventListener('change', () => { onChange(input.checked); changed(); });
  const text = document.createElement('span'); text.className = 'sr-only'; text.textContent = label;
  wrapper.append(input, text);
  if (mobileLabel) {
    const mobileText = document.createElement('span'); mobileText.className = 'mobile-toggle-label';
    mobileText.textContent = mobileLabel; mobileText.setAttribute('aria-hidden', 'true');
    wrapper.append(mobileText);
  }
  return wrapper;
}
function cell(row: HTMLTableRowElement, content: Node | string): HTMLTableCellElement {
  const td = document.createElement('td'); td.append(content); row.append(td); return td;
}
function ruleTypeSelect(rule: CustomRedactionRule, fixed = false, onTypeChange?: () => void): HTMLSelectElement {
  const select = document.createElement('select'); select.setAttribute('aria-label', `Rule type for ${rule.name || 'new filter'}`);
  for (const type of fixed ? RULE_TYPES.filter(type => type.id === rule.type) : CUSTOM_RULE_TYPES) {
    const option = document.createElement('option'); option.value = type.id; option.textContent = type.label;
    select.append(option);
  }
  select.value = rule.type!; select.title = RULE_TYPES.find(type => type.id === rule.type)!.description;
  if (fixed) select.dataset.fixed = 'true';
  else select.addEventListener('change', () => {
    rule.type = select.value as RuleType;
    select.title = RULE_TYPES.find(type => type.id === rule.type)!.description;
    onTypeChange?.();
    changed();
  });
  return select;
}
function render(): void {
  const builtins = get('builtins'); builtins.replaceChildren();
  for (const filter of BUILTIN_FILTERS) {
    const row = document.createElement('tr'); row.className = 'builtin';
    cell(row, checkbox(`Enable ${filter.name}`, !draft.disabledBuiltins.includes(filter.id), enabled => {
      draft.disabledBuiltins = enabled ? draft.disabledBuiltins.filter(id => id !== filter.id) : [...draft.disabledBuiltins, filter.id];
    }));
    const name = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = filter.name;
    const type = document.createElement('small'); type.textContent = 'Built-in';
    name.append(title, type); cell(row, name);
    const rule = customRuleFromBuiltin(filter.id);
    const automatic = isAutomaticType(rule.type);
    const personalFields = filter.id === 'personal-fields-mask' || filter.id === 'personal-fields';
    const text = document.createElement(automatic && !personalFields ? 'span' : 'code');
    text.textContent = AUTOMATIC_MATCHING_DESCRIPTIONS[rule.type!] ?? rule.text;
    text.title = filter.description;
    cell(row, text);
    cell(row, ruleTypeSelect(customRuleFromBuiltin(filter.id), true)).className = 'rule-type-value';
    const caseToggle = checkbox(`Case sensitive for ${filter.name}`, builtinCaseSensitive(draft, filter.id), value => {
      const overrides = { ...draft.builtinCaseSensitivity };
      if (value === filter.caseSensitive) delete overrides[filter.id];
      else overrides[filter.id] = value;
      if (Object.keys(overrides).length) draft.builtinCaseSensitivity = Object.fromEntries(
        BUILTIN_FILTERS.filter(item => overrides[item.id] !== undefined).map(item => [item.id, overrides[item.id]]));
      else delete draft.builtinCaseSensitivity;
    }, 'Case sensitive');
    cell(row, automatic ? '—' : caseToggle).className = 'case-value';
    if (!automatic) {
      const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.textContent = 'Duplicate'; duplicate.dataset.duplicate = 'true';
      duplicate.title = 'Create an editable custom copy of this built-in filter';
      duplicate.addEventListener('click', () => {
        if (!isCustomRuleType(customRuleFromBuiltin(filter.id).type) || busy || !ready || draft.customRules.length >= REDACTION_LIMITS.rules) return;
        const copy = customRuleFromBuiltin(filter.id, builtinCaseSensitive(draft, filter.id));
        copy.id = crypto.randomUUID(); copy.name = `${filter.name} copy`;
        draft.customRules.push(copy); changed(); render();
        get('custom-rules').querySelector<HTMLInputElement>('.custom-rule:last-child input[type="text"]')?.focus();
      });
      cell(row, duplicate).className = 'builtin-actions';
    } else {
      const action = cell(row, '—'); action.className = 'builtin-actions'; action.title = 'Automatic built-in filter. Use On to enable or disable it.';
    }
    const managedState = policySnapshot ? managedBuiltinState(policySnapshot.policy, filter.id) : undefined;
    if (managedState !== undefined) {
      row.dataset.managed = 'true';
      if (managedState) row.dataset.required = 'true';
      const toggle = row.querySelector<HTMLInputElement>('input[type="checkbox"]'); if (toggle) toggle.checked = managedState;
      for (const input of row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
        input.disabled = true;
        if (input !== toggle) input.checked = filter.caseSensitive;
      }
      row.title = `${managedState ? 'Enabled' : 'Disabled'} by your organization`;
      for (const input of row.querySelectorAll<HTMLInputElement>('input')) input.ariaDescription = row.title;
    }
    builtins.append(row);
  }
  const rules = get('custom-rules'); rules.replaceChildren();
  for (const rule of draft.customRules) {
    const row = document.createElement('tr'); row.className = 'custom-rule';
    cell(row, checkbox('Enable this filter', rule.enabled, value => { rule.enabled = value; }));
    const name = document.createElement('input'); name.type = 'text'; name.value = rule.name;
    name.maxLength = REDACTION_LIMITS.name; name.placeholder = 'Filter name'; name.setAttribute('aria-label', 'Filter name');
    name.addEventListener('input', () => { rule.name = name.value; changed(); });
    cell(row, name);
    const text = document.createElement('textarea'); text.rows = 1; text.value = rule.text; text.spellcheck = false;
    text.placeholder = 'Matching rule'; text.setAttribute('aria-label', 'Matching rule');
    const matchingCell = cell(row, text);
    const examples = document.createElement('select'); examples.className = 'regex-examples'; examples.setAttribute('aria-label', 'Insert Regex example');
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Insert example…'; examples.append(placeholder);
    for (const example of REGEX_EXAMPLES) {
      const option = document.createElement('option'); option.value = example.id; option.textContent = example.label; examples.append(option);
    }
    const hint = document.createElement('small'); hint.className = 'regex-hint';
    const error = document.createElement('small'); error.className = 'rule-error'; error.id = `rule-error-${rule.id}`; error.setAttribute('aria-live', 'polite');
    const caseToggle = checkbox('Case sensitive for this filter', rule.caseSensitive, value => { rule.caseSensitive = value; }, 'Case sensitive');
    text.setAttribute('aria-describedby', error.id);
    const updateRuleEditor = () => {
      const regex = rule.type === 'regex';
      text.maxLength = regex ? REDACTION_LIMITS.regex : REDACTION_LIMITS.text;
      examples.hidden = !regex; hint.hidden = !regex;
      hint.textContent = 'Enter Regex without / delimiters or flags. Case sensitive controls letter case.';
      error.textContent = '';
      if (regex && rule.text.trim()) {
        try { compileRegex(rule.text, rule.caseSensitive); }
        catch (cause) { error.textContent = cause instanceof Error ? cause.message : 'Invalid Regex.'; }
      }
      text.setAttribute('aria-invalid', String(Boolean(error.textContent)));
    };
    examples.addEventListener('change', () => {
      const example = REGEX_EXAMPLES.find(example => example.id === examples.value); examples.value = '';
      if (!example || (rule.text.trim() && rule.text !== example.pattern && !window.confirm('Replace this matching rule with the selected Regex example?'))) return;
      rule.text = example.pattern; text.value = rule.text; changed(); updateRuleEditor();
      hint.textContent = example.note; text.focus();
    });
    text.addEventListener('input', () => { rule.text = text.value; changed(); updateRuleEditor(); });
    matchingCell.append(examples, hint, error); updateRuleEditor();
    cell(row, ruleTypeSelect(rule, false, updateRuleEditor)).className = 'rule-type-value';
    const caseCell = cell(row, caseToggle); caseCell.className = 'case-value';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
    remove.addEventListener('click', () => { draft.customRules = draft.customRules.filter(item => item.id !== rule.id); changed(); render(); });
    cell(row, remove); rules.append(row);
  }
  const managedList = document.querySelector<HTMLElement>('#managed-rules');
  if (managedList) {
    managedList.replaceChildren();
    for (const rule of policySnapshot?.policy.ManagedRedactionRules ?? []) {
      const item = document.createElement('li');
      item.textContent = `${rule.name} — ${rule.type}: ${rule.text} (${rule.caseSensitive ? 'case sensitive' : 'case insensitive'}; required, read-only)`;
      managedList.append(item);
    }
    document.querySelector<HTMLElement>('#managed-filters')!.hidden = !managedList.children.length;
  }
  get('empty-rules').hidden = draft.customRules.length > 0;
  clearTestResult(); refreshTestRules();
  updateControls(); syncNavigationDraft();
}

async function load(restoreNavigation = false): Promise<void> {
  const generation = ++loadGeneration;
  policySnapshot = undefined;
  busy = true; clearTestResult(); updateControls();
  try {
    const snapshot = await readPolicy();
    if (generation !== loadGeneration || disposed) return;
    policySnapshot = snapshot;
    assertAction(snapshot.policy, 'customize');
    const note = document.querySelector<HTMLElement>('#organization-policy');
    if (note) { note.hidden = !isManaged(snapshot.policy); note.textContent = isManaged(snapshot.policy) ? `Managed by your organization. Required filters are read-only.${snapshot.policy.UserRedactionRulesAllowed === false ? ' Personal filter changes are disabled.' : ''}${snapshot.policy.UserPreferencesSaveAllowed === false ? ' Saving personal filters is disabled.' : ''}` : ''; }
    const restored = restoreNavigation ? readFilterDemoDraft() : undefined;
    const settings = snapshot.policy.UserRedactionRulesAllowed === false ? defaultRedactionSettings() : restored?.settings ?? await loadPersonalRedactionSettings();
    if (disposed || generation !== loadGeneration) return;
    draft = settings; baseline = restored ? restored.baseline : JSON.stringify(settings); ready = true; modified = baseline === undefined || JSON.stringify(settings) !== baseline;
    feedback(restored && modified ? 'Unsaved filter changes restored.' : ''); render();
    if (location.hash === '#test-panel') get<HTMLDetailsElement>('test-panel').open = true;
  } catch (error) {
    if (generation !== loadGeneration) return;
    ready = false; baseline = undefined; modified = false; draft = defaultRedactionSettings();
    get('builtins').replaceChildren(); get('custom-rules').replaceChildren();
    feedback(error instanceof PolicyError ? policyMessage(error) : 'Unable to load saved filters. Retry Reload saved, or restore defaults and save to replace them. Exports with redaction are blocked while saved filters cannot be read.');
  } finally { if (generation === loadGeneration) { busy = false; updateControls(); } }
}
get('reload-filters').addEventListener('click', () => {
  if (!busy && (!modified || window.confirm('Discard unsaved filter changes?'))) void load();
});
get('restore-defaults').addEventListener('click', () => {
  if (busy || !window.confirm('Restore default built-in settings and remove every custom rule? Choose Save filters to apply this change.')) return;
  draft = defaultRedactionSettings(); ready = true; changed(); render();
});
get('add-rule').addEventListener('click', () => {
  if (busy || !ready || draft.customRules.length >= REDACTION_LIMITS.rules) return;
  const rule: CustomRedactionRule = { id: crypto.randomUUID(), name: '', text: '', caseSensitive: false, enabled: true, type: 'text' };
  draft.customRules.push(rule); changed(); render();
  get('custom-rules').querySelector<HTMLInputElement>('.custom-rule:last-child input[type="text"]')?.focus();
});
get('save-filters').addEventListener('click', () => {
  if (busy || !ready || !modified) return;
  void (async () => {
    busy = true; updateControls();
    try {
      const settings = validateRedactionSettings(draft);
      if (baseline !== undefined && JSON.stringify(await loadPersonalRedactionSettings()) !== baseline) {
        feedback('Filters changed in another tab. Choose Reload saved before saving your changes.'); return;
      }
      await saveRedactionSettings(settings);
      draft = settings; baseline = JSON.stringify(settings); modified = false;
      syncNavigationDraft();
      render();
      feedback('Filters saved. They apply to your next export when Redact sensitive data is on.');
    } catch (error) {
      feedback(error instanceof Error && error.message.includes('Regex') ? error.message : 'Unable to save filters. Check names, matching rules and filter limits. URL parameter rules need names only, without ?, &, =, # or line breaks. Reload saved if settings changed elsewhere.');
    } finally { busy = false; updateControls(); }
  })();
});
function runTest(selected: boolean): void {
  if (busy || !ready) return;
  clearTestResult();
  try {
    const context = get<HTMLSelectElement>('test-context').value as FilterTestContext;
    const label = context === 'auto' ? get<HTMLInputElement>('test-field-label').value.trim() : '';
    const sample = get<HTMLTextAreaElement>('test-input').value;
    const result = testRedactionFilters(policySnapshot && hasManagedFilters(policySnapshot.policy) ? mergeManagedFilters(policySnapshot.policy, draft) : draft, sample, label, selected ? get<HTMLSelectElement>('test-rule').value : undefined, context);
    get<HTMLTextAreaElement>('test-output').value = result.output;
    if (result.fieldLabel !== undefined) {
      get('test-label-result').hidden = false;
      get<HTMLInputElement>('test-label-output').value = result.fieldLabel;
    }
    get('test-count').textContent = `${result.redactionCount} replacement${result.redactionCount === 1 ? '' : 's'} · ${result.matches.length} matched rule${result.matches.length === 1 ? '' : 's'} · ${result.testedCount} rule${result.testedCount === 1 ? '' : 's'} tested${selected ? ' (selected only)' : ' (enabled only)'}.`;
    get('test-match-results').hidden = false;
    for (const match of result.matches) {
      const item = document.createElement('li');
      const type = RULE_TYPES.find(type => type.id === match.type)!.label;
      item.textContent = `${match.name} — ${match.source === 'builtin' ? 'Built-in' : 'Custom'} · ${type} · ${match.redactionCount} replacement${match.redactionCount === 1 ? '' : 's'} on its own`;
      get('test-matches').append(item);
    }
    if (!result.matches.length) {
      const item = document.createElement('li'); item.textContent = 'No rules matched this sample.'; get('test-matches').append(item);
    }
    feedback(selected ? 'Selected filter tested on its own, including if it is off. Nothing was saved or copied.' : 'Test complete. Nothing was saved or copied.');
  } catch (error) { feedback(error instanceof Error && error.message.includes('Regex') ? error.message : 'Complete the filters being tested. Use names and non-blank matching rules within the limits; URL parameter rules need names only. Test selected can check a completed rule while other rows are unfinished.'); }
}
get('test-filters').addEventListener('click', () => runTest(false));
get('test-selected').addEventListener('click', () => runTest(true));
for (const id of ['test-input', 'test-field-label']) get(id).addEventListener('input', clearTestResult);
get('test-rule').addEventListener('change', clearTestResult);
get('test-context').addEventListener('change', () => {
  get('test-field-context').hidden = get<HTMLSelectElement>('test-context').value !== 'auto'; clearTestResult();
});
for (const [id, nearMiss] of [['load-example', false], ['load-near-miss', true]] as const) {
  get(id).addEventListener('click', () => {
    if (busy || !ready) return;
    clearTestResult();
    try {
      const key = get<HTMLSelectElement>('test-rule').value;
      const item = testRules(policySnapshot ? applyManagedBuiltinStates(policySnapshot.policy, draft) : draft).find(item => item.key === key);
      if (!item) throw new Error('No filter selected');
      const example = filterExample(item, nearMiss);
      get<HTMLSelectElement>('test-context').value = 'auto'; get('test-field-context').hidden = false;
      get<HTMLInputElement>('test-field-label').value = example.fieldLabel;
      get<HTMLTextAreaElement>('test-input').value = example.sample;
      const matched = testRedactionFilters(draft, example.sample, example.fieldLabel, key).matches.length > 0;
      get('example-feedback').textContent = nearMiss
        ? matched ? 'This near miss also matches your selected rule. Check whether another alternative covers it.' : 'Synthetic near miss loaded. Test selected should leave it unchanged; Test all may match other rules.'
        : matched ? 'Synthetic matching example loaded. Choose Test selected or Test all.' : 'Synthetic example loaded, but your selected rule does not match it. Check its terms and type requirements.';
    } catch (error) { feedback(error instanceof Error && error.message.includes('Regex') ? error.message : 'Complete the selected filter before loading an example. Other filters can remain unfinished.'); }
  });
}
function demoSettings(): RedactionSettings {
  return validateRedactionSettings({ ...draft, customRules: draft.customRules.filter(rule => rule.enabled) });
}
function syncNavigationDraft(): void {
  if (!hasNavigationDraft || disposed) return;
  try { writeFilterDemoDraft({ session: demoSession, settings: draft, baseline }); }
  catch { /* Navigation validates again before leaving; editing remains available. */ }
}
get('open-demo').addEventListener('click', () => {
  if (busy || !ready) return;
  try { demoSettings(); }
  catch { feedback('Complete the enabled filters before opening Demo. Disabled unfinished rows can stay unchanged.'); return; }
  void (async () => {
    try {
      writeFilterDemoDraft({ session: demoSession, settings: draft, baseline });
      hasNavigationDraft = true;
      leaving = true; updateControls();
      const tab = await browser.tabs.getCurrent();
      if (tab?.id === undefined) throw new Error('tab-unavailable');
      await browser.tabs.update(tab.id, { url: `${browser.runtime.getURL('/demo.html')}#${demoSession}` });
    } catch {
      leaving = false; updateControls(); feedback('Unable to open the filter demo. Your filter changes are still here.');
    }
  })();
});
get('show-import').addEventListener('click', () => {
  if (busy) return;
  try { fileInput.value = ''; fileInput.click(); }
  catch { feedback('Unable to open the file picker. Try again.'); }
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file || busy) return;
  if (file.size > REDACTION_LIMITS.json) { feedback('The filter file is too large. The limit is 1 MB.'); fileInput.value = ''; return; }
  busy = true; updateControls();
  void file.text().then(text => {
    if (disposed) return;
    let imported: RedactionSettings;
    try { imported = importRedactionSettings(text); }
    catch (error) { feedback(error instanceof Error ? error.message : 'Unable to import this filter file.'); return; }
    if (modified && !window.confirm('Replace your unsaved filter changes with this file?')) return;
    draft = imported; ready = true; changed(); render();
    feedback(modified ? 'Filters imported. Choose Save filters to apply them.' : 'Imported filters already match the saved settings.');
  }).catch(() => feedback('Unable to read this filter file. Choose a valid filter export and try again.'))
    .finally(() => { busy = false; fileInput.value = ''; updateControls(); });
});
function revokeDownload(): void {
  clearTimeout(revokeTimer);
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
}
get('export-filters').addEventListener('click', async () => {
  if (busy || !ready) return;
  let text: string;
  try { const { policy } = await readPolicy(); assertAction(policy, 'customize'); assertAction(policy, 'save'); text = exportRedactionSettings(draft); }
  catch (error) { feedback(error instanceof PolicyError ? policyMessage(error) : 'Complete each filter before exporting, and stay within the filter limits.'); return; }
  try {
    revokeDownload();
    downloadUrl = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = downloadUrl; link.download = 'page-as-context-filters.json';
    document.body.append(link); link.click(); link.remove();
    revokeTimer = setTimeout(revokeDownload, 60_000);
    feedback('Download started: page-as-context-filters.json. Includes built-in and custom filters from this table.');
  } catch { revokeDownload(); feedback('Unable to download filters. Try again or check your browser download settings.'); }
});
get('close-filters').addEventListener('click', () => {
  if (busy || leaving || (modified && !window.confirm('Discard unsaved filter changes and close this tab?'))) return;
  leaving = true; updateControls();
  void (async () => {
    try {
      const tab = await browser.tabs.getCurrent();
      if (tab?.id === undefined) throw new Error('tab-unavailable');
      const route = new URLSearchParams(location.hash.slice(1));
      if (route.get('return') === 'mcp') {
        const source = route.get('source');
        await browser.tabs.update(tab.id, { url: browser.runtime.getURL('/mcp.html') + (source && /^[a-zA-Z0-9_-]{16,80}$/u.test(source) ? '#' + source : '') });
        return;
      }
      await browser.tabs.remove(tab.id);
    } catch {
      leaving = false; updateControls();
      feedback('Unable to close this tab. Try again or close it using your browser.');
    }
  })();
});
window.addEventListener('beforeunload', event => { if (modified && !leaving) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => {
  disposed = true; stopPolicy(); loadGeneration++; revokeDownload();
  get<HTMLTextAreaElement>('test-input').value = ''; clearTestResult();
  get<HTMLInputElement>('test-field-label').value = '';
});
window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; leaving = false; updateControls(); syncNavigationDraft(); } });
const stopPolicy = watchPolicy(() => { policySnapshot = undefined; ready = false; modified = false; updateControls(); void load(); });
void load(true);
