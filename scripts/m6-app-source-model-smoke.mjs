import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'app-source-model-'));
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
        entry: path.join(projectRoot, 'src/utils/appSourceModel.ts'),
        formats: ['es'],
        fileName: () => 'appSourceModel.mjs',
      },
      rollupOptions: { external: [] },
    },
  });

  const mod = await import(pathToFileURL(path.join(outDir, 'appSourceModel.mjs')).href);
  const {
    normalizeAppSource,
    composeViewerSource,
    bboxToEnvelope,
    envelopeToBbox,
    isViewerBuiltin,
  } = mod;

  // 1. 文字列ビルトイン → builtin → 文字列出力
  const builtin = normalizeAppSource('osm');
  assert.equal(builtin.sourceType, 'builtin');
  assert.equal(composeViewerSource(builtin), 'osm');
  assert.ok(isViewerBuiltin('gsi_ortho'));
  assert.ok(!isViewerBuiltin('gsi_ort_USA10'));

  // 2. 旧AppEdit形式のビルトイン（objectでalways混入） → 文字列出力
  const legacyBuiltin = normalizeAppSource({
    sourceType: 'base-map',
    mapID: 'gsi',
    role: 'base',
    data: { mapID: 'gsi', title: '地理院地図', always: true },
  });
  assert.equal(legacyBuiltin.sourceType, 'builtin');
  assert.equal(composeViewerSource(legacyBuiltin), 'gsi');

  // 3. tms overlay: snake_case正規化 + Editor専用キー除去 + maptype出力
  const overlay = normalizeAppSource({
    sourceType: 'base-map',
    mapID: 'kanto_rapid-900913',
    role: 'overlay',
    label: { ja: '迅速測図' },
    data: {
      url: 'https://example.test/{z}/{x}/{y}.jpg',
      maxZoom: 17,
      envelopLngLats: [[139, 36], [140, 36], [140, 36.5], [139, 36.5]],
      always: true,
      scope: 'user',
    },
  });
  assert.equal(overlay.sourceType, 'tms');
  assert.equal(overlay.role, 'overlay');
  assert.ok(overlay.data.envelopeLngLats);
  assert.equal(overlay.data.envelopLngLats, undefined);
  assert.equal(overlay.data.always, undefined);
  const composedOverlay = composeViewerSource(overlay);
  assert.equal(composedOverlay.maptype, 'overlay');
  assert.equal(composedOverlay.mapID, 'kanto_rapid-900913');
  assert.deepEqual(composedOverlay.label, { ja: '迅速測図' });
  assert.equal(composedOverlay.always, undefined);
  assert.equal(composedOverlay.sourceType, undefined);
  assert.equal(composedOverlay.role, undefined);
  assert.equal(composedOverlay.startFrom, undefined);

  // 4. maplat: label最小出力 + settingFilePrefix
  const maplat = normalizeAppSource({
    sourceType: 'maplat',
    mapID: 'naramachi_yasui_bunko',
    label: { ja: '享保頃', en: '173X', de: '' },
    data: { compiled: { wh: [100, 100] }, gcps: [] },
  });
  assert.equal(maplat.sourceType, 'maplat');
  const composedMaplat = composeViewerSource(maplat);
  assert.deepEqual(Object.keys(composedMaplat).sort(), ['label', 'mapID']);
  assert.deepEqual(composedMaplat.label, { ja: '享保頃', en: '173X' });
  const composedPreview = composeViewerSource(maplat, { settingFilePrefix: 'maps/' });
  assert.equal(composedPreview.settingFile, 'maps/naramachi_yasui_bunko.json');
  assert.equal(composedPreview.maptype, 'maplat');

  // 5. bbox ⇄ envelope
  assert.deepEqual(bboxToEnvelope([139, 35, 140, 36]), [
    [139, 35],
    [140, 35],
    [140, 36],
    [139, 36],
  ]);
  assert.deepEqual(envelopeToBbox([[139, 35], [140, 35], [140, 36], [139, 36]]), [139, 35, 140, 36]);
  assert.equal(envelopeToBbox(null), null);
  assert.equal(envelopeToBbox([]), null);

  // 6. レガシーアプリJSONの文字列 (非builtin) はtms扱いで壊れない
  const unknownString = normalizeAppSource('mapbox');
  assert.equal(unknownString.sourceType, 'tms');

  console.log('m6-app-source-model smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
