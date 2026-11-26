import assert from 'node:assert/strict';
import Tin from '@maplat/tin';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  crsToLonLat, crsToMercator, mercatorToCrs, lonLatToCrs, geodesicDistanceMeters,
  reprojectLayerCoords, validateRoundtrip, csvGeoCoordToTarget,
} from '../src/utils/crsProjection.ts';
import { prepareCrsAdoption } from '../src/utils/crsAdoption.ts';
import { buildEditorLayerTin } from '../src/services/editorComputeBackend.ts';
import { updateTin } from '../src/workers/tinComputeWorker.ts';
import { useLayerTransformState } from '../src/composables/useLayerTransformState.ts';
import { deriveIntentFromStoredLayer, deriveLayerBuildOptions, transformLayerFromDocument, seedCompiledTin } from '../src/utils/layerTransformIntent.ts';
import { compiledGeoJsonToMercator } from '../src/utils/compiledGeo.ts';
import { WorldFileSurface } from '@maplat/transform';
import { projectionEngineForCrs } from '../src/utils/compiledGeo.ts';

const planeVi = {
  epsg: 6674, authority: 'EPSG', code: '6674',
  proj4: '+proj=tmerc +lat_0=36 +lon_0=136 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs',
};
const feet = {
  authority: 'TEST', code: 'FEET',
  proj4: '+proj=tmerc +lat_0=36 +lon_0=136 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs',
};
const worldFile = { xScale: 2.5, xSkew: 0.25, xOrigin: 500, ySkew: -0.125, yScale: -3, yOrigin: 800 };
const gcps = [
  [[10, 20], crsToMercator([136, 36])],
  [[110, 20], crsToMercator([136.01, 36])],
  [[10, 120], crsToMercator([136, 36.01])],
  [[110, 120], crsToMercator([136.01, 36.01])],
];
const edges = [[[[50, 20]], [crsToMercator([136.005, 36])], [0, 1]]];

// Critical 1 の表と独立 6 項目を同じ smoke の一部として実行する。
await import('./layer-transform-state-smoke.mjs');

test('Karney の既知距離と 1.0 m / 超過の判定', () => {
  assert.ok(Math.abs(geodesicDistanceMeters([-73.8, 40.6], [2.55, 49.01666667]) - 5853226) < 0.5);
  const original = [135, 35];
  const allowed = lonLatToCrs([135.000009, 35], planeVi);
  assert.ok(validateRoundtrip(original, allowed, planeVi, { kind: 'gcp', index: 0 }) < 1);
  const exceeded = lonLatToCrs([135.00002, 35], planeVi);
  assert.throws(
    () => validateRoundtrip(original, exceeded, planeVi, { kind: 'gcp', index: 0 }),
    (error) => error.code === 'roundtrip_exceeded' && error.distanceMeters > 1,
  );
});

for (const [name, target] of [['EPSG:4326', { epsg: 4326 }], ['EPSG:6674', planeVi], ['US survey feet', feet]]) {
  test(`${name} へ GCP と必須エッジの中継点を原状非破壊で変換する`, () => {
    const before = structuredClone({ gcps, edges });
    const converted = reprojectLayerCoords(gcps, edges, undefined, target);
    assert.notEqual(converted.gcps, gcps);
    assert.notEqual(converted.edges, edges);
    assert.deepEqual({ gcps, edges }, before);
    assert.ok(converted.maxRoundtripMeters <= 1);
    for (const [index, gcp] of converted.gcps.entries()) {
      const original = crsToLonLat(gcps[index][1]);
      assert.ok(geodesicDistanceMeters(original, crsToLonLat(gcp[1], target)) <= 1);
    }
    const midpoint = converted.edges[0][1][0];
    assert.ok(geodesicDistanceMeters(crsToLonLat(edges[0][1][0]), crsToLonLat(midpoint, target)) <= 1);
  });
}

