// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
/** Shared credential-label recognizer; isolated helpers must not import the full redaction engine. */
export const SENSITIVE_FIELD_NAME = /\b(?:password|passcode|secret|token|api[ _-]?key|authorization)\b/iu;
