// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return { listeners, addListener: (fn: (value: T) => void) => listeners.add(fn),
    removeListener: (fn: (value: T) => void) => listeners.delete(fn),
    emit: (value: T) => { for (const fn of [...listeners]) fn(value); } };
}
const managedGet = vi.fn();
let changed: ReturnType<typeof event<any>>;
let erased: ReturnType<typeof event<number>>;
let download: ReturnType<typeof vi.fn>;
let search: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.spyOn>;
let owner: EventTarget;
beforeEach(() => {
  managedGet.mockReset().mockResolvedValue({});
  changed = event(); erased = event();
  download = vi.fn().mockResolvedValue(12);
  search = vi.fn().mockResolvedValue([{ state: 'in_progress' }]);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  owner = new EventTarget(); vi.stubGlobal('window', owner);
  vi.doMock('wxt/browser', () => ({ browser: { storage: { managed: { get: managedGet } }, downloads: { download, search, onChanged: changed, onErased: erased } } }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });
async function start(signal?: AbortSignal) {
  const { saveContextFile } = await import('@/src/save-context');
  const task = saveContextFile('Synthetic export', 'semantic-text', signal);
  void task.catch(() => {});
  for (let index = 0; index < 8; index++) await Promise.resolve();
  return { task };
}
function cleaned() {
  expect(changed.listeners.size).toBe(0); expect(erased.listeners.size).toBe(0);
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test');
}

it('returns the download ID for reveal only after a successful save', async () => {
  search.mockResolvedValue([{ state: 'complete' }]);
  const { downloadBlob } = await import('@/src/save-context');
  await expect(downloadBlob(new Blob(['synthetic config']), 'config.yaml')).resolves.toBe(12);
  expect(download).toHaveBeenCalledWith({ url: 'blob:test', filename: 'config.yaml', saveAs: true });
  cleaned();
});

it.each(['complete', 'interrupted', 'erased'] as const)('finishes and releases resources after %s', async state => {
  const { task } = await start();
  if (state === 'erased') erased.emit(12);
  else changed.emit({ id: 12, state: { current: state } });
  if (state === 'complete') await expect(task).resolves.toBeUndefined();
  else await expect(task).rejects.toThrow(state === 'erased' ? 'download-erased' : 'download-interrupted');
  cleaned();
});

it('ignores other transfers and detects completion that preceded listener attachment', async () => {
  search.mockResolvedValue([{ state: 'complete' }]);
  const { task } = await start();
  erased.emit(99); changed.emit({ id: 99, state: { current: 'interrupted' } });
  await task; cleaned();
});

it('rejects an item erased before the initial history check', async () => {
  search.mockResolvedValue([]);
  const { task } = await start();
  await expect(task).rejects.toThrow('download-unavailable'); cleaned();
});

it.each(['signal', 'pagehide'] as const)('releases a pending transfer on %s', async reason => {
  const controller = new AbortController();
  const { task } = await start(controller.signal);
  if (reason === 'signal') controller.abort(); else owner.dispatchEvent(new Event('pagehide'));
  await expect(task).rejects.toThrow('download-cancelled'); cleaned();
});

it('cancels while the browser dialog is pending, without leaving listeners or a blob', async () => {
  let finish!: (id: number) => void;
  download.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const { task } = await start(controller.signal);
  controller.abort(); await expect(task).rejects.toThrow('download-cancelled');
  finish(12); await Promise.resolve(); cleaned();
  expect(search).not.toHaveBeenCalled();
});

it('does not initiate a download for an already cancelled operation', async () => {
  const controller = new AbortController(); controller.abort();
  const { task } = await start(controller.signal);
  await expect(task).rejects.toThrow('download-cancelled');
  expect(download).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});


it('blocks corporate file restrictions before creating a blob or starting a download', async () => {
  managedGet.mockResolvedValue({ FileExportAllowed: false });
  const { task } = await start();
  await expect(task).rejects.toThrow('File export is disabled');
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
});
it('rejects stale prepared contexts and mismatched formats at the final download boundary', async () => {
  managedGet.mockResolvedValue({ RedactionMode: 'force-on', AllowedExportFormats: ['markdown'] });
  const { readPolicy } = await import('@/src/policy/runtime');
  const { saveContextFile } = await import('@/src/save-context');
  const snapshot = await readPolicy();
  const context = { policyRevision: snapshot.revision, format: 'markdown', compression: 'compact', redactSensitiveData: true } as const;
  await expect(saveContextFile('Synthetic', 'semantic-text', undefined, context)).rejects.toThrow('does not match');
  managedGet.mockResolvedValue({ RedactionMode: 'force-on', FileExportAllowed: true });
  await expect(saveContextFile('Synthetic', 'markdown', undefined, context)).rejects.toThrow('changed');
  expect(download).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});


it.each([new Error('USER_CANCELED'), new Error('Download canceled by the user'), { message: 'Download canceled by the user' }])('recognizes Save As rejection as cancellation: %j', async error => {
  download.mockRejectedValue(error);
  const { task } = await start();
  const { DownloadCancelledError } = await import('@/src/download-errors');
  await expect(task).rejects.toBeInstanceOf(DownloadCancelledError);
  expect(search).not.toHaveBeenCalled(); cleaned();
});

it.each(['event', 'search'] as const)('recognizes USER_CANCELED from the download %s and releases resources', async source => {
  if (source === 'search') search.mockResolvedValue([{ state: 'interrupted', error: 'USER_CANCELED' }]);
  const { task } = await start();
  if (source === 'event') changed.emit({ id: 12, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
  const { DownloadCancelledError } = await import('@/src/download-errors');
  await expect(task).rejects.toBeInstanceOf(DownloadCancelledError); cleaned();
});

it('keeps real download failures distinct from cancellation', async () => {
  const error = new Error('FILE_ACCESS_DENIED'); download.mockRejectedValue(error);
  const { task } = await start();
  await expect(task).rejects.toBe(error); cleaned();
});
