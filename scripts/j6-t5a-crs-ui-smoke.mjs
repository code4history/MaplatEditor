// J6-T5a: CRS 推定結果パネルの判定（推定の入口・単体再推定・残差・推奨 4 種・§4.8 推奨のまま採用・
// YAXIS_FOLLOW ベクタ比較・比較中不変条件）を、画面から切り出した純ロジックと静的検査で確かめる。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test as nodeTest } from 'node:test';
import { worldFileToCrs } from '@maplat/transform';
import { shouldRecommendCrsSwitch } from '@c4h/teiresias';
import {
  adoptRecommendedPlan, base3857CandidateId, resolveBase3857Selected, buildPipelineSummary,
  comparedCandidateNotice, recommendedAdoptionTarget, candidateRows, compare3857, estimationResultFor,
  estimateGcpsFromLayer, isEstimationStale, manualSelection, previewCornerPolygonMercator, previewMeshMercator,
  previewTinEdges, residualArrows, residualRows, setupAdvice, setupLabelKey, usableEstimation, warningMessageKeys,
} from '../src/utils/crsEstimationPanel.ts';
import { prepareCrsAdoption } from '../src/utils/crsAdoption.ts';
import { useLayerTransformState } from '../src/composables/useLayerTransformState.ts';
import { crsToMercator, geodesicDistanceMeters, lonLatToCrs, reprojectLayerCoords } from '../src/utils/crsProjection.ts';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];

function test(name, run) {
  return nodeTest(name, async () => {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('試験が時間内に完了しませんでした')), 3000);
    });
    try {
      await Promise.race([run(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  });
}

// ---- fixture 用の推定結果（T5b の固定 fixture と同じ判定の形を再現する） ----
const planeVi = {
  epsg: 6674, authority: 'EPSG', code: '6674',
  proj4: '+proj=tmerc +lat_0=36 +lon_0=136 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs',
};
const worldFile = { xScale: 2, xSkew: 0, xOrigin: 100, ySkew: 0, yScale: -2, yOrigin: 200 };
const gcps = [
  { pixel: [10, 20], geo: [136, 36] },
  { pixel: [110, 20], geo: [136.01, 36] },
  { pixel: [10, 120], geo: [136, 36.01] },
  { pixel: [110, 120], geo: [136.01, 36.01] },
];

function candidate(overrides = {}) {
  return {
    id: 'EPSG:6674', authority: 'EPSG', code: '6674', name: 'JGD2011 / 平面直角 VI 系',
    crs: planeVi, coreCompatible: true,
    rawWorldFile: { ...worldFile, xOrigin: 99 },
    worldFile, gcpsNew: structuredClone(gcps),
    score: 0.001, rmsMeters: 0.5, unit: { name: 'metre', metresPerUnit: 1 }, qualityGate: 'adoptable',
    ...overrides,
  };
}

function rankedRow(overrides = {}) {
  return {
    authority: 'EPSG', code: '3857', score: 0.05, rmsMeters: 4,
    unit: { name: 'metre', metresPerUnit: 1 },
    id: 'EPSG:3857', name: 'Web Mercator', crs: { epsg: 3857 }, coreCompatible: true,
    ...overrides,
  };
}

function okResponse(selected, overrides = {}) {
  return {
    requestId: 'r1', status: 'ok', selected,
    ranked: [rankedRow(), rankedRow({ authority: 'EPSG', code: '6674', id: 'EPSG:6674', score: selected?.score ?? 0.001 })],
    warnings: [], untransformableIds: [], candidateCount: 10, transformableCount: 8,
    base3857Score: 0.05,
    ...overrides,
  };
}

const base3857Selected = candidate({
  id: 'EPSG:3857', authority: 'EPSG', code: '3857', name: 'Web Mercator', crs: { epsg: 3857 },
  score: 0.05, worldFile: { ...worldFile, xOrigin: 7 },
});

// 人間が「推奨の行と推奨の形」を選んで「この変換の形を採用」する場合の選択（§4.8 同値の相手）
function manualRecommended(response, base3857, vertexMode = 'plain') {
  const usable = usableEstimation(response);
  const best = usable.selected;
  const target = shouldRecommendCrsSwitch(best.score, usable.base3857Score) ? best : base3857;
  const advice = setupAdvice(estimationResultFor(target), vertexMode);
  const setup = advice.reason === 'birdeye' ? 'C' : (advice.borderlineSetupKey ?? advice.cards.find((c) => c.recommended).key);
  return manualSelection(target, setup);
}

test('推定の入口: gcps 3 点未満・failed・selected 無しは使わせない', () => {
  assert.equal(usableEstimation({ requestId: 'x', status: 'failed', failureReason: 'estimation_failed' }), null);
  assert.equal(usableEstimation(okResponse(null)), null);
  assert.equal(usableEstimation({ requestId: 'x', status: 'canceled' }), null);
  assert.ok(usableEstimation(okResponse(candidate())));
});

test('3857 比較: 基準スコア欠損・0 以下・非有限は数値差を出さない', () => {
  const best = { score: 0.001, authority: 'EPSG', code: '6674' };
  for (const base of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(compare3857(base, best), { kind: 'unavailable' }, String(base));
  }
  assert.deepEqual(compare3857(0.05, { score: null, authority: 'EPSG', code: '6674' }), { kind: 'unavailable' });
  const switched = compare3857(0.05, best);
  assert.equal(switched.kind, 'switch');
  assert.equal(switched.crsLabel, 'EPSG:6674');
  assert.ok(Math.abs(switched.percent - 98) < 1e-9);
  const kept = compare3857(0.001, { score: 0.00099, authority: 'EPSG', code: '6674' });
  assert.equal(kept.kind, 'keep');
});

test('候補一覧は診断専用（順位・差）で、部分順位は選択に使わない', () => {
  const rows = candidateRows([rankedRow(), rankedRow({ id: 'ESRI:102012', authority: 'ESRI', code: '102012', score: 0.02, coreCompatible: false })], 0.05);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rank, 1);
  assert.ok(Math.abs(rows[0].diff3857Percent - 0) < 1e-9);
  assert.equal(rows[1].coreCompatible, false);
  assert.equal(candidateRows([rankedRow({ score: null })], null)[0].diff3857Percent, null);
});

