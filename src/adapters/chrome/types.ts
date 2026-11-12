// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

/**
 * Minimal Chromium DevTools Protocol-shaped input used by the future Chrome adapter.
 * It stays adapter-local so CDP identifiers and properties cannot leak into the core.
 */
export interface ChromeAxValue {
  relatedNodes?: { backendDOMNodeId: number }[];
  sources?: { type?: string; superseded?: boolean }[];
  type?: string;
  value?: string | number | boolean | null;
}

export interface ChromeAxProperty {
  name: string;
  value?: ChromeAxValue;
  description?: ChromeAxValue;
}

export interface ChromeAxNode {
  nodeId: string;
  childIds?: string[];
  frameId?: string;
  backendDOMNodeId?: number;
  parentId?: string;
  ignored?: boolean;
  ignoredReasons?: ChromeAxProperty[];
  role?: ChromeAxValue;
  name?: ChromeAxValue;
  value?: ChromeAxValue;
  description?: ChromeAxValue;
  properties?: ChromeAxProperty[];
}

export interface ChromeAxTreeResponse {
  nodes: ChromeAxNode[];
}
