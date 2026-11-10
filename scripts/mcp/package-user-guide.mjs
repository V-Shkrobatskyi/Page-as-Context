// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function packageUserGuide(repo, integration) {
  const guide = await readFile(join(repo, 'integrations', integration, 'PACKAGE-README.md'), 'utf8');
  const source = 'https://github.com/V-Shkrobatskyi/Page-as-Context/blob/main';
  return guide.replaceAll('](../../docs/', `](${source}/docs/`)
    .replaceAll('](ACCEPTANCE.md)', `](${source}/integrations/${integration}/ACCEPTANCE.md)`);
}
