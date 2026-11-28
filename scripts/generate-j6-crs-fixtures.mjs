#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import proj4 from 'proj4';
import { initializeProjWasmRuntime } from '@c4h/atlas';
import { recommendTransformSetup, shouldRecommendCrsSwitch } from '@c4h/teiresias';
import Tin from '@maplat/tin';
import {
  MapTransform,
  Transform,
  WorldFileSurface,
  createProj4ProjectionEngine,
  worldFileToCrs,
} from '@maplat/transform';
// 推定・推奨・採用・三角網の生成は、Editor の実際の処理と同じ関数を通す
import { estimate } from '../electron/workers/crsEstimationProcess.ts';
import { prepareCrsAdoption } from '../src/utils/crsAdoption.ts';
import {
  adoptRecommendedPlan,
  base3857CandidateId,
  estimateGcpsFromLayer,
  estimationResultFor,
  manualSelection,
  resolveBase3857Selected,
} from '../src/utils/crsEstimationPanel.ts';
import { resolveTransformLayerTinOptions, transformLayerFromDocument } from '../src/utils/layerTransformIntent.ts';
import { applyTinGeometry } from '../src/utils/tinOptions.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'j6-crs');
const ASSET_DIR = path.join(FIXTURE_DIR, 'assets');
const GRID_PNG_PATH = path.join(ASSET_DIR, 'grid-256.png');

const PRNG_SEED = 20270106;
const EPSG_6674_PROJ4 =
  '+proj=tmerc +lat_0=36 +lon_0=136 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
// 広域の合成地図（北緯 61〜65 度）の生成元。緯度の幅が大きく、3857 の縮尺（1/cos φ）が図の中で大きく変わるので、
// 投影の伸び縮みを補正した適合スコアでも、3857 でない CRS が 5% 以上良くなる。
const UTM33_PROJ4 = '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const INPUT_CRS = { epsg: 3857 };
const WH = [256, 256];
const BASE_ID = 'EPSG:3857';