test('中継点 1 点だけの失敗でも入力を 1 バイトも変えず拒否する', () => {
  const broken = structuredClone(edges);
  broken[0][1][0][0] = Number.NaN;
  const before = structuredClone({ gcps, edges: broken });
  assert.throws(() => reprojectLayerCoords(gcps, broken, undefined, planeVi),
    (error) => error.code === 'transform_failed' && error.location.kind === 'edge' && error.location.nodeIndex === 0);
  assert.deepEqual({ gcps, edges: broken }, before);
});

test('採用準備は換算済み WF を再換算せず、候補と同じ点列を使う', async () => {
  const converted = reprojectLayerCoords(gcps, edges, undefined, planeVi);
  const selected = {
    crs: planeVi, worldFile, coreCompatible: true,
    gcpsNew: converted.gcps.map((gcp) => ({ pixel: gcp[0], geo: gcp[1] })),
  };
  const layer = {
    layerId: 'main', intent: { setup: 'legacyV2' },
    buildOptions: { strictMode: 'strict', vertexMode: 'plain', yaxisMode: 'invert' }, gcps, edges,
  };
  for (const setup of ['A', 'B', 'C']) {
    const prepared = await prepareCrsAdoption(layer, { selected, setup }, new AbortController().signal);
    assert.deepEqual(prepared.intent.crs, planeVi);
    if (setup === 'C') assert.equal('worldFile' in prepared.intent, false);
    else assert.deepEqual(prepared.intent.worldFile, worldFile);
    assert.deepEqual(prepared.gcps, converted.gcps);
    assert.deepEqual(prepared.edges, converted.edges);
  }
  const stale = structuredClone(selected);
  stale.gcpsNew[0].geo = lonLatToCrs([140, 40], planeVi);
  await assert.rejects(prepareCrsAdoption(layer, { selected: stale, setup: 'B' }, new AbortController().signal),
    (error) => error.code === 'reference_mismatch');
});

test('保存形から A/B/C・三つの生成設定を復元し降格保存は C になる', () => {
  const crs = planeVi;
  assert.deepEqual(deriveIntentFromStoredLayer({ tinEnabled: false, crs, worldFile }),
    { setup: 'A', crs, worldFile });
  assert.deepEqual(deriveIntentFromStoredLayer({ crs }, { outerTransform: 'worldFile', worldFile }),
    { setup: 'B', crs, worldFile });
  assert.deepEqual(deriveIntentFromStoredLayer({ crs }, { outerTransform: 'extrapolate' }),
    { setup: 'C', crs });
  assert.deepEqual(deriveIntentFromStoredLayer({}, { outerTransform: 'worldFile', worldFile }), { setup: 'legacyV2' });
  assert.deepEqual(deriveLayerBuildOptions({}, { strictMode: 'loose', vertexMode: 'birdeye', yaxisMode: 'follow' }),
    { strictMode: 'loose', vertexMode: 'birdeye', yaxisMode: 'follow' });
});

test('CSV は入力 CRS から WGS84 を経て主図・副層の target CRS へ変換する', () => {
  const raw = [136.01, 36.01];
  for (const target of [undefined, { epsg: 4326 }, planeVi, feet]) {
    const actual = csvGeoCoordToTarget(raw, target, (point) => point);
    const expected = lonLatToCrs(raw, target);
    assert.deepEqual(actual, expected);
  }
  assert.throws(() => csvGeoCoordToTarget(raw, planeVi, () => [Number.NaN, 33]), /invalid source CRS/);
});

test('Plan A のホーム用 WorldFileSurface は主図と副層で順逆変換できる', () => {
  for (const dimensions of [{ wh: [256, 256] }, { bounds: [[0, 0], [256, 0], [256, 256], [0, 256]] }]) {
    const surface = new WorldFileSurface({
      crs: planeVi, worldFile, projectionEngine: projectionEngineForCrs(planeVi), ...dimensions,
    });
    const mercator = surface.transform([30, 40], false);
    assert.notEqual(mercator, false);
    const xy = surface.transform(mercator, true);
    assert.ok(Math.hypot(xy[0] - 30, xy[1] - 40) < 1e-8);
  }
});

