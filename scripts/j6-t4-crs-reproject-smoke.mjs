import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  crsToLonLat, crsToMercator, mercatorToCrs, lonLatToCrs, geodesicDistanceMeters,
  reprojectLayerCoords, validateRoundtrip, csvGeoCoordToTarget,
} from '../src/utils/crsProjection.ts';
import { prepareCrsAdoption } from '../src/utils/crsAdoption.ts';
import { deriveIntentFromStoredLayer, deriveLayerBuildOptions } from '../src/utils/layerTransformIntent.ts';
import { compiledGeoJsonToMercator } from '../src/utils/compiledGeo.ts';
import { WorldFileSurface } from '@maplat/transform';
import { projectionEngineForCrs } from '../src/utils/compiledGeo.ts';

const planeVi = {
  epsg: 6674, authority: 'EPSG', code: '6674',
  proj4: '+proj=tmerc +lat_0=33 +lon_0=132 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs',
};
const feet = {
  authority: 'TEST', code: 'FEET',
  proj4: '+proj=tmerc +lat_0=33 +lon_0=132 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs',
};
const worldFile = { xScale: 2.5, xSkew: 0.25, xOrigin: 500, ySkew: -0.125, yScale: -3, yOrigin: 800 };
const gcps = [
  [[10, 20], crsToMercator([132, 33])],
  [[110, 20], crsToMercator([132.01, 33])],
  [[10, 120], crsToMercator([132, 33.01])],
  [[110, 120], crsToMercator([132.01, 33.01])],
];
const edges = [[[[50, 20]], [crsToMercator([132.005, 33])], [0, 1]]];

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
  const raw = [132.01, 33.01];
  for (const target of [undefined, planeVi, feet]) {
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
  for (const fn of ['performUndo', 'performRedo', 'saveMap', 'saveMapAfterConfirm', 'uploadCsv', 'addSubMap', 'removeSubMap']) {
    const body = source.match(new RegExp(`(?:const|async function) ${fn}[\\s\\S]*?\\n\\};`))?.[0] ?? '';
    assert.match(body, /adoptionInProgress/, `${fn} の入口に採用中の拒否が必要`);
  }
  assert.match(source, /withoutHistoryAsync:\s*\(apply\)\s*=>\s*withoutHistoryAsync\('adopt-crs', apply\)/);
  assert.match(source, /targetCrs:\s*cloneDeep\(activeLayerCrs\.value\)/);
  assert.match(source, /const enableSetHomeIllst[\s\S]*?worldFileSurfaceAt\(0\)/);
  assert.match(source, /const tinResultUpdate[\s\S]*?compiledGeoJsonToMercator/);
  assert.match(source, /const viewError[\s\S]*?compiledGeoJsonToMercator/);
});
