// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { installMcpPopup } from '@/src/mcp/popup';


import { isManaged } from '@/src/policy/model';

import { readPolicy, checkPolicy, watchPolicy, policyMessage, type PolicyContext, type PolicySnapshot } from '@/src/policy/runtime';
import { assertAction, formats, levels, redactionMode, resolvePreferences, PolicyError } from '@/src/policy/model';
import { openPreview } from '@/src/preview-session';
import { PICKER_START } from '@/src/element-picker-protocol';
import { captureWarningText } from '@/src/preview-message';
import { openFirefoxSave } from '@/src/firefox-save';
import { installTouchButtonFeedback } from '@/src/touch-button-feedback';
import '@popup-style.css';
import { technicalEvent } from '@/src/diagnostics/client';
import { browser } from 'wxt/browser';

import {
  DEFAULT_COMPRESSION_LEVEL,
  type CompressionLevel,
  type SupportedExportFormat,
} from '@/src/core';
import { CAPTURE_ACTIVE_TAB_MESSAGE, isCaptureActiveTabResponse, type CaptureActiveTabRequest } from '@/src/capture-message';
import { wrapClipboardContext } from '@/src/clipboard-context';
import { saveContextFile } from '@/src/save-context';
import { installFrameAccessToggle, type FrameAccessToggle } from '@/src/firefox-frame-access';

type ExportAction = 'copy' | 'save' | 'preview';
type StoredPopupSettings = {
  compression?: CompressionLevel;
  format?: SupportedExportFormat;
  redactSensitiveData?: boolean;
};

const POPUP_SETTINGS_KEY = 'popup-settings';

const ERROR_MESSAGES: Record<string, string> = {
  'unsupported-page': 'This browser page cannot be captured. Open a regular web page and try again.',
  'permission-denied': 'The browser denied access to this page.',
  'debugger-busy': 'Chrome debugging is already in use for this tab. Close DevTools and try again.',
  'invalid-tree': 'The browser returned an invalid semantic tree. Try again.',
  'capture-failed': 'Unable to capture this page’s semantic structure. Try again.',
  'capture-unavailable': 'Page capture is not available in this build yet.',
  'capture-limit': 'This page exceeds the capture limits. Try a smaller page.',
  'capture-timeout': 'Page capture took too long. Try again.',
  'page-changed': 'The page changed during capture. Wait for it to finish loading and try again.',
  'copy-failed': 'Unable to copy the page context. Check browser clipboard access and try again.',
  'preview-failed': 'Unable to open the preview. Keep the popup open until the editor is ready and try again.',
  'redaction-settings': 'Unable to load redaction filters. Open Filters to reload or restore them.',
  'save-failed': 'Unable to save the page context. Try again.',
};

const FORMAT_LABELS: Record<SupportedExportFormat, string> = {
  'semantic-text': 'Semantic Text',
  markdown: 'Markdown',
};

function selectedFormat(value: string): SupportedExportFormat {
  return value === 'markdown' ? 'markdown' : 'semantic-text';
}

function formatMetrics(
  characterCount: number,
  approximateTokenCount: number,
  reductionRatio: number | null,
  redactionCount: number,
  action: ExportAction,
): string {
  const reduction = reductionRatio === null ? 'reduction unavailable' : `${Math.round(reductionRatio * 100)}% smaller than Without`;
  const redactions = `${redactionCount} redaction${redactionCount === 1 ? '' : 's'}`;
  const countLabel = action === 'copy' ? 'characters copied' : 'characters';
  const reductionLabel = action === 'copy' ? `context ${reduction}` : reduction;
  return `${characterCount} ${countLabel} · ~${approximateTokenCount} tokens · ${reductionLabel} · ${redactions}.`;
}

