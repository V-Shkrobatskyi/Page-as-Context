// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only

import { maskPhone } from './masking';
import { isEmailType } from './emails';

export { PERSONAL_FIELD_TERMS } from './personal-field-terms';
import { PERSONAL_FIELD_TERMS } from './personal-field-terms';
export const PERSONAL_DATA_TYPES = ['phoneNumbers', 'paymentCards', 'iban'] as const;
export type PersonalDataType = (typeof PERSONAL_DATA_TYPES)[number];
export function isAutomaticType(type: unknown): boolean {
  return type === 'personalFieldsHide' || type === 'phoneNumbersMask' || type === 'personalFieldsMask' || isEmailType(type) || PERSONAL_DATA_TYPES.some(id => id === type);
}

// Fixed national lengths from the SWIFT IBAN Registry, release 101 (December 2025).
// https://www.swift.com/sites/default/files/files/iban-registry-v101.pdf
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27,
  DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28,
  IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22,
  MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23,
  PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24,
  SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};
const WORD = /[\p{L}\p{N}_]/u;
const HORIZONTAL_SPACE = ' \\u00a0\\u202f';
const SPACE = `[${HORIZONTAL_SPACE}]`;
const CARD_CANDIDATE = new RegExp(`[0-9]+(?:[${HORIZONTAL_SPACE}-][0-9]+)*`, 'gu');
const PHONE_CANDIDATE = new RegExp(`(?:\\+|00)[1-9*][0-9*${HORIZONTAL_SPACE}().-]*[0-9*]|\\b(?:phone|telephone|tel|mobile|fax)(?:${SPACE}+(?:number|no\\.?))?${SPACE}*[:=]${SPACE}*(?:\\+|00)?\\(?[0-9*][0-9*${HORIZONTAL_SPACE}().-]*[0-9*]`, 'giu');

function validCard(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;
  let sum = 0;
  for (let index = digits.length - 1, double = false; index >= 0; index--, double = !double) {
    let digit = Number(digits[index]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

function validIban(iban: string): boolean {
  if (IBAN_LENGTHS[iban.slice(0, 2)] !== iban.length || Number(iban.slice(2, 4)) < 2 || Number(iban.slice(2, 4)) > 98) return false;
  let remainder = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const digits = /[A-Z]/u.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export type FieldMaskKind = 'text' | 'phone' | 'email' | 'hide';
const fieldMatchers = PERSONAL_FIELD_TERMS.split(' / ').map(term => ({ term, pattern: new RegExp(`\\b${term}\\b`, 'iu') }));
export function personalFieldMaskKind(label: string): FieldMaskKind | undefined {
  const matches = fieldMatchers.filter(({ pattern }) => pattern.test(label)).map(({ term }) => term);
  if (!matches.length) return undefined;
  if (matches.some(term => !['full name', 'first name', 'last name', 'email', 'phone', 'telephone', 'mobile', 'address'].includes(term))) return 'hide';
  if (matches.includes('email')) return 'email';
  if (matches.some(term => ['phone', 'telephone', 'mobile'].includes(term))) return 'phone';
  return 'text';
}

type Match = { start: number; end: number; replacement: string; mask?: boolean };
/** Format/checksum checks are local heuristics, not proof of an issued account or reachable number. */
export function* personalDataMatches(value: string, type: PersonalDataType, phoneField = false, mask = false): Generator<Match> {
  if (type === 'phoneNumbers' && phoneField) {
    for (const match of personalDataMatches('Phone: ' + value, type, false, mask)) {
      if (match.start >= 7) yield { ...match, start: match.start - 7, end: match.end - 7 };
    }
    return;
  }
  if (type === 'iban') {
    // Read only the country's expected length, so trailing prose cannot be swallowed.
    const starts = /[A-Z]{2}[0-9]{2}/giu;
    for (const match of value.matchAll(starts)) {
      const start = match.index;
      if (WORD.test(value[start - 1] ?? '')) continue;
      const length = IBAN_LENGTHS[match[0].slice(0, 2).toUpperCase()];
      if (!length) continue;
      let end = start; let iban = '';
      while (end < value.length && iban.length < length) {
        const char = value[end]!;
        if (/[A-Z0-9]/iu.test(char)) iban += char.toUpperCase();
        else if (!/[ \u00a0\u202f]/u.test(char) || end === start || /[ \u00a0\u202f]/u.test(value[end - 1]!)) break;
        end++;
      }
      if (WORD.test(value[end] ?? '') || !validIban(iban)) continue;
      yield { start, end, replacement: '[REDACTED]' };
    }
    return;
  }
  if (!/[0-9*]/u.test(value)) return;
  if (type === 'paymentCards') {
    // Consume the entire run before checking it: never hide a valid prefix of a longer ID.
    for (const match of value.matchAll(CARD_CANDIDATE)) {
      const start = match.index; const end = start + match[0].length;
      if (WORD.test(value[start - 1] ?? '') || WORD.test(value[end] ?? '') || !validCard(match[0].replace(/\D/gu, ''))) continue;
      yield { start, end, replacement: '[REDACTED]' };
    }
    return;
  }
  // International prefixes or explicit English labels avoid treating every numeric ID as a phone.
  for (const match of value.matchAll(PHONE_CANDIDATE)) {
    const label = /^(?:phone|telephone|tel|mobile|fax)(?:[ \u00a0\u202f]+(?:number|no\.?))?[ \u00a0\u202f]*[:=][ \u00a0\u202f]*/iu.exec(match[0])?.[0] ?? '';
    const start = match.index + label.length;
    const end = match.index + match[0].length;
    const candidate = value.slice(start, end);
    const digits = candidate.replace(/[^0-9*]/gu, '').replace(/^00/u, '');
    if (WORD.test(value[match.index - 1] ?? '') || /[\p{L}\p{N}_+]/u.test(value[end] ?? '') || digits.length < 8 || digits.length > 15) continue;
    // Reject malformed parentheses and date-shaped national values.
    if ((candidate.match(/\(/gu)?.length ?? 0) !== (candidate.match(/\)/gu)?.length ?? 0) || /\d{4}[-.]\d{2}[-.]\d{2}/u.test(candidate)) continue;
    yield { start, end, replacement: mask ? maskPhone(candidate) : '[REDACTED]', ...(mask ? { mask: true } : {}) };
  }
}
