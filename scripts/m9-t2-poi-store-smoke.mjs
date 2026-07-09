// POI Store (M9-T2) スモーク: Write Store の poi_sources / assets テーブル + CRUD + FTS。
// schema v2 (uid正準 + グローバルslugレジストリ + revision楽観ロック) を poi_source/asset に拡張。
// シナリオ:
//   poi_sources:
//     (a) createPoiSource → findPoiSource が uid/slug/title/mode/url/dataJson/featureCount/revision=1 を返す
//     (b) findPoiSourceBySlug が同一uidを返す
//     (c) upsertPoiSource の slug rename が asset_registry と同一Txで同期される
//     (d) 古い expectedRevision で RevisionConflictError、revision++ の楽観ロック
//     (e) deletePoiSource が本体・registry を掃除する(slug再利用可)
//     (f) グローバルslug衝突: map の slug で createPoiSource は失敗 / 逆方向も失敗
//     (g) searchPoiSources が feature の name テキストでヒットする(FTS raw に feature を含む)
//     (h) listPoiSources の要素に data_json(dataJson)が含まれない(一覧軽量化)
//   assets(同型):
//     (i) createAsset → findAsset が metadata/revision=1 を返す / findAssetBySlug
//     (j) upsertAssetMeta の slug rename が registry と同期 + revision++
//     (k) RevisionConflictError
//     (l) deleteAsset が本体・registry を掃除する
//     (m) グローバルslug衝突(asset vs map)
//     (n) searchAssets が title でヒット
//     (o) listAssets が metadata を返す(blob 列は無い)
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-store-'));
const entryFile = path.join(workDir, 'poi-store-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'poi-store-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');

  await mkdir(dataDir, { recursive: true });
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

      const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService, RevisionConflictError } = await import(${JSON.stringify(sqlitePath)});

      await SqliteDataService.getDb();

      // 内部形 FeatureCollection (properties._maplatUid, name/desc は LangResource 内部形)
      const fc = {
        type: 'FeatureCollection',
        id: 'kyoto-temples',
        features: [
          {
            type: 'Feature',
            id: 'p1',
            geometry: { type: 'Point', coordinates: [135.729, 35.039] },
            properties: {
              _maplatUid: '11111111-1111-4111-8111-111111111111',
              name: { ja: '金閣寺' },
              desc: { ja: '鹿苑寺の舎利殿' },
            },
          },
          {
            type: 'Feature',
            id: 'p2',
            geometry: { type: 'Point', coordinates: [135.798, 35.027] },
            properties: {
              _maplatUid: '22222222-2222-4222-8222-222222222222',
              name: { ja: '銀閣寺' },
            },
          },
        ],
      };
      const dataJson = JSON.stringify(fc);

      // (a) createPoiSource → findPoiSource
      const { uid } = await SqliteDataService.createPoiSource('kyoto-temples', {
        title: { ja: '京都の寺' },
        mode: 'local',
        dataJson,
        featureCount: 2,
      });
      assert.match(uid, UUID_PATTERN, 'createPoiSource は UUIDv4 の uid を採番するはず');
      const found = await SqliteDataService.findPoiSource(uid);
      assert.ok(found, 'findPoiSource(uid) がレコードを返すはず');
      assert.equal(found.uid, uid);
      assert.equal(found.slug, 'kyoto-temples');
      assert.deepEqual(found.title, { ja: '京都の寺' });
      assert.equal(found.mode, 'local');
      assert.equal(found.url, null, 'local ソースの url は null');
      assert.equal(found.featureCount, 2);
      assert.equal(found.revision, 1);
      assert.equal(found.dataJson, dataJson, 'findPoiSource は data blob を返す');
      console.log('ok: (a) createPoiSource/findPoiSource');

      // (b) findPoiSourceBySlug
      const bySlug = await SqliteDataService.findPoiSourceBySlug('kyoto-temples');
      assert.equal(bySlug.uid, uid);
      assert.equal(await SqliteDataService.findPoiSourceBySlug('no-such-slug'), null);
      console.log('ok: (b) findPoiSourceBySlug');

      // (c) upsertPoiSource の slug rename + registry 同期
      const renamed = await SqliteDataService.upsertPoiSource(
        uid,
        'kyoto-shrines',
        { title: { ja: '京都の社寺' }, mode: 'local', dataJson, featureCount: 2 },
        1,
      );
      assert.equal(renamed.revision, 2);
      const afterRename = await SqliteDataService.findPoiSource(uid);
      assert.equal(afterRename.slug, 'kyoto-shrines');
      assert.equal(afterRename.revision, 2);
      assert.deepEqual(afterRename.title, { ja: '京都の社寺' });
      const rawDb = await SqliteDataService.getDb();
      const registryRow = rawDb.prepare('SELECT kind, slug FROM asset_registry WHERE uid = ?').get(uid);
      assert.equal(registryRow.kind, 'poi_source');
      assert.equal(registryRow.slug, 'kyoto-shrines', 'registry の slug も同一Txで更新されるはず');
      assert.equal(await SqliteDataService.isSlugAvailable('kyoto-temples'), true, '旧slugは解放される');
      console.log('ok: (c) upsertPoiSource rename synced with registry');

      // (d) revision 楽観ロック
      let conflict = null;
      try {
        await SqliteDataService.upsertPoiSource(
          uid,
          'kyoto-shrines',
          { title: { ja: 'x' }, mode: 'local', dataJson, featureCount: 2 },
          1,
        );
      } catch (e) {
        conflict = e;
      }
      assert.ok(conflict instanceof RevisionConflictError, '古い expectedRevision では RevisionConflictError');
      assert.equal(conflict.kind, 'revision-conflict');
      assert.equal(conflict.current, 2);
      // expectedRevision なしは無条件上書き
      const overwritten = await SqliteDataService.upsertPoiSource(uid, 'kyoto-shrines', {
        title: { ja: '京都の社寺' }, mode: 'local', dataJson, featureCount: 2,
      });
      assert.equal(overwritten.revision, 3);
      console.log('ok: (d) upsertPoiSource optimistic locking');

      // (f) グローバルslug衝突 (map vs poi_source)
      await SqliteDataService.createMap('shared-slug', { title: '共有スラッグ地図' });
      await assert.rejects(
        () => SqliteDataService.createPoiSource('shared-slug', { title: { ja: 'x' }, mode: 'local', dataJson: '{"type":"FeatureCollection","features":[]}', featureCount: 0 }),
        'map が持つ slug で createPoiSource は失敗するはず',
      );
      await assert.rejects(
        () => SqliteDataService.createMap('kyoto-shrines', { title: '地図' }),
        'poi_source が持つ slug で createMap は失敗するはず',
      );
      console.log('ok: (f) global slug collision (map vs poi_source)');

      // (g) searchPoiSources が feature の name テキストでヒット
      // '金閣寺' は slug/title には無く feature の name にのみ存在する
      const hitsByFeature = await SqliteDataService.searchPoiSources('金閣寺');
      assert.equal(hitsByFeature.length, 1, 'feature name でヒットするはず');
      assert.equal(hitsByFeature[0].uid, uid);
      // slug でもヒット
      const hitsBySlug = await SqliteDataService.searchPoiSources('kyoto-shrines');
      assert.equal(hitsBySlug.length, 1);
      // 非該当語は空
      assert.equal((await SqliteDataService.searchPoiSources('nonexistent-xyz')).length, 0);
      console.log('ok: (g) searchPoiSources hits by feature name text');

      // (h) listPoiSources の要素に data blob が含まれない
      const list = await SqliteDataService.listPoiSources();
      assert.ok(list.length >= 1);
      const listed = list.find((item) => item.uid === uid);
      assert.ok(listed, 'listPoiSources に対象が含まれる');
      assert.equal(listed.slug, 'kyoto-shrines');
      assert.equal(listed.featureCount, 2);
      assert.equal(listed.revision, 3);
      assert.ok(!('dataJson' in listed), 'listPoiSources は data blob(dataJson) を含めない');
      assert.ok(!('data_json' in listed), 'listPoiSources は data blob(data_json) を含めない');
      console.log('ok: (h) listPoiSources excludes data blob');

      // (e) deletePoiSource が本体・registry を掃除する
      await SqliteDataService.deletePoiSource(uid);
      assert.equal(await SqliteDataService.findPoiSource(uid), null);
      assert.equal(await SqliteDataService.isSlugAvailable('kyoto-shrines'), true, 'delete で slug が解放される');
      assert.equal(rawDb.prepare('SELECT 1 FROM asset_registry WHERE uid = ?').get(uid), undefined, 'registry行も消える');
      assert.equal((await SqliteDataService.searchPoiSources('金閣寺')).length, 0, 'delete で FTS 索引も掃除される');
      console.log('ok: (e) deletePoiSource sweeps registry + FTS');

      // ============ assets (同型) ============

      // (i) createAsset → findAsset / findAssetBySlug
      const { uid: assetUid } = await SqliteDataService.createAsset('temple-photo', {
        title: { ja: '寺院の写真' },
        mime: 'image/jpeg',
        ext: 'jpg',
        width: 1024,
        height: 768,
        byteSize: 204800,
      });
      assert.match(assetUid, UUID_PATTERN);
      const asset = await SqliteDataService.findAsset(assetUid);
      assert.equal(asset.slug, 'temple-photo');
      assert.deepEqual(asset.title, { ja: '寺院の写真' });
      assert.equal(asset.mime, 'image/jpeg');
      assert.equal(asset.ext, 'jpg');
      assert.equal(asset.width, 1024);
      assert.equal(asset.height, 768);
      assert.equal(asset.byteSize, 204800);
      assert.equal(asset.revision, 1);
      const assetBySlug = await SqliteDataService.findAssetBySlug('temple-photo');
      assert.equal(assetBySlug.uid, assetUid);
      assert.equal(await SqliteDataService.findAssetBySlug('no-such-asset'), null);
      console.log('ok: (i) createAsset/findAsset/findAssetBySlug');

      // (j) upsertAssetMeta の slug rename + registry 同期 + revision++
      const assetRenamed = await SqliteDataService.upsertAssetMeta(
        assetUid,
        'shrine-photo',
        { title: { ja: '神社の写真' }, mime: 'image/jpeg', ext: 'jpg', width: 1024, height: 768, byteSize: 204800 },
        1,
      );
      assert.equal(assetRenamed.revision, 2);
      const afterAssetRename = await SqliteDataService.findAsset(assetUid);
      assert.equal(afterAssetRename.slug, 'shrine-photo');
      assert.deepEqual(afterAssetRename.title, { ja: '神社の写真' });
      const assetRegistryRow = rawDb.prepare('SELECT kind, slug FROM asset_registry WHERE uid = ?').get(assetUid);
      assert.equal(assetRegistryRow.kind, 'asset');
      assert.equal(assetRegistryRow.slug, 'shrine-photo');
      console.log('ok: (j) upsertAssetMeta rename synced with registry');

      // (k) revision 楽観ロック
      let assetConflict = null;
      try {
        await SqliteDataService.upsertAssetMeta(
          assetUid, 'shrine-photo',
          { title: { ja: 'x' }, mime: 'image/jpeg', ext: 'jpg', byteSize: 1 }, 1,
        );
      } catch (e) {
        assetConflict = e;
      }
      assert.ok(assetConflict instanceof RevisionConflictError);
      assert.equal(assetConflict.current, 2);
      console.log('ok: (k) upsertAssetMeta optimistic locking');

      // (m) グローバルslug衝突 (asset vs map)
      await assert.rejects(
        () => SqliteDataService.createMap('shrine-photo', { title: '地図' }),
        'asset が持つ slug で createMap は失敗するはず',
      );
      await assert.rejects(
        () => SqliteDataService.createAsset('shared-slug', { title: { ja: 'x' }, mime: 'image/png', ext: 'png', byteSize: 1 }),
        'map が持つ slug で createAsset は失敗するはず',
      );
      console.log('ok: (m) global slug collision (asset vs map)');

      // (n) searchAssets が title でヒット
      const assetHits = await SqliteDataService.searchAssets('神社');
      assert.equal(assetHits.length, 1);
      assert.equal(assetHits[0].uid, assetUid);
      const assetSlugHits = await SqliteDataService.searchAssets('shrine-photo');
      assert.equal(assetSlugHits.length, 1);
      assert.equal((await SqliteDataService.searchAssets('nonexistent-xyz')).length, 0);
      console.log('ok: (n) searchAssets hits by title/slug');

      // (o) listAssets が metadata を返す
      const assetList = await SqliteDataService.listAssets();
      const assetListed = assetList.find((item) => item.uid === assetUid);
      assert.ok(assetListed);
      assert.equal(assetListed.slug, 'shrine-photo');
      assert.equal(assetListed.mime, 'image/jpeg');
      assert.equal(assetListed.byteSize, 204800);
      assert.equal(assetListed.revision, 2);
      console.log('ok: (o) listAssets returns metadata');

      // (l) deleteAsset が本体・registry を掃除する
      await SqliteDataService.deleteAsset(assetUid);
      assert.equal(await SqliteDataService.findAsset(assetUid), null);
      assert.equal(await SqliteDataService.isSlugAvailable('shrine-photo'), true);
      assert.equal(rawDb.prepare('SELECT 1 FROM asset_registry WHERE uid = ?').get(assetUid), undefined);
      console.log('ok: (l) deleteAsset sweeps registry');

      console.log('M9-T2 poi store smoke passed');
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
          entryFileNames: 'poi-store-smoke.mjs',
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
  console.log('M9-T2 poi store smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
