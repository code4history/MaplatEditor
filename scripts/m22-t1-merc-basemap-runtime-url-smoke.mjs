// m22-t1 smoke: merc ベースマップの実行時タイル URL 導出（GCP 編集画面での表示是正）。
// タスク設計 `docs/superpowers/specs/2026-08-15-m22-t1-merc-basemap-runtime-url-design.md` v1.3 §7.2 準拠。
// （S7 の `'url_' in result === false` 判定は v1.3 で追加された条件であり、本 smoke に実装されている）
//
// 本 smoke は **2種類の harness を1本に同居させる**（設計 §4.4 / round 3 申し送り9）:
//   (I)  electron stub ＋ vite ssr build で ipcMain handler を直接起動する
//        （前例: scripts/m12-t1-hotfix-1-search-thumbnails-smoke.mjs:30-106,212-213）
//        → S2 / S3 / S4 / S5-a / S6 / S8
//   (II) vite lib build で src/utils/*.ts を .mjs 化して import する
//        （前例: scripts/m6-t10-app-source-diff-model-smoke.mjs:22-38）
//        → S5-b / S7
//   加えて electron を import しない純関数を直接 import する
//        （前例: scripts/m19-t4a-settings-menu-about-smoke.mjs:13）
//        → S1
//
// 実行順は (I) → S1 → (II) の順にしてある。RED 先行（設計 §7.2）で S2 が
// 「純関数の不在」ではなく「IPC が url_ を返さない」という振る舞いで落ちるようにするため。
//
// シナリオ:
//   S1 deriveMercBaseMapTileUrl の純関数マトリクス（merc/非merc・uid 空・saveFolder 空・
//      percent-encoding・テンプレート部 {z}/{x}/{y} 無加工）
//   S2 IPC 3チャネルすべてが item レベルに同じ url_ を返す
//   S3 同じ行の data.url は '' のままで、data に url_ キーが存在しない（'url_' in item.data === false）
//   S4 item.data を丸ごと saveUser へ差し戻しても data_json に url_ が現れない（防壁不要の実証）
//   S5 IPC を通らない経路（SettingsService.listBaseMaps）に url_ が無く、
//      composeBaseMapSettingFile の出力にも url_ が出ない
//   S6 非 merc（tms / google / mapbox / maplibre）の item に url_ が立たない（'url_' in item === false）
//   S7 toBaseMapLayerData が url_ を載せ替え、引数の item.data を破壊せず、
//      url_ を持たない item の返り値には url_ own key を立てない（round 3 MNR-13）
//   S8 search:baseMaps の pageSize<=0（全件）経路でも url_ と thumbnailUrl の両方が添付される
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm22-t1-merc-url-'));
const entryFile = path.join(workDir, 'm22-t1-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const ipcOutDir = path.join(workDir, 'dist-ipc');
const libOutDir = path.join(workDir, 'dist-lib');
const bundledFile = path.join(ipcOutDir, 'm22-t1-smoke.mjs');
const snapshotFile = path.join(workDir, 'ipc-snapshot.json');

const MERC_UID = '11111111-2222-3333-4444-555555555555';
const MERC_SLUG = 'm22-merc-a';
const NON_MERC = [
  { uid: 'aaaaaaaa-0000-4000-8000-000000000001', slug: 'm22-kind-tms', kind: 'tms' },
  { uid: 'aaaaaaaa-0000-4000-8000-000000000002', slug: 'm22-kind-google', kind: 'google' },
  { uid: 'aaaaaaaa-0000-4000-8000-000000000003', slug: 'm22-kind-mapbox', kind: 'mapbox' },
  { uid: 'aaaaaaaa-0000-4000-8000-000000000004', slug: 'm22-kind-maplibre', kind: 'maplibre' },
];

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  // ============================================================
  // harness (I): electron stub ＋ vite ssr build で ipcMain handler を直接起動する
  // ============================================================
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
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
      export const ipcMain = {
        handle(channel: string, fn: any) { handlers.set(channel, fn); },
        removeHandler() {},
      };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
      };
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
      import nodePath from 'node:path';
      import { writeFile as fsWriteFile } from 'node:fs/promises';
      import fileUrl from 'file-url';

      const dataDir = ${JSON.stringify(dataDir)};
      const MERC_UID = ${JSON.stringify(MERC_UID)};
      const MERC_SLUG = ${JSON.stringify(MERC_SLUG)};
      const NON_MERC = ${JSON.stringify(NON_MERC)};
      const snapshotFile = ${JSON.stringify(snapshotFile)};

      // 同梱リソース（basemap_icons/）の解決基点を明示する。
      // electron/utils/resourceAssets.ts は APP_ROOT が無いと bundle の __dirname から
      // 相対で探すため、outDir 名に依存した偶然の解決になる（m12-t1 の harness は outDir が
      // 'dist' で vite が publicDir を複製するため偶然通っている）。ここでは明示して固定する
      // （前例: m4-t2 / m4-t3 / m10-t1 / m12-t16 の各 smoke が同じ形で設定している）。
      process.env.APP_ROOT = ${JSON.stringify(projectRoot)};

      const { __handlers } = await import(${JSON.stringify(electronStubFile)});
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
      const { registerSettingsHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/settings.ts'))});
      const { registerSearchHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/search.ts'))});
      const db = await SqliteDataService.getDb();
      registerSettingsHandlers();
      registerSearchHandlers();
      const call = (channel: string, ...args: any[]) => __handlers.get(channel)(null, ...args);

      // --- seed: 地図1件 + merc ベースマップ1件 + 非 merc 4種 ---
      const mapSlug = 'm22-t1-map';
      const seedMap = await SqliteDataService.createMap(mapSlug, {
        title: 'm22 map', lang: 'ja', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain',
      }, crypto.randomUUID());
      const mapUid = seedMap.uid;

      const makeTms = (kind: string, title: string) => ({
        kind,
        lang: 'ja',
        title: { ja: title },
        label: { ja: title },
        attr: { ja: '帰属' },
        dataAttr: {},
        license: '',
        dataLicense: '',
        licenseNote: {},
        dataLicenseNote: {},
        // merc は url を保存しない（読み込み時は常に空文字。m6-t8 の不変条件）
        url: kind === 'merc' ? '' : 'https://example.invalid/{z}/{x}/{y}.png',
        minZoom: 12,
        maxZoom: 16,
        thumbnail: '',
        coverageLngLats: null,
        tileJsonSourceUrl: null,
        sourceMapUid: null,
      });

      await SqliteDataService.saveUserBaseMap({
        uid: MERC_UID, slug: MERC_SLUG, create: true, tms: makeTms('merc', 'メルカトルA'),
      });
      for (const spec of NON_MERC) {
        await SqliteDataService.saveUserBaseMap({
          uid: spec.uid, slug: spec.slug, create: true, tms: makeTms(spec.kind, spec.slug),
        });
      }
      await SqliteDataService.setBaseMapVisibilityForMapID(mapUid, MERC_UID, true);

      // 期待値: {saveFolder}/merc/{baseMapUid}/{z}/{x}/{y}.png（ADR-0016 の実体レイアウト・uid 名前空間）
      const expectedUrl = fileUrl(nodePath.join(dataDir, 'merc', MERC_UID)) + '/{z}/{x}/{y}.png';

      // ============================================================
      // S2: IPC 3チャネルすべてが item レベルに同じ url_ を返す
      // ============================================================
      const visibilityItems = await call('mapedit:get-base-map-visibility', mapUid);
      const listItems = await call('basemaps:list');
      const searchPaged = await call('search:baseMaps', { q: '', page: 1, pageSize: 0 });
      const searchItems = searchPaged.docs;

      const findMerc = (items: any[]) => items.find((item: any) => item.uid === MERC_UID);
      const channels: [string, any][] = [
        ['mapedit:get-base-map-visibility', findMerc(visibilityItems)],
        ['basemaps:list', findMerc(listItems)],
        ['search:baseMaps', findMerc(searchItems)],
      ];
      for (const [channel, item] of channels) {
        assert.ok(item, 'S2: ' + channel + ' に seed した merc ベースマップが含まれること');
        assert.equal(item.data?.kind, 'merc', 'S2: ' + channel + ' の対象行は kind=merc であること');
        assert.equal(
          item.url_, expectedUrl,
          'S2: ' + channel + ' が item レベルへ merc の実行時タイル URL を付与すること: ' + item.url_,
        );
      }
      console.log('ok: S2 all three IPC channels attach the same item-level url_');

      // ============================================================
      // S3: data.url は '' のままで、data に url_ キーが存在しない
      // ============================================================
      for (const [channel, item] of channels) {
        assert.equal(item.data.url, '', 'S3: ' + channel + ' の merc は data.url が空文字のままであること');
        assert.equal(
          'url_' in item.data, false,
          'S3: ' + channel + ' の data に url_ own key が存在しないこと（item レベルであることの確認）',
        );
      }
      console.log('ok: S3 data.url stays empty and data has no url_ own key');

      // ============================================================
      // S4: item.data を丸ごと saveUser へ差し戻しても data_json に url_ が現れない
      //     （MapEdit.vue:3866-3879 と同じ形。書き込み側防壁を置かずに成立することの実証）
      // ============================================================
      const listMerc = findMerc(listItems);
      const plainData = JSON.parse(JSON.stringify(listMerc.data));
      await SqliteDataService.saveUserBaseMap({
        uid: MERC_UID,
        slug: listMerc.mapID,
        expectedRevision: listMerc.revision,
        tms: { ...plainData, minZoom: 13, maxZoom: 17, coverageLngLats: null },
      });
      const row = db.prepare('SELECT data_json FROM base_maps WHERE uid = ?').get(MERC_UID) as any;
      assert.ok(row, 'S4: 差し戻し後も merc マスタ行が存在すること');
      assert.equal(
        String(row.data_json).includes('url_'), false,
        'S4: data_json のテキストに url_ が現れないこと: ' + row.data_json,
      );
      const reread = await SqliteDataService.findBaseMapByUid(MERC_UID);
      assert.equal('url_' in reread.data, false, 'S4: 再読み込みした data に url_ own key が無いこと');
      assert.equal(reread.data.url, '', 'S4: 差し戻し後も data.url は空文字のままであること');
      console.log('ok: S4 round-tripping item.data through saveUser does not persist url_');

      // ============================================================
      // S5-a: IPC を通らない経路（SettingsService.listBaseMaps）に url_ が存在しない
      // ============================================================
      const directItems = await SettingsService.listBaseMaps();
      const directMerc = directItems.find((item: any) => item.uid === MERC_UID);
      assert.ok(directMerc, 'S5-a: 直呼び経路にも merc マスタが含まれること');
      assert.equal(
        'url_' in directMerc, false,
        'S5-a: IPC を通らない SettingsService.listBaseMaps() の item に url_ own key が無いこと',
      );
      assert.equal('url_' in directMerc.data, false, 'S5-a: 同 item の data にも url_ が無いこと');
      console.log('ok: S5-a non-IPC path (SettingsService.listBaseMaps) carries no url_');

      // ============================================================
      // S6: 非 merc（tms / google / mapbox / maplibre）に url_ が立たない
      //     判定は 'url_' in item === false（値が undefined の own key でも不合格）
      // ============================================================
      for (const [channel, items] of [
        ['mapedit:get-base-map-visibility', visibilityItems],
        ['basemaps:list', listItems],
        ['search:baseMaps', searchItems],
      ] as [string, any[]][]) {
        for (const spec of NON_MERC) {
          const item = items.find((candidate: any) => candidate.uid === spec.uid);
          assert.ok(item, 'S6: ' + channel + ' に ' + spec.kind + ' の行が含まれること');
          assert.equal(
            'url_' in item, false,
            'S6: ' + channel + ' の ' + spec.kind + ' に url_ own key が立たないこと',
          );
        }
        // ビルトイン（329件）にも一切立たないこと
        const builtinWithUrl = items.filter((item: any) => item.scope === 'builtin' && 'url_' in item);
        assert.equal(
          builtinWithUrl.length, 0,
          'S6: ' + channel + ' のビルトインに url_ own key が立たないこと（' + builtinWithUrl.length + ' 件）',
        );
      }
      console.log('ok: S6 non-merc items (incl. builtins) never get a url_ own key');

      // ============================================================
      // S8: search:baseMaps の pageSize<=0（全件）経路でも url_ と thumbnailUrl の両方が添付される
      //     （attachBaseMapListExtras へ畳む際に attachWhenUnbounded=true を落としていないこと）
      // ============================================================
      // pageSize>0 側は全行（builtin 329 + user 5）が1ページに収まる値にする。
      // builtin が先にソートされるため、小さい pageSize では user の merc 行が page 1 に載らない。
      for (const pageSize of [400, 0]) {
        const paged = await call('search:baseMaps', { q: '', page: 1, pageSize });
        const merc = paged.docs.find((doc: any) => doc.uid === MERC_UID);
        assert.ok(merc, 'S8: pageSize=' + pageSize + ' で merc 行が返ること');
        assert.equal(merc.url_, expectedUrl, 'S8: pageSize=' + pageSize + ' でも url_ が添付されること: ' + merc.url_);
        const osm = paged.docs.find((doc: any) => doc.mapID === 'osm');
        assert.ok(osm, 'S8: pageSize=' + pageSize + ' でビルトイン osm が返ること');
        assert.ok(
          osm.thumbnailUrl && String(osm.thumbnailUrl).includes('basemap_icons'),
          'S8: pageSize=' + pageSize + ' でも thumbnailUrl の添付が維持されること: ' + osm.thumbnailUrl,
        );
      }
      // bbox 分岐（もう一方の呼び出し点）でも同じ添付が効くこと
      const bboxPaged = await call('search:baseMaps', { q: '', page: 1, pageSize: 0, bbox: [-180, -85, 180, 85] });
      const bboxOsm = bboxPaged.docs.find((doc: any) => doc.mapID === 'osm');
      assert.ok(
        bboxOsm && bboxOsm.thumbnailUrl && String(bboxOsm.thumbnailUrl).includes('basemap_icons'),
        'S8: bbox 分岐でも thumbnailUrl が添付されること',
      );
      console.log('ok: S8 search:baseMaps keeps attachWhenUnbounded=true for both url_ and thumbnailUrl');

      // renderer 側検証（S5-b / S7）へ渡すスナップショット
      await fsWriteFile(snapshotFile, JSON.stringify({
        expectedUrl,
        mercItem: findMerc(listItems),
        nonMercItem: listItems.find((item: any) => item.uid === NON_MERC[0].uid),
      }, null, 2));

      console.log('m22-t1 smoke (IPC harness): S2/S3/S4/S5-a/S6/S8 PASS');
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
      outDir: ipcOutDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp'],
        output: {
          entryFileNames: 'm22-t1-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  // ============================================================
  // S1: deriveMercBaseMapTileUrl の純関数マトリクス
  //     electron を import しないモジュールなので node から直接 import できる
  //     （--experimental-strip-types。前例: m19-t4a-settings-menu-about-smoke.mjs:13）
  // ============================================================
  const { deriveMercBaseMapTileUrl } = await import('../electron/utils/mercBaseMapTileUrl.ts');

  const plainFolder = path.join(path.sep, 'tmp', 'maplat-data');
  const mercData = { kind: 'merc', url: '' };

  assert.equal(
    deriveMercBaseMapTileUrl(mercData, 'uid-1', plainFolder),
    `file://${path.join(plainFolder, 'merc', 'uid-1').split(path.sep).join('/')}/{z}/{x}/{y}.png`,
    'S1: merc は {saveFolder}/merc/{uid}/{z}/{x}/{y}.png を組み立てること',
  );
  for (const kind of ['tms', 'google', 'mapbox', 'maplibre']) {
    assert.equal(
      deriveMercBaseMapTileUrl({ kind }, 'uid-1', plainFolder), undefined,
      `S1: kind=${kind} には一切触れず undefined を返すこと`,
    );
  }
  assert.equal(deriveMercBaseMapTileUrl(null, 'uid-1', plainFolder), undefined, 'S1: data=null は undefined');
  assert.equal(deriveMercBaseMapTileUrl(undefined, 'uid-1', plainFolder), undefined, 'S1: data=undefined は undefined');
  assert.equal(deriveMercBaseMapTileUrl({}, 'uid-1', plainFolder), undefined, 'S1: kind 未設定は undefined');
  assert.equal(deriveMercBaseMapTileUrl(mercData, '', plainFolder), undefined, 'S1: uid 空は undefined（空文字 url_ を立てない）');
  assert.equal(deriveMercBaseMapTileUrl(mercData, undefined, plainFolder), undefined, 'S1: uid undefined は undefined');
  assert.equal(deriveMercBaseMapTileUrl(mercData, 'uid-1', ''), undefined, 'S1: saveFolder 空は undefined');
  assert.equal(deriveMercBaseMapTileUrl(mercData, 'uid-1', undefined), undefined, 'S1: saveFolder undefined は undefined');

  // percent-encoding（保存フォルダに空白・非 ASCII を含む環境。file-url に委ねる）
  const encodedFolder = path.join(path.sep, 'Users', 'aa bb', 'データ');
  const encoded = deriveMercBaseMapTileUrl(mercData, 'uid-1', encodedFolder);
  assert.ok(encoded.startsWith('file:///'), 'S1: file:/// 形式であること: ' + encoded);
  assert.ok(encoded.includes('aa%20bb'), 'S1: 空白が percent-encoding されること: ' + encoded);
  assert.equal(encoded.includes(' '), false, 'S1: 生の空白が残らないこと: ' + encoded);
  assert.ok(encoded.includes('%E3%83%87%E3%83%BC%E3%82%BF'), 'S1: 非 ASCII が percent-encoding されること: ' + encoded);
  // テンプレート部は後置のため無加工で残る（percent-encoding されない）
  assert.ok(encoded.endsWith('/merc/uid-1/{z}/{x}/{y}.png'), 'S1: テンプレート部 {z}/{x}/{y} が無加工で残ること: ' + encoded);
  console.log('ok: S1 deriveMercBaseMapTileUrl matrix (kind gate / empty args / percent-encoding / template)');

  // ============================================================
  // harness (II): vite lib build で src/utils/*.ts を .mjs 化して import する
  //               （前例: m6-t10-app-source-diff-model-smoke.mjs:22-38）
  // ============================================================
  for (const [entry, fileName] of [
    ['src/utils/appSourceModel.ts', 'appSourceModel.mjs'],
    ['src/utils/baseMapEditorDocument.ts', 'baseMapEditorDocument.mjs'],
  ]) {
    await build({
      root: projectRoot,
      logLevel: 'error',
      configFile: false,
      build: {
        outDir: libOutDir,
        emptyOutDir: false,
        lib: {
          entry: path.join(projectRoot, entry),
          formats: ['es'],
          fileName: () => fileName,
        },
        rollupOptions: { external: [] },
      },
    });
  }

  const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
  const { createBaseMapMasterLookup, composeBaseMapSettingFile } =
    await import(pathToFileURL(path.join(libOutDir, 'appSourceModel.mjs')).href);
  const { toBaseMapLayerData } =
    await import(pathToFileURL(path.join(libOutDir, 'baseMapEditorDocument.mjs')).href);

  // ============================================================
  // S5-b: url_ を持つ IPC item を compose 境界へ渡しても設定ファイルへ出ない
  //       （AppEdit.vue:434 が IPC item を createBaseMapMasterLookup へ渡す唯一の経路）
  // ============================================================
  assert.equal(snapshot.mercItem.url_, snapshot.expectedUrl, 'S5-b: 前提として IPC item が url_ を持つこと');
  const lookup = createBaseMapMasterLookup([snapshot.mercItem]);
  const master = lookup.byUid(MERC_UID);
  assert.ok(master, 'S5-b: lookup が merc マスタを引けること');
  assert.equal('url_' in master, false, 'S5-b: createBaseMapMasterLookup が item レベルのキーを落とすこと');
  const settingFile = composeBaseMapSettingFile(master, 'base');
  assert.equal('url_' in settingFile, false, 'S5-b: 設定ファイル出力に url_ キーが出ないこと（MJR-1 の再発防止）');
  assert.equal(
    settingFile.url, `merc/${MERC_SLUG}/{z}/{x}/{y}.png`,
    'S5-b: 設定ファイルの url は現在 slug 由来のまま不変であること: ' + settingFile.url,
  );
  console.log('ok: S5-b compose boundary emits no url_ and keeps the slug-derived url');

  // ============================================================
  // S7: toBaseMapLayerData の載せ替え・非破壊・own key 規律（round 3 MNR-13）
  // ============================================================
  const mercItem = JSON.parse(JSON.stringify(snapshot.mercItem));
  const layerData = toBaseMapLayerData(mercItem);
  assert.equal(layerData.url_, snapshot.expectedUrl, 'S7: item の url_ を返り値へ載せ替えること');
  assert.equal(layerData.url, '', 'S7: data.url は空文字のまま持ち越されること');
  assert.equal(layerData.kind, 'merc', 'S7: data の他フィールドがそのまま持ち越されること');
  assert.equal('url_' in mercItem.data, false, 'S7: 引数の item.data を破壊しないこと');
  assert.notEqual(layerData, mercItem.data, 'S7: 返り値は新しいオブジェクトであること');

  const nonMercItem = JSON.parse(JSON.stringify(snapshot.nonMercItem));
  assert.equal('url_' in nonMercItem, false, 'S7: 前提として非 merc item は url_ を持たないこと');
  const nonMercLayerData = toBaseMapLayerData(nonMercItem);
  assert.equal(
    'url_' in nonMercLayerData, false,
    'S7: url_ を持たない item の返り値に url_ own key を立てないこと（undefined own key も不合格）',
  );
  assert.equal(nonMercLayerData.url, nonMercItem.data.url, 'S7: 非 merc の data.url はそのまま持ち越されること');

  // 退化入力（data 欠落）でも例外を投げず、url_ own key も立てない
  assert.deepEqual(toBaseMapLayerData({}), {}, 'S7: data 欠落の item は空オブジェクトを返すこと');
  assert.equal('url_' in toBaseMapLayerData({ url_: '' }), false, 'S7: url_ が空文字なら own key を立てないこと');
  console.log('ok: S7 toBaseMapLayerData moves url_ without mutating or fabricating own keys');

  console.log('m22-t1 smoke: ALL PASS (S1-S8)');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
