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
  const langResourcePath = path.join(projectRoot, 'src/utils/langResource.ts');
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
  // mapA/mapB は個別表示設定(tmsList_mapA.json等)の対象地図。schema v2 では表示設定が
  // 地図uidへ解決されるため、設定対象の地図もnedbに存在させる (ADR-0007)
  await writeFile(
    path.join(dataDir, 'nedb.db'),
    legacyMapDoc('legacy-map', 'Legacy Map') + legacyMapDoc('mapA', 'Map A') + legacyMapDoc('mapB', 'Map B')
  );
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
      // pageSize=0 は全件取得 (legacy-map / mapA / mapB の3件)
      const listedAll = await StorageAdapter.listMaps({ query: '', page: 1, pageSize: 0 });
      assert.equal(listedAll.docs.length, 3);
      assert.equal(listedAll.next, false);
      // schema v2: 移行された地図は uid(UUIDv4) と slug=旧ID を持つ (ADR-0007)
      const migratedDoc = await SqliteDataService.findMapBySlug('legacy-map');
      assert.match(migratedDoc.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(migratedDoc.slug, 'legacy-map');
      assert.equal(migratedDoc.revision, 1);

      const loaded = await StorageAdapter.readMapForEdit('legacy-map');
      assert.equal(loaded.mapID, 'legacy-map');
      assert.equal(loaded.status, 'Update');
      // 言語別フィールドの内部形は常にオブジェクト (ADR-0005)。
      // nedb由来のプレーン文字列(=デフォルト言語の値)はマイグレーション/ロードで正規化される
      const migrated = await db.findOneAsync({ _id: 'legacy-map' });
      assert.deepEqual(migrated.title, { ja: 'Legacy Map' });
      assert.deepEqual(migrated.officialTitle, {});

      // 書き込み直後の読み取り(read-your-writes): 単一レコードはWrite Store、一覧はSearch Layer
      await StorageAdapter.saveMapForEdit({
        mapObject: { ...loaded, title: 'Updated Legacy Map', status: 'Update' },
        tins: ['tooLessGcps'],
      });
      const reloaded = await db.findOneAsync({ _id: 'legacy-map' });
      // 保存経路でもプレーン文字列はオブジェクト形へ正規化される (ADR-0005)
      assert.deepEqual(reloaded.title, { ja: 'Updated Legacy Map' });
      const relisted = await StorageAdapter.listMaps({ query: 'Updated', page: 1, pageSize: 20 });
      assert.equal(relisted.docs.length, 1);

      // ADR-0005: 交換形(エクスポート)はデフォルト言語のみ→プレーン文字列、複数言語→オブジェクト
      const langResource = await import(${JSON.stringify(langResourcePath)});
      assert.deepEqual(langResource.normalizeLangResource('日本地図', 'ja'), { ja: '日本地図' });
      assert.deepEqual(langResource.normalizeLangResource({ ja: '日本地図', en: '' }, 'ja'), { ja: '日本地図' });
      assert.equal(langResource.compactLangResource({ ja: '日本地図' }, 'ja'), '日本地図');
      assert.deepEqual(langResource.compactLangResource({ ja: '日本地図', en: 'Japan Map' }, 'ja'), { ja: '日本地図', en: 'Japan Map' });
      // デフォルト言語以外の単一言語はオブジェクトのまま(言語情報を失わない)
      assert.deepEqual(langResource.compactLangResource({ en: 'Japan Map' }, 'ja'), { en: 'Japan Map' });
      assert.equal(langResource.compactLangResource({ ja: '' }, 'ja'), undefined);
      const compactedDoc = langResource.compactMapLangFields({ lang: 'ja', title: { ja: '日本地図' }, description: { ja: '説明', en: 'Desc' }, attr: {} });
      assert.equal(compactedDoc.title, '日本地図');
      assert.deepEqual(compactedDoc.description, { ja: '説明', en: 'Desc' });
      assert.ok(!('attr' in compactedDoc));

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

      // オプトイン方式(ADR-0006): 設定のない地図には常時表示ベースマップのみが表示される
      const mapC = await SettingsService.getTmsListOfMapID('mapC');
      assert.deepEqual(mapC.map((tms) => tms.mapID).sort(), ['gsi', 'gsi_ortho', 'osm']);

      // 常時表示の再編(ADR-0006): OSMは外せない/GSI系は外せる/任意のベースマップを常時表示にできる
      const catalog = await SettingsService.listBaseMaps();
      const catalogOsm = catalog.find((item) => item.mapID === 'osm');
      const catalogGsi = catalog.find((item) => item.mapID === 'gsi');
      const catalogUser = catalog.find((item) => item.mapID === 'user-base');
      assert.equal(catalogOsm.alwaysVisible, true);
      assert.equal(catalogOsm.alwaysLocked, true);
      assert.equal(catalogGsi.alwaysVisible, true);
      assert.equal(catalogGsi.alwaysLocked, false);
      assert.equal(catalogUser.alwaysVisible, false);
      await assert.rejects(() => SettingsService.setBaseMapAlways('osm', false));
      await SettingsService.setBaseMapAlways('gsi', false);
      await SettingsService.setBaseMapAlways('user-base', true);
      const mapCUpdated = await SettingsService.getTmsListOfMapID('mapC');
      assert.deepEqual(mapCUpdated.map((tms) => tms.mapID).sort(), ['gsi_ortho', 'osm', 'user-base']);
      // 常時表示のベースマップは地図単位の設定ではロックされる
      const mapCVisibility = await SettingsService.getBaseMapVisibilityOfMapID('mapC');
      assert.equal(mapCVisibility.find((item) => item.mapID === 'user-base').locked, true);
      // 後続アサーションに影響させないため常時表示設定を既定へ戻す
      await SettingsService.setBaseMapAlways('gsi', true);
      await SettingsService.setBaseMapAlways('user-base', false);

      // FTS5(日本語分かち書き)とR-Tree(bbox)の索引がトリガで同期されること
      await SqliteDataService.upsertMapBySlug('ryukyu-map', {
        title: '正保琉球国絵図写',
        compiled: { vertices_points: [[[0, 0], [15550000, 3070000]], [[1, 1], [15650000, 3170000]]] },
      });
      await SqliteDataService.upsertMapBySlug('kuma-map', { title: '球磨川流域地図' });
      // 「琉球」: 単語一致のみヒット(「球」を含むだけの球磨川へは誤ヒットしない)
      const jaHits = await SearchDataService.listMaps('琉球', 1, 0);
      assert.deepEqual(jaHits.docs.map((doc) => doc._id), ['ryukyu-map']);
      // トークン境界を跨ぐ部分文字列は raw LIKE フォールバックで従来同様ヒット
      const substrHits = await SearchDataService.listMaps('図写', 1, 0);
      assert.deepEqual(substrHits.docs.map((doc) => doc._id), ['ryukyu-map']);
      // R-Tree: bbox交差検索(メルカトル座標)。削除でトリガが索引を掃除すること
      assert.deepEqual(await SearchDataService.searchExtent([15500000, 3000000, 15700000, 3200000]), ['ryukyu-map']);
      assert.deepEqual(await SearchDataService.searchExtent([0, 0, 100, 100]), []);
      await SqliteDataService.deleteMapBySlug('ryukyu-map');
      assert.deepEqual(await SearchDataService.searchExtent([15500000, 3000000, 15700000, 3200000]), []);
      assert.equal((await SearchDataService.listMaps('琉球', 1, 0)).docs.length, 0);
      await SqliteDataService.deleteMapBySlug('kuma-map');

      // ビルトインベースマップはKTGISカタログ由来(重複なし・再シード安全)
      const baseMaps = await SettingsService.listBaseMaps();
      assert.ok(baseMaps.some((item) => item.scope === 'builtin' && item.mapID === 'osm'));
      assert.ok(baseMaps.some((item) => item.scope === 'builtin' && item.mapID === 'muroran00'));
      assert.ok(baseMaps.some((item) => item.scope === 'user' && item.mapID === 'user-base'));
      // ID空間はMaplat地図とベースマップ(ビルトイン含む)で共有・一意
      // (サムネイルが tmbs/{mapID}.* を共有するため)
      assert.equal(await StorageAdapter.isMapIdAvailable('osm'), false);
      assert.equal(await StorageAdapter.isMapIdAvailable('user-base'), false);
      assert.equal(await StorageAdapter.isMapIdAvailable('brand-new-id'), true);
      await assert.rejects(() =>
        SqliteDataService.saveUserBaseMap({ mapID: 'legacy-map', title: 'x', url: 'https://example.test/{z}/{x}/{y}.png' })
      );

      // slug改名(ADR-0007): uidが正本キーのため、改名は同一uidのslug付け替えとして行われる。
      // 改名先の衝突はasset_registryのグローバル一意性で拒否される(旧grandfatheringは
      // マイグレーション時のslugサフィックス解消に置き換えられ不要になった)
      await SqliteDataService.saveUserBaseMap({ mapID: 'dup-base', title: 'Dup', url: 'https://example.test/{z}/{x}/{y}.png' });
      const dupUid = (await SettingsService.listBaseMaps()).find((item) => item.mapID === 'dup-base').uid;
      // 改名先が地図slugと衝突する場合は拒否
      await SqliteDataService.upsertMapBySlug('another-map', { title: '別の地図' });
      await assert.rejects(() =>
        SqliteDataService.saveUserBaseMap({ mapID: 'another-map', title: 'Dup2', url: 'https://example.test/{z}/{x}/{y}.png' }, 'dup-base')
      );
      await SqliteDataService.deleteMapBySlug('another-map');
      // 未使用slugへの改名は成功し、uidは変わらない
      await SqliteDataService.saveUserBaseMap({ mapID: 'dup-base-renamed', title: 'Dup2', url: 'https://example.test/{z}/{x}/{y}.png' }, 'dup-base');
      const afterRename = await SettingsService.listBaseMaps();
      const renamedItem = afterRename.find((item) => item.scope === 'user' && item.mapID === 'dup-base-renamed');
      assert.ok(renamedItem);
      assert.equal(renamedItem.uid, dupUid, 'slug改名でuidが変わってはいけない');
      assert.ok(!afterRename.some((item) => item.scope === 'user' && item.mapID === 'dup-base'));
      await SqliteDataService.deleteUserBaseMap('dup-base-renamed');

      // 改名で地図単位の表示設定が引き継がれること(mapAでuser-baseをオプトイン済み)
      await SqliteDataService.saveUserBaseMap({ mapID: 'user-base-renamed', title: 'User Base', url: 'https://example.test/{z}/{x}/{y}.png' }, 'user-base');
      const mapARenamed = await SettingsService.getTmsListOfMapID('mapA');
      assert.ok(mapARenamed.some((tms) => tms.mapID === 'user-base-renamed'));
      assert.ok(!mapARenamed.some((tms) => tms.mapID === 'user-base'));
      // 後続アサーションのため元のIDへ戻す(設定も戻る)
      await SqliteDataService.saveUserBaseMap({ mapID: 'user-base', title: 'User Base', url: 'https://example.test/{z}/{x}/{y}.png' }, 'user-base-renamed');
      assert.ok((await SettingsService.getTmsListOfMapID('mapA')).some((tms) => tms.mapID === 'user-base'));
      await SearchDataService.reset();
      await SqliteDataService.reset();
      // 2回目以降の起動では移行済みのため、退避アーカイブが残っていても進捗通知(移行ダイアログ)は出ない
      const progressCountBeforeReopen = globalThis.__appProgressEvents.length;
      const rawDb = await SqliteDataService.getDb();
      assert.equal(globalThis.__appProgressEvents.length, progressCountBeforeReopen,
        'reopening an already-migrated DB must not emit migration progress events');
      const duplicateCheck = rawDb
        .prepare('SELECT scope, slug, count(*) AS count FROM base_maps GROUP BY scope, slug HAVING count(*) > 1')
        .all();
      assert.equal(duplicateCheck.length, 0);
      assert.ok(globalThis.__appProgressEvents.some((event) =>
        event.channel === 'app:taskProgress' && event.payload.text === 'database.migrated'
      ));
      // 再オープンでオプトイン化の一括破棄(スキーマ移行)が再実行されないこと(明示選択が保持される)
      const mapAAfterReopen = await SettingsService.getTmsListOfMapID('mapA');
      assert.ok(mapAAfterReopen.some((tms) => tms.mapID === 'user-base'));

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