test('単体再推定: 選択候補の worldFile と gcpsNew の同一変換済み点列だけで残差を出す（再換算しない）', () => {
  const selected = candidate();
  const before = structuredClone({ selected, gcps });
  const rows = residualRows(selected, gcps);
  assert.equal(rows.length, 4);
  rows.forEach((row, index) => {
    const expected = worldFileToCrs(selected.worldFile, gcps[index].pixel);
    assert.deepEqual(row.predictedMerc, crsToMercator(expected, selected.crs));
    assert.deepEqual(row.measuredMerc, crsToMercator(selected.gcpsNew[index].geo, selected.crs));
    assert.ok(Number.isFinite(row.distanceMeters) && row.distanceMeters >= 0);
    const lonLatA = [136.005 + index * 0.001, 36.005];
    assert.ok(Math.abs(geodesicDistanceMeters(lonLatA, lonLatA)) < 1e-9);
  });
  assert.deepEqual({ selected, gcps }, before, '入力は変えない');
  // 別候補（別の worldFile）を選ぶと、その候補の換算済み worldFile で計算し直す
  const other = candidate({ id: 'EPSG:3857', authority: 'EPSG', code: '3857', crs: { epsg: 3857 }, worldFile: { ...worldFile, xOrigin: 7 } });
  const otherRows = residualRows(other, gcps);
  assert.notDeepEqual(otherRows[0].predictedMerc, rows[0].predictedMerc);
  assert.deepEqual(otherRows[0].predictedMerc, crsToMercator(worldFileToCrs(other.worldFile, gcps[0].pixel), other.crs));
});

test('残差矢印は 1x / 5x / 自動拡大で長さが変わり、残差距離は Karney 法', () => {
  const selected = candidate();
  const rows = residualRows(selected, gcps);
  const one = residualArrows(rows, '1x', 1);
  const five = residualArrows(rows, '5x', 1);
  const auto = residualArrows(rows, 'auto', 1);
  const length = (arrow) => Math.hypot(arrow.to[0] - arrow.from[0], arrow.to[1] - arrow.from[1]);
  assert.ok(Math.abs(length(five[0]) - 5 * length(one[0])) < 1e-9);
  assert.ok(Math.abs(Math.max(...auto.map(length)) - 40) < 1e-6, '自動拡大は最大 40 画素に合わせる');
  assert.deepEqual(one.map((arrow) => arrow.index), [1, 2, 3, 4]);
});

