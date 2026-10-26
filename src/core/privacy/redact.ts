// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { SemanticNode, SemanticTree } from '..';
import { compileRegex } from './regex';
import { maskPhone, maskText } from './masking';
import { emailMatches } from './emails';
import { isAutomaticType, PERSONAL_DATA_TYPES, personalDataMatches, personalFieldMaskKind, type FieldMaskKind } from './personal-data';
import { builtinCaseSensitive, DETECTOR_MODES, legacyRuleFromType, customRuleTerms, defaultRedactionSettings, validateRedactionSettings, type BuiltinFilterId, type RedactionSettings } from './settings';

/** A value-only summary that never retains a matched secret. */
export interface RedactionResult {
  tree: SemanticTree;
  redactionCount: number;
}

import { SENSITIVE_FIELD_NAME } from './sensitive-fields';
const AUTHORIZATION_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gu;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu;
const OPENAI_STYLE_KEY = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gu;
const ASSIGNED_SECRET = /\b((?:api[ _-]?key|token|secret|password)\s*[:=]\s*)((?!\[REDACTED\])[^\s&"',;]{8,})/giu;
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider']);
// Every supported credential pattern contains one of these markers. Most labels do not.
const CREDENTIAL_MARKER = /Bearer|Basic|eyJ|gh[pousr]_|github_pat_|AKIA|ASIA|sk-|api[ _-]?key|token|secret|password/iu;

/**
 * Returns an independent semantic tree with common credential-shaped text redacted.
 *
 * This is intentionally a local heuristic, not a general DLP or PII detector. It
 * must run before every serializer and never exposes the original matched values.
 */
export function redactSemanticTree(tree: SemanticTree, settings: RedactionSettings = defaultRedactionSettings()): RedactionResult {
  const validated = validateRedactionSettings(settings);
  const config = { ...validated, customRules: validated.customRules.map(legacyRuleFromType) };
  const disabled = new Set<BuiltinFilterId>(config.disabledBuiltins);
  const enabled = (id: BuiltinFilterId) => !disabled.has(id);
  const maskEmailDomains = enabled('email-mask-domain');
  const hidePhones = enabled('phone-numbers');
  const maskPhones = enabled('phone-mask');
  const maskPersonalFields = enabled('personal-fields-mask');
  const personalTypes = PERSONAL_DATA_TYPES.filter(type => (type === 'phoneNumbers' ? hidePhones || maskPhones : enabled(type === 'paymentCards' ? 'payment-cards' : 'iban')));
  const hideEmails = enabled('email-hide');
  const configuredPattern = (id: BuiltinFilterId, pattern: RegExp) => new RegExp(pattern.source,
    pattern.flags.replace('i', '') + (builtinCaseSensitive(config, id) ? '' : 'i'));
  const fieldNamePattern = configuredPattern('sensitive-fields', SENSITIVE_FIELD_NAME);
  const builtins = [
    ['authorization', AUTHORIZATION_VALUE, 1, ' [REDACTED]'],
    ['jwt', JWT, 0, '[REDACTED]'], ['github', GITHUB_TOKEN, 0, '[REDACTED]'],
    ['aws', AWS_ACCESS_KEY, 0, '[REDACTED]'], ['openai', OPENAI_STYLE_KEY, 0, '[REDACTED]'],
    ['assignments', ASSIGNED_SECRET, 1, '[REDACTED]'],
  ] as const;
  const builtinPatterns = builtins.filter(([id]) => enabled(id)).map(([id, pattern, prefix, replacement]) =>
    ({ pattern: configuredPattern(id, pattern), prefix, replacement }));
  let redactionCount = 0;
  // User rules are literal substrings. Escape metacharacters before compiling them.
  // Separate matchers preserve overlaps between rules and protect placeholders.
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const customRegexPatterns = config.customRules.filter(rule => rule.enabled && rule.type === 'regex').map(rule => compileRegex(rule.text, rule.caseSensitive));
  const customPatterns = config.customRules.filter(rule => rule.enabled && rule.type !== 'regex' && !isAutomaticType(rule.type) && !rule.fieldLabels && !rule.urlParameters && !DETECTOR_MODES.some(mode => rule[mode.key])).flatMap(rule =>
    customRuleTerms(rule).map(term => new RegExp(`\\[REDACTED\\]|${escape(term)}`, rule.caseSensitive ? 'gu' : 'giu')));
  const queryNamePatterns = [
    ...(enabled('query-values') ? [new RegExp('^(?:api[ _-]?key|token|secret|password)$', builtinCaseSensitive(config, 'query-values') ? 'u' : 'iu')] : []),
    ...config.customRules.filter(rule => rule.enabled && rule.urlParameters).map(rule =>
      new RegExp(`^(?:${customRuleTerms(rule).map(escape).join('|')})$`, rule.caseSensitive ? 'u' : 'iu')),
  ];
  const customFieldPatterns = config.customRules.filter(rule => rule.enabled && rule.fieldLabels).flatMap(rule =>
    customRuleTerms(rule).map(term => new RegExp(rule.wholeWords ? `\\b${escape(term)}\\b` : escape(term), rule.caseSensitive ? 'u' : 'iu')));

  const customDetectorPatterns = config.customRules.filter(rule => rule.enabled).flatMap(rule => {
    const terms = customRuleTerms(rule).map(escape).join('|');
    const alternatives = `(?:${terms})`;
    const sources = {
      authorization: { source: `\\b(${terms})\\s+[A-Za-z0-9._~+/=-]{8,}\\b`, prefix: 1, replacement: ' [REDACTED]' },
      jwt: { source: `\\b${alternatives}[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\b`, prefix: 0, replacement: '[REDACTED]' },
      githubTokens: { source: `\\b${alternatives}[A-Za-z0-9_]{20,}\\b`, prefix: 0, replacement: '[REDACTED]' },
      awsKeys: { source: `\\b${alternatives}[0-9A-Z]{16}\\b`, prefix: 0, replacement: '[REDACTED]' },
      openaiKeys: { source: `\\b${alternatives}[A-Za-z0-9_-]{16,}\\b`, prefix: 0, replacement: '[REDACTED]' },
      assignedSecrets: { source: `\\b(${alternatives}\\s*[:=]\\s*)((?!\\[REDACTED\\])[^\\s&"',;]{8,})`, prefix: 1, replacement: '[REDACTED]' },
    };
    return DETECTOR_MODES.filter(mode => rule[mode.key]).map(mode => ({
      ...sources[mode.key], pattern: new RegExp(sources[mode.key].source, rule.caseSensitive ? 'gu' : 'giu'),
    }));
  });

  const redactText = (value: string, phoneField = false, fieldMask?: FieldMaskKind): string => {
    if (!fieldMask && personalTypes.length === 0 && !CREDENTIAL_MARKER.test(value) && customPatterns.length === 0 && queryNamePatterns.length === 0 && customDetectorPatterns.length === 0 && customRegexPatterns.length === 0 && !((maskEmailDomains || hideEmails) && value.includes('@'))) return value;
    type Span = { start: number; end: number; replacement: string; mask?: boolean };
    const streams: Generator<Span>[] = [];
    const protectedRanges = customRegexPatterns.length
      ? [...value.matchAll(/\[REDACTED\]/gu)].map(match => [match.index, match.index + match[0].length] as const) : [];
    function* regexMatches(pattern: ReturnType<typeof compileRegex>): Generator<Span> {
      const matcher = pattern.matcher(value);
      let protectedIndex = 0;
      while (matcher.find()) {
        let start = matcher.start(); const end = matcher.end();
        if (start === end) continue;
        while (protectedRanges[protectedIndex] && protectedRanges[protectedIndex]![1] <= start) protectedIndex++;
        for (let index = protectedIndex; protectedRanges[index] && protectedRanges[index]![0] < end; index++) {
          const [protectedStart, protectedEnd] = protectedRanges[index]!;
          if (start < protectedStart) yield { start, end: protectedStart, replacement: '[REDACTED]' };
          start = Math.max(start, protectedEnd);
        }
        if (start < end) yield { start, end, replacement: '[REDACTED]' };
      }
    }
    function* matches(pattern: RegExp, prefix: number, replacement: string, protectPlaceholder: boolean): Generator<Span> {
      const matcher = new RegExp(pattern);
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(value)) !== null) {
        if (protectPlaceholder) {
          if (match[0] === '[REDACTED]') continue;
          // A literal may overlap itself; move one Unicode code point, not its full length.
          matcher.lastIndex = match.index + (value.codePointAt(match.index)! > 0xffff ? 2 : 1);
        }
        yield { start: match.index + (prefix ? match[prefix]!.length : 0), end: match.index + match[0].length, replacement };
      }
    }
    const collect = (pattern: RegExp, prefix = 0, replacement = '[REDACTED]', protectPlaceholder = false) => {
      streams.push(matches(pattern, prefix, replacement, protectPlaceholder));
    };
    if (CREDENTIAL_MARKER.test(value)) {
      for (const { pattern, prefix, replacement } of builtinPatterns) collect(pattern, prefix, replacement);
    }
    for (const pattern of customPatterns) collect(pattern, 0, '[REDACTED]', true);
    function* queryValues(): Generator<Span> {
      // Decode names once using URL query semantics, but retain original spans
      // so escaping, parameter order and unrelated values remain unchanged.
      for (const match of value.matchAll(/[?&]([^?&#=]+)=([^&#\s]+)/gu)) {
        const name = new URLSearchParams(`${match[1]}=`).keys().next().value ?? '';
        if (match[2] === '[REDACTED]' || !queryNamePatterns.some(pattern => pattern.test(name))) continue;
        yield { start: match.index + match[1]!.length + 2, end: match.index + match[0].length, replacement: '[REDACTED]' };
      }
    }
    if (queryNamePatterns.length && /[?&]/u.test(value)) streams.push(queryValues());
    for (const { pattern, prefix, replacement } of customDetectorPatterns) collect(pattern, prefix, replacement);
    for (const pattern of customRegexPatterns) streams.push(regexMatches(pattern));
    function* emails(): Generator<Span> {
      for (const email of emailMatches(value)) yield {
        start: email.start, end: email.end, mask: !hideEmails,
        replacement: hideEmails ? '[REDACTED]' : maskEmailDomains ? email.maskedDomain : email.masked,
      };
    }
    if (maskEmailDomains || hideEmails) streams.push(emails());
    for (const type of personalTypes) streams.push(personalDataMatches(value, type, phoneField, type === 'phoneNumbers' && !hidePhones));
    function* maskedField(): Generator<Span> {
      if (!fieldMask || !value || value === '[REDACTED]') return;
      let replacement: string;
      if (fieldMask === 'hide' || value.includes('[REDACTED]')) replacement = '[REDACTED]';
      else if (fieldMask === 'phone' && /^[+0-9*(). \u00a0\u202f-]+$/u.test(value)) replacement = maskPhone(value);
      else if (fieldMask === 'email') {
        const email = emailMatches(value).next().value;
        replacement = email && email.start === 0 && email.end === value.length ? email.maskedDomain : maskText(value);
      } else replacement = maskText(value);
      yield { start: 0, end: value.length, replacement, mask: replacement !== '[REDACTED]' };
    }
    if (fieldMask) streams.push(maskedField());
    // Merge original-text matches as streams, so overlapping rules retain full
    // coverage without retaining a per-character match list for short custom rules.
    const candidates = streams.map(stream => stream.next().value as Span | undefined);
    const parts: string[] = [];
    let current: Span | undefined;
    let cursor = 0;
    const flush = () => {
      if (!current) return;
      parts.push(value.slice(cursor, current.start), current.replacement);
      cursor = current.end;
      if (value.slice(current.start, current.end) !== current.replacement) redactionCount += 1;
    };
    for (;;) {
      let selected = -1;
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (candidate && (selected === -1 || candidate.start < candidates[selected]!.start ||
          (candidate.start === candidates[selected]!.start && candidate.end > candidates[selected]!.end))) selected = index;
      }
      if (selected === -1) break;
      const span = candidates[selected]!;
      candidates[selected] = streams[selected]!.next().value as Span | undefined;
      if (current && (span.start < current.end || (span.start === current.end && !span.mask && !current.mask))) {
        // Full hiding wins over masking across the entire connected match range.
        if (current.mask && !span.mask) { current.replacement = span.replacement; current.mask = false; }
        current.end = Math.max(current.end, span.end);
      }
      else { flush(); current = span; }
    }
    if (!current) return value;
    flush();
    parts.push(value.slice(cursor));
    return parts.join('');
  };

  const redactFieldText = (value: string): string => {
    if (value !== '[REDACTED]') redactionCount += 1;
    return '[REDACTED]';
  };

  const redactNode = (node: SemanticNode, insideSensitiveField = false, insidePhoneField = false, insideMaskedField?: FieldMaskKind): SemanticNode => {
    const field = node.value !== undefined || FIELD_ROLES.has(node.role);
    const phoneField = insidePhoneField || (field && /\b(?:phone|telephone|tel|mobile|fax)\b/iu.test(node.name ?? ''));
    const sensitiveField = field &&
      ((enabled('sensitive-fields') && fieldNamePattern.test(node.name ?? '')) ||
        (enabled('personal-fields') && personalFieldMaskKind(node.name ?? '') !== undefined) ||
        customFieldPatterns.some(pattern => pattern.test(node.name ?? '')));
    const fieldMask = insideMaskedField === 'hide' ? 'hide'
      : (maskPersonalFields && field ? personalFieldMaskKind(node.name ?? '') : undefined) ?? insideMaskedField;
    const result: SemanticNode = {
      role: node.role,
      // AX trees may repeat a control value as text below generic wrappers.
      children: node.children.map((child) => redactNode(child, insideSensitiveField || sensitiveField, phoneField, fieldMask)),
    };
    if (node.id !== undefined) result.id = node.id;
    if (node.actionRef !== undefined) result.actionRef = node.actionRef;
    if (node.name !== undefined) result.name = insideSensitiveField ? redactFieldText(node.name) : redactText(node.name, insidePhoneField, insideMaskedField);
    if (node.value !== undefined) {
      if (sensitiveField || insideSensitiveField) {
        result.value = redactFieldText(node.value);
      } else {
        result.value = redactText(node.value, phoneField, fieldMask);
      }
    }
    if (node.level !== undefined) result.level = node.level;
    if (node.href !== undefined) result.href = insideSensitiveField ? redactFieldText(node.href) : redactText(node.href, false, insideMaskedField);
    if (node.states !== undefined) result.states = { ...node.states };
    return result;
  };

  const result: SemanticTree = {
    schemaVersion: tree.schemaVersion,
    root: redactNode(tree.root),
  };
  if (tree.title !== undefined) result.title = redactText(tree.title);
  if (tree.sourceUrl !== undefined) result.sourceUrl = redactText(tree.sourceUrl);
  if (tree.capturedAt !== undefined) result.capturedAt = tree.capturedAt;
  if (tree.browser !== undefined) result.browser = tree.browser;
  if (tree.selectedElementTag !== undefined) result.selectedElementTag = tree.selectedElementTag;

  return { tree: result, redactionCount };
}
