// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

/** A browser-independent state extracted from an accessible UI node. */
export interface NodeStates {
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  focusable?: boolean;
  readOnly?: boolean;
  focused?: boolean;
}

/** A normalized semantic node. It intentionally contains no browser/CDP details. */
export interface SemanticNode {
  /** Opaque, transient adapter reference. Never a selector or browser node ID. */
  actionRef?: string;
  /** Adapter-identified editable content, before compression. */
  editable?: boolean;
  id?: string;
  role: string;
  name?: string;
  value?: string;
  level?: number;
  href?: string;
  states?: NodeStates;
  children: SemanticNode[];
}

/** The versioned document-level representation consumed by transformations and serializers. */
export interface SemanticTree {
  schemaVersion: 1;
  /** Optional document title supplied by a browser adapter when it is safe to expose. */
  title?: string;
  /** Optional URL of the captured document. */
  sourceUrl?: string;
  /** Local capture time, formatted as YYYY.MM.DD HH:mm:ss. */
  capturedAt?: string;
  /** Browser name, platform and available version supplied by the extension runtime. */
  browser?: string;
  /** Tag of the block captured through the element picker; absent for full-page captures. */
  selectedElementTag?: string;
  root: SemanticNode;
}
