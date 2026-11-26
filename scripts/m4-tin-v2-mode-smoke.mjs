// 三角網の作り方（resolveTinBuildOptions）の実動作検査。
//   (a) crs の無い地図は、従来の new Tin({ useV2Algorithm: true }) と compiled・往復の変換が完全に一致する。
//   (b) worker・ipc/mapedit・MapEditService・WmtsGeneratorService の各経路を実際に動かし、
//       渡った Tin の作り方（コンストラクタの引数と、計算を始める時点の strict／vertex／yaxis など）を
//       記録して、resolveTinBuildOptions の結果と一致することを確かめる。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'vite';
import Tin from '@maplat/tin';
import { applyTinGeometry, resolveTinBuildOptions } from '../src/utils/tinOptions.ts';

const root = path.resolve(new URL('..', import.meta.url).pathname);

// ---------------- 判定そのもの ----------------
const worldFile = { xScale: 1, xSkew: 0, xOrigin: 0, ySkew: 0, yScale: -1, yOrigin: 0 };
assert.deepEqual(resolveTinBuildOptions({}), { useV2Algorithm: true }, 'crs 無しは V2');
assert.deepEqual(
  resolveTinBuildOptions({ compiled: { outerTransform: 'worldFile', worldFile }, crs: undefined }),
  { useV2Algorithm: true }, 'crs が undefined なら compiled に world file があっても V2');
assert.equal(resolveTinBuildOptions({ tinEnabled: false, crs: { epsg: 6677 }, worldFile }), null, 'A は三角網を作らない（null）');
assert.deepEqual(
  resolveTinBuildOptions({ crs: { epsg: 3857 }, compiled: {} }),
  { useV2Algorithm: false, outerTransform: 'extrapolate' }, 'C + 3857 は extrapolate を明示する');
assert.deepEqual(
  resolveTinBuildOptions({ crs: { epsg: 6677 } }, {}, 'C'),
  { useV2Algorithm: false, outerTransform: 'extrapolate' }, 'C は常に extrapolate を明示する');
assert.deepEqual(
  resolveTinBuildOptions({ crs: { epsg: 6677 }, compiled: { outerTransform: 'worldFile', worldFile } }),
  { useV2Algorithm: false, outerTransform: 'worldFile', worldFile }, 'B は world file 外周');
assert.deepEqual(
  resolveTinBuildOptions({ crs: { epsg: 6677 }, compiled: { outerTransform: 'worldFile', worldFile } }, {}, 'C'),
  { useV2Algorithm: false, outerTransform: 'extrapolate' }, 'C への降格は extrapolate');
assert.deepEqual(
  resolveTinBuildOptions({ crs: { epsg: 6677 }, yaxisMode: 'follow', compiled: { yaxisMode: 'invert' } }, { strictMode: 'loose', vertexMode: 'birdeye' }),
  { useV2Algorithm: false, strictMode: 'loose', vertexMode: 'birdeye', yaxisMode: 'follow', outerTransform: 'extrapolate' },
  'yaxisMode は引数、層の直下、compiled の順');
assert.deepEqual(
  resolveTinBuildOptions({ crs: { epsg: 6677 }, compiled: { yaxisMode: 'follow' } }),
  { useV2Algorithm: false, outerTransform: 'extrapolate', yaxisMode: 'follow' }, '投影済みの層では compiled の yaxisMode を使う');
assert.deepEqual(
  resolveTinBuildOptions({ yaxisMode: 'follow', compiled: { yaxisMode: 'follow' } }, { yaxisMode: 'follow' }),
  { useV2Algorithm: true }, '従来 V2 の生成では内部軸の既定を使う');
assert.throws(() => resolveTinBuildOptions({ crs: { epsg: 6677 } }, {}, 'B'), /ワールドファイル/);
// 主図だけ crs を持つ混在は層ごとに判定する。
assert.equal(resolveTinBuildOptions({ crs: { epsg: 6677 } }).useV2Algorithm, false);
assert.equal(resolveTinBuildOptions({}).useV2Algorithm, true);

