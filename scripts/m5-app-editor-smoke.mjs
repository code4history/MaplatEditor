import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'app-editor-'));
const entryFile = path.join(workDir, 'app-editor-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'app-editor-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');
  const sqliteDataServicePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');

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

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqliteDataServicePath)});

      // 参照先の登録地図 (ADR-0007: app sources は地図uidを参照する)
      const { uid: histmapUid } = await SqliteDataService.createMap('histmap', { title: 'Hist Map' });

      const doc = {
        appID: 'demo_app',
        title: { ja: 'デモアプリ', en: 'Demo App' },
        description: { ja: '説明', en: 'Description' },
        keywords: { ja: '姫路,古地図', en: 'Himeji,historical map' },
        lang: 'ja',
        sources: [
          { sourceType: 'base-map', mapID: 'osm', role: 'base', title: 'OpenStreetMap', data: { mapID: 'osm', maptype: 'base' } },
          // 旧保存形(mapID=slug)のmaplat参照: 読込時にuidへ解決されること
          { sourceType: 'maplat', mapID: 'histmap', role: 'maplat', title: 'Hist Map', startFrom: true, data: { mapID: 'histmap', maptype: 'maplat', noload: true } },
        ],
        httpSettings: { previewPort: 41781, pwaManifest: true, enableShare: true, enableBorder: true, enableMarkerList: true },
        appSettings: { splash: 'demo_splash.png', homeLng: 139, homeLat: 35, defaultZoom: 17 },
        manifestSettings: {
          name: { ja: '姫路案内', en: 'Himeji Guide' },
          shortName: { ja: '姫路', en: 'Himeji' },
          backgroundColor: '#f6f0d3',
          themeColor: '#f6f0d3',
        },
        startFrom: 'histmap',
      };

      // uid正準の保存 (ADR-0007): uidなし=新規作成
      const created = await AppDataService.saveApp({ document: doc, slug: 'demo_app' });
      assert.equal(created.result, 'Success');
      assert.equal(created.revision, 1);
      const demoUid = created.uid;

      // slug衝突(グローバルnamespace)の新規作成は Exist
      assert.equal((await AppDataService.saveApp({ document: doc, slug: 'demo_app' })).result, 'Exist');
      assert.equal((await AppDataService.saveApp({ document: doc, slug: 'histmap' })).result, 'Exist');

      const loaded = await AppDataService.getApp(demoUid);
      assert.equal(loaded.uid, demoUid);
      assert.equal(loaded.appID, 'demo_app');
      assert.equal(loaded.revision, 1);
      assert.equal(loaded.title.ja, 'デモアプリ');
      assert.equal(loaded.sources.length, 2);
      assert.equal(loaded.httpSettings.enableShare, true);
      // マーカー一覧トグル (GUI 検証 D3): document 経由で保存/読込される
      assert.equal(loaded.httpSettings.enableMarkerList, true);
      assert.equal(loaded.appSettings.splash, 'demo_splash.png');
      assert.deepEqual(loaded.manifestSettings.name, { ja: '姫路案内', en: 'Himeji Guide' });
      // 旧slug参照のmaplatソースが読込時にuid+表示用slugへ解決されること (ADR-0007)
      assert.equal(loaded.sources[1].mapUid, histmapUid);
      assert.equal(loaded.sources[1].mapSlug, 'histmap');
      // 旧startFrom(slug)もuidへ追随する
      assert.equal(loaded.startFrom, histmapUid);
      assert.doesNotMatch(JSON.stringify(loaded), /default_zoom|home_position|app_name|start_from|fake_gps/);

      const listed = await AppDataService.requestApps('デモ', 1, 20);
      assert.equal(listed.docs.length, 1);
      assert.equal(listed.docs[0].uid, demoUid);
      assert.equal(listed.docs[0].appID, 'demo_app');
      assert.equal(listed.docs[0].title, 'デモアプリ');
      assert.equal((await AppDataService.requestApps('Himeji,historical', 1, 20)).docs.length, 1);
      assert.equal((await AppDataService.requestApps('Himeji Guide', 1, 20)).docs.length, 1);

      // M13-T1 (§1.6/§2.7): legacy_app ケースを2ケースへ分割する。
      // AC-T1-2 (missing map 拒否) の適用により、旧M5契約(孤児参照でも警告なしSuccess)は
      // 「孤児参照 reject」+「legacy形フィールド正規化(地図実在)」の2ケースへ分かれる。

      // ケース1: 孤児参照 reject (新規)。DB に存在しないことが明確な別slugを参照させ、
      // saveApp が {result:'Error'} を返すことを assert する(M13契約の回帰テスト)。
      // 保存失敗でレコードは作られないため、使用するapp slugは後続assertに影響しない
      const orphanCreated = await AppDataService.saveApp({ slug: 'orphan_legacy_app', document: {
        appID: 'orphan_legacy_app',
        app_name: { ja: '孤児旧アプリ', en: 'Orphan Legacy App' },
        title: { ja: '孤児旧アプリ', en: 'Orphan Legacy App' },
        default_zoom: 16,
        home_position: [140, 36],
        start_from: 'orphan_legacy_map',
        fake_gps: true,
        fake_radius: 20,
        sources: [{ mapID: 'orphan_legacy_map', maptype: 'maplat', setting_file: 'maps/orphan_legacy_map.json' }],
      } });
      assert.equal(orphanCreated.result, 'Error', '孤児 maplat 参照を持つ App の保存は拒否されるはず(AC-T1-2)');

      // ケース2: legacy形フィールド正規化(既存意図を保存・書き換え)。legacy_map を事前に
      // 実在させてから同一形状(legacy形)のドキュメントを保存する。guardは実在地図を通過するため
      // Successになり、camelCase正規化assert群はそのまま実行できる。ただしstartFrom/mapUidは
      // 地図が実在するためresolveMaplatSourceRefs()のuid追随によりcreateMap()のuidへ解決される
      // (孤児フォールバックの期待値は成立しない)。app slugはlegacy_appを維持する(後続の
      // rename-Exist assertがslug legacy_app実在に依存するため)
      const { uid: legacyMapUid } = await SqliteDataService.createMap('legacy_map', { title: 'Legacy Map' });
      const legacyCreated = await AppDataService.saveApp({ slug: 'legacy_app', document: {
        appID: 'legacy_app',
        app_name: { ja: '旧アプリ', en: 'Legacy App' },
        title: { ja: '旧アプリ', en: 'Legacy App' },
        default_zoom: 16,
        home_position: [140, 36],
        start_from: 'legacy_map',
        fake_gps: true,
        fake_radius: 20,
        sources: [{ mapID: 'legacy_map', maptype: 'maplat', setting_file: 'maps/legacy_map.json' }],
      } });
      assert.equal(legacyCreated.result, 'Success');
      const legacyLoaded = await AppDataService.getApp(legacyCreated.uid);
      assert.equal(legacyLoaded.appName.ja, '旧アプリ');
      assert.equal(legacyLoaded.defaultZoom, 16);
      assert.deepEqual(legacyLoaded.homePosition, [140, 36]);
      // 地図が実在するため、startFrom/sources[0].mapUidの両方がresolveMaplatSourceRefs()の
      // uid追随によりcreateMap()のuidへ解決される(孤児フォールバックではない。demoケースの
      // 127行 assert.equal(loaded.startFrom, histmapUid) と同一の既存契約パターン)
      assert.equal(legacyLoaded.startFrom, legacyMapUid);
      assert.equal(legacyLoaded.sources[0].mapUid, legacyMapUid);
      assert.equal(legacyLoaded.fakeGps, true);
      assert.equal(legacyLoaded.fakeRadius, 20);
      assert.equal(legacyLoaded.sources[0].settingFile, 'maps/legacy_map.json');
      assert.doesNotMatch(JSON.stringify(legacyLoaded), /default_zoom|home_position|app_name|start_from|fake_gps|fake_radius|setting_file/);

      // slug改名: uid維持のままslugを付け替える (ADR-0007)
      const renamed = await AppDataService.saveApp({
        document: { ...doc, appID: 'other_app' },
        uid: demoUid,
        slug: 'other_app',
        expectedRevision: 1,
      });
      assert.equal(renamed.result, 'Success');
      assert.equal(renamed.uid, demoUid);
      assert.equal(renamed.revision, 2);
      assert.equal(await AppDataService.getApp('demo_app'), null);
      assert.equal((await AppDataService.getApp(demoUid)).appID, 'other_app');

      // 既存アプリの他アセットslugへの改名は Exist
      assert.equal((await AppDataService.saveApp({
        document: doc, uid: demoUid, slug: 'legacy_app', expectedRevision: 2,
      })).result, 'Exist');

      // revision楽観ロック: 古いexpectedRevisionでの保存は revision-conflict
      const conflict = await AppDataService.saveApp({
        document: doc, uid: demoUid, slug: 'other_app', expectedRevision: 1,
      });
      assert.equal(conflict.error, 'revision-conflict');
      assert.equal(conflict.current, 2);

      // 上書き(expectedRevisionなし)は成功する
      const overwrite = await AppDataService.saveApp({ document: doc, uid: demoUid, slug: 'other_app' });
      assert.equal(overwrite.result, 'Success');
      assert.equal(overwrite.revision, 3);

      // 削除もuid正準
      await AppDataService.deleteApp(demoUid);
      assert.equal(await AppDataService.getApp(demoUid), null);

      // --- M12-T30: 旧 Phase 8 Task 2 の poiSources 多重 stringify 復元 heal 期待値ブロックは
      // ここにあった (healAppDocumentPois の多重エスケープ「復元成功」期待)。sp-0006（絶対遵守）に
      // 基づき、当該復元ロジック (bounded reparse ループ) は実装ミスの後始末として撤去され、
      // 単一実装 src/utils/appPoisFormat.ts の readAppDocumentPois（形式判定のみ・復元なし）へ
      // 置き換えられた。削除ではなく契約変更に伴う置換であり、置き換え後の全分岐表（深さ1を含む
      // 全文字列形が unsupported になることの behavioral 証明）は
      // scripts/m12-t30-pois-write-shape-smoke.mjs Part A が引き継ぐ。

      console.log('M5 app editor smoke passed');
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
          entryFileNames: 'app-editor-smoke.mjs',
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

  const appPreviewService = await readFile(path.join(projectRoot, 'electron/services/AppPreviewService.ts'), 'utf8');
  const appEditView = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
  await readFile(path.join(projectRoot, 'public/preview/maplat_ui.css'), 'utf8');
  await readFile(path.join(projectRoot, 'public/preview/maplat_ui.umd.js'), 'utf8');
  await readFile(path.join(projectRoot, 'public/preview/service-worker.js'), 'utf8');
  // viewer ロケールは servePackageAsset の第一候補 public/preview/locales/ に置く
  // (assets/locales/ 配下は配信解決に乗らない死に配置。11言語同梱: 3bc7219)
  await readFile(path.join(projectRoot, 'public/preview/locales/ja/translation.json'), 'utf8');
  await readFile(path.join(projectRoot, 'public/preview/locales/th/translation.json'), 'utf8');
  assert.match(appPreviewService, /http\.createServer/, 'AppPreviewService が HTTP server を作成していない');
  assert.match(appPreviewService, /assets\/maplat_ui\.css/, 'AppPreviewService が Maplat UI CSS を preview HTML で読み込んでいない');
  assert.match(appPreviewService, /__dirname,\s*'\.\.',\s*'public\/preview'/, 'AppPreviewService が開発実行時の preview asset 配置を探索していない');
  assert.match(appPreviewService, /__dirname,\s*'\.\.',\s*'dist\/preview'/, 'AppPreviewService がビルド後の preview asset 配置を探索していない');
  assert.match(appPreviewService, /assets\/ol\.js/, 'AppPreviewService が OpenLayers UMD を preview HTML で読み込んでいない');
  assert.match(appPreviewService, /olPackageRoot/, 'AppPreviewService が OpenLayers bundle を配信していない');
  assert.match(appPreviewService, /service-worker\.js/, 'AppPreviewService が service worker を preview scope で配信していない');
  assert.match(appPreviewService, /rest\[0\]\s*===\s*'tiles'/, 'AppPreviewService が preview scope の tiles をローカル保存フォルダへ配信していない');
  assert.match(appPreviewService, /local-file/, 'AppPreviewService がローカルファイル proxy を持っていない');
  assert.match(appPreviewService, /rest\[0\]\s*===\s*'apps'/, 'AppPreviewService が app json を HTTP 配信していない');
  assert.match(appEditView, /httpSettings/, 'AppEdit.vue に HTTP 設定がない');
  assert.match(appEditView, /manifestSettings/, 'AppEdit.vue に manifest 設定がない');
  assert.match(appEditView, /preparePreview/, 'AppEdit.vue が HTTP preview API を呼んでいない');
  // マーカー一覧/マーカー非表示トグル (GUI 検証 D3): メタデータ編集タブのチェックボックス →
  // document.httpSettings → preview/export の viewerOption へ配線される
  assert.match(
    appEditView,
    /v-model="appData\.httpSettings\.enableMarkerList"/,
    'AppEdit.vue にマーカー一覧トグル (enableMarkerList) のチェックボックスがない'
  );
  assert.match(appEditView, /appedit\.marker_list_ui/, 'AppEdit.vue がマーカー一覧トグルのラベル (appedit.marker_list_ui) を使っていない');
  assert.match(
    appEditView,
    /v-model="appData\.httpSettings\.enableHideMarker"/,
    'AppEdit.vue にマーカー非表示トグル (enableHideMarker) のチェックボックスがない'
  );
  assert.match(
    appPreviewService,
    /enableMarkerList: Boolean\(httpSettings\.enableMarkerList\)/,
    'AppPreviewService が enableMarkerList を viewerOption に渡していない'
  );
  const appExportServiceSrc = await readFile(path.join(projectRoot, 'electron/services/AppExportService.ts'), 'utf8');
  assert.match(
    appExportServiceSrc,
    /enableMarkerList: Boolean\(httpSettings\.enableMarkerList\)/,
    'AppExportService が enableMarkerList を viewerOption に渡していない'
  );
  // Phase 8 Task 2: POIデータタブ (真実の器は appData.pois 配列1つ。生 textarea と
  // poiSources 文字列形は廃止 — 二重 stringify 破損の根治)
  assert.match(
    appEditView,
    /import PoiReferenceEditor from "\.\.\/components\/PoiReferenceEditor\.vue"/,
    'AppEdit.vue が PoiReferenceEditor を import していない'
  );
  assert.match(
    appEditView,
    // m3-t6 98dfcfc でペイン内に DiagnosticFeedback + §5.8 コメントが挿入され 300 字を超えた
    // (構造は不変: ペイン直下マウントのまま)。距離上限のみ 800 字へ緩和
    /v-show="activeTab === 'pois'"[\s\S]{0,800}?<PoiReferenceEditor/,
    'AppEdit.vue が POIデータタブに PoiReferenceEditor をマウントしていない'
  );
  // v-show と d-flex の同居禁止: Bootstrap の display:flex!important が v-show に勝ち、
  // ペインが常時表示になって後続タブ(プレビュー)を覆い隠す (2026-07-12、MapEdit と同型)
  assert.doesNotMatch(
    appEditView,
    /<[a-zA-Z][^>]*v-show[^>]*\bd-flex\b[^>]*>/,
    'AppEdit に v-show + d-flex 同居要素がある (v-show 専用ラッパーを挟むこと)'
  );
  // M11-T7/AC9: タブは EditorTabs primitive + §9 語彙(editor_ui.tabs.pois)へ移行した
  assert.match(
    appEditView,
    /key: 'pois'[\s\S]{0,120}?editor_ui\.tabs\.pois/,
    'AppEdit.vue のタブバーに POI選択タブ (editor_ui.tabs.pois、§9 語彙) がない'
  );
  // 読込形式判定 (M12-T30): pois 配列のみ正準。復元 (bounded reparse) は撤去済み — sp-0006。
  // M4-T1: 受け入れ (温存を含む) は AppEdit / MapEdit 共通の acceptDocumentPois が唯一の実装に
  // なり、判定表示は共通 composable usePoisFormatGuard (computed) が担う。AppEdit 側の独自分岐
  // (poisRead / poisUnsupported.value への代入) は撤去された — 検査の意図 (形式判定を経由し、
  // 未対応形式を画面へ通知する) はそのままに、期待値を新しい共通実装へ更新する。
  assert.match(
    appEditView,
    // M4-T4: 書き込み側の関所 writeDocumentPois が加わり import が2つになった。
    // 検査意図（AppEdit が形式仕様の単一実装から受け入れ関所を取ること）は不変
    /import \{[^}]*\bacceptDocumentPois\b[^}]*\} from "\.\.\/utils\/appPoisFormat"/,
    'AppEdit.vue が acceptDocumentPois (appPoisFormat) を import していない'
  );
  assert.match(
    appEditView,
    /import \{ usePoisFormatGuard \} from "\.\.\/composables\/usePoisFormatGuard"/,
    'AppEdit.vue が usePoisFormatGuard を import していない'
  );
  assert.match(
    appEditView,
    /acceptDocumentPois\(normalized, value\)/,
    'normalizeAppDocument が共通の受け入れ関所 acceptDocumentPois を通していない'
  );
  // 未対応形式は画面上に警告を出す (黙って消えない原則の可視化面)。判定は computed なので
  // 受け入れ関所を通らない履歴 undo/redo でも追随する
  assert.match(
    appEditView,
    /const \{ unsupported: poisUnsupported, pois: poisForEditor \} = poisGuard/,
    'AppEdit.vue が共通ガードから poisUnsupported / poisForEditor を受けていない'
  );
  assert.doesNotMatch(
    appEditView,
    /poisUnsupported\.value\s*=/,
    'AppEdit.vue に poisUnsupported への命令的代入が残存している (M4-T1 で computed へ移行済みのはず)'
  );
  assert.match(
    appEditView,
    /v-if="poisUnsupported"[\s\S]{0,120}?appedit\.poi_format_unsupported/,
    'AppEdit.vue が未対応形式時にオンスクリーン警告 (appedit.poi_format_unsupported) を出していない'
  );
  // 旧契約 (heal / poiHealFailed / poi_heal_failed) の残置禁止
  assert.doesNotMatch(
    appEditView,
    /healAppDocumentPois|healPoisValue|poiHealFailed|poi_heal_failed|poiSourcesHeal/,
    'AppEdit.vue に旧 heal 契約 (poiSourcesHeal 系) が残存している'
  );
  // 破損の根本原因の再発防止 + M12-T30 v1.2（sp-0007）: AppEdit は旧 Editor 内部表現
  // （JSON 文字列の内部表現、及びそれを扱う変数・型フィールド）を一切持たない
  // (内部表現・保存形とも pois 配列のみ)。型定義・normalize 分岐・コメントいずれも
  // 含めて当該語が0件であることを bare 検査で強制する
  assert.doesNotMatch(
    appEditView,
    /poiSources/,
    'AppEdit.vue に旧 Editor 内部表現（poiSources）への参照が残存している — M12-T30 v1.2 で完全撤去のはず'
  );
  // 書き戻し: PoiReferenceEditor の update:pois を配列のまま反映 + 履歴記録
  assert.match(appEditView, /function onPoisChange/, 'AppEdit.vue に update:pois の反映 (onPoisChange) がない');
  // M4-T1: 本体に書き込みガード (未対応形式を弾く二重防御) と空時のキー削除 (永続形は両画面同一)
  // が入ったため、本体完全一致から要素ごとの検査へ改める。recordHistory が AppEdit の履歴方式で
  // あることは変わらないので、その検査意図は維持する。
  {
    const onPoisChangeIdx = appEditView.indexOf('function onPoisChange');
    const body = appEditView.slice(onPoisChangeIdx, onPoisChangeIdx + 420);
    assert.match(body, /if \(!poisGuard\.acceptsWrite\(\)\) return;/, 'onPoisChange に書き込みガードがない (M4-T1)');
    // M4-T4: 空時のキー削除を含む保存形の決定は共通の書き込み関所 writeDocumentPois へ移した。
    // View 内で直接 next を代入すると単独形が配列へ書き換わってしまうため（sp-0006）である。
    // キー削除そのものの検証は m4-t4 smoke Part D が表駆動で担う。
    assert.match(
      body,
      /writeDocumentPois\(appData\.value, next, appData\.value\.pois\)/,
      'onPoisChange が書き込み関所 writeDocumentPois を通っていない (M4-T4)'
    );
    // M4-T4: 反映そのものも関所が担う（上の assert が経路を押さえている）。素の代入は
    // 単独形を壊すため撤去済みで、残っていたら回帰である
    assert.doesNotMatch(
      body,
      /appData\.value\.pois\s*=\s*next/,
      'onPoisChange が pois を直接代入している（単独形が配列へ書き換わる — M4-T4 §5.4）'
    );
    assert.match(body, /recordHistory\(\)/, 'onPoisChange が recordHistory (AppEdit の履歴方式) を呼んでいない');
  }
  // 参照判定・復元・書き戻しの純関数部は共有 util (utils/poiReferenceUi) に集約されたまま
  const poiReferenceUi = await readFile(path.join(projectRoot, 'src/utils/poiReferenceUi.ts'), 'utf8');
  const poiReferenceEditor = await readFile(path.join(projectRoot, 'src/components/PoiReferenceEditor.vue'), 'utf8');
  assert.match(
    poiReferenceEditor,
    // m3-t6 で isNonReferenceObjectEntry 等の named import が増えたため、3 関数の存在のみを検査
    /import \{[^}]*\bpoiUidOf\b[^}]*\bextractPoiRefs\b[^}]*\bapplyPoiSelection\b[^}]*\} from "\.\.\/utils\/poiReferenceUi"/,
    'PoiReferenceEditor.vue が共有 util (poiReferenceUi) を import していない'
  );
  assert.match(
    poiReferenceUi,
    /typeof uid === "string" && UUID_PATTERN\.test\(uid\)/,
    'poiReferenceUi.ts の参照要素判定が poiReferenceResolver 規約 (UUID 形状の poiUid のみ, M4) と一致しない'
  );
  assert.match(
    poiReferenceUi,
    /export function applyPoiSelection\(pois: unknown\[\], selected: SelectedPoiSourceRef\[\]\): unknown\[\]/,
    'poiReferenceUi.ts に selector 選択の差分反映 (applyPoiSelection) がない'
  );
  assert.match(poiReferenceUi, /const uid = poiUidOf\(entry\);/, 'poiReferenceUi.ts の差分反映が poiUid 要素判定を通していない');
  // POIデータタブの UI コントラクト: 順番変更 (上下) / 参照単位の icon 上書き / 解除 / 追加 selector
  assert.match(poiReferenceEditor, /<ResourceSelectorList/, 'PoiReferenceEditor.vue が共通 ResourceSelectorList をマウントしていない');
  assert.match(poiReferenceEditor, /function move\(index: number, delta: number\)/, 'PoiReferenceEditor.vue に順番変更 (move) がない');
  assert.match(poiReferenceEditor, /<IconRefField/, 'PoiReferenceEditor.vue が上書き icon 欄 (IconRefField) をマウントしていない');
  assert.match(poiReferenceEditor, /poiref\.icon_override/, 'PoiReferenceEditor.vue に上書きアイコンラベルがない');
  assert.match(poiReferenceEditor, /poiref\.selected_icon_override/, 'PoiReferenceEditor.vue に選択時アイコンラベルがない');
  // m3-t6 §5.11: 単一バッジ poiref.external_data は inline_data / external_url の 2 種へ分割された
  assert.match(poiReferenceEditor, /poiref\.inline_data/, 'PoiReferenceEditor.vue に非参照 (地図内定義POI) 行の表示がない');
  // 削除済みソースへの参照カードの警告表示 (GUI 検証 D4): poiSources.get の null (not-found 確定)
  // で警告スタイル + 文言。IPC 一時失敗 (reject) は警告にしない
  assert.match(poiReferenceEditor, /poiref\.missing_source/, 'PoiReferenceEditor.vue に削除済み参照の警告文言 (poiref.missing_source) がない');
  assert.match(
    poiReferenceEditor,
    /'border-warning bg-warning-subtle': isMissing\(entry\)/,
    'PoiReferenceEditor.vue の削除済み参照カードに警告スタイル (border-warning) が付かない'
  );
  assert.match(
    poiReferenceEditor,
    /missingByUid\.value\[uid\] = detail == null/,
    'PoiReferenceEditor.vue が poiSources.get の null (not-found 確定) で missing 判定していない'
  );
  assert.match(poiReferenceEditor, /"update:pois"/, 'PoiReferenceEditor.vue が update:pois を emit していない');
  // Phase 8 Task 5: 地図選択タブ (AppEdit sources) と同じ2カラム設計 (ユーザー指摘 2026-07-11:
  // 上下2段は窮屈・検索が無い)。T9 以降、PoiReferenceEditor は ResourceSelector コンポーネントにラップされ、
  // 2カラム grid / 左右 pane / ↑↓× btn-group は ResourceSelector 内で一元実装される。
  assert.match(
    poiReferenceEditor,
    /import ResourceSelector from "\.\/ResourceSelector\.vue"/,
    'PoiReferenceEditor.vue が ResourceSelector を import していない'
  );
  assert.match(
    poiReferenceEditor,
    /<ResourceSelector[\s\S]*<template #list>[\s\S]*?<ResourceSelectorList/,
    'PoiReferenceEditor.vue が ResourceSelector #list slot に ResourceSelectorList を配置していない'
  );
  const resourceSelector = await readFile(path.join(projectRoot, 'src/components/ResourceSelector.vue'), 'utf8');
  assert.match(
    resourceSelector,
    /grid-template-columns: minmax\(280px, 36%\) 1fr/,
    'ResourceSelector.vue が2カラムグリッドを提供していない'
  );
  assert.match(resourceSelector, /class="source-pane/, 'ResourceSelector.vue に左カラム (source-pane) がない');
  assert.match(resourceSelector, /class="selected-pane/, 'ResourceSelector.vue に右カラム (selected-pane) がない');
  assert.match(
    poiReferenceEditor,
    // M4-T4: btn-group の先頭に「上書きを追加」（U4 行のみ）が加わり、↑ までの距離が伸びた。
    // 検査意図は ↑/↓/× がこの順で同じ btn-group に並ぶこと（地図選択と同配置）であり、
    // 先行ボタンの本数に依存させない
    /class="btn-group btn-group-sm flex-shrink-0"[\s\S]{0,1600}>↑<\/button>[\s\S]{0,600}>↓<\/button>[\s\S]{0,600}>×<\/button>/,
    'PoiReferenceEditor.vue の選択済みカードに ↑/↓/× の btn-group (地図選択と同配置) がない'
  );
  // 右カラム見出しは呼び出し側の headingKey prop で App/Map を差し替える
  assert.match(poiReferenceEditor, /headingKey\?: string/, 'PoiReferenceEditor.vue に見出しキー prop (headingKey) がない');
  assert.match(
    appEditView,
    /<PoiReferenceEditor[\s\S]{0,200}?heading-key="poiref\.selected_list_app"/,
    'AppEdit.vue が POIデータタブ見出し (poiref.selected_list_app) を渡していない'
  );
  // 左カラムは共通検索一覧 + host 所有の行 (追加済みは disabled)
  assert.match(poiReferenceEditor, /v-model:query="poiSearchQuery"/, 'POI selector に検索 query がない');
  assert.match(poiReferenceEditor, /:adapter="poiSourceAdapter"/, 'POI selector が search adapter に接続されていない');
  assert.match(poiReferenceEditor, /<ResourceMasterRow[\s\S]{0,200}?variant="selector"/, 'POI selector が共通の ResourceMasterRow variant="selector" になっていない');
  // M12-T10 v2.0: 追加済み POI 行は selected=true（青）で表現され、disabled は readOnly のみ。
  // isPoiSelected は asResourceListRowFromPoiSource 内で selected へ反映（HM6: added=青）
  assert.match(poiReferenceEditor, /:disabled="readOnly"/, '追加済み POI 行の disabled は readOnly のみ（added は selected で表現）');
  assert.match(poiReferenceEditor, /selected: added/, 'asResourceListRowFromPoiSource で added=selected が設定される');
  // picker 表示中のグローバルキー抑止 (MAJOR-1) と行 key の安定化 (MINOR-2) は再設計後も維持
  assert.match(poiReferenceEditor, /defineExpose\(\{ pickerOpen \}\)/, 'PoiReferenceEditor.vue が pickerOpen を expose していない');
  assert.match(poiReferenceEditor, /return `ref:\$\{uid\}#\$\{occurrence\}`/, 'PoiReferenceEditor.vue の entryKey が uid+occurrence 安定 key でない');
  // preview 起動時の warnings 表示 (export と同じ t(key) join → showMessageBox detail 形式)
  assert.match(appEditView, /result\.warnings/, 'AppEdit.vue が preparePreview の warnings を表示していない');
  assert.match(appEditView, /appedit\.preview_warnings/, 'AppEdit.vue が preview warnings ダイアログの message キーを使っていない');
  console.log('M5 app editor smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
