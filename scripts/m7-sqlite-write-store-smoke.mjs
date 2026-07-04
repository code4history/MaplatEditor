// SQLite Write Store + DuckDB Search Layer (ADR-0001) の統合スモーク。
// シナリオ1: 生きたレガシー入力(nedb.db / settings/)からのマイグレーションと
//            Write Store経由のCRUD、Search Layer経由の一覧検索、退避リネーム。
// シナリオ2: 退避済み入力(_nedb.db / _settings/)からもマイグレーションできること。
import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'sqlite-write-store-'));
const entryFile = path.join(workDir, 'sqlite-write-store-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'sqlite-write-store-smoke.mjs');

function legacyMapDoc(id, title) {
  return JSON.stringify({
    _id: id,
    title,
    officialTitle: '',
    description: 'Migrated from NeDB',
    attr: '',
    dataAttr: '',
    author: '',
    createdAt: '',
    era: '',
    license: '',
    dataLicense: '',
    contributor: '',
    mapper: '',
    reference: '',
    url: '',
    lang: 'ja',
    imageExtension: 'jpg',
    width: 320,
    height: 200,
    gcps: [],
    edges: [],
    sub_maps: [],
    homePosition: [0, 0],
    mercZoom: 0,
    strictMode: 'strict',
    vertexMode: 'plain',
  }) + '\n';
}

try {
  const dataDir = path.join(workDir, 'data');
  const settingsDir = path.join(dataDir, 'settings');
  const retiredDataDir = path.join(workDir, 'data-retired');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const mapDataPath = path.join(projectRoot, 'electron/services/MapDataService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const searchPath = path.join(projectRoot, 'electron/services/SearchDataService.ts');
  const storageAdapterPath = path.join(projectRoot, 'electron/adapters/ElectronStorageAdapter.ts');

  await mkdir(settingsDir, { recursive: true });
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
      globalThis.__appProgressEvents = [];
      const fakeWindow = {
        webContents: {
          send(channel: string, payload: any) {
            globalThis.__appProgressEvents.push({ channel, payload });
          },
        },
      };
      export const BrowserWindow = class {
        static getAllWindows() { return [fakeWindow]; }
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

  // シナリオ1: 生きたレガシー入力
  await writeFile(path.join(dataDir, 'nedb.db'), legacyMapDoc('legacy-map', 'Legacy Map'));
  await writeFile(
    path.join(settingsDir, 'tmsList.json'),
    JSON.stringify([{ mapID: 'user-base', title: 'User Base', url: 'https://example.test/{z}/{x}/{y}.png' }])
  );
  await writeFile(
    path.join(settingsDir, 'tmsList_mapA.json'),
    JSON.stringify({ 'user-base': false, 'gsi_ort_USA10': true })
  );
  await writeFile(
    path.join(settingsDir, 'tmsList.mapB.json'),
    JSON.stringify({ 'user-base': true, 'gsi_ort_USA10': false })
  );

  // シナリオ2: 退避済み入力(先行のDuckDB移行がリネームした状態を再現)
  await mkdir(path.join(retiredDataDir, '_settings'), { recursive: true });
  await writeFile(path.join(retiredDataDir, '_nedb.db'), legacyMapDoc('retired-map', 'Retired Map'));
  await writeFile(
    path.join(retiredDataDir, '_settings', 'tmsList.json'),
    JSON.stringify([{ mapID: 'retired-base', title: 'Retired Base', url: 'https://example.test/{z}/{x}/{y}.png' }])
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { access } from 'node:fs/promises';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: MapDataService } = await import(${JSON.stringify(mapDataPath)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: SearchDataService } = await import(${JSON.stringify(searchPath)});
      const { default: StorageAdapter } = await import(${JSON.stringify(storageAdapterPath)});

      const db = await MapDataService.getDBInstance();
      assert.ok(globalThis.__appProgressEvents.some((event) =>
        event.channel === 'app:taskProgress' && event.payload.text === 'database.migrating'
      ));
      assert.equal(await StorageAdapter.isMapIdAvailable('legacy-map'), false);
      // 一覧検索はSearch Layer(DuckDB sqlite ATTACH)経由
      const listed = await StorageAdapter.listMaps({ query: 'Legacy', page: 1, pageSize: 20 });
      assert.equal(listed.docs.length, 1);
      assert.equal(listed.docs[0].mapID, 'legacy-map');
      // pageSize=0 は全件取得
      const listedAll = await StorageAdapter.listMaps({ query: '', page: 1, pageSize: 0 });
      assert.equal(listedAll.docs.length, 1);
      assert.equal(listedAll.next, false);

      const loaded = await StorageAdapter.readMapForEdit('legacy-map');
      assert.equal(loaded.mapID, 'legacy-map');
      assert.equal(loaded.status, 'Update');

      // 書き込み直後の読み取り(read-your-writes): 単一レコードはWrite Store、一覧はSearch Layer
      await StorageAdapter.saveMapForEdit({
        mapObject: { ...loaded, title: 'Updated Legacy Map', status: 'Update' },
        tins: ['tooLessGcps'],
      });
      const reloaded = await db.findOneAsync({ _id: 'legacy-map' });
      assert.equal(reloaded.title, 'Updated Legacy Map');
      const relisted = await StorageAdapter.listMaps({ query: 'Updated', page: 1, pageSize: 20 });
      assert.equal(relisted.docs.length, 1);

      // Write StoreはSQLiteファイル。DuckDBファイルは作られない
      await access(${JSON.stringify(path.join(dataDir, 'maplat.sqlite'))});
      await assert.rejects(() => access(${JSON.stringify(path.join(dataDir, 'maplat.duckdb'))}));
      // 消費済みレガシー入力は退避リネームされる(Legacy Data Retirement)
      await access(${JSON.stringify(path.join(dataDir, '_nedb.db'))});
      await access(${JSON.stringify(path.join(dataDir, '_settings'))});
      await assert.rejects(() => access(${JSON.stringify(path.join(dataDir, 'nedb.db'))}));
      await assert.rejects(() => access(${JSON.stringify(settingsDir)}));

      const mapA = await SettingsService.getTmsListOfMapID('mapA');
      assert.ok(mapA.some((tms) => tms.mapID === 'osm'));
      assert.ok(mapA.some((tms) => tms.mapID === 'gsi_ort_USA10'));
      assert.ok(!mapA.some((tms) => tms.mapID === 'user-base'));
      const mapAVisibility = await SettingsService.getBaseMapVisibilityOfMapID('mapA');
      const mapAOsm = mapAVisibility.find((item) => item.mapID === 'osm');
      const mapAUser = mapAVisibility.find((item) => item.mapID === 'user-base');
      assert.equal(mapAOsm.locked, true);
      assert.equal(mapAOsm.enabled, true);
      assert.equal(mapAUser.enabled, false);

      await SettingsService.setBaseMapVisibilityForMapID('mapA', 'osm', false);
      await SettingsService.setBaseMapVisibilityForMapID('mapA', 'user-base', true);
      const mapAUpdated = await SettingsService.getTmsListOfMapID('mapA');
      assert.ok(mapAUpdated.some((tms) => tms.mapID === 'osm'));
      assert.ok(mapAUpdated.some((tms) => tms.mapID === 'user-base'));

      const mapB = await SettingsService.getTmsListOfMapID('mapB');
      assert.ok(!mapB.some((tms) => tms.mapID === 'gsi_ort_USA10'));
      assert.ok(mapB.some((tms) => tms.mapID === 'user-base'));

      const mapC = await SettingsService.getTmsListOfMapID('mapC');
      assert.ok(mapC.some((tms) => tms.mapID === 'gsi_ort_USA10'));
      assert.ok(mapC.some((tms) => tms.mapID === 'user-base'));

      // FTS5(日本語分かち書き)とR-Tree(bbox)の索引がトリガで同期されること
      await SqliteDataService.upsertMap('ryukyu-map', {
        title: '正保琉球国絵図写',
        compiled: { vertices_points: [[[0, 0], [15550000, 3070000]], [[1, 1], [15650000, 3170000]]] },
      });
      await SqliteDataService.upsertMap('kuma-map', { title: '球磨川流域地図' });
      // 「琉球」: 単語一致のみヒット(「球」を含むだけの球磨川へは誤ヒットしない)
      const jaHits = await SearchDataService.listMaps('琉球', 1, 0);
      assert.deepEqual(jaHits.docs.map((doc) => doc._id), ['ryukyu-map']);
      // トークン境界を跨ぐ部分文字列は raw LIKE フォールバックで従来同様ヒット
      const substrHits = await SearchDataService.listMaps('図写', 1, 0);
      assert.deepEqual(substrHits.docs.map((doc) => doc._id), ['ryukyu-map']);
      // R-Tree: bbox交差検索(メルカトル座標)。削除でトリガが索引を掃除すること
      assert.deepEqual(await SearchDataService.searchExtent([15500000, 3000000, 15700000, 3200000]), ['ryukyu-map']);
      assert.deepEqual(await SearchDataService.searchExtent([0, 0, 100, 100]), []);
      await SqliteDataService.deleteMap('ryukyu-map');
      assert.deepEqual(await SearchDataService.searchExtent([15500000, 3000000, 15700000, 3200000]), []);
      assert.equal((await SearchDataService.listMaps('琉球', 1, 0)).docs.length, 0);
      await SqliteDataService.deleteMap('kuma-map');

      // ビルトインベースマップはKTGISカタログ由来(重複なし・再シード安全)
      const baseMaps = await SettingsService.listBaseMaps();
      assert.ok(baseMaps.some((item) => item.scope === 'builtin' && item.mapID === 'osm'));
      assert.ok(baseMaps.some((item) => item.scope === 'builtin' && item.mapID === 'muroran00'));
      assert.ok(baseMaps.some((item) => item.scope === 'user' && item.mapID === 'user-base'));
      await SearchDataService.reset();
      await SqliteDataService.reset();
      // 2回目以降の起動では移行済みのため、退避アーカイブが残っていても進捗通知(移行ダイアログ)は出ない
      const progressCountBeforeReopen = globalThis.__appProgressEvents.length;
      const rawDb = await SqliteDataService.getDb();
      assert.equal(globalThis.__appProgressEvents.length, progressCountBeforeReopen,
        'reopening an already-migrated DB must not emit migration progress events');
      const duplicateCheck = rawDb
        .prepare('SELECT scope, map_id, count(*) AS count FROM base_maps GROUP BY scope, map_id HAVING count(*) > 1')
        .all();
      assert.equal(duplicateCheck.length, 0);
      assert.ok(globalThis.__appProgressEvents.some((event) =>
        event.channel === 'app:taskProgress' && event.payload.text === 'database.migrated'
      ));

      // シナリオ2: 退避済み入力(_nedb.db/_settings)からのマイグレーション
      SettingsService.set('saveFolder', ${JSON.stringify(retiredDataDir)});
      await MapDataService.switchDataFolder();
      assert.equal(await SqliteDataService.isMapIdAvailable('retired-map'), false);
      const retiredList = await SearchDataService.listMaps('Retired', 1, 20);
      assert.equal(retiredList.docs.length, 1);
      const retiredBaseMaps = await SettingsService.listBaseMaps();
      assert.ok(retiredBaseMaps.some((item) => item.scope === 'user' && item.mapID === 'retired-base'));
      // 退避済み入力はそのまま残る(再リネームされない)
      await access(${JSON.stringify(path.join(retiredDataDir, '_nedb.db'))});
      await access(${JSON.stringify(path.join(retiredDataDir, '_settings'))});

      // DuckDB経路(MAPLAT_SEARCH_ENGINE=duckdb)も温存されており、同じ結果を返すこと
      process.env.MAPLAT_SEARCH_ENGINE = 'duckdb';
      await SearchDataService.reset();
      const duckdbList = await SearchDataService.listMaps('Retired', 1, 20);
      assert.equal(duckdbList.docs.length, 1);
      assert.equal(duckdbList.docs[0]._id, 'retired-map');
      delete process.env.MAPLAT_SEARCH_ENGINE;
      await SearchDataService.reset();

      console.log('M7 SQLite write store smoke passed');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp'],
        output: {
          entryFileNames: 'sqlite-write-store-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M7 SQLite write store smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
