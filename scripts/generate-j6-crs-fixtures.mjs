#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import proj4 from 'proj4';
import {
  createCandidateTransformer,
  initializeProjWasmRuntime,
  listProjectedCrsFromProjWasm,
} from '@c4h/atlas';
import {
  estimateCrs,
  recommendTransformSetup,
  shouldRecommendCrsSwitch,
} from '@c4h/teiresias';
import Tin from '@maplat/tin';
import {
  MapTransform,
  Transform,
  WorldFileSurface,
  createProj4ProjectionEngine,
  worldFileToCrs,
} from '@maplat/transform';
import {
  describeCandidate,
  toCenteredWorldFile,
} from '../electron/workers/crsEstimationProcess.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'j6-crs');
const ASSET_DIR = path.join(FIXTURE_DIR, 'assets');
const GRID_PNG_PATH = path.join(ASSET_DIR, 'grid-256.png');

const PRNG_SEED = 20270106;
const EPSG_6674_PROJ4 =
  '+proj=tmerc +lat_0=36 +lon_0=136 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
const BASELINE_CANDIDATE = {
  id: 'EPSG:3857',
  authority: 'EPSG',
  code: '3857',
  name: 'WGS 84 / Pseudo-Mercator',
  proj4:
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +type=crs',
};

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

async function runEstimation(gcpsLonLat, preferredCandidateId) {
  const lon = gcpsLonLat.map((g) => g.geo[0]);
  const lat = gcpsLonLat.map((g) => g.geo[1]);
  const rows = await listProjectedCrsFromProjWasm({
    extent: {
      west: Math.min(...lon),
      south: Math.min(...lat),
      east: Math.max(...lon),
      north: Math.max(...lat),
    },
    onshoreOnly: true,
    includeCustomProjections: false,
  });
  if (!rows.some((r) => r.id === BASELINE_CANDIDATE.id)) rows.push(BASELINE_CANDIDATE);

  const transformAll = createCandidateTransformer(rows);
  const transformedAll = new Map();
  const fullRes = await estimateCrs(gcpsLonLat, rows, {
    geoBasis: { kind: 'lonlat_deg', axisOrder: 'lon-lat' },
    timeoutMs: 10_000,
    transformer: async (id, pts, basis) => {
      const converted = await transformAll(id, pts, basis);
      if (converted) transformedAll.set(id, Array.isArray(converted) ? converted : converted.points);
      return converted;
    },
  });

  const base3857Score =
    fullRes.ranked.find((r) => r.authority === 'EPSG' && r.code === '3857')?.score ?? null;
  let activeRes = fullRes;
  let activePtsMap = transformedAll;
  let selectedId = `${fullRes.selected.identity.authority}:${fullRes.selected.identity.code}`;

  if (preferredCandidateId && preferredCandidateId !== selectedId) {
    const singleRows = rows.filter((r) => r.id === preferredCandidateId);
    assert.equal(singleRows.length, 1, `Candidate ${preferredCandidateId} must exist`);
    const singleTransform = createCandidateTransformer(singleRows);
    const singlePts = new Map();
    activeRes = await estimateCrs(gcpsLonLat, singleRows, {
      geoBasis: { kind: 'lonlat_deg', axisOrder: 'lon-lat' },
      timeoutMs: 10_000,
      transformer: async (id, pts, basis) => {
        const converted = await singleTransform(id, pts, basis);
        if (converted) singlePts.set(id, Array.isArray(converted) ? converted : converted.points);
        return converted;
      },
    });
    activePtsMap = singlePts;
    selectedId = preferredCandidateId;
  }

  const candidateRow = rows.find((r) => r.id === selectedId);
  assert.ok(candidateRow, `Row ${selectedId} missing`);
  const desc = describeCandidate(candidateRow);
  const rawWorldFile = activeRes.selected.worldFile;
  const worldFile = toCenteredWorldFile(rawWorldFile);
  const crsPoints = activePtsMap.get(selectedId);
  assert.ok(crsPoints && crsPoints.length === gcpsLonLat.length, 'Transformed points missing');

  return {
    fullRes,
    activeRes,
    base3857Score,
    selectedId,
    desc,
    rawWorldFile,
    worldFile,
    crsPoints,
    recommendation: recommendTransformSetup(activeRes),
    shouldRecommendSwitch: shouldRecommendCrsSwitch(
      fullRes.selected?.score ?? null,
      base3857Score,
    ),
  };
}