test('推奨 4 種（clear / borderline / birdeye / unavailable）', () => {
  const clearA = setupAdvice(estimationResultFor(candidate({ score: 0.001 })), 'plain');
  assert.equal(clearA.reason, 'clear');
  assert.deepEqual(clearA.cards.filter((c) => c.recommended).map((c) => c.key), ['A']);
  const clearB = setupAdvice(estimationResultFor(candidate({ score: 0.01 })), 'plain');
  assert.deepEqual(clearB.cards.filter((c) => c.recommended).map((c) => c.key), ['B']);
  const borderline = setupAdvice(estimationResultFor(candidate({ score: 0.032 })), 'plain');
  assert.equal(borderline.reason, 'borderline');
  assert.deepEqual(borderline.cards.filter((c) => c.recommended).map((c) => c.key), ['B', 'C']);
  assert.equal(borderline.borderlineSetupKey, 'B');
  const birdeye = setupAdvice(estimationResultFor(candidate({ score: 0.032 })), 'birdeye');
  assert.equal(birdeye.reason, 'birdeye');
  assert.deepEqual(birdeye.cards.map((c) => [c.key, c.disabled]), [['A', true], ['B', true], ['C', false]]);
  const unavailable = setupAdvice(estimationResultFor(candidate({ score: null })), 'plain');
  assert.equal(unavailable.reason, 'unavailable');
  assert.deepEqual(unavailable.cards.filter((c) => c.recommended), []);
});

test('推定の警告は 3 点のみ・アフィン不足・ほぼ一直線を DiagnosticFeedback の文言キーで返す', () => {
  const response = okResponse(candidate(), {
    warnings: [{ code: 'affineSkippedInsufficientDof' }, { code: 'nearCollinearSource' }],
  });
  assert.deepEqual(warningMessageKeys(response, 3), [
    'mapedit.crs_warning_three_gcps',
    'mapedit.crs_warning_affine_skipped',
    'mapedit.crs_warning_near_collinear',
  ]);
  assert.deepEqual(warningMessageKeys(okResponse(candidate()), 6), []);
});

// ---- §4.8「推奨のまま採用」 ----
const fixtures = {
  A: { selected: candidate({ score: 0.001 }), base3857Score: 0.0012 },
  B: { selected: candidate({ score: 0.01 }), base3857Score: 0.05 },
  BC: { selected: candidate({ score: 0.032 }), base3857Score: 0.05 },
  Non3857: { selected: candidate({ score: 0.002 }), base3857Score: 0.02 },
};

for (const [name, fixture] of Object.entries(fixtures)) {
  test(`§4.8 fixture ${name}: 推奨のまま採用は人間の推奨行＋推奨形の選択と 1 ビットも変わらない`, () => {
    const response = okResponse(fixture.selected, { base3857Score: fixture.base3857Score });
    const verdict = adoptRecommendedPlan({ response, base3857Selected, vertexMode: 'plain' });
    assert.equal(verdict.disabled, null, name);
    const expected = manualRecommended(response, base3857Selected);
    assert.deepEqual(verdict.plan.selection, expected, name);
    assert.equal(verdict.plan.selection.setup, expected.setup, name);
  });
}

test('§4.8: borderline は setups[0] を採り、脇の案内のラベルキーを持つ', () => {
  const response = okResponse(fixtures.BC.selected, { base3857Score: 0.05 });
  const verdict = adoptRecommendedPlan({ response, base3857Selected, vertexMode: 'plain' });
  assert.equal(verdict.plan.reason, 'borderline');
  assert.equal(verdict.plan.setup, 'B');
  assert.equal(verdict.plan.borderlineSetupLabelKey, 'mapedit.crs_setup_b');
});

test('§4.8: birdeye は C を採る', () => {
  const response = okResponse(fixtures.BC.selected, { base3857Score: 0.05 });
  const verdict = adoptRecommendedPlan({ response, base3857Selected, vertexMode: 'birdeye' });
  assert.equal(verdict.plan.setup, 'C');
  assert.equal(verdict.plan.reason, 'birdeye');
});

test('§4.8: 押せない 4 条件（unavailable / failed / 基準スコア欠損 / core 非互換）', () => {
  const unavailable = adoptRecommendedPlan({
    response: okResponse(candidate({ score: null }), { base3857Score: 0.05 }), base3857Selected, vertexMode: 'plain',
  });
  assert.deepEqual(unavailable, { plan: null, disabled: 'unavailable' });
  const failed = adoptRecommendedPlan({
    response: { requestId: 'x', status: 'failed', failureReason: 'estimation_failed' }, base3857Selected, vertexMode: 'plain',
  });
  assert.deepEqual(failed, { plan: null, disabled: 'estimation-failed' });
  for (const base of [null, 0]) {
    const noBase = adoptRecommendedPlan({
      response: okResponse(candidate(), { base3857Score: base }), base3857Selected, vertexMode: 'plain',
    });
    assert.deepEqual(noBase, { plan: null, disabled: 'no-base-score' }, String(base));
  }
  const coreIncompatible = adoptRecommendedPlan({
    response: okResponse(candidate({ score: 0.001, coreCompatible: false }), { base3857Score: 0.05 }),
    base3857Selected, vertexMode: 'plain',
  });
  assert.deepEqual(coreIncompatible, { plan: null, disabled: 'core-incompatible' });
});

