// Identity Store (ADR-0007) スモーク: schema v2 (uid正準 + グローバルslugレジストリ + revision楽観ロック)。
// シナリオ:
//   (a) 空フォルダ → createMap → findMap が uid/slug/revision=1 を返す
//   (b) isSlugAvailable の自分除外
//   (c) upsertMap の slug rename + revision 楽観ロック (RevisionConflictError)
//   (d) グローバルnamespace: map が持つ slug で createApp は失敗する
//   (e) 旧schema(v1) DB は起動時に _maplat-v1.sqlite へ退避され新規v2 DBが作られる
//   (f) searchMaps が slug でヒットする (FTS raw に slug を含む)
//   (g) builtin base maps は uid+slug でシードされ、再起動で重複・uid変化しない
//   (h) slugサフィックスされたビルトイン(カタログIDをユーザー資産が先取り)は
//       builtinId で再マッチし、再起動しても uid/slug/表示設定が安定する
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'identity-store-'));
const entryFile = path.join(workDir, 'identity-store-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'identity-store-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const v1DataDir = path.join(workDir, 'data-v1');
  const suffixDataDir = path.join(workDir, 'data-suffix');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');

  await mkdir(dataDir, { recursive: true });
  await mkdir(v1DataDir, { recursive: true });
  await mkdir(suffixDataDir, { recursive: true });
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
      import { access } from 'node:fs/promises';
      import { DatabaseSync } from 'node:sqlite';

      const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService, RevisionConflictError } = await import(${JSON.stringify(sqlitePath)});

      // (a) 空フォルダ → createMap → findMap が uid/slug/revision を返す
      await SqliteDataService.getDb();
      const { uid } = await SqliteDataService.createMap('sample', { title: 'サンプル地図' });
      assert.match(uid, UUID_PATTERN, 'createMap は UUIDv4 の uid を採番するはず');
      const found = await SqliteDataService.findMap(uid);
      assert.ok(found, 'findMap(uid) がドキュメントを返すはず');
      assert.equal(found.uid, uid);
      assert.equal(found.slug, 'sample');
      assert.equal(found.revision, 1);
      // 言語別フィールドはDB内で常にオブジェクト形 (ADR-0005)
      assert.deepEqual(found.title, { ja: 'サンプル地図' });
      const foundBySlug = await SqliteDataService.findMapBySlug('sample');
      assert.equal(foundBySlug.uid, uid);
      console.log('ok: (a) createMap/findMap with uid/slug/revision');

      // (b) isSlugAvailable の自分除外
      assert.equal(await SqliteDataService.isSlugAvailable('sample'), false);
      assert.equal(await SqliteDataService.isSlugAvailable('sample', uid), true);
      assert.equal(await SqliteDataService.isSlugAvailable('brand-new'), true);
      console.log('ok: (b) isSlugAvailable with excludeUid');

      // (c) upsertMap の rename + revision 楽観ロック
      const upserted = await SqliteDataService.upsertMap(uid, 'renamed', { title: '改名済み地図' }, 1);
      assert.equal(upserted.revision, 2);
      const renamed = await SqliteDataService.findMap(uid);
      assert.equal(renamed.slug, 'renamed');
      assert.equal(renamed.revision, 2);
      assert.equal(await SqliteDataService.isSlugAvailable('sample'), true, '旧slugは解放されるはず');
      const rawDb = await SqliteDataService.getDb();
      const registryRow = rawDb.prepare('SELECT kind, slug FROM asset_registry WHERE uid = ?').get(uid);
      assert.equal(registryRow.kind, 'map');
      assert.equal(registryRow.slug, 'renamed', 'registry の slug も同一Txで更新されるはず');
      let conflict = null;
      try {
        await SqliteDataService.upsertMap(uid, 'renamed', { title: '古い版からの上書き' }, 1);
      } catch (e) {
        conflict = e;
      }
      assert.ok(conflict, '古い expectedRevision では RevisionConflictError になるはず');
      assert.ok(conflict instanceof RevisionConflictError);
      assert.equal(conflict.kind, 'revision-conflict');
      assert.equal(conflict.current, 2);
      // expectedRevision なしは無条件上書き(上書き保存経路)
      const overwritten = await SqliteDataService.upsertMap(uid, 'renamed', { title: '上書き' });
      assert.equal(overwritten.revision, 3);
      console.log('ok: (c) upsertMap rename + optimistic locking');

      // (d) グローバルnamespace: map が保持する slug では createApp できない
      await assert.rejects(() => SqliteDataService.createApp('renamed', { title: 'アプリ' }));
      const { uid: appUid } = await SqliteDataService.createApp('sample-app', { title: 'アプリ' });
      const foundApp = await SqliteDataService.findApp(appUid);
      assert.equal(foundApp.slug, 'sample-app');
      assert.equal(foundApp.revision, 1);
      // 逆方向: app が保持する slug では createMap できない
      await assert.rejects(() => SqliteDataService.createMap('sample-app', { title: '地図' }));
      console.log('ok: (d) global slug namespace across kinds');

      // (f) searchMaps が slug でヒット (FTS raw に slug が入っている)
      const hits = await SqliteDataService.searchMaps('renamed');
      assert.equal(hits.length, 1);
      assert.equal(hits[0].uid, uid);
      assert.equal(hits[0].slug, 'renamed');
      console.log('ok: (f) searchMaps hits by slug');

      // (g) builtin base maps は uid+slug でシードされ再起動で安定
      const catalog = await SqliteDataService.listBaseMaps();
      const osm = catalog.find((item) => item.mapID === 'osm');
      assert.ok(osm, 'builtin osm がシードされるはず');
      assert.equal(osm.scope, 'builtin');
      assert.match(osm.uid, UUID_PATTERN);
      const builtinCount = catalog.filter((item) => item.scope === 'builtin').length;
      await SqliteDataService.reset();
      await SqliteDataService.getDb();
      const catalog2 = await SqliteDataService.listBaseMaps();
      const osm2 = catalog2.find((item) => item.mapID === 'osm');
      assert.equal(osm2.uid, osm.uid, '再起動で builtin の uid が変わってはいけない');
      assert.equal(catalog2.filter((item) => item.scope === 'builtin').length, builtinCount, '再シードで重複してはいけない');
      console.log('ok: (g) builtin seed is uid-stable and idempotent');

      // (e) 旧schema(v1) DB の退避
      const v1File = ${JSON.stringify(path.join(v1DataDir, 'maplat.sqlite'))};
      const v1Db = new DatabaseSync(v1File);
      v1Db.exec('CREATE TABLE maps (map_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT)');
      v1Db.prepare('INSERT INTO maps (map_id, data_json) VALUES (?, ?)').run('old-map', '{}');
      v1Db.close();
      SettingsService.set('saveFolder', ${JSON.stringify(v1DataDir)});
      await SqliteDataService.reset();
      const freshDb = await SqliteDataService.getDb();
      await access(${JSON.stringify(path.join(v1DataDir, '_maplat-v1.sqlite'))});
      const uidColumn = freshDb.prepare("SELECT 1 AS ok FROM pragma_table_info('maps') WHERE name = 'uid'").get();
      assert.ok(uidColumn, '新規DBは v2 schema (maps.uid) を持つはず');
      const oldRows = freshDb.prepare('SELECT count(*) AS count FROM maps').get();
      assert.equal(Number(oldRows.count), 0, '旧schemaの行は引き継がれない(退避のみ)');
      console.log('ok: (e) v1 schema database retired to _maplat-v1.sqlite');

      // (h) slugサフィックスされたビルトインの再起動安定性
      SettingsService.set('saveFolder', ${JSON.stringify(suffixDataDir)});
      await SqliteDataService.reset();
      const suffixDb = await SqliteDataService.getDb();
      // 衝突状態を捏造: builtin 'muroran00'(常時表示ではない) の行とregistryを直接消し、
      // そのslugをユーザー資産(地図)が先取りしている状態を作る
      const muroranRow = suffixDb
        .prepare("SELECT uid FROM base_maps WHERE scope = 'builtin' AND slug = 'muroran00'")
        .get();
      assert.ok(muroranRow, 'builtin muroran00 がシードされているはず');
      suffixDb.prepare('DELETE FROM base_maps WHERE uid = ?').run(muroranRow.uid);
      suffixDb.prepare('DELETE FROM asset_registry WHERE uid = ?').run(muroranRow.uid);
      await SqliteDataService.createMap('muroran00', { title: 'ビルトインIDを先取りした地図' });
      // 再シード → builtin は muroran00_2 として復活し、builtinId=カタログID を保持する
      await SqliteDataService.reset();
      await SqliteDataService.getDb();
      const suffixedCatalog = await SqliteDataService.listBaseMaps();
      const suffixed = suffixedCatalog.find((item) => item.mapID === 'muroran00_2');
      assert.ok(suffixed, '先取りされたカタログIDのビルトインはサフィックス付きslugで復活するはず');
      assert.equal(suffixed.scope, 'builtin');
      assert.equal(suffixed.data.mapID, 'muroran00_2');
      assert.equal(suffixed.data.builtinId, 'muroran00');
      // サフィックス付きビルトインに地図単位の表示設定を付与する
      await SqliteDataService.setBaseMapVisibilityForMapID('muroran00', 'muroran00_2', true);
      // 再起動2回: uid/slug が安定し、表示設定が消えないこと
      for (let reopen = 1; reopen <= 2; reopen++) {
        await SqliteDataService.reset();
        await SqliteDataService.getDb();
        const reopenedCatalog = await SqliteDataService.listBaseMaps();
        const reopened = reopenedCatalog.find((item) => item.mapID === 'muroran00_2');
        assert.ok(reopened, '再起動 ' + reopen + ' でサフィックス付きビルトインが消えてはいけない');
        assert.equal(reopened.uid, suffixed.uid, '再起動 ' + reopen + ' で uid が変わってはいけない');
        assert.equal(reopened.data.builtinId, 'muroran00');
        assert.ok(
          !reopenedCatalog.some((item) => item.mapID === 'muroran00_3'),
          '再起動 ' + reopen + ' で slug が振り直されてはいけない'
        );
        const reopenedVisibility = await SqliteDataService.getBaseMapVisibilityOfMapID('muroran00');
        const visItem = reopenedVisibility.find((item) => item.mapID === 'muroran00_2');
        assert.equal(visItem.enabled, true, '再起動 ' + reopen + ' で表示設定が消えてはいけない');
      }
      console.log('ok: (h) suffixed builtin keeps uid/slug/visibility across restarts');

      console.log('M8-T2 identity store smoke passed');
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
          entryFileNames: 'identity-store-smoke.mjs',
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
  console.log('M8-T2 identity store smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
