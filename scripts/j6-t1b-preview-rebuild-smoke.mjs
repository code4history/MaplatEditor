import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'vite';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const scratch = path.join(root, '.tmp-smoke');
await mkdir(scratch, { recursive: true });
const workDir = await mkdtemp(path.join(scratch, 'j6-t1b-preview-'));
const entry = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron.ts');
const storeStub = path.join(workDir, 'electron-store.ts');
const outDir = path.join(workDir, 'dist');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(electronStub, `
    export const app = { getPath: () => ${JSON.stringify(workDir)}, getName: () => 'MaplatEditorSmoke' };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const dialog = { async showOpenDialog() { return { canceled: true, filePaths: [] }; }, async showSaveDialog() { return { canceled: true }; } };
    export const BrowserWindow = class { static getAllWindows() { return []; } static fromWebContents() { return null; } };
    export const shell = { async trashItem() {} };
    export const session = { defaultSession: { async clearStorageData() {} } };
  `);
  await writeFile(storeStub, `export default class Store { constructor({ defaults = {} } = {}) { this.store = { ...defaults }; } get(k) { return this.store[k]; } set(k, v) { this.store[k] = v; } has(k) { return Object.hasOwn(this.store, k); } }`);
  await writeFile(entry, String.raw`
    import assert from 'node:assert/strict';
    import SettingsService from '../../electron/services/SettingsService';
    import SqliteDataService from '../../electron/services/SqliteDataService';
    import MapEditService from '../../electron/services/MapEditService';
    import WmtsGeneratorService from '../../electron/services/WmtsGeneratorService';
    import Tin from '@maplat/tin';
    import { Jimp } from 'jimp';
    import proj4 from 'proj4';
    import { mkdir, writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { resolveTinBuildOptions } from '../../src/utils/tinOptions';
    const root = process.argv[2];
    SettingsService.set('saveFolder', root);
    const db = await SqliteDataService.getDb();
    const gcps = [
      [[0, 0], [0, 0]], [[100, 0], [10000, 0]], [[100, 100], [10000, -10000]],
      [[0, 100], [0, -10000]], [[50, 50], [5000, -5000]],
    ];
    const base = { title: { ja: '投影試験' }, width: 100, height: 100, gcps, edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain' };
    const crs = { epsg: 6677, proj4: '+proj=tmerc +lat_0=36 +lon_0=139.833333333333 +k=0.9999 +ellps=GRS80 +towgs84=0,0,0 +units=m +axis=enu' };
    const projected = await SqliteDataService.createMap('preview-crs', { ...base, crs });
    const legacy = await SqliteDataService.createMap('preview-legacy', base);
    const generated = [];
    const getCompiled = Tin.prototype.getCompiled;
    Tin.prototype.getCompiled = function () {
      generated.push({ useV2Algorithm: this.useV2Algorithm, boundaryDiagnostics: this.boundaryDiagnostics });
      return getCompiled.call(this);
    };
    let projectedPreview;
    let legacyPreview;
    try {
      projectedPreview = await MapEditService.buildPreviewSource(projected.uid);
      legacyPreview = await MapEditService.buildPreviewSource(legacy.uid);
    } finally {
      Tin.prototype.getCompiled = getCompiled;
    }
    assert.ok(projectedPreview.compiled, '投影地図のプレビューで GCP から compiled が作られる');
    assert.equal(generated[0].useV2Algorithm, false, 'crs を持つプレビュー再構築は V4 を使う');
    assert.ok(generated[0].boundaryDiagnostics, 'crs を持つプレビュー再構築は V4 外周診断を持つ');
    assert.ok(legacyPreview.compiled, '従来地図のプレビューで GCP から compiled が作られる');
    assert.equal(generated[1].useV2Algorithm, true, 'crs がないプレビュー再構築は V2 のまま');
    assert.equal(generated[1].boundaryDiagnostics, undefined, 'V2 のプレビューには V4 外周診断がない');

    // WMTS の projected transform と TileJSON 範囲を、proj4 だけで独立に算出した値と照合する。
    const IX = { epsg: 6677, proj4: '+proj=tmerc +lat_0=36 +lon_0=139.833333333333 +k=0.9999 +ellps=GRS80 +towgs84=0,0,0 +units=m +axis=enu' };
    proj4.defs('EPSG:6677', IX.proj4);
    const worldFile = { xScale: 100, xSkew: 0, xOrigin: 500, ySkew: 0, yScale: -100, yOrigin: 1000 };
    const projectedGCPs = [[[0, 0], [450, 1050]], [[300, 0], [30450, 1050]], [[300, 260], [30450, -24950]], [[0, 260], [450, -24950]], [[150, 130], [15450, -12950]]];
    const projectedCompiled = {};
    for (const intent of ['B', 'C']) {
      const layer = { crs: IX, worldFile, compiled: { outerTransform: intent === 'B' ? 'worldFile' : 'extrapolate', worldFile } };
      const tin = new Tin(resolveTinBuildOptions(layer, { strictMode: 'loose', vertexMode: 'plain' }, intent));
      tin.setWh([300, 260]); tin.setStrictMode('loose'); tin.setVertexMode('plain'); tin.setPoints(projectedGCPs); tin.setEdges([]); await tin.updateTinAsync();
      projectedCompiled[intent] = { ...tin.getCompiled(), outerTransform: intent === 'B' ? 'worldFile' : 'extrapolate', ...(intent === 'B' ? { worldFile } : {}) };
    }
    const originalDir = path.join(root, 'originals');
    await mkdir(originalDir, { recursive: true });
    await new Jimp({ width: 300, height: 260, color: 0xffffffff }).write(path.join(originalDir, 'wmts-ix.png'));
    const HALF = 20037508.342789244;
    const toWgs84 = ([x, y]) => [x / HALF * 180, 180 / Math.PI * (2 * Math.atan(Math.exp(y / HALF * Math.PI)) - Math.PI / 2)];
    const toMercator = ([x, y]) => proj4('EPSG:6677', 'EPSG:3857', [x, y]);
    const mapPoint = (x, y) => [worldFile.xOrigin + worldFile.xScale * (x - 0.5), worldFile.yOrigin + worldFile.yScale * (y - 0.5)];
    const width = 300, height = 260;
    const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => toMercator(mapPoint(x, y)));
    const diagonal = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const pixelLongest = Math.hypot(width, height);
    const mapRate = Math.min(diagonal(corners[0], corners[2]), diagonal(corners[1], corners[3])) / pixelLongest;
    const maxZoom = Math.ceil(Math.log2(HALF * 2 / 256 / mapRate));
    const minZoom = maxZoom - Math.ceil(Math.log2(Math.min(width, height) / 256));
    const edgeValues = [...corners];
    for (let px = 1; px < width; px++) {
      edgeValues.push(toMercator(mapPoint(px, 0)), toMercator(mapPoint(px, height)));
    }
    for (let py = 1; py < height; py++) {
      edgeValues.push(toMercator(mapPoint(0, py)), toMercator(mapPoint(width, py)));
    }
    const txs = edgeValues.map(([x]) => x), tys = edgeValues.map(([, y]) => y);
    const tileXw = Math.floor((Math.min(...txs) + HALF) / (2 * HALF) * 256 * 2 ** maxZoom / 256);
    const tileXe = Math.floor((Math.max(...txs) + HALF) / (2 * HALF) * 256 * 2 ** maxZoom / 256);
    const tileYn = Math.floor((HALF - Math.max(...tys)) / (2 * HALF) * 256 * 2 ** maxZoom / 256);
    const tileYs = Math.floor((HALF - Math.min(...tys)) / (2 * HALF) * 256 * 2 ** maxZoom / 256);
    const unit = 2 * HALF / 2 ** maxZoom;
    const expectedBounds = [
      toWgs84([tileXw * unit - HALF, 0])[0],
      toWgs84([0, HALF - (tileYs + 1) * unit])[1],
      toWgs84([(tileXe + 1) * unit - HALF, 0])[0],
      toWgs84([0, HALF - tileYn * unit])[1],
    ];
    console.log('WMTS expected range: ' + JSON.stringify({ maxZoom, minZoom, tileXw, tileXe, tileYn, tileYs, expectedBounds }));
    for (const intent of ['B', 'C']) {
      const uid = 'wmts-ix-' + intent.toLowerCase();
      await writeFile(path.join(originalDir, uid + '.png'), await (await Jimp.read(path.join(originalDir, 'wmts-ix.png'))).getBuffer('image/png'));
      const result = await WmtsGeneratorService.generate({ webContents: { send() {} }, isDestroyed: () => false }, uid, uid, width, height, projectedCompiled[intent], 'png', 'smoke', uid, IX);
      assert.ifError(result.err);
      assert.equal(result.tileJson.maxzoom, maxZoom, 'WMTS maximum zoom matches independent projection');
      assert.equal(result.tileJson.minzoom, minZoom, 'WMTS minimum zoom matches independent projection');
      result.tileJson.bounds.forEach((value, i) => assert.ok(Math.abs(value - expectedBounds[i]) < 1e-7, 'WMTS bound matches independent proj4 range: ' + value + ' vs ' + expectedBounds[i]));
      console.log('WMTS IX ' + intent + ' bounds delta: ' + Math.max(...result.tileJson.bounds.map((value, i) => Math.abs(value - expectedBounds[i]))));
    }
    await db.close();
    console.log('MapEditService preview rebuild smoke: PASS');
  `);
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { electron: electronStub, 'electron-store': storeStub } },
    build: { ssr: entry, outDir, target: 'node22', rollupOptions: { output: { entryFileNames: 'entry.mjs' } } },
  });
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(outDir, 'entry.mjs'), dataDir]);
  process.stdout.write(stdout);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