// 3857 の単体再推定の selected は、全体推定の base3857Score と同じ推定の値（同じ入力なのでスコアは一致する）
const keptBase = (score) => ({ ...base3857Selected, score });

test('§4.8: 乗り換えが推奨されないときは EPSG:3857 を、3857 の側の形で採る', () => {
  const response = okResponse(candidate({ score: 0.0012 }), { base3857Score: 0.00121 });
  const verdict = adoptRecommendedPlan({ response, base3857Selected: keptBase(0.00121), vertexMode: 'plain' });
  assert.equal(verdict.plan.crsChoice, 'base3857');
  assert.equal(verdict.plan.selection.selected.id, 'EPSG:3857');
  assert.equal(verdict.plan.selection.setup, 'A');
  assert.equal(verdict.plan.setup, 'A');
  const withoutBase = adoptRecommendedPlan({ response, base3857Selected: null, vertexMode: 'plain' });
  assert.deepEqual(withoutBase, { plan: null, disabled: 'no-base-score' });
});

test('§4.8: 最良候補と自動の採用先が違うとき（非 3857 が 0.0349・3857 が 0.0351）は 3857 を保ち、3857 の側の形を採る', () => {
  const best = candidate({ score: 0.0349 });
  const response = okResponse(best, { base3857Score: 0.0351 });
  const base = keptBase(0.0351);
  const verdict = adoptRecommendedPlan({ response, base3857Selected: base, vertexMode: 'plain' });
  assert.equal(response.selected.id, 'EPSG:6674', '最良候補は非 3857 のまま');
  assert.equal(verdict.plan.crsChoice, 'base3857');
  assert.equal(verdict.plan.selection.selected, base);
  // 最良候補の形は B（0.0349 < 0.035）だが、採るのは 3857 の側の形 C（0.0351 >= 0.035）
  assert.equal(setupAdvice(estimationResultFor(best), 'plain').borderlineSetupKey, 'B');
  assert.equal(verdict.plan.setup, 'C');
  assert.equal(verdict.plan.selection.setup, 'C');
  assert.equal(verdict.plan.borderlineSetupLabelKey, 'mapedit.crs_setup_c');
});

test('§4.8: 3857 の単体再推定が要るのは最良候補が非 3857 で順位に 3857 があるときだけ', () => {
  const non = okResponse(candidate());
  assert.equal(base3857CandidateId(non), 'EPSG:3857');
  assert.equal(base3857CandidateId(okResponse(candidate(), { ranked: [] })), null);
  assert.equal(base3857CandidateId(okResponse(base3857Selected)), null);
  assert.equal(resolveBase3857Selected(non, null), null);
  assert.equal(resolveBase3857Selected(non, base3857Selected), base3857Selected);
  assert.equal(resolveBase3857Selected(okResponse(base3857Selected), null), base3857Selected);
});

test('「推奨のまま採用」の横の CRS と変換の形は、採用の処理へ渡す selection から作る（最良候補から推測しない）', () => {
  const response = okResponse(candidate({ score: 0.0349 }), { base3857Score: 0.0351 });
  const { plan } = adoptRecommendedPlan({ response, base3857Selected: keptBase(0.0351), vertexMode: 'plain' });
  assert.deepEqual(recommendedAdoptionTarget(plan), { crsLabel: 'EPSG:3857', setupLabelKey: 'mapedit.crs_setup_c' });
  const switched = adoptRecommendedPlan({
    response: okResponse(candidate({ score: 0.001 })), base3857Selected, vertexMode: 'plain',
  }).plan;
  assert.deepEqual(recommendedAdoptionTarget(switched), { crsLabel: 'EPSG:6674', setupLabelKey: 'mapedit.crs_setup_a' });
});

test('比べている候補が最良候補と違うときだけ、2 つの CRS を出す', () => {
  const best = candidate();
  assert.equal(comparedCandidateNotice(best, best), null);
  assert.equal(comparedCandidateNotice(best, null), null);
  assert.equal(comparedCandidateNotice(null, best), null);
  assert.deepEqual(comparedCandidateNotice(best, base3857Selected), { bestCrs: 'EPSG:6674', comparedCrs: 'EPSG:3857' });
});

test('§4.8: editGeneration が進んだ結果は古く、ボタンは出さない', () => {
  assert.equal(isEstimationStale(0, 0), false);
  assert.equal(isEstimationStale(null, 7), false, '推定前は結果自体が無い');
  assert.equal(isEstimationStale(0, 1), true);
  assert.equal(isEstimationStale(3, 2), true);
});

