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

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});

      // Initial catalog exposes builtin base maps only
      const initial = await SettingsService.listBaseMaps();
      assert.ok(initial.some((item) => item.scope === 'builtin' && item.mapID === 'osm'));
      assert.equal(initial.filter((item) => item.scope === 'user').length, 0);

      // Builtin masters are seeded from the KTGIS catalog (ADR-0002):
      // osm carries a 52px icon, KTGIS maps carry icon + coverage, and the
      // catalog includes newly imported maps such as muroran00
      const osm = initial.find((item) => item.scope === 'builtin' && item.mapID === 'osm');
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

      // Add a user base map (uid正準 ADR-0007: payload = { uid?, slug, tms }, uidなし=新規)
      const { uid: myBaseUid } = await SettingsService.saveUserBaseMap({
        slug: 'my_basemap',
        tms: {
          title: 'My Base Map',
          url: 'https://example.test/tiles/{z}/{x}/{y}.png',
          attr: 'Example Provider',
          minZoom: 5,
          maxZoom: 18,
        },
      });
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
      await SettingsService.saveUserBaseMap({
        uid: added.uid,
        slug: 'my_basemap',
        tms: {
          title: 'My Base Map v2',
          url: 'https://example.test/tiles/{z}/{x}/{-y}.png',
          thumbnail: 'tmbs/my_basemap_menu.jpg',
          coverageLngLats: [[139, 35], [140, 35], [140, 36], [139, 36]],
        },
      });
      const afterUpdate = await SettingsService.listBaseMaps();
      const updated = afterUpdate.find((item) => item.mapID === 'my_basemap');
      assert.equal(updated.uid, added.uid, '更新でuidが変わってはいけない');
      assert.equal(updated.data.title, 'My Base Map v2');
      assert.equal(updated.data.thumbnail, 'tmbs/my_basemap_menu.jpg');
      assert.equal(updated.data.coverageLngLats.length, 4);
      assert.equal(afterUpdate.filter((item) => item.mapID === 'my_basemap').length, 1);

      // Builtin ID conflicts are rejected (slugのグローバル一意性)
      await assert.rejects(() => SettingsService.saveUserBaseMap({
        slug: 'osm',
        tms: { title: 'Fake OSM', url: 'https://example.test/{z}/{x}/{y}.png' },
      }));
      await assert.rejects(() => SettingsService.saveUserBaseMap({ tms: { title: 'No ID' } }));
      // 未知のuid指定の更新は拒否される
      await assert.rejects(() => SettingsService.saveUserBaseMap({
        uid: '00000000-0000-4000-8000-000000000000',
        slug: 'ghost',
        tms: { title: 'Ghost', url: 'https://example.test/{z}/{x}/{y}.png' },
      }));

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
      const { uid: readdedUid } = await SettingsService.saveUserBaseMap({
        slug: 'my_basemap',
        tms: { title: 'My Base Map v3', url: 'https://example.test/tiles/{z}/{x}/{y}.png' },
      });
      assert.notEqual(readdedUid, added.uid, '再追加は別uidの新アセットになるはず');
      const visibility = await SettingsService.getBaseMapVisibilityOfMapID('some-map');
      const readded = visibility.find((item) => item.mapID === 'my_basemap');
      assert.equal(readded.uid, readdedUid);
      assert.equal(readded.enabled, false);

      // 新規作成時のアイコン付け替え: uid未採番のため暫定名でアップロードされたアイコンは
      // 保存時に tmbs/{uid}.{ext} へ移動され、thumbnail参照も追随する
      await mkdir(${JSON.stringify(path.join(dataDir, 'tmbs'))}, { recursive: true });
      await writeFile(${JSON.stringify(path.join(dataDir, 'tmbs'))} + '/icon_new.png', 'png-bytes');
      const { uid: iconNewUid } = await SettingsService.saveUserBaseMap({
        slug: 'icon_new',
        tms: { title: 'Icon New', url: 'https://example.test/{z}/{x}/{y}.png', thumbnail: 'tmbs/icon_new.png' },
      });
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

      // アイコンパスのuid化マイグレーション: レガシー状態(tmbs/{slug}.png参照)を捏造して
      // マーカーを剥がし、再起動で ファイル改名 + base_maps/apps の参照書き換え が走ることを確認
      const legacyIconRel = 'tmbs/my_basemap.png';
      await mkdir(${JSON.stringify(path.join(dataDir, 'tmbs'))}, { recursive: true });
      await writeFile(${JSON.stringify(path.join(dataDir, 'tmbs'))} + '/my_basemap.png', 'png-bytes');
      const legacyData = JSON.parse(
        db.prepare('SELECT data_json FROM base_maps WHERE uid = ?').get(readdedUid).data_json
      );
      legacyData.thumbnail = legacyIconRel;
      db.prepare('UPDATE base_maps SET data_json = ? WHERE uid = ?').run(JSON.stringify(legacyData), readdedUid);
      await SqliteDataService.createApp('icon-app', {
        title: 'アイコン参照アプリ',
        sources: [
          // 新形(data.thumbnail)と旧フラット保存形(thumbnail直下)の両方を混在させる
          { sourceType: 'tms', mapUid: 'my_basemap', data: { url: 'https://example.test/{z}/{x}/{y}.png', thumbnail: legacyIconRel } },
          { mapID: 'my_basemap', url: 'https://example.test/{z}/{x}/{y}.png', thumbnail: legacyIconRel },
        ],
      });
      db.prepare("DELETE FROM schema_migrations WHERE id = '2026-07-09-base-map-icon-uid-paths'").run();

      // 一括prefix移行: 本接頭辞導入以前の旧コードが生slugキーで書いた暫定行は、
      // マーカー付き移行で slug: 接頭辞へ付け替えられる(その後の採用も機能する)
      db.prepare(
        "INSERT INTO map_base_map_visibility (map_uid, base_map_uid, enabled) VALUES ('rawdraft', ?, 1)"
      ).run(readdedUid);
      db.prepare("DELETE FROM schema_migrations WHERE id = '2026-07-09-provisional-visibility-slug-prefix'").run();

      await SqliteDataService.reset();
      const reopenedDb = await SqliteDataService.getDb();
      const migratedThumb = JSON.parse(
        reopenedDb.prepare('SELECT data_json FROM base_maps WHERE uid = ?').get(readdedUid).data_json
      ).thumbnail;
      assert.equal(migratedThumb, 'tmbs/' + readdedUid + '.png');
      await access(${JSON.stringify(path.join(dataDir, 'tmbs'))} + '/' + readdedUid + '.png');
      await assert.rejects(() => access(${JSON.stringify(path.join(dataDir, 'tmbs'))} + '/my_basemap.png'));
      const migratedApp = await SqliteDataService.findAppBySlug('icon-app');
      assert.equal(migratedApp.sources[0].data.thumbnail, 'tmbs/' + readdedUid + '.png',
        'アプリ内のTMSソース参照もuidパスへ追随するはず');
      assert.equal(migratedApp.sources[1].thumbnail, 'tmbs/' + readdedUid + '.png',
        '旧フラット保存形(thumbnail直下)の参照も追随するはず');

      // TTL掃除の検証(上の再起動で実行済み): 古い暫定行は消え、新しい暫定行は残る
      const provisionalKeys = reopenedDb
        .prepare("SELECT map_uid FROM map_base_map_visibility WHERE map_uid LIKE 'slug:%'")
        .all()
        .map((row) => row.map_uid);
      assert.ok(!provisionalKeys.includes('slug:abandoned-map'), '7日超の暫定行は掃除されるはず');
      assert.ok(provisionalKeys.includes('slug:fresh-draft'), '新しい暫定行は掃除されないはず');

      // 一括prefix移行の検証(上の再起動で実行済み): 生slug行は slug: 接頭辞へ付け替えられ、
      // その後の初回保存でuidキーへ採用される
      assert.ok(provisionalKeys.includes('slug:rawdraft'), '生slugの暫定行はslug:接頭辞へ付け替えられるはず');
      assert.ok(
        !reopenedDb.prepare("SELECT 1 FROM map_base_map_visibility WHERE map_uid = 'rawdraft'").get(),
        '生slugキーの行は残らないはず'
      );
      const { uid: rawDraftUid } = await SqliteDataService.createMap('rawdraft', { title: '生slug下書き地図' });
      assert.ok(
        (await SettingsService.getTmsListOfMapID(rawDraftUid)).some((tms) => tms.mapID === 'my_basemap'),
        '付け替え後の暫定行も初回保存でuidキーへ採用されるはず'
      );

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