async function computeKnownPixels({ setup, crs, worldFile, gcps, edges, strictMode, vertexMode }) {
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
  const crsProj = proj4StringOf(crs);

  if (setup === 'A') {
    const surface = new WorldFileSurface({ crs, worldFile, wh: [256, 256], projectionEngine });
    return probePixels.map((pixel) => {
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
    });
  }

  const outerTransform = setup === 'B' ? 'worldFile' : 'extrapolate';
  const tin = new Tin({
    wh: [256, 256],
    points: gcps,
    edges,
    strictMode,
    vertexMode,
    useV2Algorithm: false,
    outerTransform,
    ...(setup === 'B' ? { worldFile } : {}),
  });
  await tin.updateTinAsync();
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

  const est = await runEstimation(gcpsLonLat);
  assert.equal(est.desc.id, 'EPSG:3857');
  assert.ok(est.activeRes.selected.score < 0.003);
  assert.deepEqual(est.recommendation.reason, 'clear');
  assert.deepEqual(est.recommendation.setups, ['worldFileOnly']);
  assert.equal(est.shouldRecommendSwitch, false);

  const gcpsMerc = gcpsLonLat.map((g, i) => [g.pixel, roundPair(est.crsPoints[i], 6)]);
  const knownPixels = await computeKnownPixels({
    setup: 'A',
    crs: est.desc.crs,
    worldFile: est.worldFile,
    gcps: gcpsMerc,
    edges: [],
    strictMode: 'strict',
    vertexMode: 'plain',
  });

  return {
    id: 'fixture-a',
    title: 'Fixture A（伏見城図クラス・CRS＋ワールドファイルのみ推奨）',
    seed: PRNG_SEED + 1,
    wh: [256, 256],
    imageAsset: 'assets/grid-256.png',
    strictMode: 'strict',
    vertexMode: 'plain',
    inputMap: {
      crs: { epsg: 3857 },
      gcps: gcpsLonLat.map((g) => [g.pixel, roundPair(proj4('EPSG:4326', 'EPSG:3857', g.geo), 6)]),
      edges: [],
    },
    estimation: {
      selectedId: est.selectedId,
      crs: est.desc.crs,
      coreCompatible: est.desc.coreCompatible,
      score: roundNum(est.activeRes.selected.score, 10),
      rmsMeters: roundNum(est.activeRes.selected.rmsMeters, 6),
      base3857Score: roundNum(est.base3857Score, 10),
      shouldRecommendCrsSwitch: est.shouldRecommendSwitch,
      recommendation: est.recommendation,
      rawWorldFile: est.rawWorldFile,
      worldFile: est.worldFile,
      gcpsNew: gcpsLonLat.map((g, i) => ({ pixel: g.pixel, geo: roundPair(est.crsPoints[i], 6) })),
    },
    expectedAdoption: {
      setup: 'A',
      crs: est.desc.crs,
      tinEnabled: false,
      knownPixels,
    },
  };
}

