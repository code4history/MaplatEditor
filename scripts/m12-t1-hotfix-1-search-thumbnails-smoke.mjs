// M12-T1-HOTFIX-1 smoke: search:maps/search:apps の image 添付（一覧サムネイル非表示回帰の修正）。
// m9-t3 型 harness（electron/electron-store stub + vite ssr build）で ipcMain handler を直接起動し、
// resolver 契約・handler 添付・委譲 refactor（MapDataService/AppDataService 挙動不変）を検証する。
// シナリオ:
//   (a) tmbs/{uid}.jpg がある地図は search:maps で image=file:// tmbs が添付される
//   (b) tmbs が無く tiles/{uid}/0/0/0.png がある地図はタイル fallback が添付される
//   (c) どちらも無い地図は image=null（no_image fallback 契約の維持）
//   (d) search:apps は iconSource → splash → startFrom maplat タイルの優先順で添付される
//   (e) FTS・paginate（total/next）の現行契約が維持される
//   (f) pageSize<=0 の全件経路では添付をスキップする（無制限 I/O 防止、レビュー Minor-1）
//   (g) MapDataService.requestMaps / AppDataService.requestApps の image 添付が委譲後も現行どおり
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t1-hotfix1-'));
const entryFile = path.join(workDir, 'm12-t1-hotfix1-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t1-hotfix1-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
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
      // M12-T18: バンドルに含まれる MapDeleteTrashService が shell を named import するため
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
      import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
      import nodePath from 'node:path';

      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
      const dataDir = ${JSON.stringify(dataDir)};
      const workDir = ${JSON.stringify(workDir)};

      const { __handlers } = await import(${JSON.stringify(electronStubFile)});
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
      const { default: MapDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/MapDataService.ts'))});
      const { default: AppDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/AppDataService.ts'))});
      const { registerSearchHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/search.ts'))});
      await SqliteDataService.getDb();
      registerSearchHandlers();
      const call = (channel: string, ...args: any[]) => __handlers.get(channel)(null, ...args);

      const mapSlug = 'thumb-map';
      const appSlug = 'thumb-app';
      const seedMap = await SqliteDataService.createMap(mapSlug, {
        title: 'thumb map', lang: 'ja', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain',
      }, crypto.randomUUID());
      const mapUid = seedMap.uid;
      const appUid = crypto.randomUUID();
      await SqliteDataService.createApp(appSlug, {
        appID: appSlug, appName: { ja: 'thumb app' }, title: { ja: 'thumb app' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [], pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
      }, appUid);

      // --- 添付対象のファイル実体を配置 ---
      const tmbsDir = nodePath.join(dataDir, 'tmbs');
      await fsMkdir(tmbsDir, { recursive: true });
      await fsWriteFile(nodePath.join(tmbsDir, mapUid + '.jpg'), PNG);
      const tilesDir = nodePath.join(dataDir, 'tiles', mapUid, '0', '0');
      await fsMkdir(tilesDir, { recursive: true });
      await fsWriteFile(nodePath.join(tilesDir, '0.png'), PNG);

      // (a) tmbs/{uid}.jpg がある → image = file:// tmbs
      const mapsResult = await call('search:maps', { q: '', page: 1, pageSize: 20 });
      const mapDoc = mapsResult.docs.find((d: any) => d.slug === mapSlug);
      assert.ok(mapDoc, 'seed した地図が search:maps に含まれること');
      assert.equal(mapDoc.image, 'file://' + nodePath.join(tmbsDir, mapUid + '.jpg').split(nodePath.sep).join('/'),
        'tmbs/{uid}.jpg が image として添付されること: ' + mapDoc.image);
      console.log('ok: (a) search:maps attaches tmbs file as image');

      // (b) tmbs を消した場合は tiles fallback
      const tmbsFile = nodePath.join(tmbsDir, mapUid + '.jpg');
      const tmbsBackup = nodePath.join(workDir, 'backup-' + mapUid + '.jpg');
      await (await import('node:fs/promises')).rename(tmbsFile, tmbsBackup);
      const mapsResult2 = await call('search:maps', { q: '', page: 1, pageSize: 20 });
      const mapDoc2 = mapsResult2.docs.find((d: any) => d.slug === mapSlug);
      assert.equal(mapDoc2.image, 'file://' + nodePath.join(tilesDir, '0.png').split(nodePath.sep).join('/'),
        'tiles/{uid}/0/0/0.png が fallback 添付されること: ' + mapDoc2.image);
      console.log('ok: (b) tiles fallback is attached when tmbs is absent');

      // (c) どちらも無い → image=null
      await (await import('node:fs/promises')).rename(tilesDir, nodePath.join(dataDir, 'tiles-backup-' + mapUid));
      const mapsResult3 = await call('search:maps', { q: '', page: 1, pageSize: 20 });
      const mapDoc3 = mapsResult3.docs.find((d: any) => d.slug === mapSlug);
      assert.equal(mapDoc3.image, null, '画像実体が無ければ image=null: ' + mapDoc3.image);
      console.log('ok: (c) image is null when neither exists');

      // (d) search:apps の優先順: iconSource → splash → startFrom
      const appDoc1 = (await call('search:apps', { q: '', page: 1, pageSize: 20 })).docs.find((d: any) => d.slug === appSlug);
      assert.equal(appDoc1.image, null, 'iconSource/splash/startFrom 無しは image=null');
      // iconSource を設定（AppAssetService.fileUrlFor は saveFolder 相対で解決するため saveFolder/img/ へ配置）
      const appImgDir = nodePath.join(dataDir, 'img');
      await fsMkdir(appImgDir, { recursive: true });
      await fsWriteFile(nodePath.join(appImgDir, 'icon.png'), PNG);
      await SqliteDataService.upsertApp(appUid, appSlug, {
        appID: appSlug, appName: { ja: 'thumb app' }, title: { ja: 'thumb app' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [], pois: [], httpSettings: {}, appSettings: {},
        manifestSettings: { iconSource: 'img/icon.png' },
      });
      const appDoc2 = (await call('search:apps', { q: '', page: 1, pageSize: 20 })).docs.find((d: any) => d.slug === appSlug);
      assert.ok(appDoc2.image && appDoc2.image.startsWith('file://'), 'iconSource が image として添付されること: ' + appDoc2.image);
      console.log('ok: (d) search:apps attaches iconSource as image');

      // (e) FTS・paginate 契約: total/next、q 一致
      const ftsResult = await call('search:maps', { q: 'thumb', page: 1, pageSize: 1 });
      assert.equal(ftsResult.total, 1, 'FTS total が一致すること');
      assert.equal(ftsResult.next, undefined, '1件のみの場合 next が無いこと');
      const noHit = await call('search:maps', { q: 'zzz-no-hit', page: 1, pageSize: 20 });
      assert.equal(noHit.total, 0, 'FTS 不一致は total=0');
      console.log('ok: (e) FTS and pagination contracts are preserved');

      // (f) pageSize<=0 では添付スキップ（無制限 I/O 防止）
      await fsMkdir(tmbsDir, { recursive: true });
      await fsWriteFile(nodePath.join(tmbsDir, mapUid + '.jpg'), PNG);
      const allResult = await call('search:maps', { q: '', page: 1, pageSize: 0 });
      const allDoc = allResult.docs.find((d: any) => d.slug === mapSlug);
      assert.ok(allDoc.image == null, 'pageSize<=0 では添付しないこと（image 不在）: ' + allDoc.image);
      console.log('ok: (f) pageSize<=0 skips image attachment');

      // (g) 既存経路（MapDataService.requestMaps / AppDataService.requestApps）の回帰なし
      const legacy = await MapDataService.requestMaps('', 1, 20);
      const legacyDoc = legacy.docs.find((d: any) => (d.mapID ?? d.slug) === mapSlug);
      assert.equal(legacyDoc.image, 'file://' + nodePath.join(tmbsDir, mapUid + '.jpg').split(nodePath.sep).join('/'),
        'maplist.request 経路の image 添付が委譲後も現行どおり: ' + legacyDoc.image);
      const legacyApp = await AppDataService.requestApps('', 1, 20);
      const legacyAppDoc = legacyApp.docs.find((d: any) => (d.appID ?? d.slug) === appSlug);
      assert.ok(legacyAppDoc.image && legacyAppDoc.image.startsWith('file://'),
        'applist.request 経路の image 添付が委譲後も現行どおり: ' + legacyAppDoc.image);
      console.log('ok: (g) legacy request paths keep attaching images after delegation');

      // (h) search:baseMaps も thumbnailUrl を添付する（builtin の basemap_icons/ 解決）
      //     — discovery「ビルトインBM アイコン非表示」の回帰面
      const baseMapsResult = await call('search:baseMaps', { q: '', page: 1, pageSize: 40 });
      const osmDoc = baseMapsResult.docs.find((d: any) => d.mapID === 'osm' || d.slug === 'osm');
      assert.ok(osmDoc, '内蔵ベースマップ osm が search:baseMaps に含まれること');
      assert.ok(osmDoc.thumbnailUrl && osmDoc.thumbnailUrl.includes('basemap_icons'),
        'builtin の thumbnail が thumbnailUrl として添付されること: ' + osmDoc.thumbnailUrl);
      // BaseMapList は limit:0（pageSize<=0 全件経路）で読むため、同経路でも添付されることを確認する
      const baseMapsAll = await call('search:baseMaps', { q: '', page: 1, pageSize: 0 });
      const osmAll = baseMapsAll.docs.find((d: any) => d.mapID === 'osm' || d.slug === 'osm');
      assert.ok(osmAll.thumbnailUrl && osmAll.thumbnailUrl.includes('basemap_icons'),
        'pageSize<=0 全件経路でも builtin thumbnailUrl が添付されること: ' + osmAll.thumbnailUrl);
      console.log('ok: (h) search:baseMaps attaches builtin thumbnail as thumbnailUrl (pageSize>0 and pageSize<=0)');

      // (i) basemaps:list 経路（settings IPC）の thumbnailUrl 解決が委譲後も現行どおり
      const { registerSettingsHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/settings.ts'))});
      registerSettingsHandlers();
      const basemapsList = await call('basemaps:list');
      const osmListItem = basemapsList.find((d: any) => d.mapID === 'osm' || d.slug === 'osm');
      assert.ok(osmListItem.thumbnailUrl && osmListItem.thumbnailUrl.includes('basemap_icons'),
        'basemaps:list 経路の thumbnailUrl 解決が委譲後も現行どおり: ' + osmListItem.thumbnailUrl);
      console.log('ok: (i) basemaps:list path keeps resolving thumbnailUrl after delegation');

      console.log('m12-t1-hotfix-1 smoke: ALL PASS');
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
          entryFileNames: 'm12-t1-hotfix1-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