test('主図・副層の YAXIS_FOLLOW を共通 helper で戻して描画・ジャンプする', () => {
  const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [1000, -2000] }, properties: {} };
  const converted = compiledGeoJsonToMercator(feature, 'follow', planeVi);
  assert.notEqual(converted, false);
  const roundtrip = mercatorToCrs(converted.geometry.coordinates, planeVi);
  assert.ok(Math.hypot(roundtrip[0] - 1000, roundtrip[1] - 2000) < 1e-6);
});

test('MapEdit の採用中拒否・世代照合・保存と CSV/ホーム経路が接続されている', async () => {
  const source = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /StoredOuterTin/);
  for (const field of ['layerIds', 'layerTransformIntents', 'layerBuildOptions']) assert.match(source, new RegExp(field));
  for (const fn of ['restoreHistoryNavigation', 'onMainProcessMessage', 'saveMap', 'saveMapAfterConfirm', 'uploadCsv', 'addSubMap', 'removeSubMap']) {
    const body = source.match(new RegExp(`(?:const|async function) ${fn}[\\s\\S]*?\\n\\};`))?.[0] ?? '';
    assert.match(body, /documentEditsBlocked/, `${fn} の入口に採用中の拒否が必要`);
  }
  assert.match(source, /const documentEditsBlocked = computed\(\(\) => adoptionInProgress\.value \|\| saveWriting\.value \|\| historyRestoring\.value\)/);
  assert.match(source, /withoutHistoryAsync:\s*\(apply\)\s*=>\s*withoutHistoryAsync\('adopt-crs', \(\) => \{\s*apply\(\)/);
  // CSV の変換先 CRS は設定オブジェクトへ混ぜず、別の引数で main まで運ぶ
  assert.match(source, /uploadCsv\(\s*t\('dataio\.csv_file'\),\s*JSON\.parse\(JSON\.stringify\(csvUploadUiValue\.value\)\),\s*(?:\/\/[^\n]*\n\s*)?cloneDeep\(activeLayerCrs\.value\),?\s*\)/);
  const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
  assert.match(preload, /uploadCsv: \(csvRepl: string, csvUpSettings: any, targetCrs\?: unknown\) =>\s*ipcRenderer\.invoke\('mapedit:uploadCsv', csvRepl, csvUpSettings, targetCrs\)/);
  assert.doesNotMatch(preload, /csvUpSettings\.targetCrs/);
  assert.match(source, /const enableSetHomeIllst[\s\S]*?worldFileSurfaceAt\(0\)/);
  assert.match(source, /const tinResultUpdate[\s\S]*?compiledGeoJsonToMercator/);
  assert.match(source, /const viewError[\s\S]*?compiledGeoJsonToMercator/);
});

test('新版の層モデルで読み込みを種付けし、生成を待たずに履歴を復元する', async () => {
  const source = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  assert.match(source, /createLayerTransformState\(snapshot, seedTinObjects\(snapshot, tins\)\)/);
  assert.equal(Array.from(source.matchAll(/initializeLayerTransformState\(/g)).length, 4);
  assert.match(source, /if \(!result\.restored\) return/);
  assert.doesNotMatch(source, /await (?:layerTransformState(?:\.value)?\.(?:undo|redo|restoreDraft)\(|result\.settled)/);
  assert.match(source, /\.editLayers\(/);
  assert.match(source, /\.editLayer\('main', \{ bounds: \[arg\.width, arg\.height\] \}\)/);
  assert.doesNotMatch(source, /watch\(\[gcps, edges|watch\(strictMode|watch\(vertexMode/);
});

test('採用時に ENU の軸指定を掃除し、別の軸と古い候補を拒否する', async () => {
  const converted = reprojectLayerCoords(gcps, edges, undefined, planeVi);
  const selected = {
    crs: { ...planeVi, proj4: planeVi.proj4 + ' +axis=enu' },
    worldFile, coreCompatible: true,
    gcpsNew: converted.gcps.map(([pixel, geo]) => ({ pixel, geo })),
  };
  const layer = { layerId: 'main', intent: { setup: 'legacyV2' },
    buildOptions: { strictMode: 'strict', vertexMode: 'plain', yaxisMode: 'invert' }, gcps, edges };
  const signal = new AbortController().signal;
  const prepared = await prepareCrsAdoption(layer, { selected, setup: 'B' }, signal);
  assert.deepEqual(prepared.intent.crs, planeVi);
  await assert.rejects(prepareCrsAdoption(layer, {
    selected: { ...selected, crs: { ...planeVi, proj4: planeVi.proj4 + ' +axis=neu' } }, setup: 'C',
  }, signal), /unsupported_axis/);
  await assert.rejects(prepareCrsAdoption(layer, {
    selected: { ...selected, gcpsNew: selected.gcpsNew.slice(1) }, setup: 'B',
  }, signal), /reference_mismatch/);
  await assert.rejects(prepareCrsAdoption(layer, {
    selected: { ...selected, worldFile: { ...worldFile, yScale: 3 } }, setup: 'A',
  }, signal));
});

test('follow の投影済み主図・副層を外部座標へ戻し、元の compiled と一致する', async () => {
  const pixels = [[0, 0], [100, 0], [100, 100], [0, 100], [54, 47]];
  const outsideGcps = pixels.map(([x, y]) => [[x, y], [1000 + x, 2000 + y]]);
  const insideEdges = [[[[48, 1]], [[1048, -2001]], [0, 1]]];
  for (const [layerId, geometry, strictMode, vertexMode] of [
    ['main', { wh: [100, 100] }, 'strict', 'plain'],
    ['sub:1', { bounds: pixels.slice(0, 4) }, 'loose', 'birdeye'],
  ]) {
    const options = { useV2Algorithm: false, outerTransform: 'extrapolate', strictMode, vertexMode, yaxisMode: 'follow' };
    const original = new Tin({ ...options, ...geometry });
    original.setVertexMode(vertexMode);
    original.setPoints(outsideGcps);
    original.setEdges(insideEdges);
    await original.updateTinAsync();
    const compiled = original.getCompiled();
    const document = {
      crs: planeVi, width: 100, height: 100, bounds: geometry.bounds, gcps: compiled.points, edges: compiled.edges,
    };
    const layer = transformLayerFromDocument(layerId, document, compiled);
    assert.deepEqual(layer.gcps, outsideGcps);
    assert.deepEqual(layer.edges[0][1], [[1048, 2001]]);
    assert.equal(layer.buildOptions.yaxisMode, 'follow');
    assert.deepEqual(seedCompiledTin(layer, compiled).getCompiled(), compiled);
    const rebuilt = await buildEditorLayerTin({ layer, layerId, kind: 'edit', reqGen: 1, isCurrent: () => true },
      layerId === 'main' ? 0 : 1, updateTin);
    assert.deepEqual(rebuilt.tin.getCompiled(), compiled);
    assert.equal(rebuilt.tin.getCompiled().version, compiled.version);
    const pixel = [54, 47];
    assert.deepEqual(rebuilt.tin.transform(pixel, false), outsideGcps.at(-1)[1]);
    assert.deepEqual(rebuilt.tin.transform(outsideGcps.at(-1)[1], true), pixel);
    const projected = compiledGeoJsonToMercator(rebuilt.tin.tins.bakw, 'follow', planeVi);
    assert.ok(projected.features.length);
    assert.ok(projected.features.flatMap(({ geometry }) => geometry.coordinates.flat()).every(([x, y]) =>
      Number.isFinite(x) && Number.isFinite(y)));
  }
});

test('実 Tin の B 採用、GCP 編集による降格、Undo・Redo・下書き・保存を通す', async () => {
  const crs = { epsg: 3857 };
  const worldFile = { xScale: 1, xSkew: 0, xOrigin: 0.5, yScale: -1, ySkew: 0, yOrigin: 999.5 };
  const points = [[0, 0], [100, 0], [100, 100], [0, 100], [54, 47]];
  const shifted = (delta) => points.map(([x, y]) => [[x, y], [x + delta, 1000 - y]]);
  const main = transformLayerFromDocument('main', { width: 100, height: 100, gcps: shifted(0) });
  const sub = transformLayerFromDocument('sub:a', {
    tinEnabled: false, crs, worldFile, bounds: points.slice(0, 4), gcps: shifted(0),
  });
  let active = 0;
  const history = [[main, sub]];
  const adapter = {
    commit: (snapshot) => { history.splice(++active, Infinity, snapshot); },
    undo: () => active > 0 ? history[--active] : undefined,
    redo: () => active < history.length - 1 ? history[++active] : undefined,
    withoutHistoryAsync: async (apply) => apply(),
  };
  const deps = {
    buildTin: (request) => buildEditorLayerTin(request, request.layerId === 'main' ? 0 : 1, updateTin),
    prepareAdoption: prepareCrsAdoption,
    history: adapter,
  };
  const model = useLayerTransformState([main, sub], deps);
  const result = await model.startAdoption('main', { setup: 'B', selected: {
    crs, worldFile, coreCompatible: true, gcpsNew: main.gcps.map(([pixel, geo]) => ({ pixel, geo })),
  } });
  assert.equal(result.status, 'adopted');
  assert.equal(history.length, 2);
  assert.deepEqual(model.capture()[0].intent, { setup: 'B', crs, worldFile });
  const before = model.getTinState('main').tin.getCompiled();
  assert.equal(before.outerTransform, 'worldFile');
  assert.deepEqual(before.worldFile, worldFile);

  assert.equal(model.editLayer('main', { gcps: shifted(70) }), true);
  await model.requestTin('main');
  const fallback = model.getTinState('main');
  const fallbackCompiled = fallback.tin.getCompiled();
  assert.equal(fallbackCompiled.outerTransform, 'extrapolate');
  assert.equal('worldFile' in fallbackCompiled, false);
  assert.equal(fallback.diagnostics.requestedOuterTransform, 'worldFile');
  assert.equal(fallback.diagnostics.outerTransform, 'extrapolate');
  assert.equal(fallback.diagnostics.fallbackReason, 'boundaryFlips');
  assert.equal(model.capture()[0].intent.setup, 'B');

  assert.equal(await model.undo().settled, true);
  assert.deepEqual(model.getTinState('main').tin.getCompiled(), before);
  assert.equal(await model.redo().settled, true);
  assert.deepEqual(model.getTinState('main').tin.getCompiled(), fallbackCompiled);
  const copy = useLayerTransformState([main, sub], deps);
  assert.equal(await copy.restoreDraft(JSON.parse(JSON.stringify(model.capture()))).settled, true);
  assert.deepEqual(copy.getTinState('main').tin.getCompiled(), fallbackCompiled);
  assert.deepEqual(copy.getTinState('main').diagnostics, fallback.diagnostics);

  const saved = await model.save(({ layers, tins }) => {
    assert.equal(tins[1], 'worldFile');
    const compiled = tins[0].getCompiled();
    assert.deepEqual(compiled, fallbackCompiled);
    assert.deepEqual(deriveIntentFromStoredLayer({ crs: layers[0].intent.crs }, compiled), { setup: 'C', crs });
  });
  assert.deepEqual(saved, { ok: true });
});

test('外周を持たない旧 V2 副層は主図の外周または画像矩形を使う', () => {
  const customBounds = [[0, 0], [20, 0], [15, 20], [0, 15]];
  assert.deepEqual(transformLayerFromDocument('sub:1', {}, undefined, {
    width: 20, height: 20, bounds: customBounds,
  }).bounds, customBounds);
  assert.deepEqual(transformLayerFromDocument('sub:1', {}, undefined, {
    width: 30, height: 20,
  }).bounds, [[0, 0], [30, 0], [30, 20], [0, 20]]);
});

// ---- レビュー指摘 M1〜M3（T4b レビュー・2026-11-26）の回帰試験 ----

async function strictErrorTin() {
  // 4 隅＋入れ替えた内点 2 つ。strict で厳密判定に失敗し、逆変換は例外になる。
  const corners = [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y]) => [[x, y], [x + 1000, 1000 - y]]);
  const swapped = [[[40, 50], [1060, 950]], [[60, 50], [1040, 950]]];
  const tin = new Tin({ useV2Algorithm: false, strictMode: 'strict', vertexMode: 'plain', wh: [100, 100] });
  tin.setPoints([...corners, ...swapped]);
  await tin.updateTinAsync();
  return tin;
}

test('M1: strict_error の主図は、逆変換が false・順変換は値になる（ホーム位置で例外にならない）', async () => {
  const tin = await strictErrorTin();
  assert.equal(tin.strict_status, 'strict_error');
  assert.throws(() => tin.transform([1050, 950], true), 'Tin 自体は strict_error の逆変換で例外を投げる');
  const { transformMercatorToXy, transformXyToMercator } = await import('../src/utils/layerCoordTransform.ts');
  const target = { surface: null, tin, crs: undefined };
  assert.equal(transformMercatorToXy([1050, 950], target), false);
  const forward = transformXyToMercator([50, 50], target);
  assert.ok(Array.isArray(forward) && forward.every(Number.isFinite));
  // 文字列（生成エラー）・未生成の層は例外にならず false
  assert.equal(transformMercatorToXy([1050, 950], { surface: null, tin: 'tooLessGcps' }), false);
  assert.equal(transformMercatorToXy([1050, 950], { surface: null, tin: undefined }), false);
  assert.equal(transformXyToMercator([50, 50], { surface: null, tin: 'unknownError' }), false);
});

test('M1: strict でない主図と WorldFileSurface は従来どおり逆変換でき、非 3857 の層は CRS を通す', async () => {
  const { transformMercatorToXy, transformXyToMercator } = await import('../src/utils/layerCoordTransform.ts');
  const tin = new Tin({ useV2Algorithm: false, strictMode: 'strict', vertexMode: 'plain', wh: [100, 100] });
  tin.setPoints([[0, 0], [100, 0], [100, 100], [0, 100], [50, 50]].map(([x, y]) => [[x, y], [x + 1000, 1000 - y]]));
  await tin.updateTinAsync();
  assert.equal(tin.strict_status, 'strict');
  const back = transformMercatorToXy([1050, 950], { surface: null, tin });
  assert.ok(Math.abs(back[0] - 50) < 1e-6 && Math.abs(back[1] - 50) < 1e-6);
  const surface = new WorldFileSurface({
    crs: planeVi, worldFile, projectionEngine: projectionEngineForCrs(planeVi), wh: [100, 100],
  });
  const merc = transformXyToMercator([10, 20], { surface, tin: 'worldFile', crs: planeVi });
  assert.deepEqual(merc, surface.transform([10, 20], false));
  assert.deepEqual(transformMercatorToXy(merc, { surface, tin: 'worldFile', crs: planeVi }), surface.transform(merc, true));
});

test('M1: MapEdit の変換は util を通し、ホームマーカーは逆変換の失敗でも続行する', async () => {
  const source = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  assert.match(source, /from '\.\.\/utils\/layerCoordTransform/);
  // 画面側の関数は util への委譲だけで、Tin を直接呼ばない
  for (const fn of ['transformMercatorToXy', 'transformXyToMercator']) {
    const body = source.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`))?.[0] ?? '';
    assert.ok(body, `${fn} が見つからない`);
    assert.doesNotMatch(body, /\.transform\(/, `${fn} は util へ委譲する`);
  }
});

test('M2: updateTin は文書の編集ではないので、履歴の復元の抑止中でも依頼する', async () => {
  const source = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  const body = source.match(/const updateTin = async \(\): Promise<boolean> => \{[\s\S]*?\n\};/)?.[0] ?? '';
  assert.ok(body, 'updateTin が見つからない');
  assert.doesNotMatch(body, /documentEditsBlocked|historyRestoring/, '入口で抑止を見ると、読み込み直後の生成が依頼されない');
  assert.match(body, /adoptionInProgress\.value \|\| saveWriting\.value/, '採用中・保存中は引き続き断る');
  // 採用中・保存中は requestTin が自分で断る
  const model = useLayerTransformState([transformLayerFromDocument('main', { width: 10, height: 10, gcps: [] })], {
    buildTin: async () => ({ tin: 'tooLessGcps' }),
    prepareAdoption: prepareCrsAdoption,
    history: { commit() {}, undo() {}, redo() {}, withoutHistoryAsync: async (apply) => apply() },
  });
  assert.equal(await model.requestTin('main'), true);
  assert.equal(model.getTinState('main').tin, 'tooLessGcps');
});

test('M3: 想定外の生成エラーでも、編集の依頼は unknownError で保存でき、採用は reject のまま', async () => {
  const layer = transformLayerFromDocument('main', { width: 100, height: 100, gcps: [[[0, 0], [1000, 1000]]] });
  const throwing = async () => { throw new Error('worker: unexpected'); };
  const edit = await buildEditorLayerTin({ layer, layerId: 'main', kind: 'edit', reqGen: 1, isCurrent: () => true }, 0, throwing);
  assert.deepEqual(edit, { tin: 'unknownError' });
  await assert.rejects(
    buildEditorLayerTin({ layer, layerId: 'main', kind: 'adoption', reqGen: 1, isCurrent: () => true }, 0, throwing),
    /worker: unexpected/,
  );
  // 失効は従来どおり例外（結果を捨てるため）
  await assert.rejects(
    buildEditorLayerTin({ layer, layerId: 'main', kind: 'edit', reqGen: 1, isCurrent: () => false }, 0, throwing),
    /失効/,
  );
  let current = true;
  await assert.rejects(
    buildEditorLayerTin({ layer, layerId: 'main', kind: 'edit', reqGen: 1, isCurrent: () => current }, 0,
      async () => { current = false; throw new Error('worker: unexpected'); }),
    /worker: unexpected/,
    '失効した依頼の失敗は unknownError にせず、捨てる側へ投げる',
  );
  // 経路を通すと、モデルは failed ではなく ready(unknownError) になり、保存が通る
  const model = useLayerTransformState([layer], {
    buildTin: (request) => buildEditorLayerTin(request, 0, throwing),
    prepareAdoption: prepareCrsAdoption,
    history: { commit() {}, undo() {}, redo() {}, withoutHistoryAsync: async (apply) => apply() },
  });
  assert.equal(await model.requestTin('main'), true);
  const state = model.getTinState('main');
  assert.equal(state.status, 'ready');
  assert.equal(state.tin, 'unknownError');
});

test('Minor 7: 非 3857 の主図でも util が CRS を挟み、画像⇄メルカトルが往復する（ホーム・テストクリックの経路）', async () => {
  const { transformMercatorToXy, transformXyToMercator } = await import('../src/utils/layerCoordTransform.ts');
  const pixels = [[0, 0], [100, 0], [100, 100], [0, 100], [54, 47]];
  const nativeGcps = pixels.map(([x, y]) => [[x, y], [1000 + x * 10, 2000 - y * 10]]);
  const layer = transformLayerFromDocument('main', { crs: planeVi, width: 100, height: 100, gcps: nativeGcps, edges: [] });
  const built = await buildEditorLayerTin({ layer, layerId: 'main', kind: 'edit', reqGen: 1, isCurrent: () => true }, 0, updateTin);
  assert.equal(built.tin.strict_status, 'strict', '生成に成功している');
  const target = { surface: null, tin: built.tin, crs: planeVi };
  const merc = transformXyToMercator([54, 47], target);
  const expected = crsToMercator([1540, 1530], planeVi);
  assert.ok(Math.abs(merc[0] - expected[0]) < 1e-3 && Math.abs(merc[1] - expected[1]) < 1e-3);
  const back = transformMercatorToXy(merc, target);
  assert.ok(Math.abs(back[0] - 54) < 1e-3 && Math.abs(back[1] - 47) < 1e-3);
  // CRS を挟まない（3857 として扱う）と、同じメルカトルでも画像座標へ戻らない
  assert.notDeepEqual(transformMercatorToXy(merc, { ...target, crs: undefined }), back);
});

test('Minor 2: V2 の層は compiled が follow でも y を反転せず、V2 以外は Tin の属性から軸を読む', async () => {
  const { displayYaxisMode } = await import('../src/utils/layerTransformIntent.ts');
  const v2 = { intent: { setup: 'legacyV2' } };
  const projected = { intent: { setup: 'B', crs: planeVi, worldFile } };
  const follow = { yaxisMode: 'follow' };
  assert.equal(displayYaxisMode(v2, follow), undefined);
  assert.equal(displayYaxisMode(projected, follow), 'follow');
  assert.equal(displayYaxisMode(projected, { yaxisMode: 'invert' }), 'invert');
  assert.equal(displayYaxisMode(undefined, follow), undefined);
  // 描画の入口は Tin の属性を読み、描き直しのたびに compiled を作らない
  const source = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  const redraw = source.match(/const tinResultUpdate = [\s\S]*?\n\};/)?.[0] ?? '';
  assert.ok(redraw);
  assert.doesNotMatch(redraw, /tin\.getCompiled/);
  assert.doesNotMatch(source.match(/const viewError = [\s\S]*?\n\};/)?.[0] ?? '', /tin\.getCompiled/);
  // 実際に反転しない: V2 が follow を拾うと y が負になり、拾わなければ元のまま
  const { compiledPointToMercator } = await import('../src/utils/compiledGeo.ts');
  assert.deepEqual(compiledPointToMercator([10, 20], displayYaxisMode(v2, follow)), [10, 20]);
  assert.deepEqual(compiledPointToMercator([10, 20], 'follow'), [10, -20]);
});

test('Minor 1・3・4: 枠の描き直し・ラジオの見た目の復元・書き出し中の採用拒否が接続されている', async () => {
  const source = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  const bounds = source.match(/const boundsModifyEnd = [\s\S]*?\n\};/)?.[0] ?? '';
  assert.ok(bounds);
  assert.match(bounds, /documentEditsBlocked\.value\) \{ tinResultUpdate\(\); return; \}/, '拒否時は枠を描き直す');
  assert.match(bounds, /layerId === 'main'[\s\S]*?tinResultUpdate\(\)/, '主図は枠を文書の形へ戻す');
  const select = source.match(/function selectTinBuildOption[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert.match(select, /radio\.checked = radio\.value === current/, '拒否されたラジオの見た目を戻す');
  assert.equal(Array.from(source.matchAll(/@click="selectTinBuildOption\('\w+', '\w+', \$event\)"/g)).length, 4);
  const adopt = source.match(/async function adoptCrsEstimation[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert.match(adopt, /preparingSave\.value \|\| exporting\.value/, '書き出し中の採用を拒否する');
});