// ---------------- (a) crs の無い地図は従来の V2 と完全に一致 ----------------
const gcps = [
  [[0, 0], [1000, 0]], [[100, 0], [1100, 0]], [[100, 80], [1100, -80]], [[0, 80], [1000, -80]],
  [[50, 40], [1052, -37]], [[20, 60], [1018, -61]],
];
const representativePoints = [[10, 10], [50, 40], [90, 70], [30, 75], [75, 15]];

async function legacyV2(geometry, strictMode, vertexMode) {
  const tin = new Tin({ useV2Algorithm: true });
  if (geometry.wh) tin.setWh(geometry.wh); else tin.setBounds(geometry.bounds);
  tin.setStrictMode(strictMode);
  tin.setVertexMode(vertexMode);
  tin.setPoints(gcps);
  tin.setEdges([]);
  await tin.updateTinAsync();
  return tin;
}
async function resolved(layer, geometry, strictMode, vertexMode) {
  const options = resolveTinBuildOptions(layer, { strictMode, vertexMode });
  const tin = new Tin(options);
  assert.ok(applyTinGeometry(tin, options, geometry));
  tin.setPoints(gcps);
  tin.setEdges([]);
  await tin.updateTinAsync();
  return tin;
}
const geometries = [
  { name: '主図（wh）', wh: [100, 80] },
  { name: '副層（bounds）', bounds: [[0, 0], [100, 0], [100, 80], [0, 80]] },
];
for (const geometry of geometries) {
  for (const [strictMode, vertexMode] of [['strict', 'plain'], ['loose', 'birdeye'], ['auto', 'birdeye']]) {
    const expected = await legacyV2(geometry, strictMode, vertexMode);
    const actual = await resolved({}, geometry, strictMode, vertexMode);
    const label = `${geometry.name} ${strictMode}/${vertexMode}`;
    assert.equal(actual.useV2Algorithm, true, `${label}: V2`);
    assert.equal(actual.boundaryDiagnostics, undefined, `${label}: V2 に外周の診断は無い`);
    assert.deepEqual(actual.getCompiled(), expected.getCompiled(), `${label}: compiled が従来の V2 と一致`);
    for (const point of representativePoints) {
      assert.deepEqual(actual.transform(point, false, true), expected.transform(point, false, true), `${label}: 順変換 ${point}`);
      const forward = expected.transform(point, false, true);
      assert.deepEqual(actual.transform(forward, true, true), expected.transform(forward, true, true), `${label}: 逆変換 ${point}`);
    }
  }
}

// 推定・比較の状態に CRS 候補があっても、層直下に crs が無ければ V2 のまま。
{
  const unadopted = await resolved({ compiled: { version: 4, outerTransform: 'worldFile' }, estimateResult: { crs: { epsg: 6674 } } }, geometries[0], 'strict', 'plain');
  assert.equal(unadopted.useV2Algorithm, true);
  assert.equal(unadopted.boundaryDiagnostics, undefined);
  // 採用済み地図では Tin が V4 外周を計算し、診断を保持する。
  const adopted = await resolved({ crs: { epsg: 3857 }, compiled: {} }, geometries[0], 'strict', 'plain');
  assert.equal(adopted.useV2Algorithm, false);
  assert.ok(adopted.boundaryDiagnostics, 'V4 は外周の診断を持つ');
  assert.equal(adopted.boundaryDiagnostics.requestedOuterTransform, undefined, 'C は world file を要求していない');
}
console.log('ok: (a) crs の無い地図は従来の V2 と compiled・往復変換が一致し、crs のある地図だけ V4 になる');

