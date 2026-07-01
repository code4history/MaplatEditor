import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const files = [
  'electron/ipc/mapedit.ts',
  'electron/services/WmtsGeneratorService.ts',
  'src/views/MapEdit.vue',
];

try {
  for (const file of files) {
    const source = await readFile(path.join(projectRoot, file), 'utf8');
    assert.doesNotMatch(
      source,
      /new\s+Tin\s*\(\s*\{\s*\}\s*\)/,
      `${file} must not instantiate Tin without explicit V2 mode`
    );
  }

  const mapeditIpc = await readFile(path.join(projectRoot, 'electron/ipc/mapedit.ts'), 'utf8');
  assert.match(
    mapeditIpc,
    /const\s+TIN_V2_OPTIONS\s*=\s*\{\s*useV2Algorithm\s*:\s*true\s*\}/,
    'mapedit IPC must define explicit V2 Tin options'
  );
  assert.match(
    mapeditIpc,
    /new\s+Tin\s*\(\s*TIN_V2_OPTIONS\s*\)/,
    'mapedit IPC TIN generation must use V2 Tin options'
  );

  const wmtsService = await readFile(path.join(projectRoot, 'electron/services/WmtsGeneratorService.ts'), 'utf8');
  assert.match(
    wmtsService,
    /new\s+Tin\s*\(\s*TIN_V2_OPTIONS\s*\)/,
    'WMTS generation must restore compiled TINs with V2 Tin options'
  );

  const mapEdit = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
  const rendererTinRestores = mapEdit.match(/new\s+Tin\s*\(\s*TIN_V2_OPTIONS\s*\)/g) ?? [];
  assert.ok(
    rendererTinRestores.length >= 2,
    'MapEdit renderer must restore both updateTin and imported compiled TINs with V2 Tin options'
  );
  assert.match(
    mapEdit,
    /tin\.getCompiled\s*\(\)/,
    'MapEdit save/export paths must still serialize through Tin.getCompiled()'
  );

  console.log('M4 TIN V2 mode smoke passed');
} catch (err) {
  console.error('M4 TIN V2 mode smoke FAILED:', err.message);
  process.exit(1);
}
