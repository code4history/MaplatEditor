// m5-t5 AC11: 検査後に先取りされるレースを 'Exist' へ写像する（タスク設計 v1.4 §5.4）。
//
// 固定する受け入れ条件:
//   AC11(a) registerAsset の **本物の** 'Slug already in use' が 'Exist' になる
//   AC11(b) SlugReservationConflictError（実型）が 'Exist' になる
//   AC11(c) **負のケース** — restoreManagedPois の POI slug 失敗は 'Exist' に **ならない**
//
// 【(a) が文言を注入しない理由】
// 判別子 /^Slug already in use: / は message 依存であり単独では脆い。偽の message を
// throw するテストにすると、実装の文言が変わってもテストは緑のまま通ってしまう。
// **実際に埋まった slug を createMap へ渡して本物の throw を起こす**ことで、
// 文言が変われば必ず赤くなる回帰ガードになる。
//
// 【(c) が必要な理由】
// 写像を extractZip の外側 catch に置くと、createMap より前に走る restoreManagedPois が
// 投げる 'Slug already in use: <POI の slug>' まで拾ってしまい、
// **POI 復元の失敗を地図 slug のレースとして誤ラベルする**。
// (c) はその置き場所を固定する検査であり、(a)(b) だけでは検出できない。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t5-race-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); } };
    export const ipcMain = { handle() {} };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
  `);
  await writeFile(storeStub, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    const sqliteMod = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const SqliteDataService = sqliteMod.default;
    const { SlugReservationConflictError } = sqliteMod;
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { default: poiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});

    assert.equal(typeof SlugReservationConflictError, 'function',
      'AC11(b): SlugReservationConflictError を実型として import できること（偽物を作らない）');

    const makeMapZip = (slug: string, pois?: unknown[], extra?: (z: AdmZip) => void) => {
      const zip = new AdmZip();
      const doc: any = { mapID: slug, title: slug, attr: 'test', lang: 'ja', gcps: [], edges: [] };
      if (pois) doc.pois = pois;
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify(doc)));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('T'));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('X'));
      extra?.(zip);
      const p = nodePath.join(workDir, slug + '-' + Math.random().toString(36).slice(2) + '.zip');
      zip.writeZip(p);
      return p;
    };

    const fc = (name: string) => ({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [135, 35] }, properties: { name } }],
    });

    // 【レースの作り方】
    // 解決器を差し替えるのではなく、**解決器が使う空き検査に嘘をつかせる**。
    // isSlugAvailable が「空いている」と答えた slug が createMap 到達時には埋まっている
    // ——これは検査後に他者が先取りした状況そのものであり、実経路を1つも迂回しない。
    // （ESM 名前空間は凍結されており関数 export の差し替えはできないが、
    //   SqliteDataService は singleton ∴ メソッド差し替えは実経路に効く）
    const withSlugCheckLying = async (fn: () => Promise<any>) => {
      const original = SqliteDataService.isSlugAvailable.bind(SqliteDataService);
      SqliteDataService.isSlugAvailable = async () => true; // 常に「空いている」
      try { return await fn(); }
      finally { SqliteDataService.isSlugAvailable = original; }
    };

    // =====================================================================
    // AC11(a): registerAsset の **本物の** throw が 'Exist' になる
    // =====================================================================
    {
      const TAKEN = 'race-taken';
      await SqliteDataService.createMap(TAKEN, { mapID: TAKEN, title: TAKEN, gcps: [], edges: [] });

      // 文言は注入しない。空き検査が嘘をつくため解決器は TAKEN をそのまま返し、
      // createMap で SqliteDataService.registerAsset が
      // **本物の** Error('Slug already in use: …') を投げる。
      const result = await withSlugCheckLying(
        () => dataUploadService.extractZip(makeMapZip(TAKEN)));

      assert.equal(result.err, 'Exist',
        'AC11(a): createMap の本物の slug 衝突が Exist へ写像されること（実際: '
          + JSON.stringify(result).slice(0, 300) + '）');
      assert.equal(result.mapData, undefined, 'AC11(a): 地図は作られない');
      console.log('ok AC11(a): 本物の "Slug already in use" が Exist（文言変更の回帰ガード）');
    }

    // =====================================================================
    // AC11(b): SlugReservationConflictError（実型）が 'Exist' になる
    // =====================================================================
    {
      const originalCreateMap = SqliteDataService.createMap.bind(SqliteDataService);
      SqliteDataService.createMap = async (slug: string) => {
        throw new SlugReservationConflictError(slug); // 実型。message は型側の定義に従う
      };
      try {
        const result = await dataUploadService.extractZip(makeMapZip('race-b'));
        assert.equal(result.err, 'Exist',
          'AC11(b): 予約競合（多重起動）も Exist へ写像されること（実際: '
            + JSON.stringify(result).slice(0, 300) + '）');
      } finally {
        SqliteDataService.createMap = originalCreateMap;
      }
      console.log('ok AC11(b): SlugReservationConflictError が Exist');
    }

    // =====================================================================
    // AC11(c) 負のケース: POI 復元の slug 失敗は 'Exist' にならない
    // =====================================================================
    {
      // 地図 slug は自由。**POI ソース**の作成が 'Slug already in use' で失敗する状況を作る。
      // 写像が外側 catch にあると、この message を拾って Exist と誤ラベルする。
      const originalCreate = poiSourceService.createPoiSourceFromManagedDocument
        .bind(poiSourceService);
      poiSourceService.createPoiSourceFromManagedDocument = async () => {
        // 地図側と **同じ形** の Error。message だけで判定していると区別できない
        throw new Error('Slug already in use: some-poi-slug');
      };
      try {
        const zipPath = makeMapZip('race-c', [{ layer: 'pois/p.geojson' }], (z) => {
          z.addFile('pois/p.geojson', Buffer.from(JSON.stringify(fc('p'))));
        });
        const result = await dataUploadService.extractZip(zipPath);

        assert.notEqual(result.err, 'Exist',
          'AC11(c): POI 復元の slug 失敗を地図レースと誤ラベルしないこと。'
            + '写像が createMap 呼び出しへ限局されていない可能性がある（実際: '
            + JSON.stringify(result).slice(0, 300) + '）');
        assert.match(String(result.err), /Slug already in use/,
          'AC11(c): POI 復元の失敗は message のまま返ること（renderer では error_upload へ）'
            + '（実際: ' + JSON.stringify(result).slice(0, 300) + '）');
        assert.equal(result.mapData, undefined, 'AC11(c): 地図は作られない');
      } finally {
        poiSourceService.createPoiSourceFromManagedDocument = originalCreate;
      }
      console.log('ok AC11(c): POI 復元の slug 失敗は Exist にならない（写像の限局を固定）');
    }

    console.log('m5-t5 import race mapping OK');
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [
      { find: 'electron', replacement: electronStub },
      { find: 'electron-store', replacement: storeStub },
    ]},
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: {
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 180000, maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  console.log('m5-t5 import race mapping smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