const projectionEngine = createProj4ProjectionEngine(proj4);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function buildDeterministicGridPng() {
  const width = 256;
  const height = 256;
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const idx = rowStart + 1 + x * 4;
      const border = x < 2 || x >= width - 2 || y < 2 || y >= height - 2;
      const majorGrid = x % 32 < 2 || y % 32 < 2;
      const diagonal = Math.abs(x - y) < 2 || Math.abs(x + y - 255) < 2;

      let r;
      let g;
      let b;
      if (border || majorGrid) {
        r = 31;
        g = 41;
        b = 55;
      } else if (diagonal) {
        r = 255;
        g = 255;
        b = 255;
      } else {
        const checker = ((x >> 4) + (y >> 4)) % 2 === 0;
        if (x < 128 && y < 128) {
          [r, g, b] = checker ? [224, 82, 82] : [248, 180, 180];
        } else if (x >= 128 && y < 128) {
          [r, g, b] = checker ? [47, 158, 102] : [159, 226, 191];
        } else if (x < 128 && y >= 128) {
          [r, g, b] = checker ? [59, 116, 216] : [165, 196, 250];
        } else {
          [r, g, b] = checker ? [224, 165, 38] : [252, 224, 155];
        }
      }
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function proj4StringOf(crs) {
  if (crs?.epsg === 3857) return 'EPSG:3857';
  if (crs?.epsg === 4326) return 'EPSG:4326';
  if (crs?.proj4) return crs.proj4;
  throw new Error(`Unsupported CRS in fixture generator: ${JSON.stringify(crs)}`);
}

function roundNum(value, decimals = 10) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundPair(pair, decimals = 10) {
  return [roundNum(pair[0], decimals), roundNum(pair[1], decimals)];
}

async function runWorker(input, candidateId) {
  const response = await estimate(
    { type: 'estimate', requestId: 'j6-fixture', input, candidateId },
    new AbortController().signal,
  );
  assert.ok(response.selected, `estimation failed: ${response.status} ${response.failureReason ?? ''}`);
  return response;
}

/** 地図に入れる対応点（3857）。 */
function inputGcpsOf(gcpsLonLat) {
  return gcpsLonLat.map((g) => [g.pixel, roundPair(proj4('EPSG:4326', 'EPSG:3857', g.geo), 6)]);
}

/**
 * 推定パネルと同じ手順。最良候補（全候補の推定の 1 位）と、
 * 自動の採用先（乗り換えの規則を当てた後の CRS と形。「推奨のまま採用」）を分けて返す。
 */
async function runEstimation(inputGcps, vertexMode) {
  const gcps = estimateGcpsFromLayer(inputGcps, INPUT_CRS);
  assert.ok(gcps, 'input GCPs must convert to lon/lat');
  const input = { gcps, onshoreOnly: true };
  const response = await runWorker(input);
  const best = response.selected;
  const baseId = base3857CandidateId(response);
  const reestimated = baseId ? (await runWorker(input, baseId)).selected : null;
  const base3857Selected = resolveBase3857Selected(response, reestimated);
  const { plan, disabled } = adoptRecommendedPlan({ response, base3857Selected, vertexMode });
  assert.ok(plan, `recommended adoption is disabled: ${disabled}`);
  return {
    best,
    base3857Score: response.base3857Score,
    plan,
    recommendation: recommendTransformSetup(estimationResultFor(best), { vertexMode }),
    shouldRecommendSwitch: shouldRecommendCrsSwitch(best.score, response.base3857Score),
  };
}

/** 採用の処理（座標の変換と照合）を通した層。 */
async function adoptLayer({ inputGcps, selection, strictMode, vertexMode }) {
  const layer = transformLayerFromDocument('main', {
    crs: INPUT_CRS, gcps: inputGcps, edges: [], width: WH[0], height: WH[1], strictMode, vertexMode,
  });
  const prepared = await prepareCrsAdoption(layer, selection, new AbortController().signal);
  return { ...layer, ...prepared };
}

async function buildTin(layer) {
  const options = resolveTransformLayerTinOptions(layer);
  const tin = new Tin(options);
  assert.ok(applyTinGeometry(tin, options, { wh: WH }));
  tin.setPoints(layer.gcps);
  tin.setEdges(layer.edges);
  await tin.updateTinAsync();
  return tin;
}

async function computeKnownPixels(layer) {
  const probePixels = [
    [0, 0],
    [256, 0],
    [256, 256],
    [0, 256],
    [128, 128],
    [64, 96],
    [280, 128],
    [-24, 128],
  ];
  const { intent } = layer;
  const { crs } = intent;

  if (intent.setup === 'A') {
    const { worldFile } = intent;
    const surface = new WorldFileSurface({ crs, worldFile, wh: WH, projectionEngine });
    return {
      knownPixels: probePixels.map((pixel) => {
        const crsPt = worldFileToCrs(worldFile, pixel);
        const mercPt = surface.transform(pixel, false);
        assert.ok(Array.isArray(mercPt), 'WorldFileSurface forward failed');
        const geo = proj4('EPSG:3857', 'EPSG:4326', mercPt);
        return {
          pixel,
          crsCoord: roundPair(crsPt, 8),
          mercatorCoord: roundPair(mercPt, 8),
          geoLonLat: roundPair(geo, 10),
        };
      }),
    };
  }

  const crsProj = proj4StringOf(crs);
  const tin = await buildTin(layer);
  const compiled = tin.getCompiled();
  const mapTransform = new MapTransform();
  await mapTransform.setLayeredMapData({
    main: {
      kind: 'tin',
      compiled,
      crs,
      projectionEngine,
    },
    subMaps: [],
  });
  const localTransform = new Transform();
  localTransform.setCompiled(compiled);

  return {
    tin,
    compiled,
    knownPixels: probePixels.map((pixel) => {
      const crsPt = localTransform.transform(pixel, false);
      const mercResult = mapTransform.xy2MercWithLayer(pixel);
      assert.ok(Array.isArray(crsPt) && Array.isArray(mercResult), 'TIN transform failed');
      const mercPt = mercResult[1];
      const geo = proj4(crsProj, 'EPSG:4326', crsPt);
      return {
        pixel,
        crsCoord: roundPair(crsPt, 8),
        mercatorCoord: roundPair(mercPt, 8),
        geoLonLat: roundPair(geo, 10),
      };
    }),
  };
}

/** fixture の共通部分。`estimation` は最良候補、`autoAdoption` は「推奨のまま採用」が採る CRS と形。 */
function fixtureOf({ id, title, seed, strictMode, vertexMode = 'plain', inputGcps, est }) {
  const { best, plan } = est;
  return {
    id,
    title,
    seed,
    wh: WH,
    imageAsset: 'assets/grid-256.png',
    strictMode,
    vertexMode,
    inputMap: { crs: INPUT_CRS, gcps: inputGcps, edges: [] },
    estimation: {
      selectedId: best.id,
      crs: best.crs,
      coreCompatible: best.coreCompatible,
      score: roundNum(best.score, 10),
      rmsMeters: roundNum(best.rmsMeters, 6),
      base3857Score: roundNum(est.base3857Score, 10),
      shouldRecommendCrsSwitch: est.shouldRecommendSwitch,
      recommendation: est.recommendation,
      rawWorldFile: best.rawWorldFile,
      worldFile: best.worldFile,
      gcpsNew: best.gcpsNew.map((g) => ({ pixel: g.pixel, geo: roundPair(g.geo, 6) })),
    },
    autoAdoption: {
      crsChoice: plan.crsChoice,
      selectedId: plan.selection.selected.id,
      setup: plan.setup,
      score: roundNum(plan.selection.selected.score, 10),
    },
  };
}

/** B・BC の意図: 最良候補が 3857 でなく、乗り換えが勧められ、自動の採用先もその候補になる。 */
function assertSwitchRecommended(est) {
  assert.notEqual(est.best.id, BASE_ID);
  assert.equal(est.best.coreCompatible, true);
  assert.equal(est.shouldRecommendSwitch, true);
  assert.equal(est.plan.crsChoice, 'best');
  assert.equal(est.plan.selection.selected.id, est.best.id);
}

async function buildFixtureA() {
  const rng = mulberry32(PRNG_SEED + 1);
  const center = proj4('EPSG:4326', 'EPSG:3857', [135.755, 34.935]);
  const wf = {
    xScale: 5.0,
    xSkew: 0.3,
    xOrigin: center[0] - 640,
    ySkew: 0.3,
    yScale: -5.0,
    yOrigin: center[1] + 640,
  };
  const pixels = [
    [20, 20],
    [236, 20],
    [236, 236],
    [20, 236],
    [128, 92],
    [104, 172],
  ];
  const gcpsLonLat = pixels.map(([x, y]) => ({
    pixel: [x, y],
    geo: proj4('EPSG:3857', 'EPSG:4326', [
      wf.xScale * x + wf.xSkew * y + wf.xOrigin + (rng() - 0.5) * 3.0,
      wf.ySkew * x + wf.yScale * y + wf.yOrigin + (rng() - 0.5) * 3.0,
    ]),
  }));

  const inputGcps = inputGcpsOf(gcpsLonLat);
  const est = await runEstimation(inputGcps, 'plain');
  assert.equal(est.best.id, BASE_ID);
  assert.ok(est.best.score < 0.003);
  assert.deepEqual(est.recommendation.reason, 'clear');
  assert.deepEqual(est.recommendation.setups, ['worldFileOnly']);
  assert.equal(est.shouldRecommendSwitch, false);
  assert.equal(est.plan.selection.selected.id, BASE_ID);
  assert.equal(est.plan.setup, 'A');

  const layer = await adoptLayer({ inputGcps, selection: est.plan.selection, strictMode: 'strict', vertexMode: 'plain' });
  const { knownPixels } = await computeKnownPixels(layer);

  return {
    ...fixtureOf({
      id: 'fixture-a',
      title: 'Fixture A（伏見城図クラス・CRS＋ワールドファイルのみ推奨）',
      seed: PRNG_SEED + 1,
      strictMode: 'strict',
      inputGcps,
      est,
    }),
    expectedAdoption: {
      source: 'auto',
      selectedId: est.plan.selection.selected.id,
      setup: 'A',
      crs: layer.intent.crs,
      tinEnabled: false,
      knownPixels,
    },
  };
}

async function buildFixtureB() {
  // 1 画素 1600 m（図の一辺は約 410 km）。対応点のずれは画素の単位で与える
  const scale = 1600;
  const center = [550000, 7000000];
  const wf = {
    xScale: scale,
    xSkew: scale * 0.06,
    xOrigin: center[0] - 128 * scale * 1.06,
    ySkew: scale * 0.06,
    yScale: -scale,
    yOrigin: center[1] + 128 * scale * 0.94,
  };
  const pixels = [
    [24, 24],
    [232, 24],
    [232, 232],
    [24, 232],
    [96, 96],
    [160, 96],
    [160, 160],
    [96, 160],
  ];
  const offsets = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [4.4, -3.4],
    [-4, 4.4],
    [4, 4],
    [-4.4, -4],
  ];
  const gcpsLonLat = pixels.map(([x, y], i) => ({
    pixel: [x, y],
    geo: proj4(UTM33_PROJ4, 'EPSG:4326', [
      wf.xScale * x + wf.xSkew * y + wf.xOrigin + offsets[i][0] * scale,
      wf.ySkew * x + wf.yScale * y + wf.yOrigin + offsets[i][1] * scale,
    ]),
  }));

  const inputGcps = inputGcpsOf(gcpsLonLat);
  const est = await runEstimation(inputGcps, 'plain');
  assertSwitchRecommended(est);
  assert.ok(
    est.best.score >= 0.008 && est.best.score < 0.03,
    `Expected B score in [0.008, 0.030), got ${est.best.score}`,
  );
  assert.equal(est.recommendation.reason, 'clear');
  assert.deepEqual(est.recommendation.setups, ['tinGlobal']);
  assert.equal(est.plan.setup, 'B');

  const layer = await adoptLayer({ inputGcps, selection: est.plan.selection, strictMode: 'strict', vertexMode: 'plain' });
  const bComputed = await computeKnownPixels(layer);
  const bDiag = bComputed.tin.boundaryDiagnostics;
  assert.equal(bComputed.compiled.outerTransform, 'worldFile');
  assert.equal(bDiag?.outerTransform, 'worldFile');
  assert.ok(bDiag?.margin >= 0.1 && bDiag?.margin <= 0.225, `Unexpected margin: ${bDiag?.margin}`);

  // 左上の対応点を、図の外向きに 180 画素ぶん動かすと、境界が反転して外挿へ降格する
  const editedGcps = layer.gcps.map(([px, geo], idx) =>
    idx === 0 ? [px, roundPair([geo[0] - 180 * scale, geo[1] + 180 * scale], 6)] : [px, geo],
  );
  const tinEdited = await buildTin({ ...layer, gcps: editedGcps });
  assert.equal(tinEdited.boundaryDiagnostics?.requestedOuterTransform, 'worldFile');
  assert.equal(tinEdited.boundaryDiagnostics?.outerTransform, 'extrapolate');
  assert.equal(tinEdited.boundaryDiagnostics?.fallbackReason, 'boundaryFlips');
  assert.equal(tinEdited.getCompiled().outerTransform, 'extrapolate');

  return {
    ...fixtureOf({
      id: 'fixture-b',
      title: 'Fixture B（広域の合成地図・乗り換え推奨・三角網＋大域外挿推奨）',
      seed: PRNG_SEED + 2,
      strictMode: 'strict',
      inputGcps,
      est,
    }),
    expectedAdoption: {
      source: 'auto',
      selectedId: est.plan.selection.selected.id,
      setup: 'B',
      crs: layer.intent.crs,
      outerTransform: 'worldFile',
      margin: bDiag.margin,
      knownPixels: bComputed.knownPixels,
    },
    editToFallback: {
      gcpIndex: 0,
      editedGeo: editedGcps[0][1],
      expectedRequestedOuterTransform: 'worldFile',
      expectedOuterTransform: 'extrapolate',
      expectedFallbackReason: 'boundaryFlips',
    },
  };
}

