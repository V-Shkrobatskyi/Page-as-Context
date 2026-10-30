// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

/**
 * Minimal Chrome extension API surface used by this project. Keeping it local
 * avoids a broad ambient dependency while preserving strict types at the browser
 * boundary. Add only APIs that production code actually calls.
 */
interface ChromeTab {
  id?: number;
  title?: string;
  url?: string;
}

interface ChromeApi {
  runtime: {
    lastError: { message?: string } | undefined;
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    sendMessage(message: unknown): Promise<unknown>;
    getURL(path: string): string;
  };
  debugger: {
    getTargets(): Promise<Array<{ type: string; tabId?: number; url: string; title: string }>>;
    attach(target: { tabId: number }, requiredVersion: string, callback: () => void): void;
    sendCommand(
      target: { tabId: number; sessionId?: string },
      method: string,
      params: Record<string, unknown>,
      callback: (result: unknown) => void,
    ): void;
    detach(target: { tabId: number }, callback: () => void): void;
    onEvent: {
      addListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params: unknown) => void): void;
      removeListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params: unknown) => void): void;
    };
    onDetach: {
      addListener(listener: (source: { tabId?: number }, reason: string) => void): void;
      removeListener(listener: (source: { tabId?: number }, reason: string) => void): void;
    };
  };
  tabs: {
    query(queryInfo: { active: boolean; lastFocusedWindow: boolean }): Promise<ChromeTab[]>;
  };
  downloads: {
    download(options: { url: string; filename: string; saveAs: boolean }): Promise<number>;
  };
  storage: {
    local: {
      get(keys: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

declare const chrome: ChromeApi;
