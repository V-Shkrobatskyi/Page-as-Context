// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { hfsLauncher } from '@/src/mcp/launchers';

it.each([['mac', 'Start HFS.command', true], ['linux', 'start-hfs.sh', true], ['win', 'Start HFS.cmd', false]] as const)('selects the %s launcher and permission guidance', (os, filename, needsExecutePermission) => {
  expect(hfsLauncher(os)).toMatchObject({ filename, needsExecutePermission });
});
it.each(['android', 'cros', 'openbsd', 'unknown'])('never substitutes another OS launcher for %s', os => {
  expect(hfsLauncher(os)).toBeUndefined();
});
it.skipIf(process.platform === 'win32').each(['mac', 'linux'])('runs the %s script from its own folder, preserving quoted paths and refusing missing inputs', os => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'HFS test $ & ')));
  try {
    const launcher = hfsLauncher(os)!;
    const script = join(folder, launcher.filename), binary = join(folder, 'hfs'), config = join(folder, 'config.yaml'), argsFile = join(folder, 'args.bin');
    writeFileSync(script, launcher.content);
    expect(spawnSync('/bin/sh', ['-n', script]).status).toBe(0);
    writeFileSync(binary, '#!/bin/sh\nprintf "%s\\000" "$@" > "$PAC_HFS_TEST_ARGS"\n'); chmodSync(binary, 0o700);
    writeFileSync(config, 'synthetic: true\n');
    const run = () => spawnSync('/bin/sh', [script], { cwd: '/', env: { ...process.env, PAC_HFS_TEST_ARGS: argsFile }, input: '', encoding: 'utf8' });
    expect(run().status).toBe(0);
    expect(readFileSync(argsFile, 'utf8').split('\0').slice(0, -1)).toEqual(['--cwd', folder, '--no-central']);
    unlinkSync(argsFile); unlinkSync(config);
    expect(run().stdout).toContain('Missing or empty config.yaml');
    expect(existsSync(argsFile)).toBe(false);
    writeFileSync(config, ''); expect(run().status).toBe(1);
    writeFileSync(config, 'synthetic: true\n'); chmodSync(binary, 0o600);
    expect(run().stdout).toContain('not executable');
    expect(existsSync(argsFile)).toBe(false);
    unlinkSync(binary); expect(run().stdout).toContain('Missing hfs.');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
it('uses CRLF and avoids a trailing backslash before the quoted Windows cwd argument', () => {
  const launcher = hfsLauncher('win')!;
  expect(launcher.content).not.toMatch(/(?<!\r)\n/u);
  expect(launcher.content).toContain('setlocal DisableDelayedExpansion\r\n');
  expect(launcher.content).toContain('"%~dp0hfs.exe" --cwd "%~dp0." --no-central\r\n');
});