async function buildFixtureBcFallback() {
  // 1 画素 2000 m（図の一辺は約 510 km）
  const scale = 2000;
  const center = [550000, 7000000];
  const wf = {
    xScale: scale,
    xSkew: scale * 0.0625,
    xOrigin: center[0] - 128 * scale * 1.0625,
    ySkew: scale * 0.0625,
    yScale: -scale,
    yOrigin: center[1] + 128 * scale * 0.9375,
  };
  const pixels = [
    [20, 20],
    [236, 20],
    [236, 236],
    [20, 236],
    [116, 16],
    [140, 16],
    [104, 128],
    [152, 160],
  ];
  const offsets = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [20, 0],
    [-20, 0],
    [5, -4],
    [-5, 4],
  ];
  const gcpsLonLat = pixels.map(([x, y], i) => ({
    pixel: [x, y],
    geo: proj4(UTM33_PROJ4, 'EPSG:4326', [
      wf.xScale * x + wf.xSkew * y + wf.xOrigin + offsets[i][0] * scale,
      wf.ySkew * x + wf.yScale * y + wf.yOrigin + offsets[i][1] * scale,
    ]),
  }));

  const inputGcps = inputGcpsOf(gcpsLonLat);
  const est = await runEstimation(inputGcps, 'plain');
  assertSwitchRecommended(est);
  assert.ok(
    est.best.score >= 0.03 && est.best.score < 0.04,
    `Expected BC borderline score in [0.030, 0.040), got ${est.best.score}`,
  );
  assert.equal(est.recommendation.reason, 'borderline');
  assert.equal(est.recommendation.setups.length, 2);
  assert.equal(est.plan.setup, 'B');

  const layer = await adoptLayer({ inputGcps, selection: est.plan.selection, strictMode: 'loose', vertexMode: 'plain' });
  const cComputed = await computeKnownPixels(layer);
  const diag = cComputed.tin.boundaryDiagnostics;
  assert.equal(diag?.requestedOuterTransform, 'worldFile');
  assert.equal(diag?.outerTransform, 'extrapolate');
  assert.equal(diag?.fallbackReason, 'boundaryFlips');
  assert.ok((diag?.boundaryTriangleFlips ?? 0) > 0, 'Expected boundaryTriangleFlips > 0');
  assert.equal(cComputed.compiled.outerTransform, 'extrapolate');
  assert.equal(cComputed.compiled.worldFile, undefined);

  return {
    ...fixtureOf({
      id: 'fixture-bc-fallback',
      title: 'Fixture BC-Fallback（広域の合成地図・乗り換え推奨・境界付近で B→C 降格）',
      seed: PRNG_SEED + 3,
      strictMode: 'loose',
      inputGcps,
      est,
    }),
    expectedAdoption: {
      source: 'auto',
      selectedId: est.plan.selection.selected.id,
      setup: 'B',
      persistedSetupOnReopen: 'C',
      crs: layer.intent.crs,
      requestedOuterTransform: 'worldFile',
      outerTransform: 'extrapolate',
      fallbackReason: 'boundaryFlips',
      boundaryTriangleFlips: diag.boundaryTriangleFlips,
      knownPixels: cComputed.knownPixels,
    },
  };
}

