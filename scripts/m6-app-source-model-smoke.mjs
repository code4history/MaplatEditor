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
    hasViewerBasemapSource,
    isViewerBuiltin,
    createBaseMapMasterLookup,
  } = mod;

  // m6-t10 (ADR-0017/0018): 出力はマスタ参照＋上書き差分になったため、compose にはマスタ解決器が要る。
  // 本 smoke はモデルの契約を見るものなので、最小限のマスタだけを置く。
  const lookup = createBaseMapMasterLookup([
    { uid: 'uid-osm', mapID: 'osm', data: { mapID: 'osm', lang: 'en', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19 } },
    { uid: 'uid-gsi', mapID: 'gsi', data: { mapID: 'gsi', lang: 'ja', title: '地理院地図', url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png' } },
    { uid: 'uid-kanto', mapID: 'kanto_rapid-900913', data: { mapID: 'kanto_rapid-900913', lang: 'ja', url: 'https://example.test/{z}/{x}/{y}.jpg', maxZoom: 17 } },
  ]);

  // 1. 文字列ビルトイン → builtin。m6-t10: 出力は文字列ではなく設定ファイル参照（ADR-0017）
  const builtin = normalizeAppSource('osm');
  assert.equal(builtin.sourceType, 'builtin');
  assert.deepEqual(composeViewerSource(builtin, { lookup }), {
    mapID: 'osm', settingFile: 'maps/osm.json',
  });
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
  assert.deepEqual(composeViewerSource(legacyBuiltin, { lookup }), {
    mapID: 'gsi', settingFile: 'maps/gsi.json',
  });

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
  // builtin/tmsソースは登録地図ではなく埋め込みコピー(Inherited Source Defaults)なので、
  // mapUidフィールドにはビルトインID/TMS地図IDをそのまま保持する(uid解決対象外)
  assert.equal(overlay.mapUid, 'kanto_rapid-900913');
  // m6-t10: 旧形の全コピーは legacyData として温存され、resolveAppSource が overrides へ翻訳する
  assert.ok(overlay.legacyData.envelopeLngLats, 'snake_case 正規化は legacyData の時点で効く');
  assert.equal(overlay.legacyData.envelopLngLats, undefined);
  assert.equal(overlay.legacyData.always, undefined, 'Editor 専用キーは除去される');
  const composedOverlay = composeViewerSource(overlay, { lookup });
  // maptype は出さない（source_ex.ts:126 が先に成立して settingFile が読まれなくなるため）。
  // overlay であることは設定ファイル側の maptype で表現する（§3.5.1）
  assert.equal(composedOverlay.maptype, undefined, 'm6-t10: アプリ JSON に maptype を出さない');
  assert.equal(composedOverlay.mapID, 'kanto_rapid-900913');
  assert.equal(composedOverlay.settingFile, 'maps/kanto_rapid-900913.json');
  assert.deepEqual(composedOverlay.label, { ja: '迅速測図' });
  assert.equal(composedOverlay.always, undefined);
  assert.equal(composedOverlay.sourceType, undefined);
  assert.equal(composedOverlay.role, undefined);
  assert.equal(composedOverlay.startFrom, undefined);
  assert.equal(composedOverlay.url, undefined, 'm6-t10: マスタ由来値はアプリ JSON に出さない');

  // 4. maplat(旧保存形 mapID=slug): mapUidへ受容 + label最小出力 + settingFilePrefix
  const maplat = normalizeAppSource({
    sourceType: 'maplat',
    mapID: 'naramachi_yasui_bunko',
    label: { ja: '享保頃', en: '173X', de: '' },
    data: { compiled: { wh: [100, 100] }, gcps: [] },
  });
  assert.equal(maplat.sourceType, 'maplat');
  assert.equal(maplat.mapUid, 'naramachi_yasui_bunko');
  const composedMaplat = composeViewerSource(maplat);
  assert.deepEqual(Object.keys(composedMaplat).sort(), ['label', 'mapID']);
  assert.deepEqual(composedMaplat.label, { ja: '享保頃', en: '173X' });
  const composedPreview = composeViewerSource(maplat, { settingFilePrefix: 'maps/' });
  assert.equal(composedPreview.settingFile, 'maps/naramachi_yasui_bunko.json');
  assert.equal(composedPreview.maptype, 'maplat');

  // 4b. maplat(新形 mapUid=uid参照): Viewer出力は解決済みslug(maplatMapID)で書かれる (ADR-0007)
  const maplatByUid = normalizeAppSource({
    sourceType: 'maplat',
    mapUid: '9b2b6f6e-3c1d-4e5a-8f00-1234567890ab',
    mapSlug: 'naramachi_yasui_bunko',
    label: { ja: '享保頃' },
    startFrom: true,
  });
  assert.equal(maplatByUid.mapUid, '9b2b6f6e-3c1d-4e5a-8f00-1234567890ab');
  assert.equal(maplatByUid.mapSlug, 'naramachi_yasui_bunko');
  const composedByUid = composeViewerSource(maplatByUid, {
    settingFilePrefix: 'maps/',
    maplatMapID: 'naramachi_yasui_bunko',
  });
  assert.equal(composedByUid.mapID, 'naramachi_yasui_bunko');
  assert.equal(composedByUid.settingFile, 'maps/naramachi_yasui_bunko.json');
  // 内部参照キー(mapUid/mapSlug)はViewer出力に漏れない
  assert.equal(composedByUid.mapUid, undefined);
  assert.equal(composedByUid.mapSlug, undefined);
  assert.equal(hasViewerBasemapSource([maplatByUid]), false);

  // 4c. slug衝突で suffix された viewer builtin は builtinId で素の文字列に戻す。
  // これを tms/base として出力すると Viewer が tiles/{slug}/... のローカルタイルを探し、
  // 初期表示だけで存在しないタイル要求が大量発生する。
  const suffixedBuiltin = normalizeAppSource({
    sourceType: 'base-map',
    mapID: 'osm_2',
    data: { mapID: 'osm_2', builtinId: 'osm', always: true },
  });
  assert.equal(suffixedBuiltin.sourceType, 'builtin');
  assert.equal(suffixedBuiltin.mapUid, 'osm');
  assert.deepEqual(composeViewerSource(suffixedBuiltin, { lookup }), {
    mapID: 'osm', settingFile: 'maps/osm.json',
  });
  assert.equal(hasViewerBasemapSource([suffixedBuiltin, maplatByUid]), true);

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

  const englishLegacyLabel = normalizeAppSource({
    mapID: 'english_tiles',
    maptype: 'base',
    label: 'English tiles',
    url: 'https://example.com/{z}/{x}/{y}.png',
  }, 'en');
  assert.deepEqual(englishLegacyLabel.label, { en: 'English tiles' });

  console.log('m6-app-source-model smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