async function buildFixtureB() {
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
    [22, -17],
    [-20, 22],
    [20, 20],
    [-22, -20],
  ];
  const gcpsLonLat = pixels.map(([x, y], i) => ({
    pixel: [x, y],
    geo: proj4('EPSG:3857', 'EPSG:4326', [
      wf.xScale * x + wf.xSkew * y + wf.xOrigin + offsets[i][0],
      wf.ySkew * x + wf.yScale * y + wf.yOrigin + offsets[i][1],
    ]),
  }));

  const est = await runEstimation(gcpsLonLat);
  assert.ok(
    est.activeRes.selected.score >= 0.008 && est.activeRes.selected.score < 0.03,
    `Expected B score in [0.008, 0.030), got ${est.activeRes.selected.score}`,
  );
  assert.equal(est.recommendation.reason, 'clear');
  assert.deepEqual(est.recommendation.setups, ['tinGlobal']);

  const gcpsCrs = gcpsLonLat.map((g, i) => [g.pixel, roundPair(est.crsPoints[i], 6)]);
  const bComputed = await computeKnownPixels({
    setup: 'B',
    crs: est.desc.crs,
    worldFile: est.worldFile,
    gcps: gcpsCrs,
    edges: [],
    strictMode: 'strict',
    vertexMode: 'plain',
  });
  const bDiag = bComputed.tin.boundaryDiagnostics;
  assert.equal(bComputed.compiled.outerTransform, 'worldFile');
  assert.equal(bDiag?.outerTransform, 'worldFile');
  assert.ok(bDiag?.margin >= 0.1 && bDiag?.margin <= 0.225, `Unexpected margin: ${bDiag?.margin}`);

  const editedGcpsCrs = gcpsCrs.map(([px, geo], idx) =>
    idx === 0 ? [px, roundPair([geo[0] - 900, geo[1] + 900], 6)] : [px, geo],
  );
  const tinEdited = new Tin({
    wh: [256, 256],
    points: editedGcpsCrs,
    edges: [],
    strictMode: 'strict',
    vertexMode: 'plain',
    useV2Algorithm: false,
    outerTransform: 'worldFile',
    worldFile: est.worldFile,
  });
  await tinEdited.updateTinAsync();
  assert.equal(tinEdited.boundaryDiagnostics?.requestedOuterTransform, 'worldFile');
  assert.equal(tinEdited.boundaryDiagnostics?.outerTransform, 'extrapolate');
  assert.equal(tinEdited.boundaryDiagnostics?.fallbackReason, 'boundaryFlips');
  assert.equal(tinEdited.getCompiled().outerTransform, 'extrapolate');

  return {
    id: 'fixture-b',
    title: 'Fixture B（延岡・広島城クラス・三角網＋大域外挿推奨）',
    seed: PRNG_SEED + 2,
    wh: [256, 256],
    imageAsset: 'assets/grid-256.png',
    strictMode: 'strict',
    vertexMode: 'plain',
    inputMap: {
      crs: { epsg: 3857 },
      gcps: gcpsLonLat.map((g) => [g.pixel, roundPair(proj4('EPSG:4326', 'EPSG:3857', g.geo), 6)]),
      edges: [],
    },
    estimation: {
      selectedId: est.selectedId,
      crs: est.desc.crs,
      coreCompatible: est.desc.coreCompatible,
      score: roundNum(est.activeRes.selected.score, 10),
      rmsMeters: roundNum(est.activeRes.selected.rmsMeters, 6),
      base3857Score: roundNum(est.base3857Score, 10),
      shouldRecommendCrsSwitch: est.shouldRecommendSwitch,
      recommendation: est.recommendation,
      rawWorldFile: est.rawWorldFile,
      worldFile: est.worldFile,
      gcpsNew: gcpsLonLat.map((g, i) => ({ pixel: g.pixel, geo: roundPair(est.crsPoints[i], 6) })),
    },
    expectedAdoption: {
      setup: 'B',
      crs: est.desc.crs,
      outerTransform: 'worldFile',
      margin: bDiag.margin,
      knownPixels: bComputed.knownPixels,
    },
    editToFallback: {
      gcpIndex: 0,
      editedGeo: editedGcpsCrs[0][1],
      expectedRequestedOuterTransform: 'worldFile',
      expectedOuterTransform: 'extrapolate',
      expectedFallbackReason: 'boundaryFlips',
    },
  };
}