async function saveContext(content: string, format: SupportedExportFormat, context: PolicyContext): Promise<void> {
  if (firefox) {
    await openFirefoxSave(content, format, context);
    return;
  }
  await saveContextFile(content, format, undefined, context);
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup" aria-labelledby="popup-title">
    <header class="popup-header">
      <img class="brand-mark" src="/icon/32.png" alt="" aria-hidden="true" />
      <div>
        <h1 id="popup-title">Page as Context</h1>
        <p class="intro">Structured browser context for AI.</p>
      </div>
    </header>
    <p id="organization-policy" class="field-note" role="status" hidden></p>
    <button id="retry-policy" type="button" hidden>Retry organization policies</button>
    <section class="action-section" aria-label="Page context actions">
      <div class="actions">
        <button class="primary-action" type="button"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg><span>Copy context</span></button>
        <button class="secondary-action" type="button"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg><span id="save-label">Save to file</span></button>
        <button id="preview" class="preview-action" type="button" title="Preview and edit context" aria-label="Preview and edit context"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><span>Preview</span></button>
        <button id="select-element" class="preview-action" type="button" title="Select an element to capture" aria-label="Select an element to capture"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/></svg><span>Select</span></button>
        <button id="mcp-connect" class="preview-action" type="button" title="Connect this tab to MCP" aria-label="Connect this tab to MCP"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></svg><span>Connect MCP</span></button>
        <div id="ai-control" class="ai-control" role="group" aria-label="AI access to this tab" hidden><button id="ai-prev" type="button" aria-label="Decrease AI access" disabled>&lt;</button><span id="ai-menu" role="status" aria-live="polite">AI Off</span><button id="ai-next" type="button" aria-label="Increase AI access" disabled>&gt;</button></div>
      </div>
    </section>
    <section id="ai-details" class="ai-details" hidden aria-label="AI connection"><p id="ai-status" role="status" hidden></p></section>
    <section class="settings-panel" aria-label="Export preferences">
      <fieldset class="field compression-field">
        <legend>Compression</legend>
        <div class="range-control">
          <input id="compression" name="compression" type="range" min="0" max="3" step="1" value="2" />
          <div class="range-labels" aria-hidden="true">
            <span>Without</span><span>Detailed</span><span>Compact</span><span>Maximum</span>
          </div>
        </div>
      </fieldset>
      <details class="options-panel">
        <summary><span>Options</span><span id="options-summary" class="options-summary">Semantic Text · Redaction on</span></summary>
        <div class="options-content">
          <fieldset class="field format-field">
            <legend>Export format</legend>
            <div class="format-options">
              <label class="format-option"><input id="format-semantic-text" name="format" type="radio" value="semantic-text" checked /> <span>Semantic Text</span></label>
              <label class="format-option"><input id="format-markdown" name="format" type="radio" value="markdown" /> <span>Markdown</span></label>
            </div>
          </fieldset>
          <div class="privacy-setting">
            <div class="privacy-setting-header">
              <label class="privacy-toggle"><input id="redact-sensitive-data" type="checkbox" checked /> <span>Redact sensitive data</span></label>
              <button id="customize" class="customize-action" type="button" title="Customize redaction filters"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/></svg><span>Filters</span></button>
            </div>
            <p>Replaces matching credentials and custom text with <code>[REDACTED]</code>.</p>
          </div>
          ${import.meta.env.BROWSER === 'firefox' ? `<section class="privacy-setting frame-access-setting" aria-label="Site access">
            <label class="privacy-toggle"><input id="include-other-site-frames" type="checkbox" disabled aria-describedby="other-site-frames-note" /> <span>Include frames from other sites</span></label>
            <p id="other-site-frames-note">Applies immediately. Requires access to all sites; off revokes it.</p>
          </section>` : ''}
        </div>
      </details>
      <button id="save-settings" class="save-settings" type="button" hidden disabled><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg><span>Remember settings</span></button>
    </section>
    <section class="feedback" hidden aria-label="Export result">
      <p class="status" role="status" aria-live="polite"></p>
      <p class="metrics" aria-live="polite"></p>
    </section>
    <footer class="help"><a id="guide-link" target="_blank" rel="noopener">Guide</a> · <a id="diagnostics-link" href="/data-controls.html" target="_blank" rel="noopener">Data controls</a> · <a id="mcp-link" href="/mcp.html" target="_blank" rel="noopener">MCP</a> · <a id="shortcuts-link" href="#">Shortcuts</a> · <a id="license-link" href="/license.html" target="_blank" rel="noopener">License</a></footer>

  </main>
`;

const compression = document.querySelector<HTMLInputElement>('#compression')!;
const semanticTextFormat = document.querySelector<HTMLInputElement>('#format-semantic-text')!;
const markdownFormat = document.querySelector<HTMLInputElement>('#format-markdown')!;
const copyButton = document.querySelector<HTMLButtonElement>('.primary-action')!;
const saveButton = document.querySelector<HTMLButtonElement>('.secondary-action')!;
const saveLabel = document.querySelector<HTMLSpanElement>('#save-label')!;
const previewButton = document.querySelector<HTMLButtonElement>('#preview')!;
const selectElementButton = document.querySelector<HTMLButtonElement>('#select-element')!;
const customizeButton = document.querySelector<HTMLButtonElement>('#customize')!;
const firefox = import.meta.env.BROWSER === 'firefox';
let canSave = !firefox && typeof browser.downloads?.download === 'function';
function updateSaveAvailability(): void {
  saveButton.disabled = exportPending || !canSave;
  saveLabel.textContent = canSave ? 'Save to file' : 'Save unavailable';
  saveButton.title = canSave && firefox
    ? 'Firefox asks for download permission the first time you save a file.'
    : canSave ? '' : 'Saving files is unavailable in this browser. Use Copy context.';
  applyPolicyControls();
}
if (!canSave) {
  saveButton.disabled = true;
  saveLabel.textContent = 'Save unavailable';
  saveButton.title = 'Saving files is unavailable in this browser. Use Copy context.';
}
const status = document.querySelector<HTMLParagraphElement>('.status')!;
const metrics = document.querySelector<HTMLParagraphElement>('.metrics')!;
const feedback = document.querySelector<HTMLElement>('.feedback')!;
const guideLink = document.querySelector<HTMLAnchorElement>('#guide-link')!;
const redactSensitiveData = document.querySelector<HTMLInputElement>('#redact-sensitive-data')!;
const optionsSummary = document.querySelector<HTMLSpanElement>('#options-summary')!;
const saveSettingsButton = document.querySelector<HTMLButtonElement>('#save-settings')!;
installTouchButtonFeedback(saveSettingsButton, () => document.body.dataset.platform === 'android');
const controls = [
  compression, semanticTextFormat, markdownFormat, redactSensitiveData,
  saveSettingsButton, copyButton, saveButton, previewButton, selectElementButton, customizeButton,
];

let policySnapshot: PolicySnapshot | undefined;
let personalSettings: StoredPopupSettings = {};
let savedSettings: StoredPopupSettings = {};
let preferencesSavePending = false;

function preferencesChanged(): boolean {
  if (!policySnapshot || !formats(policySnapshot.policy).length || !levels(policySnapshot.policy).length) return false;
  const saved = resolvePreferences(policySnapshot.policy, savedSettings);
  const current = resolvePreferences(policySnapshot.policy, {
    compression: selectedRangeCompression(compression.value),
    format: selectedFormat(markdownFormat.checked ? 'markdown' : 'semantic-text'),
    redactSensitiveData: redactSensitiveData.checked,
  });
  return current.compression !== saved.compression || current.format !== saved.format
    || current.redactSensitiveData !== saved.redactSensitiveData;
}
let policyGeneration = 0;
let policyLoadFailed = false;

function applyPolicyControls(): void {
  optionsSummary.textContent = `${FORMAT_LABELS[markdownFormat.checked ? 'markdown' : 'semantic-text']} · Redaction ${redactSensitiveData.checked ? 'on' : 'off'}`
    + (otherSiteFrames ? ` · iframes ${otherSiteFrames.checked ? 'on' : 'off'}` : '');
  const changed = preferencesChanged();
  saveSettingsButton.hidden = !changed;
  if (!policySnapshot) { for (const control of controls) control.disabled = true; return; }
  const p = policySnapshot.policy;
  const busy = exportPending || preferencesSavePending || !!frameAccessToggle?.pending;
  for (const control of controls) { control.disabled = busy; control.title = ''; control.ariaDescription = null; }
  const blocked = (control: HTMLInputElement | HTMLButtonElement, disabled: boolean, reason: string) => {
    control.disabled ||= disabled;
    if (disabled) { control.title = reason; control.ariaDescription = reason; }
  };
  const unavailable = !formats(p).length || !levels(p).length || p.FileExportAllowed === false && p.ClipboardExportAllowed === false;
  blocked(copyButton, unavailable || p.ClipboardExportAllowed === false, 'Copying is disabled by your administrator.');
  blocked(saveButton, unavailable || !canSave || p.FileExportAllowed === false, p.FileExportAllowed === false ? 'File export is disabled by your administrator.' : 'Saving files is unavailable.');
  blocked(previewButton, unavailable || p.PreviewAllowed === false, p.PreviewAllowed === false ? 'Preview is disabled by your administrator.' : 'Export is disabled by your administrator.');
  blocked(customizeButton, p.FilterSettingsAllowed === false, 'Filter settings are disabled by your administrator.');
  blocked(selectElementButton, unavailable || p.ElementPickerAllowed === false, 'Element selection is disabled by your administrator.');
  blocked(compression, !!p.ForcedCompression || levels(p).length <= 1, 'Compression is managed by your organization.');
  blocked(semanticTextFormat, !!p.ForcedExportFormat || !formats(p).includes('semantic-text') || formats(p).length <= 1, 'Export format is managed by your organization.');
  blocked(markdownFormat, !!p.ForcedExportFormat || !formats(p).includes('markdown') || formats(p).length <= 1, 'Export format is managed by your organization.');
  blocked(redactSensitiveData, redactionMode(p) !== 'user-controlled', 'Redaction is managed by your organization.');
  const editable = (!p.ForcedCompression && levels(p).length > 1) || (!p.ForcedExportFormat && formats(p).length > 1) || redactionMode(p) === 'user-controlled';
  blocked(saveSettingsButton, p.UserPreferencesSaveAllowed === false || !editable, 'Saving preferences is managed by your organization.');
  saveSettingsButton.disabled ||= !changed;
}
async function refreshPolicy(): Promise<void> {
  const generation = ++policyGeneration;
  try {
    const snapshot = await readPolicy();
    if (generation !== policyGeneration) return;
    policySnapshot = snapshot;
    if (policyLoadFailed) showFeedback('Organization policies loaded. Try your action again.');
    policyLoadFailed = false;
    const note = document.querySelector<HTMLElement>('#organization-policy');
    if (note) { note.hidden = !isManaged(snapshot.policy); note.textContent = isManaged(snapshot.policy) ? 'Managed by your organization · Policy version 1' : ''; }
    const retry = document.querySelector<HTMLElement>('#retry-policy'); if (retry) retry.hidden = true;
    if (formats(snapshot.policy).length && levels(snapshot.policy).length) {
      const effective = resolvePreferences(snapshot.policy, personalSettings);
      compression.value = String(COMPRESSION_VALUES.indexOf(effective.compression));
      semanticTextFormat.checked = effective.format === 'semantic-text'; markdownFormat.checked = effective.format === 'markdown';
      redactSensitiveData.checked = effective.redactSensitiveData;
      updateCompressionControl();
    }
    applyPolicyControls();
  } catch (error) {
    if (generation !== policyGeneration) return;
    policySnapshot = undefined; policyLoadFailed = true; applyPolicyControls(); showFeedback(policyMessage(error));
    const retry = document.querySelector<HTMLElement>('#retry-policy'); if (retry) retry.hidden = false;
  }
}
function rememberSelection(): void {
  if (!policySnapshot) return;
  otherSiteFrames?.setAttribute('data-capture-hint', 'false');
  if (metrics.textContent) {
    feedback.hidden = true;
    status.textContent = '';
    metrics.textContent = '';
  }
  const p = policySnapshot.policy;
  if (!p.ForcedCompression && levels(p).length > 1) personalSettings.compression = selectedRangeCompression(compression.value);
  if (!p.ForcedExportFormat && formats(p).length > 1) personalSettings.format = selectedFormat(markdownFormat.checked ? 'markdown' : 'semantic-text');
  if (redactionMode(p) === 'user-controlled') personalSettings.redactSensitiveData = redactSensitiveData.checked;
  const effective = resolvePreferences(p, personalSettings);
  compression.value = String(COMPRESSION_VALUES.indexOf(effective.compression)); updateCompressionControl();
  applyPolicyControls();
}
for (const control of [compression, semanticTextFormat, markdownFormat, redactSensitiveData]) control.addEventListener('change', rememberSelection);

const COMPRESSION_VALUES: readonly CompressionLevel[] = ['without', 'detailed', 'compact', 'maximum'];

guideLink.href = browser.runtime.getURL('/guide.html');
const licenseLink = document.querySelector<HTMLAnchorElement>('#license-link')!;
licenseLink.href = browser.runtime.getURL('/license.html');
document.querySelector<HTMLAnchorElement>('#shortcuts-link')!.addEventListener('click', event => {
  event.preventDefault();
  void (async () => {
    try {
      const commands = browser.commands as typeof browser.commands & { openShortcutSettings?: () => Promise<void> };
      if (firefox && commands.openShortcutSettings) await commands.openShortcutSettings();
      else if (firefox) await browser.tabs.create({ url: 'about:addons', active: true });
      else await browser.tabs.create({ url: 'chrome://extensions/shortcuts', active: true });
      window.close();
    } catch {
      showFeedback(firefox
        ? 'Open about:addons, then choose Manage Extension Shortcuts from the tools menu.'
        : 'Open chrome://extensions/shortcuts to change keyboard shortcuts.');
    }
  })();
});
const diagnosticsLink = document.querySelector<HTMLAnchorElement>('#diagnostics-link')!;
diagnosticsLink.href = browser.runtime.getURL('/data-controls.html');
const mcpLink = document.querySelector<HTMLAnchorElement>('#mcp-link')!;
mcpLink.href = browser.runtime.getURL('/mcp.html');
for (const [link, path] of [[guideLink, '/guide.html'], [diagnosticsLink, '/data-controls.html'], [mcpLink, '/mcp.html'], [licenseLink, '/license.html']] as const) {
  link.addEventListener('click', event => {
    event.preventDefault();
    void browser.tabs.create({ url: browser.runtime.getURL(path), active: true })
      .then(() => window.close())
      .catch(() => showFeedback('Unable to open this page. Try again.'));
  });
}

function selectedRangeCompression(value: string): CompressionLevel {
  const index = Number.parseInt(value, 10);
  return COMPRESSION_VALUES[index] ?? DEFAULT_COMPRESSION_LEVEL;
}

function updateCompressionControl(): void {
  const minimum = Number.parseFloat(compression.min);
  const maximum = Number.parseFloat(compression.max);
  const current = Number.parseFloat(compression.value);
  const progress = maximum > minimum
    ? ((current - minimum) / (maximum - minimum)) * 100
    : 0;
  compression.style.setProperty('--compression-progress', `${progress}%`);
  compression.setAttribute('aria-valuetext', selectedRangeCompression(compression.value));
}

function readSettings(value: unknown): StoredPopupSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as StoredPopupSettings;
}

async function loadSettings(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(POPUP_SETTINGS_KEY);
    const settings = readSettings(stored[POPUP_SETTINGS_KEY]);
    personalSettings = settings ?? {};
    savedSettings = { ...personalSettings };
    if (settings === undefined) return;

    const compressionIndex = settings.compression === undefined
      ? -1
      : COMPRESSION_VALUES.indexOf(settings.compression);
    if (compressionIndex >= 0) compression.value = compressionIndex.toString();
    if (settings.format === 'markdown') markdownFormat.checked = true;
    if (settings.format === 'semantic-text') semanticTextFormat.checked = true;
    if (typeof settings.redactSensitiveData === 'boolean') {
      redactSensitiveData.checked = settings.redactSensitiveData;
    }
    updateCompressionControl();
  } catch {
    // The popup remains usable with its safe defaults when storage is unavailable.
  }
}

async function saveSettings(): Promise<void> {
  if (exportPending || preferencesSavePending || frameAccessToggle?.pending || !preferencesChanged()) return;
  preferencesSavePending = true;
  applyPolicyControls();
  const settings: Required<StoredPopupSettings> = {
    compression: selectedRangeCompression(compression.value),
    format: markdownFormat.checked ? 'markdown' : 'semantic-text',
    redactSensitiveData: redactSensitiveData.checked,
  };
  try {
    const { policy } = await readPolicy();
    if (policy.UserPreferencesSaveAllowed === false) throw new PolicyError('Saving preferences is disabled by your administrator.');
    const previous = await browser.storage.local.get(POPUP_SETTINGS_KEY);
    const saved = { ...readSettings(previous[POPUP_SETTINGS_KEY]) };
    if (!policy.ForcedCompression && levels(policy).length > 1) saved.compression = settings.compression;
    if (!policy.ForcedExportFormat && formats(policy).length > 1) saved.format = settings.format;
    if (redactionMode(policy) === 'user-controlled') saved.redactSensitiveData = settings.redactSensitiveData;
    await browser.storage.local.set({ [POPUP_SETTINGS_KEY]: saved });
    personalSettings = saved;
    savedSettings = { ...saved };
    showFeedback('Settings saved for future popup openings.');
  } catch (error) {
    showFeedback(error instanceof PolicyError ? policyMessage(error) : 'Unable to save settings. Try again.');
  } finally {
    preferencesSavePending = false;
    applyPolicyControls();
  }
}

function showFeedback(message: string): void {
  status.textContent = message;
  metrics.textContent = '';
  otherSiteFrames?.setAttribute('data-capture-hint', 'false');
  feedback.hidden = false;
}

function setPending(pending: boolean, action?: ExportAction): void {
  for (const control of controls) control.disabled = pending;
  saveButton.disabled = pending || !canSave;
  applyPolicyControls();
  if (pending) {
    metrics.textContent = '';
    showFeedback(action === 'preview' ? 'Preparing preview…' : action === 'copy' ? 'Capturing and copying page context…' : 'Capturing and preparing download…');
  }
}

let exportPending = false;
let frameAccessToggle: FrameAccessToggle | undefined;
const otherSiteFrames = firefox ? document.querySelector<HTMLInputElement>('#include-other-site-frames') : null;
if (otherSiteFrames) frameAccessToggle = installFrameAccessToggle(otherSiteFrames, showFeedback, pending => {
  for (const control of controls) control.disabled = pending || exportPending;
  saveButton.disabled = pending || exportPending || !canSave;
  applyPolicyControls();
});

async function exportPageContext(action: ExportAction): Promise<void> {
  if (action === 'save' && !canSave) {
    showFeedback('Saving files is unavailable in this browser. Use Copy context.');
    return;
  }
  if (exportPending || frameAccessToggle?.pending) return;
  try {
    if (!policySnapshot) throw new PolicyError('Organization policies are not ready. Retry loading them.');
    assertAction(policySnapshot.policy, action);
  } catch (error) { showFeedback(policyMessage(error)); return; }
  exportPending = true;
  frameAccessToggle?.setPending(true);
  setPending(true, action);
  let destinationStarted = false;
  try {
    // Request from the click handler before awaiting capture, preserving the user gesture.
    if (action === 'save' && firefox) {
      const granted = await browser.permissions.request({ permissions: ['downloads'] });
      if (!granted) {
        technicalEvent({ code: 'download-complete', result: 'error', reason: 'permission-denied' });
        showFeedback('Download permission was not granted. Use Copy or try Save again.');
        return;
      }
      if (typeof browser.downloads?.download !== 'function') {
        showFeedback('Saving files is unavailable in this browser. Use Copy context.');
        return;
      }
    }
    const exportFormat = selectedFormat(markdownFormat.checked ? 'markdown' : 'semantic-text');
    const request: CaptureActiveTabRequest = {
      type: CAPTURE_ACTIVE_TAB_MESSAGE,
      compression: selectedRangeCompression(compression.value),
      format: exportFormat,
      redactSensitiveData: redactSensitiveData.checked,
    };
    const context = { ...request, operationId: undefined as string | undefined, policyRevision: policySnapshot?.revision };
    await checkPolicy(action, context);
    const response = await browser.runtime.sendMessage(request);
    if (!isCaptureActiveTabResponse(response)) {
      showFeedback(ERROR_MESSAGES['capture-failed']!);
      return;
    }
    if (!response.ok) {
      showFeedback(response.error.code === 'policy-blocked' ? response.error.message : ERROR_MESSAGES[response.error.code] ?? ERROR_MESSAGES['capture-failed']!);
      return;
    }

    context.policyRevision = response.policyRevision;
    context.operationId = response.operationId;
    await checkPolicy(action, context);
    const result = response.export;
    let characterCount = result.characterCount;
    let approximateTokenCount = result.approximateTokenCount;
    destinationStarted = true;
    if (action === 'preview') {
      await openPreview({
        operationId: response.operationId, policyRevision: response.policyRevision, content: result.serialized.content, compression: request.compression, format: exportFormat,
        redactSensitiveData: request.redactSensitiveData, redactionCount: result.redactionCount,
        reductionRatio: result.reductionRatio,
        warnings: response.warnings ?? [],
      });
      showFeedback('Preview opened. Nothing has been copied.');
      window.close();
      return;
    }
    if (action === 'copy') {
      const content = wrapClipboardContext(result.serialized.content, request.compression);
      await navigator.clipboard.writeText(content);
      technicalEvent({ code: 'clipboard-complete', result: 'success', operation: response.operationId });
      characterCount = content.length;
      approximateTokenCount = Math.ceil(characterCount / 4);
      showFeedback(`Copied ${FORMAT_LABELS[exportFormat]}.`);
    } else {
      await saveContext(result.serialized.content, exportFormat, context);
      showFeedback(firefox ? 'Saving file in a separate tab.' : `Saved ${FORMAT_LABELS[exportFormat]} file.`);
    }
    const captureWarnings = response.warnings ?? [];
    const suggestFrameAccess = !!otherSiteFrames && !otherSiteFrames.checked
      && captureWarnings.includes('embedded-frames-partial');
    otherSiteFrames?.setAttribute('data-capture-hint', String(suggestFrameAccess));
    const warnings = firefox && suggestFrameAccess
      ? ['Some frames skipped. Enable other-site frames and capture again.',
        captureWarningText(captureWarnings.filter(code => code !== 'embedded-frames-partial'))].filter(Boolean).join(' ')
      : captureWarningText(captureWarnings, false);
    metrics.textContent = formatMetrics(
      characterCount,
      approximateTokenCount,
      result.reductionRatio,
      result.redactionCount,
      action,
    ) + (warnings ? ` ${warnings}` : '');
  } catch (error) {
    if (destinationStarted) technicalEvent({ code: action === 'copy' ? 'clipboard-complete' : action === 'preview' ? 'preview-transfer' : 'download-complete', result: 'error', reason: error instanceof PolicyError ? 'policy-blocked' : 'failed' });
    showFeedback(error instanceof PolicyError ? policyMessage(error) : ERROR_MESSAGES[
      destinationStarted ? (action === 'preview' ? 'preview-failed' : action === 'copy' ? 'copy-failed' : 'save-failed') : 'capture-failed'
    ]!);
  } finally {
    exportPending = false;
    frameAccessToggle?.setPending(false);
    setPending(false);
  }
}

customizeButton.addEventListener('click', () => {
  if (exportPending || frameAccessToggle?.pending) return;
  void (async () => {
    try {
      await checkPolicy('customize');
      await browser.tabs.create({ url: browser.runtime.getURL('/filters.html'), active: true });
      window.close();
    } catch (error) { showFeedback(error instanceof PolicyError ? policyMessage(error) : 'Unable to open filter settings. Try again.'); }
  })();
});
previewButton.addEventListener('click', () => void exportPageContext('preview'));
selectElementButton.addEventListener('click', async () => {
  if (exportPending || frameAccessToggle?.pending) return;
  exportPending = true; setPending(true); frameAccessToggle?.setPending(true);
  showFeedback('Starting element selection…');
  try {
    if (!policySnapshot) throw new PolicyError('Organization policies are not ready. Retry loading them.');
    await checkPolicy('picker', { compression: selectedRangeCompression(compression.value), format: selectedFormat(markdownFormat.checked ? 'markdown' : 'semantic-text'), redactSensitiveData: redactSensitiveData.checked, policyRevision: policySnapshot.revision });
    const response = await browser.runtime.sendMessage({ type: PICKER_START,
      compression: selectedRangeCompression(compression.value),
      format: selectedFormat(markdownFormat.checked ? 'markdown' : 'semantic-text'),
      redactSensitiveData: redactSensitiveData.checked,
    });
    if (response?.ok === true) window.close();
    else showFeedback(typeof response?.error?.message === 'string' ? response.error.message : 'Unable to start element selection. Try again.');
  } catch (error) { showFeedback(error instanceof PolicyError ? policyMessage(error) : 'Unable to start element selection. Try again.'); }
  finally { exportPending = false; frameAccessToggle?.setPending(false); setPending(false); }
});
copyButton.addEventListener('click', () => void exportPageContext('copy'));
saveButton.addEventListener('click', () => void exportPageContext('save'));
compression.addEventListener('input', () => { rememberSelection(); updateCompressionControl(); });
saveSettingsButton.addEventListener('click', () => {
  void saveSettings();
});
updateCompressionControl();
setPending(false);
void loadSettings().then(refreshPolicy);
const stopPolicy = watchPolicy(() => { policySnapshot = undefined; applyPolicyControls(); void refreshPolicy(); });
window.addEventListener('pagehide', stopPolicy, { once: true });
document.querySelector('#retry-policy')?.addEventListener('click', () => void refreshPolicy());

async function initializeFirefoxPlatform(): Promise<void> {
  if (!firefox) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const platform = await Promise.race([
      browser.runtime.getPlatformInfo(),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 1000); }),
    ]);
    const android = platform?.os === 'android' || /Android/u.test(navigator.userAgent);
    document.body.dataset.platform = android ? 'android' : 'desktop';
    selectElementButton.hidden = android;
    canSave = !android && ['mac', 'win', 'linux', 'cros', 'openbsd'].includes(platform?.os ?? '')
      && typeof browser.permissions?.request === 'function';
  } catch {
    // Copy remains available if local platform detection fails.
    document.body.dataset.platform = /Android/u.test(navigator.userAgent) ? 'android' : 'desktop';
    selectElementButton.hidden = document.body.dataset.platform === 'android';
  } finally {
    clearTimeout(timer);
    updateSaveAvailability();
  }
}
void initializeFirefoxPlatform();

const mcpConnect = document.querySelector<HTMLButtonElement>('#mcp-connect');
mcpConnect?.addEventListener('click', () => {
  mcpConnect.disabled = true;
  void browser.runtime.sendMessage({ type: 'mcp-ui-v1', action: 'source' }).then(result => {
    if (result?.ok) window.close(); else {
      mcpConnect.disabled = false;
      showFeedback(result?.code === 'unsupported-page' ? ERROR_MESSAGES['unsupported-page']! : 'MCP is unavailable for this page or organization policy.');
    }
  }, () => { mcpConnect.disabled = false; showFeedback('Unable to open MCP settings.'); });
});

installMcpPopup();
