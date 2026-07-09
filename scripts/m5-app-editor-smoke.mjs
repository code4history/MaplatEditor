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
  await readFile(path.join(projectRoot, 'public/preview/assets/locales/ja/translation.json'), 'utf8');
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
  console.log('M5 app editor smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