async function buildFixtureNon3857() {
  const wf = {
    xScale: 600,
    xSkew: 12,
    xOrigin: -70000,
    ySkew: 12,
    yScale: -600,
    yOrigin: 10000,
  };
  const pixels = [
    [20, 20],
    [236, 20],
    [236, 236],
    [20, 236],
    [128, 92],
    [104, 172],
  ];
  const offsets = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [240, -180],
    [-220, 200],
  ];
  const gcpsLonLat = pixels.map(([x, y], i) => ({
    pixel: [x, y],
    geo: proj4(EPSG_6674_PROJ4, 'EPSG:4326', [
      wf.xScale * x + wf.xSkew * y + wf.xOrigin + offsets[i][0],
      wf.ySkew * x + wf.yScale * y + wf.yOrigin + offsets[i][1],
    ]),
  }));

  const inputGcps = inputGcpsOf(gcpsLonLat);
  const est = await runEstimation(inputGcps, 'plain');
  assertSwitchRecommended(est);
  assert.ok(est.best.score <= est.base3857Score * 0.95);

  // この fixture は手動の採用（最良候補を選んだまま、形は B）を試す。推奨の形とは別に持つ
  const manualAdoption = { selectedId: est.best.id, setup: 'B' };
  const layer = await adoptLayer({
    inputGcps, selection: manualSelection(est.best, manualAdoption.setup), strictMode: 'strict', vertexMode: 'plain',
  });
  const bComputed = await computeKnownPixels(layer);
  assert.equal(bComputed.compiled.outerTransform, 'worldFile');

  return {
    ...fixtureOf({
      id: 'fixture-non3857',
      title: 'Fixture Non-3857（広域地図・3857 からの乗り換え推奨）',
      seed: PRNG_SEED + 4,
      strictMode: 'strict',
      inputGcps,
      est,
    }),
    manualAdoption,
    expectedAdoption: {
      source: 'manual',
      selectedId: manualAdoption.selectedId,
      setup: manualAdoption.setup,
      crs: layer.intent.crs,
      outerTransform: 'worldFile',
      knownPixels: bComputed.knownPixels,
    },
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  await initializeProjWasmRuntime({ enableNetwork: false });

  const pngBytes = buildDeterministicGridPng();
  // 推定ワーカーと同じく 1 件ずつ推定する
  const fixtures = [];
  for (const build of [buildFixtureA, buildFixtureB, buildFixtureBcFallback, buildFixtureNon3857]) {
    fixtures.push(await build());
  }

  if (mode === 'write') {
    await fs.mkdir(ASSET_DIR, { recursive: true });
    await fs.writeFile(GRID_PNG_PATH, pngBytes);
    for (const fixture of fixtures) {
      const target = path.join(FIXTURE_DIR, `${fixture.id}.json`);
      await fs.writeFile(target, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
    }
    console.log(
      `Wrote grid-256.png (${pngBytes.length} bytes, sha256=${sha256(pngBytes).slice(0, 12)}) and ${fixtures.length} fixtures.`,
    );
    return;
  }

  const existingPng = await fs.readFile(GRID_PNG_PATH);
  assert.ok(
    existingPng.equals(pngBytes),
    'grid-256.png does not match deterministic generator output',
  );
  for (const fixture of fixtures) {
    const target = path.join(FIXTURE_DIR, `${fixture.id}.json`);
    const existingText = await fs.readFile(target, 'utf8');
    const expectedText = JSON.stringify(fixture, null, 2) + '\n';
    assert.equal(existingText, expectedText, `${fixture.id}.json differs from deterministic generator`);
  }
  console.log(
    `OK: grid-256.png (${sha256(pngBytes).slice(0, 12)}) + 4 J6 CRS fixtures verified byte-for-byte.`,
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
