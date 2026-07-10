// M10-T3 スモーク: MapEdit の実保存経路で map data_json の pois が永続化されること (Phase 7 Task 3, POI-137)。
// m9/m10 系と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// MapEditService.save (histMap2Store 経由のシリアライズ) → 再読込 (request = store2HistMap 経由) を
// behavioral に検証する。store_handler.ts の keys 配列に pois が無いと保存時に落ちる (本タスクの必須修正)。
// シナリオ:
//   ① mapObject.pois に {poiUid, cachedTitle} + 生 URL 文字列を混在 → MapEditService.save →
//      DB の data_json (findMapByRef) に pois がそのまま残る
//   ② MapEditService.request(uid) の読込方向 (store2HistMap) でも pois が保持される
//   ③ pois を持たない mapObject の保存では data_json に pois キーが生えない (undefined 混入なし)
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'mapedit-pois-save-'));
const entryFile = path.join(workDir, 'mapedit-pois-save-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'mapedit-pois-save-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');

  await writeFile(
    electronStubFile,
    `
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditor'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const dialog = {
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const ipcMain = { handle() {} };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
        static fromWebContents() { return null; }
      };
      export const session = {
        defaultSession: {
          clearStorageData() { return Promise.resolve(); },
        },
      };
    `
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      await SqliteDataService.getDb();

      const POI_UID = '12345678-1234-4123-8123-123456789012';
      const RAW_URL = 'https://example.com/pois.geojson';
      const poisFixture = [
        { poiUid: POI_UID, cachedTitle: '京都POI' },
        RAW_URL,
      ];

      // gcps < 3 (tins は 'tooLessGcps' 側の分岐) の最小 mapObject。
      // width/height を持たせて読込方向 (normalizeRequestData) が store2HistMap を通ることを保証する
      const mapObject: any = {
        mapID: 'pois-save-map',
        title: 'POI保存テスト地図',
        attr: '',
        officialTitle: '',
        dataAttr: '',
        author: '',
        createdAt: '',
        era: '',
        license: 'All right reserved',
        dataLicense: 'CC BY-SA',
        contributor: '',
        mapper: '',
        reference: '',
        description: '',
        url: '',
        lang: 'ja',
        imageExtension: 'jpg',
        width: 400,
        height: 300,
        gcps: [],
        edges: [],
        sub_maps: [],
        strictMode: 'strict',
        vertexMode: 'plain',
        homePosition: [135.0, 35.0],
        mercZoom: 15,
        pois: poisFixture,
      };

      // --- ① 実保存経路 (histMap2Store 経由) で pois が data_json に残る ---
      const saveResult = await MapEditService.save({
        mapObject,
        tins: [],
        slug: 'pois-save-map',
      });
      assert.equal(saveResult.result, 'Success', 'save は Success のはず: ' + JSON.stringify(saveResult));
      const savedUid = saveResult.uid;

      const stored = await SqliteDataService.findMapByRef('pois-save-map');
      assert.ok(stored, '保存した地図が findMapByRef で見つかるはず');
      assert.deepEqual(
        stored.pois,
        poisFixture,
        '保存経路 (histMap2Store) で data_json の pois が保持されるはず (keys に pois が無いと落ちる): '
          + JSON.stringify(stored.pois)
      );
      console.log('ok: (1) MapEditService.save persists pois into map data_json');

      // --- ② 読込方向 (request = store2HistMap 経由) でも pois が保持される ---
      const loaded = await MapEditService.request(savedUid);
      assert.deepEqual(
        loaded.pois,
        poisFixture,
        '読込経路 (store2HistMap) でも pois が保持されるはず: ' + JSON.stringify(loaded.pois)
      );
      console.log('ok: (2) MapEditService.request returns pois after reload');

      // --- ③ pois なし保存で data_json に pois キーが生えない ---
      const { pois: _omit, ...noPoisObject } = mapObject;
      const saveResult2 = await MapEditService.save({
        mapObject: { ...noPoisObject, mapID: 'no-pois-map' },
        tins: [],
        slug: 'no-pois-map',
      });
      assert.equal(saveResult2.result, 'Success', '2つ目の save は Success のはず: ' + JSON.stringify(saveResult2));
      const stored2 = await SqliteDataService.findMapByRef('no-pois-map');
      assert.ok(stored2, '2つ目の地図が見つかるはず');
      assert.ok(
        !('pois' in stored2) || stored2.pois === undefined,
        'pois を持たない保存では data_json に pois キーが生えないはず: ' + JSON.stringify(stored2.pois)
      );
      console.log('ok: (3) maps without pois do not grow a pois key');

      console.log('M10-T3 mapedit pois save smoke passed');
      process.exit(0);
    `
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: 'electron', replacement: electronStubFile },
        { find: 'electron-store', replacement: electronStoreStubFile },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: [
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          /^@duckdb\/node-bindings-.*/,
          'jimp',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
        ],
        output: {
          entryFileNames: 'mapedit-pois-save-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M10-T3 mapedit pois save smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
