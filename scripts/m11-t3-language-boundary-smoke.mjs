import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource(relativeEntry, fileName) {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm11-t3-language-'));
  const outDir = path.join(workDir, 'dist');
  try {
    await build({
      root: projectRoot,
      logLevel: 'error',
      configFile: false,
      build: {
        outDir,
        emptyOutDir: true,
        lib: {
          entry: path.join(projectRoot, relativeEntry),
          formats: ['es'],
          fileName: () => fileName,
        },
      },
    });
    return await import(`${pathToFileURL(path.join(outDir, fileName)).href}?t=${Date.now()}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const { isTranslationMode } = await importSource(
  'src/utils/editorLanguageMode.ts',
  'editorLanguageMode.mjs',
);
assert.equal(isTranslationMode('ja', 'ja'), false);
assert.equal(isTranslationMode('en', 'ja'), true);
assert.equal(isTranslationMode('en-US', 'en-US'), false);
assert.equal(isTranslationMode('', 'ja'), false);
assert.equal(isTranslationMode('en', ''), false);

const mapEdit = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
assert.match(mapEdit, /const label = createLangComputed\(['"]label['"]\)/);
assert.match(mapEdit, /data-testid="map-label"[^>]*v-model="label"/);
assert.match(mapEdit, /data-testid="map-slug"[^>]*:disabled="translationMode"/);
assert.match(mapEdit, /data-editor-document-language[^>]*:disabled="translationMode"/);
assert.match(mapEdit, /@click="mapUpload"[^>]*:disabled="translationMode"/);

console.log('M11-T3 language-boundary smoke checks passed.');