test('パイプライン要約は候補数・変換可能数・当てはめ数・CRS・単位・y 軸向き・現在の形を返す', () => {
  const summary = buildPipelineSummary(okResponse(candidate()), 'legacyV2');
  assert.deepEqual(summary, {
    candidateCount: 10, transformableCount: 8, fittedCount: 2,
    crsLabel: 'EPSG:6674', unitName: 'metre', yScaleSign: -1,
    currentSetupKey: 'mapedit.crs_setup_legacy',
  });
  assert.equal(setupLabelKey('A'), 'mapedit.crs_setup_a');
  assert.equal(setupLabelKey('B'), 'mapedit.crs_setup_b');
  assert.equal(setupLabelKey('C'), 'mapedit.crs_setup_c');
});

// ---- YAXIS_FOLLOW 主図・副層のベクタ比較 ----
test('YAXIS_FOLLOW: 主図のメッシュは y 反転を戻して 3857 に写す', () => {
  const bakw = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[10, 20], [30, 20], [30, 40], [10, 20]]] }, properties: {} };
  const follow = previewMeshMercator({ bakw, yaxisMode: 'follow', crs: { epsg: 3857 } });
  const invert = previewMeshMercator({ bakw, yaxisMode: 'invert', crs: { epsg: 3857 } });
  assert.deepEqual(invert.geometry.coordinates[0][0], [10, 20]);
  assert.deepEqual(follow.geometry.coordinates[0][0], [10, -20]);
});

test('YAXIS_FOLLOW: 副層の FeatureCollection と非 3857 CRS でも共用 helper 経由で 3857 に写す', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[10, 20], [30, 20], [30, 40], [10, 20]]] }, properties: {} }],
  };
  const projected = previewMeshMercator({ bakw: collection, yaxisMode: 'follow', crs: planeVi });
  assert.notEqual(projected, false);
  const followPoint = projected.features[0].geometry.coordinates[0][0];
  // follow は内部の y を反転してから CRS → 3857 へ写す
  assert.deepEqual(followPoint, crsToMercator([10, -20], planeVi));
  assert.deepEqual(
    previewMeshMercator({ bakw: collection, yaxisMode: 'invert', crs: planeVi }).features[0].geometry.coordinates[0][0],
    crsToMercator([10, 20], planeVi),
  );
});

test('A のベクタ比較は画像側の外枠を worldFileToCrs で 3857 に写す', () => {
  const polygon = previewCornerPolygonMercator({
    worldFile, crs: planeVi, pixelCorners: [[0, 0], [256, 0], [256, 256], [0, 256]],
  });
  assert.equal(polygon.geometry.coordinates[0].length, 5);
  assert.deepEqual(polygon.geometry.coordinates[0][0], crsToMercator(worldFileToCrs(worldFile, [0, 0]), planeVi));
  assert.equal(previewCornerPolygonMercator({ worldFile, crs: planeVi, pixelCorners: [[0, 0], [1, 1]] }), null);
});

// ---- 推定の入力（§1(b) geoBasis: LONLAT）と B/C プレビューの対応線の内部軸 ----
test('CRS 推定の入力: 層座標の gcp[1] を WGS84 [lon, lat] へ写す（1 点でも写せなければ null）', () => {
  const lonLats = [[136, 36], [136.01, 36], [136, 36.01]];
  const mercGcps = lonLats.map((lonLat, index) => [[index * 10, index * 20], lonLatToCrs(lonLat, { epsg: 3857 })]);
  const from3857 = estimateGcpsFromLayer(mercGcps, { epsg: 3857 });
  assert.ok(from3857);
  assert.equal(from3857.length, 3);
  from3857.forEach((gcp, index) => {
    assert.deepEqual(gcp.pixel, [index * 10, index * 20]);
    assert.ok(Math.abs(gcp.geo[0] - lonLats[index][0]) < 1e-9, `3857 経度 ${index}`);
    assert.ok(Math.abs(gcp.geo[1] - lonLats[index][1]) < 1e-9, `3857 緯度 ${index}`);
  });
  const planeGcps = lonLats.map((lonLat, index) => [[index * 10, index * 20], lonLatToCrs(lonLat, planeVi)]);
  const from6674 = estimateGcpsFromLayer(planeGcps, planeVi);
  assert.ok(from6674);
  from6674.forEach((gcp, index) => {
    assert.ok(Math.abs(gcp.geo[0] - lonLats[index][0]) < 1e-7, `6674 経度 ${index}`);
    assert.ok(Math.abs(gcp.geo[1] - lonLats[index][1]) < 1e-7, `6674 緯度 ${index}`);
  });
  // 異常点（非有限・変換不能）は 1 点でも null
  assert.equal(estimateGcpsFromLayer([[[0, 0], [Number.NaN, 0]]], { epsg: 3857 }), null);
  assert.equal(estimateGcpsFromLayer([[[0, 0], [136, 36]], [[1, 1], [Infinity, 0]]], { epsg: 4326 }), null);
  assert.deepEqual(estimateGcpsFromLayer([], { epsg: 3857 }), []);
});

