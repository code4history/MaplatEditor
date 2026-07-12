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
  const poiSourcesHealPath = path.join(projectRoot, 'src/utils/poiSourcesHeal.ts');

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
        lang: 'ja',
        sources: [
          { sourceType: 'base-map', mapID: 'osm', role: 'base', title: 'OpenStreetMap', data: { mapID: 'osm', maptype: 'base' } },
          // 旧保存形(mapID=slug)のmaplat参照: 読込時にuidへ解決されること
          { sourceType: 'maplat', mapID: 'histmap', role: 'maplat', title: 'Hist Map', startFrom: true, data: { mapID: 'histmap', maptype: 'maplat', noload: true } },
        ],
        httpSettings: { previewPort: 41781, pwaManifest: true, enableShare: true, enableBorder: true },
        appSettings: { splash: 'demo_splash.png', homeLng: 139, homeLat: 35, defaultZoom: 17 },
        manifestSettings: { name: 'Demo', shortName: 'Demo', backgroundColor: '#f6f0d3', themeColor: '#f6f0d3' },
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
      assert.equal(loaded.appSettings.splash, 'demo_splash.png');
      assert.equal(loaded.manifestSettings.name, 'Demo');
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
      // 孤児参照(該当地図なし)のstartFrom/sourcesは旧slugのまま残る(warning-freeフォールバック)
      assert.equal(legacyLoaded.startFrom, 'legacy_map');
      assert.equal(legacyLoaded.sources[0].mapUid, undefined);
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

      // --- Phase 8 Task 2: poiSources 多重 stringify 破損の読込 heal (バグ①根治) ---
      // 旧 AppEdit は normalize のたびに poiSources 文字列を JSON.stringify し直していたため、
      // 保存⇄読込の往復ごとにエスケープが一段深くなる破損が data_json に残っている。
      // healAppDocumentPois が二重・三重エスケープ文字列を配列に復元できることを behavioral に確認。
      // 戻り値は { pois, failed } (Phase 8 品質レビュー MAJOR-2: 復元失敗を呼び出し側が判別できるように)
      const { healAppDocumentPois } = await import(${JSON.stringify(poiSourcesHealPath)});
      const poisFixture = [
        { poiUid: '11111111-1111-4111-8111-111111111111', cachedTitle: '京都POI', icon: 'builtin:defaultpin-red' },
        'https://example.com/pois.geojson',
      ];
      const once = JSON.stringify(poisFixture);
      const twice = JSON.stringify(once);
      const thrice = JSON.stringify(twice);
      assert.deepEqual(healAppDocumentPois({ poiSources: once }), { pois: poisFixture, failed: false }, '一重 stringify 文字列が配列に復元されるはず');
      assert.deepEqual(healAppDocumentPois({ poiSources: twice }), { pois: poisFixture, failed: false }, '二重エスケープ文字列が配列に復元されるはず');
      assert.deepEqual(healAppDocumentPois({ poiSources: thrice }), { pois: poisFixture, failed: false }, '三重エスケープ文字列が配列に復元されるはず');
      // 実バグ形: 旧 saveApp が JSON.parse(破損 poiSources) を pois に入れたため pois 自体が文字列
      assert.deepEqual(healAppDocumentPois({ pois: twice }), { pois: poisFixture, failed: false }, 'pois が破損文字列でも復元されるはず');
      // pois 配列優先 (poiSources 旧形は fallback)
      assert.deepEqual(
        healAppDocumentPois({ pois: poisFixture, poiSources: '[]' }), { pois: poisFixture, failed: false },
        'pois 配列が poiSources より優先されるはず'
      );
      // 6段エスケープ (MAX_REPARSE_DEPTH を 5→100 に緩和した効果の確認: 旧上限では復元不能だった深さ)
      let sixTimesEscaped = poisFixture;
      for (let i = 0; i < 6; i++) sixTimesEscaped = JSON.stringify(sixTimesEscaped);
      assert.deepEqual(
        healAppDocumentPois({ poiSources: sixTimesEscaped }), { pois: poisFixture, failed: false },
        '6段エスケープでもPOIデータが復元されるはず'
      );
      // 復元不能・未設定は空配列。未設定 (null/undefined) は failed: false、
      // 壊れたデータがあったのに復元できなかった場合は failed: true (data_json は書き換えないため破壊はしない)
      assert.deepEqual(healAppDocumentPois({ poiSources: '{broken json' }), { pois: [], failed: true }, 'parse 不能は復元失敗のはず');
      assert.deepEqual(healAppDocumentPois({ poiSources: '"loop"' }), { pois: [], failed: true }, '配列に到達しない文字列は復元失敗のはず');
      assert.deepEqual(healAppDocumentPois({}), { pois: [], failed: false }, '未設定は復元失敗ではなく空配列のはず');
      // 空文字列は「復元成功した空配列」ではなく復元失敗として扱う (MINOR-4: 多重 stringify 破損で
      // 偶然 "" になったケースを黙って正常扱いしないため。poiSources も無ければ最終的に failed: true)
      assert.deepEqual(healAppDocumentPois({ poiSources: '' }), { pois: [], failed: true }, '空文字列は復元失敗のはず (成功扱いで握り潰さない)');
      assert.deepEqual(healAppDocumentPois({ pois: '', poiSources: once }), { pois: poisFixture, failed: false }, 'pois が空文字列でも poiSources へフォールバックするはず');
      console.log('ok: healAppDocumentPois restores multi-escaped poiSources strings (including 6-level escaping) and reports failure for empty-string pois');

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
  // Phase 8 Task 2: POIデータタブ (真実の器は appData.pois 配列1つ。生 textarea と
  // poiSources 文字列形は廃止 — 二重 stringify 破損の根治)
  assert.match(
    appEditView,
    /import PoiReferenceEditor from "\.\.\/components\/PoiReferenceEditor\.vue"/,
    'AppEdit.vue が PoiReferenceEditor を import していない'
  );
  assert.match(
    appEditView,
    /v-show="activeTab === 'pois'"[\s\S]{0,300}?<PoiReferenceEditor/,
    'AppEdit.vue が POIデータタブに PoiReferenceEditor をマウントしていない'
  );
  assert.match(
    appEditView,
    /activeTab === 'pois'[\s\S]{0,200}?poiref\.tab_label/,
    'AppEdit.vue のタブバーに POIデータタブ (poiref.tab_label) がない'
  );
  // 読込 heal: pois 配列優先 + 旧 poiSources 文字列の bounded 再 parse 復元
  assert.match(
    appEditView,
    /import \{ healAppDocumentPois \} from "\.\.\/utils\/poiSourcesHeal"/,
    'AppEdit.vue が heal (poiSourcesHeal) を import していない'
  );
  assert.match(
    appEditView,
    /const poiHeal = healAppDocumentPois\(value\)/,
    'normalizeAppDocument が healAppDocumentPois で pois を復元していない'
  );
  assert.match(
    appEditView,
    /normalized\.pois = poiHeal\.pois/,
    'normalizeAppDocument が heal 結果の pois を反映していない'
  );
  // Phase 8 品質レビュー MAJOR-2: heal 失敗時 (poiHeal.failed) は画面上に警告を出す
  // (console.warn だけでは編集者が気づかず、失われたまま保存してしまうリスクがあるため)
  assert.match(
    appEditView,
    /poiHealFailed\.value = poiHeal\.failed/,
    'normalizeAppDocument が heal 失敗フラグ (poiHealFailed) を更新していない'
  );
  assert.match(
    appEditView,
    /v-if="poiHealFailed"[\s\S]{0,120}?appedit\.poi_heal_failed/,
    'AppEdit.vue が pois heal 失敗時にオンスクリーン警告 (appedit.poi_heal_failed) を出していない'
  );
  // 破損の根本原因の再発防止: AppEdit は poiSources (JSON 文字列形) をコードとして
  // 一切持たない (内部表現・保存形とも pois 配列のみ。旧形は heal 側でのみ扱う。
  // コメント中の言及は許容するため、フィールド宣言/プロパティアクセス形のみ検出)
  assert.doesNotMatch(
    appEditView,
    /poiSources\s*[:=]|\.poiSources|poiSources\.value/,
    'AppEdit.vue に poiSources (文字列形) のコードが残存している — 二重 stringify 破損の再発リスク'
  );
  // 書き戻し: PoiReferenceEditor の update:pois を配列のまま反映 + 履歴記録
  assert.match(appEditView, /function onPoisChange/, 'AppEdit.vue に update:pois の反映 (onPoisChange) がない');
  assert.match(
    appEditView,
    /function onPoisChange\(next: unknown\[\]\) \{\s*\n\s*appData\.value\.pois = next;\s*\n\s*recordHistory\(\);/,
    'onPoisChange が pois 配列反映 + recordHistory (AppEdit の履歴方式) になっていない'
  );
  // 参照判定・復元・書き戻しの純関数部は共有 util (utils/poiReferenceUi) に集約されたまま
  const poiReferenceUi = await readFile(path.join(projectRoot, 'src/utils/poiReferenceUi.ts'), 'utf8');
  const poiReferenceEditor = await readFile(path.join(projectRoot, 'src/components/PoiReferenceEditor.vue'), 'utf8');
  assert.match(
    poiReferenceEditor,
    /import \{ poiUidOf, extractPoiRefs, applyPoiSelection \} from "\.\.\/utils\/poiReferenceUi"/,
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
  assert.match(poiReferenceEditor, /<PoiSourceSelector/, 'PoiReferenceEditor.vue が追加用 PoiSourceSelector をマウントしていない');
  assert.match(poiReferenceEditor, /function move\(index: number, delta: number\)/, 'PoiReferenceEditor.vue に順番変更 (move) がない');
  assert.match(poiReferenceEditor, /<IconRefField/, 'PoiReferenceEditor.vue が上書き icon 欄 (IconRefField) をマウントしていない');
  assert.match(poiReferenceEditor, /poiref\.icon_override/, 'PoiReferenceEditor.vue に上書きアイコンラベルがない');
  assert.match(poiReferenceEditor, /poiref\.selected_icon_override/, 'PoiReferenceEditor.vue に選択時アイコンラベルがない');
  assert.match(poiReferenceEditor, /poiref\.external_data/, 'PoiReferenceEditor.vue に外部データ (生 URL/FC) 行の表示がない');
  assert.match(poiReferenceEditor, /"update:pois"/, 'PoiReferenceEditor.vue が update:pois を emit していない');
  // preview 起動時の warnings 表示 (export と同じ t(key) join → showMessageBox detail 形式)
  assert.match(appEditView, /result\.warnings/, 'AppEdit.vue が preparePreview の warnings を表示していない');
  assert.match(appEditView, /appedit\.preview_warnings/, 'AppEdit.vue が preview warnings ダイアログの message キーを使っていない');
  console.log('M5 app editor smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