async function buildFixtureBcFallback() {
  const wf = {
    xScale: 4.0,
    xSkew: 0.25,
    xOrigin: -22500,
    ySkew: 0.25,
    yScale: -4.0,
    yOrigin: -117500,
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
    [80, 0],
    [-80, 0],
    [20, -16],
    [-20, 16],
  ];
  const gcpsLonLat = pixels.map(([x, y], i) => ({
    pixel: [x, y],
    geo: proj4(EPSG_6674_PROJ4, 'EPSG:4326', [
      wf.xScale * x + wf.xSkew * y + wf.xOrigin + offsets[i][0],
      wf.ySkew * x + wf.yScale * y + wf.yOrigin + offsets[i][1],
    ]),
  }));

  const est = await runEstimation(gcpsLonLat);
  assert.ok(
    est.activeRes.selected.score >= 0.03 && est.activeRes.selected.score < 0.04,
    `Expected BC borderline score in [0.030, 0.040), got ${est.activeRes.selected.score}`,
  );
  assert.equal(est.recommendation.reason, 'borderline');
  assert.equal(est.recommendation.setups.length, 2);

  const gcpsCrs = gcpsLonLat.map((g, i) => [g.pixel, roundPair(est.crsPoints[i], 6)]);
  const cComputed = await computeKnownPixels({
    setup: 'B',
    crs: est.desc.crs,
    worldFile: est.worldFile,
    gcps: gcpsCrs,
    edges: [],
    strictMode: 'loose',
    vertexMode: 'plain',
  });
  const diag = cComputed.tin.boundaryDiagnostics;
  assert.equal(diag?.requestedOuterTransform, 'worldFile');
  assert.equal(diag?.outerTransform, 'extrapolate');
  assert.equal(diag?.fallbackReason, 'boundaryFlips');
  assert.ok((diag?.boundaryTriangleFlips ?? 0) > 0, 'Expected boundaryTriangleFlips > 0');
  assert.equal(cComputed.compiled.outerTransform, 'extrapolate');
  assert.equal(cComputed.compiled.worldFile, undefined);

  return {
    id: 'fixture-bc-fallback',
    title: 'Fixture BC-Fallback（奈良町絵図 v2 型・境界付近で B→C 降格）',
    seed: PRNG_SEED + 3,
    wh: [256, 256],
    imageAsset: 'assets/grid-256.png',
    strictMode: 'loose',
    vertexMode: 'plain',
    inputMap: {
      crs: { epsg: 3857 },
      gcps: gcpsLonLat.map((g) => [g.pixel, roundPair(proj4('EPSG:4326', 'EPSG:3857', g.geo), 6)]),
      edges: [],
    },
    estimation: {
      selectedId: est.selectedId,
      crs: est.desc.crs,
      coreCompatible: est.desc.coreCompatible,
      score: roundNum(est.activeRes.selected.score, 10),
      rmsMeters: roundNum(est.activeRes.selected.rmsMeters, 6),
      base3857Score: roundNum(est.base3857Score, 10),
      shouldRecommendCrsSwitch: est.shouldRecommendSwitch,
      recommendation: est.recommendation,
      rawWorldFile: est.rawWorldFile,
      worldFile: est.worldFile,
      gcpsNew: gcpsLonLat.map((g, i) => ({ pixel: g.pixel, geo: roundPair(est.crsPoints[i], 6) })),
    },
    expectedAdoption: {
      setup: 'B',
      persistedSetupOnReopen: 'C',
      crs: est.desc.crs,
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

  const est = await runEstimation(gcpsLonLat);
  assert.notEqual(est.desc.crs.epsg, 3857);
  assert.equal(est.desc.coreCompatible, true);
  assert.equal(est.shouldRecommendSwitch, true);
  assert.ok(est.activeRes.selected.score <= est.base3857Score * 0.95);

  const gcpsCrs = gcpsLonLat.map((g, i) => [g.pixel, roundPair(est.crsPoints[i], 6)]);
  const bComputed = await computeKnownPixels({
    setup: 'B',
    crs: est.desc.crs,
    worldFile: est.worldFile,
    gcps: gcpsCrs,
    edges: [],
    strictMode: 'strict',
    vertexMode: 'plain',
  });
  assert.equal(bComputed.compiled.outerTransform, 'worldFile');

  return {
    id: 'fixture-non3857',
    title: 'Fixture Non-3857（広域地図・3857 からの乗り換え推奨）',
    seed: PRNG_SEED + 4,
    wh: [256, 256],
    imageAsset: 'assets/grid-256.png',
    strictMode: 'strict',
    vertexMode: 'plain',
    inputMap: {
      crs: { epsg: 3857 },
      gcps: gcpsLonLat.map((g) => [g.pixel, roundPair(proj4('EPSG:4326', 'EPSG:3857', g.geo), 6)]),
      edges: [],
    },
    estimation: {
      selectedId: est.selectedId,
      crs: est.desc.crs,
      coreCompatible: est.desc.coreCompatible,
      score: roundNum(est.activeRes.selected.score, 10),
      rmsMeters: roundNum(est.activeRes.selected.rmsMeters, 6),
      base3857Score: roundNum(est.base3857Score, 10),
      shouldRecommendCrsSwitch: est.shouldRecommendSwitch,
      recommendation: est.recommendation,
      rawWorldFile: est.rawWorldFile,
      worldFile: est.worldFile,
      gcpsNew: gcpsLonLat.map((g, i) => ({ pixel: g.pixel, geo: roundPair(est.crsPoints[i], 6) })),
    },
    expectedAdoption: {
      setup: 'B',
      crs: est.desc.crs,
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
  const fixtures = await Promise.all([
    buildFixtureA(),
    buildFixtureB(),
    buildFixtureBcFallback(),
    buildFixtureNon3857(),
  ]);

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
