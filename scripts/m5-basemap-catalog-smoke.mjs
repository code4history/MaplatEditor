import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'basemap-catalog-'));
const entryFile = path.join(workDir, 'basemap-catalog-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'basemap-catalog-smoke.mjs');

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
      import { access, mkdir, writeFile } from 'node:fs/promises';
      import nodePath from 'node:path';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      // T4 legacy fixture: lang/label を持たないユーザーベースマップを移行対象として先置きする。
      // m19-t7: 以前は SQLite の base_maps 行を直に捏造して起動時 migration
      // applyBaseMapLanguageMigration に拾わせていたが、その段は撤去された（未公開の SQLite
      // ストア内部の世代差を埋める段であり 0.7.0 からは到達しない）。∴ 実際に 0.7.0 が
      // 世に出した形 = settings/tmsList.json のエントリとして置き、**取込の時点で**
      // lang / label が付くことを確認する形へ移した（観測される結果は同じ）。
      await mkdir(nodePath.join(${JSON.stringify(dataDir)}, 'settings'), { recursive: true });
      await writeFile(
        nodePath.join(${JSON.stringify(dataDir)}, 'settings', 'tmsList.json'),
        JSON.stringify([
          { mapID: 'user-base', title: 'User Base', url: 'https://example.test/{z}/{x}/{y}.png' },
        ])
      );

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});

      // Initial catalog exposes builtin base maps only
      const initial = await SettingsService.listBaseMaps();
      assert.ok(initial.some((item) => item.scope === 'builtin' && item.mapID === 'osm'));
      assert.equal(initial.filter((item) => item.scope === 'user').length, 1);

      // Builtin masters are seeded from the KTGIS catalog (ADR-0002):
      // osm carries a 52px icon, KTGIS maps carry icon + coverage, and the
      // catalog includes newly imported maps such as muroran00
      const osm = initial.find((item) => item.scope === 'builtin' && item.mapID === 'osm');
      assert.equal(osm.data.lang, 'en', 'builtin Base Mapのdefault languageはenのはず');
      assert.equal(typeof osm.data.title, 'object', 'builtin titleは内部LangResource形のはず');
      assert.equal(typeof osm.data.label, 'object', 'builtin labelは内部LangResource形のはず');
      assert.equal(osm.data.thumbnail, 'basemap_icons/osm.png');
      assert.ok(!osm.data.coverageLngLats, 'osm coverage must stay undefined (global)');
      const gsi = initial.find((item) => item.scope === 'builtin' && item.mapID === 'gsi');
      assert.ok(Array.isArray(gsi.data.coverageLngLats));
      assert.ok(!gsi.data.envelopeLngLats, 'usage envelope must stay empty by default (ADR-0004)');
      const muroran = initial.find((item) => item.scope === 'builtin' && item.mapID === 'muroran00');
      assert.ok(muroran, 'newly imported KTGIS map muroran00 must exist');
      assert.equal(muroran.data.thumbnail, 'basemap_icons/muroran00.png');
      assert.equal(muroran.data.coverageLngLats.length, 4);
      assert.ok(initial.filter((item) => item.scope === 'builtin').length >= 329);
      const migratedUserBase = initial.find((item) => item.scope === 'user' && item.mapID === 'user-base');
      assert.ok(migratedUserBase, '0.7.0 の tmsList エントリが取り込まれるはず');
      assert.equal(migratedUserBase.data.lang, 'ja', 'lang欠落の0.7.0 user Base Mapは取込時にjaが入るはず');
      assert.deepEqual(migratedUserBase.data.title, { ja: 'User Base' });
      assert.deepEqual(migratedUserBase.data.label, { ja: 'User Base' }, 'label欠落時はtitleをcloneするはず');

      // Add a user base map (uid正準 ADR-0007: payload = { uid?, slug, tms }, uidなし=新規)
      const addedResult = await SettingsService.saveUserBaseMap({
        slug: 'my_basemap',
        tms: {
          title: 'My Base Map',
          url: 'https://example.test/tiles/{z}/{x}/{y}.png',
          attr: 'Example Provider',
          minZoom: 5,
          maxZoom: 18,
        },
      });
      assert.equal(addedResult.result, 'Success');
      const { uid: myBaseUid, revision: myBaseRevision } = addedResult;
      const afterAdd = await SettingsService.listBaseMaps();
      const added = afterAdd.find((item) => item.mapID === 'my_basemap');
      assert.ok(added);
      assert.equal(added.uid, myBaseUid);
      assert.equal(added.scope, 'user');
      assert.equal(added.data.title, 'My Base Map');
      assert.equal(added.data.minZoom, 5);
      assert.equal(added.data.maxZoom, 18);

      // オプトイン方式(ADR-0006): 明示的に選択した地図のTMSリストにのみ現れる。
      // ベースマップの指定はuid正準
      const tmsListBefore = await SettingsService.getTmsListOfMapID('some-map');
      assert.ok(!tmsListBefore.some((tms) => tms.mapID === 'my_basemap'));
      await SettingsService.setBaseMapVisibilityForMapID('some-map', added.uid, true);
      const tmsList = await SettingsService.getTmsListOfMapID('some-map');
      assert.ok(tmsList.some((tms) => tms.mapID === 'my_basemap'));

      // 未保存地図('some-map'は地図として未登録)の表示設定は sentinel 付き暫定キー
      // 'slug:{slug}' で置かれる(uidと混同され得ない)
      const db = await SqliteDataService.getDb();
      const provisionalRow = db
        .prepare('SELECT map_uid FROM map_base_map_visibility WHERE base_map_uid = ?')
        .get(added.uid);
      assert.equal(provisionalRow.map_uid, 'slug:some-map');

      // Update preserves scope and updates content; user masters can carry
      // icon (thumbnail) and coverage (coverageLngLats) as app-selection defaults
      const savedUpdate = await SettingsService.saveUserBaseMap({
        uid: added.uid,
        slug: 'my_basemap',
        expectedRevision: myBaseRevision,
        tms: {
          title: 'My Base Map v2',
          url: 'https://example.test/tiles/{z}/{x}/{-y}.png',
          thumbnail: 'tmbs/my_basemap_menu.jpg',
          coverageLngLats: [[139, 35], [140, 35], [140, 36], [139, 36]],
        },
      });
      assert.equal(savedUpdate.result, 'Success');
      assert.equal(savedUpdate.revision, myBaseRevision + 1);
      const staleUpdate = await SettingsService.saveUserBaseMap({
        uid: added.uid,
        slug: 'my_basemap-stale',
        expectedRevision: myBaseRevision,
        tms: { title: 'Stale update', url: 'https://example.test/stale/{z}/{x}/{y}.png' },
      });
      assert.deepEqual(staleUpdate, { error: 'revision-conflict', current: savedUpdate.revision });
      const afterUpdate = await SettingsService.listBaseMaps();
      const updated = afterUpdate.find((item) => item.mapID === 'my_basemap');
      assert.equal(updated.uid, added.uid, '更新でuidが変わってはいけない');
      assert.equal(updated.data.title, 'My Base Map v2');
      assert.equal(updated.data.thumbnail, 'tmbs/my_basemap_menu.jpg');
      assert.equal(updated.data.coverageLngLats.length, 4);
      assert.equal(afterUpdate.filter((item) => item.mapID === 'my_basemap').length, 1);

      // Builtin ID conflicts are rejected (slugのグローバル一意性)
      assert.deepEqual(await SettingsService.saveUserBaseMap({
        slug: 'osm',
        tms: { title: 'Fake OSM', url: 'https://example.test/{z}/{x}/{y}.png' },
      }), { result: 'Exist' });
      assert.deepEqual(await SettingsService.saveUserBaseMap({ tms: { title: 'No ID' } }), {
        result: 'Error', code: 'invalid-request', message: 'slug is required',
      });
      // 未知のuid指定の更新は拒否される
      assert.deepEqual(await SettingsService.saveUserBaseMap({
        uid: '00000000-0000-4000-8000-000000000000',
        slug: 'ghost',
        tms: { title: 'Ghost', url: 'https://example.test/{z}/{x}/{y}.png' },
      }), { result: 'Error', code: 'not-found', message: 'Unknown user base map: 00000000-0000-4000-8000-000000000000' });

      // Visibility rows of a deleted user base map are cleaned up (削除はuid指定)
      await SettingsService.setBaseMapVisibilityForMapID('some-map', added.uid, false);
      await SettingsService.deleteUserBaseMap(added.uid);
      const afterDelete = await SettingsService.listBaseMaps();
      assert.ok(!afterDelete.some((item) => item.mapID === 'my_basemap'));
      // schema v2 (ADR-0007): 表示設定はuidキー。削除で当該ベースマップの行(暫定キー含む)が全て掃除される
      const visibilityRows = db
        .prepare('SELECT count(*) AS count FROM map_base_map_visibility')
        .get();
      assert.equal(Number(visibilityRows.count), 0);

      // 同じslugで再追加すると新しいuidの別アセットになり、表示設定は既定(オプトイン=非表示)に戻る
      const readdedResult = await SettingsService.saveUserBaseMap({
        slug: 'my_basemap',
        tms: { title: 'My Base Map v3', url: 'https://example.test/tiles/{z}/{x}/{y}.png' },
      });
      assert.equal(readdedResult.result, 'Success');
      const { uid: readdedUid } = readdedResult;
      assert.notEqual(readdedUid, added.uid, '再追加は別uidの新アセットになるはず');
      const visibility = await SettingsService.getBaseMapVisibilityOfMapID('some-map');
      const readded = visibility.find((item) => item.mapID === 'my_basemap');
      assert.equal(readded.uid, readdedUid);
      assert.equal(readded.enabled, false);

      // 新規作成時のアイコン付け替え: uid未採番のため暫定名でアップロードされたアイコンは
      // 保存時に tmbs/{uid}.{ext} へ移動され、thumbnail参照も追随する
      await mkdir(${JSON.stringify(path.join(dataDir, 'tmbs'))}, { recursive: true });
      await writeFile(${JSON.stringify(path.join(dataDir, 'tmbs'))} + '/icon_new.png', 'png-bytes');
      const iconNewResult = await SettingsService.saveUserBaseMap({
        slug: 'icon_new',
        tms: { title: 'Icon New', url: 'https://example.test/{z}/{x}/{y}.png', thumbnail: 'tmbs/icon_new.png' },
      });
      assert.equal(iconNewResult.result, 'Success');
      const { uid: iconNewUid } = iconNewResult;
      const iconNew = (await SettingsService.listBaseMaps()).find((item) => item.uid === iconNewUid);
      assert.equal(iconNew.data.thumbnail, 'tmbs/' + iconNewUid + '.png');
      await access(${JSON.stringify(path.join(dataDir, 'tmbs'))} + '/' + iconNewUid + '.png');
      await assert.rejects(() => access(${JSON.stringify(path.join(dataDir, 'tmbs'))} + '/icon_new.png'));
      await SettingsService.deleteUserBaseMap(iconNewUid);

      // 暫定表示設定の採用: 未保存地図('draft-map')の設定は初回保存時にuidキーへ引き継がれる
      await SettingsService.setBaseMapVisibilityForMapID('draft-map', readdedUid, true);
      const { uid: draftMapUid } = await SqliteDataService.createMap('draft-map', { title: '下書き地図' });
      const adoptedRows = db
        .prepare('SELECT map_uid FROM map_base_map_visibility WHERE base_map_uid = ?')
        .all(readdedUid)
        .map((row) => row.map_uid);
      assert.deepEqual(adoptedRows, [draftMapUid], '暫定行はuidキーへ移動し、slug:行は残らないはず');
      assert.ok(
        (await SettingsService.getTmsListOfMapID(draftMapUid)).some((tms) => tms.mapID === 'my_basemap')
      );

      // 放棄された暫定行のTTL掃除(7日): 古い暫定行は再起動(migrate)で削除され、新しい暫定行は残る
      db.prepare(
        "INSERT INTO map_base_map_visibility (map_uid, base_map_uid, enabled, updated_at) VALUES ('slug:abandoned-map', ?, 1, datetime('now', '-8 days'))"
      ).run(readdedUid);
      await SettingsService.setBaseMapVisibilityForMapID('fresh-draft', readdedUid, true);

      // m19-t7: ここにあった 2 つの起動時 migration の検証（ベースマップアイコンパスの uid 化
      // '2026-07-09-base-map-icon-uid-paths' と、暫定表示設定キーの一括 slug: 接頭辞化
      // '2026-07-09-provisional-visibility-slug-prefix'）は、当該 migration ごと撤去した。
      // どちらも未公開の SQLite ストア内部の世代差を埋める段であり、0.7.0 の入力からは
      // 到達しない（0.7.0 のベースマップに thumbnail キーは実測 0 件。0.7.0 の取込が書く
      // 可視性キーは常に uid なので生 slug 行も生じない）。
      // 撤去後も残る「毎起動の掃除」sweepStaleProvisionalVisibility の検証は下に残す。

      await SqliteDataService.reset();
      const reopenedDb = await SqliteDataService.getDb();

      // TTL掃除の検証(上の再起動で実行済み): 古い暫定行は消え、新しい暫定行は残る
      const provisionalKeys = reopenedDb
        .prepare("SELECT map_uid FROM map_base_map_visibility WHERE map_uid LIKE 'slug:%'")
        .all()
        .map((row) => row.map_uid);
      assert.ok(!provisionalKeys.includes('slug:abandoned-map'), '7日超の暫定行は掃除されるはず');
      assert.ok(provisionalKeys.includes('slug:fresh-draft'), '新しい暫定行は掃除されないはず');

      // UUID形状のslugを持つ未保存地図: 実在しないuid形状の参照は偽uidキーにならず
      // sentinel(slug:)に置かれ、初回保存でuidキーへ採用される
      const uuidShapedSlug = '99999999-9999-4999-8999-999999999999';
      await SettingsService.setBaseMapVisibilityForMapID(uuidShapedSlug, readdedUid, true);
      assert.ok(
        reopenedDb.prepare('SELECT 1 FROM map_base_map_visibility WHERE map_uid = ?').get('slug:' + uuidShapedSlug),
        'UUID形状の未保存slugは偽uidキーではなくslug:接頭辞で置かれるはず'
      );
      assert.ok(
        !reopenedDb.prepare('SELECT 1 FROM map_base_map_visibility WHERE map_uid = ?').get(uuidShapedSlug),
        'UUID形状の参照が実在しない地図uidとして保存されてはいけない'
      );
      // 保存前の読み出しも同じsentinelを見る
      assert.ok(
        (await SettingsService.getTmsListOfMapID(uuidShapedSlug)).some((tms) => tms.mapID === 'my_basemap')
      );
      const { uid: uuidSlugMapUid } = await SqliteDataService.createMap(uuidShapedSlug, { title: 'UUID形状slugの地図' });
      assert.notEqual(uuidSlugMapUid, uuidShapedSlug);
      assert.ok(
        (await SettingsService.getTmsListOfMapID(uuidSlugMapUid)).some((tms) => tms.mapID === 'my_basemap'),
        'UUID形状slugの暫定行も初回保存でuidキーへ採用されるはず'
      );

      console.log('M5 base map catalog smoke passed');
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
          entryFileNames: 'basemap-catalog-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M5 base map catalog smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
