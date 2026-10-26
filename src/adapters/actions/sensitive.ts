// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { SENSITIVE_FIELD_NAME } from '../../core/privacy/sensitive-fields';
import { PERSONAL_FIELD_TERMS } from '../../core/privacy/personal-field-terms';
// Canonical credential and sensitive personal-field vocabulary, never supplied by tools.
export const ACTION_SENSITIVE_PATTERN = `${SENSITIVE_FIELD_NAME.source}|${PERSONAL_FIELD_TERMS.split(' / ').filter(term => !['full name', 'first name', 'last name', 'email', 'phone', 'telephone', 'mobile', 'address'].includes(term)).map(term => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')}`;
