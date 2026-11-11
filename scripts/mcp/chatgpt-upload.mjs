// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readdir, lstat, unlink, rmdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Retain runtime JS, JSON, package metadata and licenses. Remove development-only
// files from production dependency tarballs, without changing dependency versions.
export async function compactChatgptPackage(plugin) {
  const node = join(plugin, 'runtime/node');
  const hash = async () => createHash('sha256').update(await readFile(node)).digest('hex');
  const upstreamExecutableSha256 = await hash();
  execFileSync('/usr/bin/strip', ['-S', '-x', node], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', node], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', node], { stdio: 'pipe' });
  if (execFileSync(node, ['--version'], { encoding: 'utf8' }).trim() !== 'v24.10.0') throw new Error('Packaged runtime version mismatch.');
  const modules = join(plugin, 'helper/node_modules');
  let removedFiles = 0;
  async function prune(root, parts = []) {
    for (const name of await readdir(root)) {
      const path = join(root, name), relative = [...parts, name], info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Package symlinks are forbidden.');
      if (info.isDirectory()) {
        await prune(path, relative);
        if (!(await readdir(path)).length) await rmdir(path);
      } else if (name.endsWith('.map') || /\.d\.(?:ts|cts|mts)$/u.test(name) ||
        relative.some(part => ['test', 'tests', '__tests__', '__snapshots__'].includes(part)) ||
        relative[0] === 'zod' && relative[1] === 'src') {
        await unlink(path); removedFiles++;
      }
    }
  }
  await prune(modules);
  return { upstreamExecutableSha256, executableSha256: await hash(),
    transformation: 'strip -S -x; ad-hoc codesign; codesign --verify --strict', removedDevelopmentFiles: removedFiles };
}
