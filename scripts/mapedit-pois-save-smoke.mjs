// スモーク: MapEdit の実保存経路で map data_json の pois が永続化されること。
// 既存の smoke と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// MapEditService.save (histMap2Store 経由のシリアライズ) → 再読込 (request = store2HistMap 経由) を
// behavioral に検証する。store_handler.ts の keys 配列に pois が無いと保存時に落ちる (本タスクの必須修正)。
// シナリオ:
//   ① mapObject.pois に {poiUid, cachedTitle} + 生 URL 文字列を混在 → MapEditService.save →
//      DB の data_json (findMapByRef) に pois がそのまま残る
//   ② MapEditService.request(uid) の読込方向 (store2HistMap) でも pois が保持される
//   ③ pois を持たない mapObject の保存では data_json に pois キーが生えない (undefined 混入なし)
import { rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';
import { makeSmokeScratch } from './smoke-scratch.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await makeSmokeScratch('mapedit-pois-save-');
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
  const poiServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const mapeditIpcPath = path.join(projectRoot, 'electron/ipc/mapedit.ts');

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
      // バンドルに含まれる MapDeleteTrashService が shell を named import するため
      // export が必要 (本 smoke は trashItem を呼ばないので no-op で可)
      export const shell = {
        trashItem(_path: string) { return Promise.resolve(); },
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
      const { default: PoiSourceService } = await import(${JSON.stringify(poiServicePath)});
      const { composeDownloadMapJson } = await import(${JSON.stringify(mapeditIpcPath)});
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
        attr: '© Example',
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

      // --- ④ main 側も新規の欠落と、既存値を空にする更新を拒否する ---
      const missingNew = await MapEditService.save({
        mapObject: { ...mapObject, mapID: 'missing-attribution-new', attr: '' }, tins: [], slug: 'missing-attribution-new',
      });
      assert.equal(missingNew.result, 'Error', '新規地図の帰属表記欠落は main で拒否するはず');
      const clearingUpdate = await MapEditService.save({
        uid: savedUid, mapObject: { ...mapObject, uid: savedUid, mapID: 'pois-save-map', attr: '' }, tins: [], slug: 'pois-save-map',
      });
      assert.equal(clearingUpdate.result, 'Error', '帰属表記を空にする更新は main で拒否するはず');

      // 以前から欠落していた地図の編集では欠落を維持できる（移行・修正で拒否も補完もしない）
      const legacyUid = (await SqliteDataService.createMap('legacy-attribution-map', { ...mapObject, mapID: 'legacy-attribution-map', attr: '' })).uid;
      const keepLegacy = await MapEditService.save({
        uid: legacyUid, mapObject: { ...mapObject, uid: legacyUid, mapID: 'legacy-attribution-map', attr: '' }, tins: [], slug: 'legacy-attribution-map',
      });
      assert.equal(keepLegacy.result, 'Success', '以前から欠落している地図の欠落はそのまま保てるはず');

      const raceUid = (await SqliteDataService.createMap('attribution-race-map', {
        ...mapObject, mapID: 'attribution-race-map', attr: '',
      })).uid;
      const [fillRace, staleRace] = await Promise.all([
        MapEditService.save({
          uid: raceUid,
          mapObject: { ...mapObject, uid: raceUid, mapID: 'attribution-race-map', attr: '© Added first' },
          tins: [], slug: 'attribution-race-map',
        }),
        MapEditService.save({
          uid: raceUid,
          mapObject: { ...mapObject, uid: raceUid, mapID: 'attribution-race-map', attr: '' },
          tins: [], slug: 'attribution-race-map',
        }),
      ]);
      assert.equal(fillRace.result, 'Success', '並行更新の帰属表記追加は成功するはず');
      assert.equal(staleRace.result, 'Error', '先行して追加された帰属表記を古い空値で消す更新は拒否するはず');
      assert.deepEqual((await SqliteDataService.findMapByRef(raceUid))?.attr, { ja: '© Added first' });

      const baseRace = await SqliteDataService.saveUserBaseMap({
        slug: 'attribution-race-base', create: true,
        tms: { kind: 'tms', attr: { ja: '© Initial' }, title: { ja: 'Race Base' }, url: 'https://example.org/race/{z}/{x}/{y}.png' },
      });
      const baseDb = await SqliteDataService.getDb();
      baseDb.prepare("UPDATE base_maps SET data_json = json_set(data_json, '$.attr', json('{}')) WHERE uid = ?").run(baseRace.uid);
      const [fillBaseRace, staleBaseRace] = await Promise.allSettled([
        SqliteDataService.saveUserBaseMap({
          uid: baseRace.uid, slug: 'attribution-race-base',
          tms: { kind: 'tms', attr: { ja: '© Added first' }, title: { ja: 'Race Base' }, url: 'https://example.org/race/{z}/{x}/{y}.png' },
        }),
        SqliteDataService.saveUserBaseMap({
          uid: baseRace.uid, slug: 'attribution-race-base',
          tms: { kind: 'tms', attr: {}, title: { ja: 'Race Base' }, url: 'https://example.org/race/{z}/{x}/{y}.png' },
        }),
      ]);
      assert.equal(fillBaseRace.status, 'fulfilled', '移行データに帰属表記を追加する更新は成功するはず');
      assert.equal(staleBaseRace.status, 'rejected', '先行追加された帰属表記を古い空値で消す更新は拒否するはず');
      const storedBaseRace = baseDb.prepare('SELECT data_json FROM base_maps WHERE uid = ?').get(baseRace.uid) as { data_json: string };
      assert.deepEqual(JSON.parse(storedBaseRace.data_json).attr, { ja: '© Added first' });
      await assert.rejects(
        () => SqliteDataService.saveUserBaseMap({ slug: 'missing-attribution-base-new', create: true, tms: { kind: 'tms', attr: {} } }),
        /mapmodel\.image_copyright/,
        '新規ベースマップの帰属表記欠落は main で拒否するはず',
      );
      const base = await SqliteDataService.saveUserBaseMap({
        slug: 'attributed-base-map', create: true,
        tms: { kind: 'tms', attr: { ja: '© Example' }, title: { ja: '背景地図' }, url: 'https://example.org/{z}/{x}/{y}.png' },
      });
      await assert.rejects(
        () => SqliteDataService.saveUserBaseMap({ uid: base.uid, slug: 'attributed-base-map', tms: { kind: 'tms', attr: {} } }),
        /mapmodel\.image_copyright/,
        'ベースマップの帰属表記を空にする更新は main で拒否するはず',
      );
      console.log('ok: (4) main rejects missing attribution on new maps and clearing updates, preserves legacy gaps');

      // --- ⑤ download 経路 (composeDownloadMapJson) でも {poiUid} 参照が解決され、
      //     未解決の poiUid キーが出力に残らないこと (品質レビューの指摘) ---
      //
      // 【地図 ZIP の書き出しの統一で解決形が変わった】以前は地図 ZIP だけが POI を
      // **インライン FC** へ展開していたが、書き出しの統一でアプリ搬出と同じ
      // **外部参照**（pois/<name>.geojson + 実体同梱）へ統一された。
      // ここで固定すべき意図は「未解決の {poiUid} を出力へ漏らさない」
      // 「件数を変えない」「解決できるなら warning を出さない」であり、
      // それらは保ったまま形だけを新契約へ合わせる（書き出しの統一の取り決め）。
      const created = await PoiSourceService.createLocal({ slug: 'download-poi', title: 'ダウンロードPOI' });
      assert.equal(created.result, 'Success', 'createLocal は Success のはず: ' + JSON.stringify(created));
      const srcUid = created.uid;
      const savedSource = await PoiSourceService.save(srcUid, {
        slug: 'download-poi',
        title: 'ダウンロードPOI',
        fc: {
          type: 'FeatureCollection',
          icon: 'builtin:defaultpin',
          features: [
            { type: 'Feature', id: 'spot',
              geometry: { type: 'Point', coordinates: [135.5, 35.5] },
              properties: { _maplatUid: '22222222-2222-4222-8222-222222222222', name: 'スポット' } },
          ],
        },
        expectedRevision: 1,
      });
      assert.equal(savedSource.result, 'Success', 'POI ソース save は Success のはず: ' + JSON.stringify(savedSource));

      const downloadPoisFixture = [{ poiUid: srcUid, cachedTitle: 'ダウンロードPOI' }, RAW_URL];
      const downloadSaveResult = await MapEditService.save({
        mapObject: { ...mapObject, mapID: 'download-poi-map', pois: downloadPoisFixture },
        tins: [],
        slug: 'download-poi-map',
      });
      assert.equal(
        downloadSaveResult.result, 'Success',
        'download 用 save は Success のはず: ' + JSON.stringify(downloadSaveResult)
      );
      // download 経路と同じ入力形 (MapEditService.request で読み込んだ編集用オブジェクト) を合成する
      const downloadMapObject = await MapEditService.request(downloadSaveResult.uid);
      const { compiled: downloadCompiled, warnings: downloadWarnings, documents: downloadDocuments } =
        await composeDownloadMapJson(downloadMapObject, []);
      assert.ok(Array.isArray(downloadCompiled.pois), 'download 出力に pois 配列があるはず');
      assert.equal(downloadCompiled.pois.length, 2, 'download 出力の pois 件数が変わらないはず');
      const resolvedRef = downloadCompiled.pois[0];
      assert.ok(
        resolvedRef && typeof resolvedRef === 'object' && !('poiUid' in resolvedRef),
        'download 出力の pois[0] に未解決の {poiUid} が残らないはず: ' + JSON.stringify(resolvedRef)
      );
      assert.equal(
        resolvedRef.layer, 'pois/download-poi.geojson',
        'download 出力の pois[0] は外部参照 pois/<slug>.geojson のはず: '
          + JSON.stringify(resolvedRef)
      );
      assert.equal(
        resolvedRef.type, undefined,
        'インライン FC へ展開しないはず（実体は documents 側へ出る）'
      );
      // 実体は documents として返る（周囲の { compiled, warnings } と同じ戻り値）
      assert.deepEqual(
        downloadDocuments.map((d: any) => d.dest), ['pois/download-poi.geojson'],
        '外部化された実体が documents へ乗るはず: ' + JSON.stringify(downloadDocuments)
      );
      assert.equal(
        downloadDocuments[0].json.type, 'FeatureCollection',
        '実体は export 形 FC のはず'
      );
      assert.deepEqual(
        downloadCompiled.pois[1], { layer: RAW_URL },
        '生 URL は {layer:URL} へ包まれて透過するはず'
          + '（viewer の先頭要素モード判定を避けるため）: '
          + JSON.stringify(downloadCompiled.pois[1])
      );
      assert.ok(
        !JSON.stringify(downloadCompiled.pois).includes('"poiUid"'),
        'download 出力全体に未解決の poiUid キーが残らないはず'
      );
      assert.deepEqual(downloadWarnings, [], 'すべて解決できるため download の warnings は空のはず');
      console.log('ok: (4) composeDownloadMapJson resolves {poiUid} references in download output (→ 外部参照)');

      console.log('mapedit pois save smoke passed');
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
  console.log('mapedit pois save smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