test('B/C プレビューの対応線: follow は内部軸へ y 反転し、invert・未指定は反転しない', () => {
  const edges = [[[[0.5, 0]], [[10, 20], [30, 40]], [0, 1]]];
  const plain4326 = reprojectLayerCoords([], edges, { epsg: 3857 }, { epsg: 4326 }).edges;
  const follow4326 = previewTinEdges(edges, { epsg: 3857 }, { epsg: 4326 }, 'follow');
  assert.deepEqual(follow4326[0][1], plain4326[0][1].map((point) => [point[0], -point[1]]), 'EPSG:4326 YAXIS_FOLLOW は y 反転');
  assert.deepEqual(previewTinEdges(edges, { epsg: 3857 }, { epsg: 4326 }, 'invert'), plain4326);
  const plain6674 = reprojectLayerCoords([], edges, { epsg: 3857 }, planeVi).edges;
  assert.deepEqual(previewTinEdges(edges, { epsg: 3857 }, planeVi, 'invert'), plain6674, 'EPSG:6674 は非反転');
  assert.deepEqual(previewTinEdges(edges, { epsg: 3857 }, planeVi, undefined), plain6674);
});

test('比較切替・不透明度・残差倍率の操作は地図文書を 1 ビットも変えない', () => {
  const guarded = {
    mapData: { gcps: structuredClone(gcps), crs: structuredClone(planeVi) },
    sub_maps: [{ bounds: [[0, 0], [8, 0], [8, 8]] }],
    gcps: structuredClone(gcps),
    edges: [[[[0.5, 0]], [[1, 0]], [0, 1]]],
    layerIds: ['main', 'sub:x'],
    layerTransformIntents: { main: { setup: 'legacyV2' }, 'sub:x': { setup: 'B', crs: planeVi, worldFile } },
    editGeneration: 4,
    tinObjects: ['worldFile', { outerTransform: 'worldFile' }],
    historyStack: [{ pointer: 1 }],
    isDirty: false,
    draftLifecycle: { saves: 0 },
  };
  const before = structuredClone(guarded);
  const selected = candidate();
  for (const mode of ['1x', '5x', 'auto']) {
    residualArrows(residualRows(selected, guarded.gcps), mode, 2);
  }
  for (const score of [0.001, 0.032, 0.05, null]) {
    setupAdvice(estimationResultFor(candidate({ score })), 'plain');
    setupAdvice(estimationResultFor(candidate({ score })), 'birdeye');
    compare3857(0.05, { score, authority: 'EPSG', code: '6674' });
    adoptRecommendedPlan({ response: okResponse(candidate({ score })), base3857Selected, vertexMode: 'plain' });
  }
  buildPipelineSummary(okResponse(selected), 'B');
  previewCornerPolygonMercator({ worldFile, crs: planeVi, pixelCorners: [[0, 0], [4, 0], [4, 4], [0, 4]] });
  previewMeshMercator({ bakw: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }, yaxisMode: 'follow', crs: planeVi });
  assert.deepEqual(guarded, before, '比較操作で文書・履歴・下書き・世代が変わらない');
});

// ---- §4.8 推奨のまま採用 → Undo 1 回復元（採用は履歴に 1 件） ----
const gcps3857 = [
  [[10, 20], [1000, 2000]],
  [[110, 20], [1200, 2000]],
  [[10, 120], [1000, 2200]],
  [[110, 120], [1200, 2200]],
];

function historyFixture() {
  const history = [structuredClone([{
    layerId: 'main',
    intent: { setup: 'legacyV2' },
    buildOptions: { strictMode: 'strict', vertexMode: 'plain' },
    gcps: structuredClone(gcps3857),
    edges: [],
  }])];
  const events = [];
  let pointer = 0;
  const adapters = {
    commit(snapshot) {
      events.push('commit');
      history.splice(++pointer, history.length, structuredClone(snapshot));
    },
    undo: () => (pointer > 0 ? history[--pointer] : undefined),
    redo: () => (pointer + 1 < history.length ? history[++pointer] : undefined),
    async withoutHistoryAsync(apply) {
      apply();
      await Promise.resolve();
    },
  };
  const model = useLayerTransformState(history[0], {
    history: adapters,
    buildTin: () => ({ tin: { fake: true } }),
    prepareAdoption: prepareCrsAdoption,
  });
  return { model, history, events };
}

