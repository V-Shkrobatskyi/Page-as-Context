// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { FORM_ROLES, type DataControls } from '../../core/data-controls';
import type { SemanticNode } from '../../core/model';
import type { CaptureOutcome } from '../types';
import type { CaptureWarningCode } from '../../capture-warnings';
import { CaptureLimitError, DOM_CAPTURE_LIMITS, type DomCaptureLimits } from './limits';
import { allowsContentName, composedChildren, elementStates, isPassword, roleForElement } from './semantics';

const OMIT_TAGS = new Set(['script', 'style', 'template', 'noscript', 'head']);
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();

export interface DomCaptureWork { nodes: number; visited: number; nameWork: number; characters: number; milliseconds: number }
export interface DomCaptureOptions {
  dataControls?: DataControls;
  root?: Element;
  embedded?: boolean;
  includeFrame?: (element: Element) => boolean;
  onFrame?: (element: Element, node: SemanticNode) => void;
  onNode?: (element: Element, node: SemanticNode) => void;
  reportWork?: (work: DomCaptureWork) => void;
}

/** A bounded HTML/ARIA approximation, not the browser's computed AX tree. */
export function captureDomPage(doc: Document, limits: DomCaptureLimits = DOM_CAPTURE_LIMITS, options: DomCaptureOptions = {}): CaptureOutcome {
  const omitValues = options.dataControls?.includeFormValues === false;
  const editable = (element: Element): boolean => {
    let current: Element | null = element;
    while (current) {
      const mode = current.getAttribute('contenteditable')?.toLowerCase();
      if (mode === 'false') return false;
      if (mode === '' || mode === 'true' || mode === 'plaintext-only') return true;
      current = current.assignedSlot ?? current.parentElement ?? (current.getRootNode() as ShadowRoot).host ?? null;
    }
    return false;
  };
  const field = (element: Element) => editable(element) || FORM_ROLES.has(roleForElement(element));
  const started = performance.now();
  let visitedCount = 0;
  let outputCount = 1;
  let characters = 4;
  let nameWork = 0;
  const warnings = new Set<CaptureWarningCode>();
  const styles = new WeakMap<Element, CSSStyleDeclaration>();
  const names = new WeakMap<Element, string>();
  const style = (element: Element): CSSStyleDeclaration => {
    let result = styles.get(element);
    if (!result) { result = doc.defaultView!.getComputedStyle(element); styles.set(element, result); }
    return result;
  };
  const check = (): void => {
    if (performance.now() - started > limits.maxMilliseconds || outputCount > limits.maxNodes ||
      visitedCount > limits.maxVisited || nameWork > limits.maxVisited || characters > limits.maxCharacters) throw new CaptureLimitError();
  };
  const text = (value: string): string => { characters += value.length; check(); return value; };
  const pruned = (element: Element): boolean => OMIT_TAGS.has(element.localName) ||
    element.hasAttribute('hidden') || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true' ||
    element.localName === 'input' && (element as HTMLInputElement).type === 'hidden' ||
    element.localName === 'dialog' && !element.hasAttribute('open') || style(element).display === 'none';

  function textAlternative(root: Element, includeHidden: boolean, exclude?: Element, path = new Set<Element>([root])): string {
    const parts: string[] = [];
    const stack: { node: Node | null; depth: number }[] = [{ node: root, depth: 0 }];
    const seen = new Set<Node>();
    let length = 0;
    const add = (value: string): void => { length += value.length; if (length > limits.maxCharacters) throw new CaptureLimitError(); parts.push(value); };
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      nameWork++; check();
      if (node === null) { add(' '); continue; }
      if (depth > limits.maxDepth) throw new CaptureLimitError();
      if (seen.has(node) || node === exclude) continue;
      seen.add(node);
      if (node.nodeType === 3) { add(node.textContent ?? ''); continue; }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (OMIT_TAGS.has(element.localName) || ['iframe', 'frame', 'canvas'].includes(element.localName) || !includeHidden && (pruned(element) || style(element).visibility === 'hidden' || style(element).visibility === 'collapse')) continue;
      // Never read a password value, including controls embedded in referenced labels.
      if (isPassword(element) || omitValues && field(element)) continue;
      if (element !== root && element.hasAttribute('aria-labelledby')) {
        add(` ${accessibleName(element, path, includeHidden)} `); continue;
      }
      const aria = element.getAttribute('aria-label');
      if (element !== root && aria) { add(` ${aria} `); continue; }
      if (element.localName === 'img' || element.localName === 'input' && (element as HTMLInputElement).type === 'image') { add(` ${element.getAttribute('alt') ?? ''} `); continue; }
      if (element.localName === 'input' || element.localName === 'textarea') {
        // Keep field values on their own nodes, where privacy rules have the
        // field label. Duplicating them in an ancestor name loses that context.
        if (element.localName === 'input' && ['button', 'submit', 'reset'].includes((element as HTMLInputElement).type)) {
          add(` ${accessibleName(element, path, includeHidden)} `);
        }
        continue;
      }
      if (element.localName === 'select') continue;
      if (element.localName === 'br') { add(' '); continue; }
      if (element !== root && /^(?:block|flex|grid|list-item|table(?:-|$))/u.test(style(element).display)) {
        add(' '); stack.push({ node: null, depth });
      }
      const children = composedChildren(element);
      if (nameWork + stack.length + children.length > limits.maxVisited) throw new CaptureLimitError();
      for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i]!, depth: depth + 1 });
    }
    return clean(parts.join(''));
  }

  function accessibleName(element: Element, path = new Set<Element>(), referenced = false): string {
    check();
    if (path.has(element)) return '';
    if (path.size > 32) throw new CaptureLimitError();
    const next = new Set(path).add(element);
    const scope = element.getRootNode() as Document | ShadowRoot;
    const refs = element.getAttribute('aria-labelledby')?.trim().split(/\s+/u).map((id) => scope.getElementById?.(id)).filter((ref): ref is HTMLElement => !!ref) ?? [];
    if (refs.length) return clean(refs.map((ref) => accessibleName(ref, next, true)).join(' '));
    const aria = clean(element.getAttribute('aria-label') ?? '');
    if (aria) return aria;
    const labels = (element as HTMLInputElement).labels;
    if (labels?.length) return clean(Array.from(labels).map((label) => textAlternative(label, false, element, next)).join(' '));
    if (element.localName === 'img') return element.getAttribute('alt') ?? element.getAttribute('title') ?? '';
    if (element.localName === 'input') {
      const input = element as HTMLInputElement;
      if (input.type === 'image') return input.alt || input.title || 'Submit';
      if (['button', 'submit', 'reset'].includes(input.type)) return input.value || (input.type === 'submit' ? 'Submit' : input.type === 'reset' ? 'Reset' : '');
    }
    const captionTag = ({ fieldset: 'legend', table: 'caption', figure: 'figcaption', svg: 'title' } as Record<string, string>)[element.localName];
    if (captionTag) {
      const caption = Array.from(element.children).find((child) => child.localName === captionTag);
      if (caption) return textAlternative(caption, false, undefined, next);
    }
    if (element.localName === 'optgroup') return element.getAttribute('label') ?? '';
    if (element.localName === 'option' && element.hasAttribute('label')) return (element as HTMLOptionElement).label;
    if (omitValues && field(element)) return element.getAttribute('title') ?? '';
    if (referenced || allowsContentName(roleForElement(element))) {
      const content = textAlternative(element, referenced, undefined, next);
      if (content) return content;
    }
    return element.getAttribute('title') ?? '';
  }

  try {
    if (!doc.body || !doc.defaultView) return { ok: false, error: { code: 'unsupported-page', message: 'This document cannot be captured.' } };
    const root: SemanticNode = { role: 'page', children: [] };
    const selected = options.root;
    if (selected && (selected.ownerDocument !== doc || !selected.isConnected)) return { ok: false, error: { code: 'page-changed', message: 'The selected element is no longer available.' } };
    let listLevel = 0;
    if (selected) {
      let ancestor: Element | null = selected;
      let depth = 0;
      while (ancestor) {
        if (++depth > limits.maxDepth) throw new CaptureLimitError();
        if (pruned(ancestor)) return { ok: false, error: { code: 'capture-unavailable', message: 'The selected element is hidden.' } };
        ancestor = ancestor.assignedSlot ?? ancestor.parentElement ?? (ancestor.getRootNode() as ShadowRoot).host ?? null;
        if (ancestor && roleForElement(ancestor) === 'list') listLevel++;
      }
    }
    const stack = [{ node: (selected ?? doc.body) as Node, parent: root, depth: 0, listLevel }];
    const visited = new WeakSet<Node>();
    while (stack.length) {
      const { node, parent, depth, listLevel } = stack.pop()!;
      visitedCount++; check();
      if (depth > limits.maxDepth) throw new CaptureLimitError();
      if (visited.has(node)) continue;
      visited.add(node);
      if (node.nodeType === 3) {
        const value = clean(node.textContent ?? '');
        if (value) { outputCount++; parent.children.push({ role: text('StaticText'), name: text(value), children: [] }); check(); }
        continue;
      }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (pruned(element)) continue;
      const frame = element.localName === 'iframe' || element.localName === 'frame';
      if (frame && options.includeFrame && !options.includeFrame(element)) continue;
      const hidden = style(element).visibility === 'hidden' || style(element).visibility === 'collapse';
      const role = roleForElement(element);
      const nextListLevel = listLevel + Number(role === 'list');
      let container = parent;
      if (element !== doc.body && !hidden) {
        const output: SemanticNode = { role: text(role), children: [] };
        outputCount++; check();
        let name = names.get(element);
        if (name === undefined) { name = accessibleName(element); names.set(element, name); }
        if (name) output.name = text(clean(name));
        if (omitValues && editable(element)) output.editable = true;
        const states = elementStates(element, role, !omitValues);
        if (states) output.states = states;
        const ariaLevel = Number(element.getAttribute('aria-level'));
        if (Number.isInteger(ariaLevel) && ariaLevel > 0) output.level = ariaLevel;
        else if (/^h[1-6]$/u.test(element.localName)) output.level = Number(element.localName[1]);
        else if (role === 'listitem' && listLevel > 0) output.level = listLevel;
        if (!omitValues && element.matches('input,textarea,select') && !isPassword(element) && !['button', 'checkbox', 'radio'].includes(role)) output.value = text((element as HTMLInputElement).value);
        else if (!omitValues && editable(element)) output.value = text(textAlternative(element, false));
        else if (!omitValues && ['slider', 'spinbutton', 'progressbar', 'meter'].includes(role)) {
          const value = element.getAttribute('aria-valuetext') ?? element.getAttribute('aria-valuenow') ?? (element.matches('progress,meter') ? String((element as HTMLProgressElement).value) : null);
          if (value !== null) output.value = text(value);
        }
        if (role === 'link' && element.hasAttribute('href')) {
          try {
            const url = new URL(element.getAttribute('href')!, doc.baseURI);
            if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) output.href = text(url.href);
          } catch { /* Invalid links are omitted without exposing their raw value. */ }
        }
        options.onNode?.(element, output);
        parent.children.push(output); container = output;
        if (frame) {
          if (options.onFrame) {
            output.role = text('embedded-document');
            output.value = 'Not captured: unavailable';
            options.onFrame(element, output);
            text(output.value);
          } else warnings.add('embedded-frames');
        }
        if (element.localName === 'canvas') warnings.add('canvas-content');
      }
      if (element.localName === 'iframe' || element.localName === 'frame' || element.localName === 'canvas') continue;
      let children = omitValues && field(element) ? [] : composedChildren(element);
      if (hidden) children = children.filter((child) => child.nodeType !== 3);
      if (visitedCount + stack.length + children.length > limits.maxVisited) throw new CaptureLimitError();
      for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i]!, parent: container, depth: depth + 1, listLevel: nextListLevel });
    }
    const tree = { schemaVersion: 1 as const, title: text(doc.title || (options.embedded ? '' : 'Untitled page')),
      ...(!options.embedded ? { sourceUrl: text(doc.location.href) } : {}), root };
    const result: CaptureOutcome = { ok: true, tree, ...(warnings.size ? { warnings: [...warnings] } : {}) };
    if (JSON.stringify(result).length > limits.maxPayloadCharacters) throw new CaptureLimitError();
    return result;
  } catch (error) {
    return { ok: false, error: {
      code: error instanceof CaptureLimitError ? 'capture-limit' : 'capture-failed',
      message: error instanceof CaptureLimitError ? 'This page exceeds the capture limits.' : 'Unable to read this page’s semantic structure.',
    } };
  } finally {
    options.reportWork?.({ nodes: outputCount, visited: visitedCount, nameWork, characters, milliseconds: performance.now() - started });
  }
}