// ---------------- (b) 各経路を実際に動かして Tin の作り方を記録する ----------------
const scratch = path.join(root, '.tmp-smoke');
await mkdir(scratch, { recursive: true });
const workDir = await mkdtemp(path.join(scratch, 'm4-tin-v2-'));
const realTinUrl = import.meta.resolve('@maplat/tin');
try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  const files = {
    electron: path.join(workDir, 'electron.ts'),
    store: path.join(workDir, 'electron-store.ts'),
    recorder: path.join(workDir, 'tin-recorder.ts'),
    shim: path.join(workDir, 'self-shim.ts'),
    entry: path.join(workDir, 'entry.ts'),
  };
  await writeFile(files.electron, `
    export const __handlers = new Map<string, any>();
    export const app = { isPackaged: true, getPath: () => ${JSON.stringify(workDir)}, getName: () => 'MaplatEditorSmoke', getVersion: () => '0.0.0-smoke', whenReady: () => Promise.resolve(), exit() {} };
    export const ipcMain = {
      handle(channel: string, fn: any) { __handlers.set(channel, fn); },
      removeHandler(channel: string) { __handlers.delete(channel); },
      on() {}, removeAllListeners() {},
    };
    export const dialog = { async showOpenDialog() { return { canceled: true, filePaths: [] }; }, async showSaveDialog() { return { canceled: true }; }, async showMessageBox() { return { response: 0 }; } };
    export const clipboard = { writeText() {}, readText() { return ''; }, clear() {} };
    export const BrowserWindow = class { static getAllWindows() { return []; } static fromWebContents() { return null; } };
    export const shell = { async trashItem() {}, async openPath() { return ''; } };
    export const session = { defaultSession: { async clearStorageData() {} } };
  `);
  await writeFile(files.store, `export default class Store { constructor({ defaults = {} } = {}) { this.store = { ...defaults }; } get(k) { return this.store[k]; } set(k, v) { this.store[k] = v; } has(k) { return Object.hasOwn(this.store, k); } delete(k) { delete this.store[k]; } }`);
  // Tin を包んで、コンストラクタの引数と計算開始時の状態を記録する（本物の Tin を継承するので計算は本物）。
  await writeFile(files.recorder, `
    const REAL_TIN_URL = ${JSON.stringify(realTinUrl)};
    const RealTin: any = (await import(/* @vite-ignore */ REAL_TIN_URL)).Tin;
    export const tinLog: any[] = ((globalThis as any).__tinLog ??= []);
    export class Tin extends RealTin {
      constructor(options?: any) {
        super(options);
        tinLog.push({ options: options === undefined ? undefined : structuredClone(options), snapshot: null, tin: this });
      }
      async updateTinAsync(...args: any[]) {
        const entry = tinLog.findLast((e) => e.tin === this);
        if (entry) {
          entry.snapshot = {
            strictMode: this.strictMode, vertexMode: this.vertexMode, yaxisMode: this.yaxisMode,
            useV2Algorithm: this.useV2Algorithm, requestedWorldFile: this.requestedWorldFile,
          };
        }
        return super.updateTinAsync(...args);
      }
    }
    export default Tin;
  `);
  await writeFile(files.shim, `
    const posted: any[] = [];
    (globalThis as any).self = { onmessage: null, postMessage(message: any) { posted.push(message); }, __posted: posted };
  `);
  await writeFile(files.entry, String.raw`
    import './self-shim';
    import assert from 'node:assert/strict';
    import { mkdir, writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { Jimp } from 'jimp';
    import { __handlers } from 'electron';
    import Tin, { tinLog } from './tin-recorder';
    import SettingsService from '../../electron/services/SettingsService';
    import MapEditService from '../../electron/services/MapEditService';
    import WmtsGeneratorService from '../../electron/services/WmtsGeneratorService';
    import { registerMapEditHandlers } from '../../electron/ipc/mapedit';
    import '../../src/workers/tinComputeWorker';
    import { resolveTinBuildOptions } from '../../src/utils/tinOptions';

    const root = process.argv[2];
    SettingsService.set('saveFolder', root);
    const selfScope: any = (globalThis as any).self;
    const IX = { epsg: 6677, proj4: '+proj=tmerc +lat_0=36 +lon_0=139.833333333333 +k=0.9999 +ellps=GRS80 +towgs84=0,0,0 +units=m +axis=enu' };
    const worldFile = { xScale: 100, xSkew: 0, xOrigin: 500, ySkew: 0, yScale: -100, yOrigin: 1000 };
    const W = 300, H = 260;
    const pixelPoints = [[0, 0], [W, 0], [W, H], [0, H], [W / 2, H / 2], [90, 200]];
    const crsGcps = pixelPoints.map(([x, y]) => [[x, y], [worldFile.xOrigin + worldFile.xScale * (x - 0.5), worldFile.yOrigin + worldFile.yScale * (y - 0.5)]]);
    const legacyGcps = pixelPoints.map(([x, y]) => [[x, y], [15000000 + 100 * x, 4000000 - 100 * y]]);
    const wholeBounds = [[0, 0], [W, 0], [W, H], [0, H]];

    // 計算を始める時点の Tin の状態が、resolveTinBuildOptions の結果と一致すること。
    function expectBuiltLike(entry: any, options: any, label: string) {
      assert.ok(entry, label + ': Tin が作られた');
      assert.deepEqual(entry.options, options, label + ': コンストラクタに渡った引数が resolveTinBuildOptions の結果と一致');
      const s = entry.snapshot;
      assert.ok(s, label + ': 計算まで進んだ');
      assert.equal(s.strictMode, options.strictMode ?? 'auto', label + ': strictMode');
      assert.equal(s.vertexMode, options.vertexMode ?? 'plain', label + ': vertexMode');
      assert.equal(s.yaxisMode, options.yaxisMode ?? 'invert', label + ': yaxisMode');
      assert.equal(s.useV2Algorithm, options.useV2Algorithm ?? false, label + ': useV2Algorithm');
      assert.deepEqual(s.requestedWorldFile, options.outerTransform === 'worldFile' ? options.worldFile : undefined, label + ': world file');
    }

    const layers: Array<{ name: string; layer: any; intent?: string; gcps: any[] }> = [
      { name: '従来(crs 無し・follow)', layer: { yaxisMode: 'follow' }, gcps: legacyGcps },
      { name: '従来(crs 無し)', layer: {}, gcps: legacyGcps },
      { name: 'C', layer: { crs: IX, compiled: { outerTransform: 'extrapolate' } }, intent: 'C', gcps: crsGcps },
      { name: 'B', layer: { crs: IX, worldFile, compiled: { outerTransform: 'worldFile', worldFile } }, intent: 'B', gcps: crsGcps },
      { name: 'C(3857)', layer: { crs: { epsg: 3857 }, compiled: {} }, intent: 'C', gcps: legacyGcps },
    ];

    // ---------------- worker / ipc: tinOptions があれば古い strict・vertex は使わない ----------------
    const trusted = { senderFrame: { url: 'app://bundle/index.html', parent: null } };
    registerMapEditHandlers();
    const updateTinIpc = (...args: any[]) => __handlers.get('mapedit:updateTin')(trusted, ...args);
    let workerId = 0;
    async function updateTinWorker(payload: any) {
      const id = ++workerId;
      await selfScope.onmessage({ data: { id, type: 'updateTin', payload } });
      const reply = selfScope.__posted.find((m: any) => m.id === id);
      assert.ok(reply && !reply.error, 'worker の応答: ' + JSON.stringify(reply));
      return reply.result;
    }
    for (const { name, layer, intent, gcps } of layers) {
      for (const index of [0, 1]) {
        const bounds = index === 0 ? [W, H] : wholeBounds;
        const tinOptions = resolveTinBuildOptions(layer, { strictMode: 'loose', vertexMode: 'birdeye' }, intent);
        assert.ok(tinOptions);
        for (const route of ['worker', 'ipc']) {
          tinLog.length = 0;
          const label = route + ' ' + name + ' index=' + index;
          // 古い引数（strict / plain）は tinOptions と食い違わせて、使われないことを見る。
          const result = route === 'worker'
            ? await updateTinWorker({ gcps, edges: [], index, bounds, strict: 'strict', vertex: 'plain', tinOptions })
            : await updateTinIpc(gcps, [], index, bounds, 'strict', 'plain', tinOptions);
          assert.equal(typeof result[1], 'object', label + ': compiled が返る ' + String(result[1]));
          assert.equal(tinLog.length, 1, label + ': Tin は 1 つだけ');
          expectBuiltLike(tinLog[0], tinOptions, label);
          assert.equal(tinLog[0].snapshot.strictMode, 'loose', label + ': strictMode は tinOptions の loose');
          assert.equal(tinLog[0].snapshot.vertexMode, 'birdeye', label + ': vertexMode は tinOptions の birdeye（副層の setBounds で plain に戻らない）');
          if (tinOptions.useV2Algorithm === false) assert.ok(result[2], label + ': V4 は外周の診断を返す');
          else assert.equal(result[2], null, label + ': V2 は外周の診断を返さない');
        }
      }
    }
    // tinOptions が無い呼び出しだけ、古い strict / vertex が作り方になる。
    for (const route of ['worker', 'ipc']) {
      for (const index of [0, 1]) {
        tinLog.length = 0;
        const bounds = index === 0 ? [W, H] : wholeBounds;
        const expected = resolveTinBuildOptions({}, { strictMode: 'loose', vertexMode: 'birdeye' });
        if (route === 'worker') await updateTinWorker({ gcps: legacyGcps, edges: [], index, bounds, strict: 'loose', vertex: 'birdeye' });
        else await updateTinIpc(legacyGcps, [], index, bounds, 'loose', 'birdeye');
        expectBuiltLike(tinLog[0], expected, route + ' tinOptions 無し index=' + index);
      }
    }
    console.log('ok: worker と ipc/mapedit は tinOptions をそのまま使い、strict・vertex の古い引数で上書きしない');

    // ---------------- MapEditService: 未作成の層も resolveTinBuildOptions ----------------
    const service: any = MapEditService;
    {
      // 投影済みの副層は主図の軸を引き継ぎ、従来の層では内部軸の既定を使う。
      const main = { gcps: legacyGcps, edges: [], width: W, height: H, strictMode: 'loose', vertexMode: 'birdeye', yaxisMode: 'follow' };
      const subs = [
        { gcps: crsGcps, edges: [], bounds: wholeBounds, crs: IX },
        { gcps: crsGcps, edges: [], bounds: wholeBounds, crs: IX, tinEnabled: false, worldFile },
        { gcps: legacyGcps, edges: [], bounds: wholeBounds, yaxisMode: 'follow' },
        { gcps: legacyGcps, edges: [], bounds: wholeBounds },
      ];
      const json = { ...main, sub_maps: subs.map((s) => ({ ...s })) };
      tinLog.length = 0;
      const result = await service.ensurePreviewCompiled(json);
      assert.ok(result.compiled, '主図の compiled が作られる');
      assert.equal(tinLog.length, 4, 'A の副層は Tin を作らない（主図 + 副層 3）');
      const options = { strictMode: 'loose', vertexMode: 'birdeye' } as const;
      expectBuiltLike(tinLog[0], resolveTinBuildOptions(main, options), 'MapEditService 主図');
      expectBuiltLike(tinLog[1], resolveTinBuildOptions({ ...subs[0], yaxisMode: main.yaxisMode }, options), 'MapEditService 副層 C');
      expectBuiltLike(tinLog[2], resolveTinBuildOptions(subs[2], options), 'MapEditService 副層 follow');
      expectBuiltLike(tinLog[3], resolveTinBuildOptions(subs[3], options), 'MapEditService 副層 従来');
      assert.equal(tinLog[0].snapshot.yaxisMode, 'invert', 'V2 の主図は内部軸の既定で作る');
      assert.equal(tinLog[1].snapshot.useV2Algorithm, false, 'crs を持つ副層だけ V4');
      assert.equal(tinLog[1].snapshot.requestedWorldFile, undefined);
      assert.equal(tinLog[1].snapshot.yaxisMode, 'follow', '投影済み副層は地図全体の軸を引き継ぐ');
      assert.equal(tinLog[2].snapshot.yaxisMode, 'invert', 'V2 の副層は内部軸の既定で作る');
      assert.equal(tinLog[3].snapshot.yaxisMode, 'invert', 'yaxisMode が無ければ既定');
      for (const entry of tinLog) assert.equal(entry.snapshot.vertexMode, 'birdeye', '副層の setBounds で vertexMode が plain に戻らない');
      assert.equal(result.sub_maps[1].compiled, undefined, 'A の副層に compiled は作らない');
      // 主図に crs が無く、副層の片側だけ crs を持つ混在でも、層ごとに決まる。
      tinLog.length = 0;
      await service.ensurePreviewCompiled({ gcps: legacyGcps, edges: [], width: W, height: H, sub_maps: [{ gcps: crsGcps, edges: [], bounds: wholeBounds, crs: IX }] });
      assert.deepEqual([tinLog[0].snapshot.useV2Algorithm, tinLog[1].snapshot.useV2Algorithm], [true, false], '混在は層ごとに V2／V4');
    }
    console.log('ok: MapEditService は未作成の層を層ごとに resolveTinBuildOptions で作り、投影済み副層は地図全体の軸を引き継ぐ');

    // ---------------- WMTS: crs 無しは resolveTinBuildOptions の V2 で復元、crs 有りは Tin を作らない ----------------
    {
      const originalDir = path.join(root, 'originals');
      await mkdir(originalDir, { recursive: true });
      const png = await new Jimp({ width: W, height: H, color: 0xffffffff }).getBuffer('image/png');
      const win: any = { webContents: { send() {} }, isDestroyed: () => false };
      async function compiledFor(layer: any, intent: string | undefined, gcps: any[]) {
        const options = resolveTinBuildOptions(layer, { strictMode: 'loose', vertexMode: 'plain' }, intent)!;
        const tin: any = new Tin(options);
        tin.setWh([W, H]);
        tin.setPoints(gcps);
        tin.setEdges([]);
        await tin.updateTinAsync();
        return tin.getCompiled();
      }
      const legacyCompiled = await compiledFor({}, undefined, legacyGcps);
      const cCompiled = await compiledFor({ crs: IX, compiled: { outerTransform: 'extrapolate' } }, 'C', crsGcps);
      for (const [uid, compiled, crs] of [['wmts-legacy', legacyCompiled, undefined], ['wmts-ix-c', cCompiled, IX]] as const) {
        await writeFile(path.join(originalDir, uid + '.png'), png);
        tinLog.length = 0;
        const result: any = await WmtsGeneratorService.generate(win, uid, uid, W, H, compiled, 'png', 'smoke', uid, crs as any);
        assert.ifError(result.err);
        assert.ok(result.tileJson, uid + ': タイルが作られる');
        if (!crs) {
          assert.equal(tinLog.length, 1, 'WMTS(crs 無し): 復元の Tin は 1 つ');
          assert.deepEqual(tinLog[0].options, resolveTinBuildOptions({}), 'WMTS(crs 無し): resolveTinBuildOptions の結果（V2）で復元する');
        } else {
          assert.equal(tinLog.length, 0, 'WMTS(crs 有り): Tin は作らず、投影つきの変換面を使う');
        }
      }
    }
    console.log('ok: WmtsGeneratorService は crs 無しを resolveTinBuildOptions の V2 で復元し、crs 有りは投影つきの変換面を使う');
    console.log('TIN V2/V4 mode smoke passed');
  `);
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { electron: files.electron, 'electron-store': files.store, '@maplat/tin': files.recorder } },
    build: { ssr: files.entry, outDir: path.join(workDir, 'dist'), target: 'node22', minify: false, rollupOptions: { output: { entryFileNames: 'entry.mjs' } } },
  });
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [path.join(workDir, 'dist', 'entry.mjs'), dataDir], { maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(stdout);
  if (process.env.SMOKE_VERBOSE) process.stderr.write(stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