test('§4.8: 推奨のまま採用は履歴に 1 件だけ積み、Undo 1 回で採用前の状態に戻る', async () => {
  const response = okResponse(candidate({
    id: 'EPSG:3857', authority: 'EPSG', code: '3857', crs: { epsg: 3857 },
    worldFile: { ...worldFile, xOrigin: 7 },
    gcpsNew: gcps3857.map(([pixel, geo]) => ({ pixel: [pixel[0], pixel[1]], geo: [geo[0], geo[1]] })),
    score: 0.001,
  }), { base3857Score: 0.001 });
  const verdict = adoptRecommendedPlan({ response, base3857Selected: response.selected, vertexMode: 'plain' });
  assert.equal(verdict.disabled, null);
  const { model, history, events } = historyFixture();
  const before = JSON.parse(JSON.stringify(model.capture()));
  const outcome = await model.startAdoption('main', verdict.plan.selection);
  assert.equal(outcome.status, 'adopted');
  assert.deepEqual(events, ['commit'], '採用の反映は履歴 1 件');
  assert.equal(history.length, 2);
  assert.deepEqual(model.capture()[0].intent, {
    setup: 'A',
    crs: { epsg: 3857 },
    worldFile: verdict.plan.selection.selected.worldFile,
  });
  model.undo();
  assert.deepEqual(JSON.parse(JSON.stringify(model.capture())), before, 'Undo 1 回で採用前へ戻る');
});

// ---- 静的検査（画面の接続・文言キー） ----
test('静的: GCP タブの推定ボタン・無効理由・左ペイン切替・T4 診断が接続されている', async () => {
  const mapEdit = await readFile(path.join(root, 'src/views/MapEdit.vue'), 'utf8');
  for (const needle of [
    'data-testid="map-edit-estimate-crs"',
    "t('mapedit.crs_estimate_button')",
    "t('mapedit.crs_estimate_disabled_help')",
    "t('mapedit.crs_cancel_estimate_button')",
    'gcps.length < 3',
    '!gcpsEditReady.value',
    "alignPhase.value !== 'P0'",
    'documentEditsBlocked.value',
    'adoptionInProgress.value',
    '<CrsEstimationPanel',
    'v-show="!crsPanelVisible"',
    "t('mapedit.crs_setup_fallback_notice')",
    "t('mapedit.crs_core_incompatible')",
    "t('mapedit.crs_reproject_error')",
    "t('mapedit.crs_yaxis_mismatch_rebuild')",
    "t('mapedit.crs_gcp_edited_after_adopt')",
    "t('mapedit.crs_adopted_notice'",
    "t('mapedit.crs_residual_label'",
    "'crsResidual'",
    "'crsPreviewVector'",
  ]) {
    assert.ok(mapEdit.includes(needle), `MapEdit.vue に ${needle} が無い`);
  }
});

test('静的: 推定パネルは換算済み worldFile を再換算せず、単体再推定と §4.8 を持つ', async () => {
  const panel = await readFile(path.join(root, 'src/components/mapedit/CrsEstimationPanel.vue'), 'utf8');
  for (const needle of [
    'window.crs',
    'estimateCandidate',
    'resolveTinBuildOptions',
    'isEstimationStale',
    'data-testid="crs-adopt-recommended"',
    "t('mapedit.crs_adopt_recommended_button')",
    "t('mapedit.crs_adopt_recommended_borderline_note'",
    'data-testid="crs-adopt-button"',
    "t('mapedit.crs_adopt_button')",
    'crsApi.cancel()',
  ]) {
    assert.ok(panel.includes(needle), `CrsEstimationPanel.vue に ${needle} が無い`);
  }
  assert.ok(!panel.includes('toCenteredWorldFile'), '半画素換算は T2 ワーカーだけ（パネルで再換算しない）');
});

test('静的: 数値の意味の説明・推奨の採用先・最良候補と比較中の候補が画面に接続されている', async () => {
  const panel = await readFile(path.join(root, 'src/components/mapedit/CrsEstimationPanel.vue'), 'utf8');
  for (const key of [
    'crs_col_score_help', 'crs_col_rms_help', 'crs_col_diff_help', 'crs_residuals_help', 'crs_residual_scale_help',
  ]) {
    assert.ok(panel.includes(`:text="t('mapedit.${key}')"`), `ContextHelp に mapedit.${key} が接続されていない`);
  }
  for (const needle of [
    'data-testid="crs-adopt-recommended-target"',
    "t('mapedit.crs_adopt_recommended_target'",
    'recommendedAdoptionTarget(recommendedPlan.value)',
    'data-testid="crs-panel-compared-candidate"',
    'comparedCandidateNotice(usable.value.selected, selectedCandidate.value)',
    "t('mapedit.crs_best_candidate'",
    "t('mapedit.crs_compared_candidate'",
  ]) {
    assert.ok(panel.includes(needle), `CrsEstimationPanel.vue に ${needle} が無い`);
  }
});

test('静的: WGS84 換算の推定入力・対応線の内部軸・競合解消・中止通知・不透明度分離が接続されている', async () => {
  const mapEdit = await readFile(path.join(root, 'src/views/MapEdit.vue'), 'utf8');
  for (const needle of [
    'estimateGcpsFromLayer(gcps.value, activeLayerCrs.value)',
    '|| !crsGcpsForEstimate.value',
    ':gcps="crsGcpsForEstimate ?? []"',
    'if (crsPanelVisible.value) closeCrsPanel();',
    'crsPanelEstimating.value = false;',
  ]) {
    assert.ok(mapEdit.includes(needle), `MapEdit.vue に ${needle} が無い`);
  }
  assert.ok(/function restoreHistoryDocuments\(state: MapEditHistoryState\): void \{[\s\S]{0,600}crsAdoptedNotice\.value = null;/.test(mapEdit),
    'restoreHistoryDocuments で採用済み通知をクリアしていない');
  assert.ok(/function initializeLayerTransformState\(tins: any\[\] \| null\) \{[\s\S]{0,400}crsAdoptedNotice\.value = null;/.test(mapEdit),
    'initializeLayerTransformState で採用済み通知をクリアしていない');
  const panel = await readFile(path.join(root, 'src/components/mapedit/CrsEstimationPanel.vue'), 'utf8');
  for (const needle of [
    'previewTinEdges(props.edges, props.crs, candidate.crs, tinOptions.yaxisMode)',
    'residualRows(candidate, candidate.gcpsNew)',
    'estimateSessionToken',
    'uiBusyToken',
    'inFlightRequest',
    'await inFlightRequest.catch(() => {});',
    'estimatedGcps',
    'estimatedOnshoreOnly',
    'lastPreviewGeojson',
    'watch(previewOpacity',
    'void crsApi?.cancel()',
  ]) {
    assert.ok(panel.includes(needle), `CrsEstimationPanel.vue に ${needle} が無い`);
  }
  assert.ok(!panel.includes('watch([previewMode, selectedCandidate, previewOpacity]'),
    '不透明度がプレビュー幾何の watch に混入している');
  assert.ok(!panel.includes('watch(usable'), '`watch(usable)` からの別発火は残さない');
});

test('静的: 画面から参照する mapedit.crs_* キーが 11 言語すべてに存在する', async () => {
  const sources = [
    await readFile(path.join(root, 'src/views/MapEdit.vue'), 'utf8'),
    await readFile(path.join(root, 'src/components/mapedit/CrsEstimationPanel.vue'), 'utf8'),
    await readFile(path.join(root, 'src/utils/crsEstimationPanel.ts'), 'utf8'),
  ].join('\n');
  const keys = [...new Set([...sources.matchAll(/mapedit\.crs_[a-z0-9_]+/g)].map((m) => m[0]))];
  assert.ok(keys.length >= 40, `参照キーが少ない: ${keys.length}`);
  for (const lang of LANGS) {
    const locale = JSON.parse(await readFile(path.join(root, `public/locales/${lang}/translation.json`), 'utf8'));
    for (const key of keys) {
      const leaf = key.slice('mapedit.'.length).split('.').reduce((value, part) => value?.[part], locale.mapedit);
      assert.equal(typeof leaf, 'string', `${lang} ${key} が無い`);
      assert.ok(leaf.trim().length > 0, `${lang} ${key} が空`);
    }
  }
});

test('推奨のまま採用でも prepareCrsAdoption の同じ経路を通る（二重実装しない）', async () => {
  const response = okResponse(candidate({
    id: 'EPSG:3857', authority: 'EPSG', code: '3857', crs: { epsg: 3857 },
    gcpsNew: gcps3857.map(([pixel, geo]) => ({ pixel: [pixel[0], pixel[1]], geo: [geo[0], geo[1]] })),
  }), { base3857Score: 0.001 });
  const verdict = adoptRecommendedPlan({ response, base3857Selected: response.selected, vertexMode: 'plain' });
  const layer = {
    layerId: 'main',
    intent: { setup: 'legacyV2' },
    buildOptions: { strictMode: 'strict', vertexMode: 'plain' },
    gcps: structuredClone(gcps3857),
    edges: [],
  };
  const prepared = await prepareCrsAdoption(layer, verdict.plan.selection, new AbortController().signal);
  assert.deepEqual(prepared.gcps, gcps3857);
  assert.equal(prepared.intent.setup, verdict.plan.selection.setup);
  assert.deepEqual(prepared.intent.worldFile, verdict.plan.selection.selected.worldFile);
});

console.log('J6-T5a CRS 推定パネルの判定・§4.8・YAXIS_FOLLOW ベクタ比較・不変条件を確認');
