// アセット UID の大文字・小文字の扱いを、エディタの診断と書き出しで揃えたことのスモーク。
// m4-t2 と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// AppExportService.exportApp の実出力を検証する。
//
// アセットの UID は小文字で保存する。POI の icon・selectedIcon・image・html 本文の
// maplat-asset:<UID> に **大文字** の UID が書かれていても、診断（src/utils/iconRefs.ts・
// src/utils/poiContentMode.ts は小文字に直して問い合わせる）と同じく、書き出しでも見つかること:
//   ① 書き出し JSON の参照が imgs/<slug>.<ext> へ書き換わる
//   ② その実体が zip に同梱される
//   ③ appedit.warn_unresolved_icon・appedit.warn_missing_asset_ref が出ない
// あわせて、レイヤの既定のアイコン（FC.properties.icon）と、アプリ側の icon 上書きも見る。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'asset-uid-case-export-'));
const entryFile = path.join(workDir, 'asset-uid-case-export-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'asset-uid-case-export-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const exportRoot = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportRoot, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const poiServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const iconRefsPath = path.join(projectRoot, 'src/utils/iconRefs.ts');
  const poiContentModePath = path.join(projectRoot, 'src/utils/poiContentMode.ts');

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
        showSaveDialog() {
          return Promise.resolve({
            canceled: false,
            filePath: ${JSON.stringify(path.join(exportRoot, 'uidcase_app.zip'))},
          });
        },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const ipcMain = { handle() {} };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
        static fromWebContents() { return null; }
      };
      export const session = {
        defaultSession: { clearStorageData() { return Promise.resolve(); } },
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
      import { readFile as fsReadFile } from 'node:fs/promises';
      import nodePath from 'node:path';

      process.env.APP_ROOT = ${JSON.stringify(projectRoot)};

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: PoiSourceService } = await import(${JSON.stringify(poiServicePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      const { collectIconAssetUids } = await import(${JSON.stringify(iconRefsPath)});
      const { collectImageAssetUids, collectAssetRefUids } = await import(${JSON.stringify(poiContentModePath)});
      await SqliteDataService.getDb();

      const UNRESOLVED_ICON_KEY = 'appedit.warn_unresolved_icon';
      const MISSING_ASSET_REF_KEY = 'appedit.warn_missing_asset_ref';

      // --- fixture: 架空のアセット 2 件（1x1 の png）---
      const assetBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const assetsDir = nodePath.join(${JSON.stringify(dataDir)}, 'assets');
      const fsExtra = (await import('fs-extra')).default;
      await fsExtra.ensureDir(assetsDir);
      async function makeAsset(slug: string, title: string) {
        const { uid } = await SqliteDataService.createAsset(slug, {
          lang: 'ja', title: { ja: title }, mime: 'image/png', ext: 'png',
          width: 1, height: 1, byteSize: assetBytes.length,
        });
        assert.equal(uid, uid.toLowerCase(), 'アセットの UID は小文字で採番されるはず: ' + uid);
        await fsExtra.writeFile(nodePath.join(assetsDir, uid + '.png'), assetBytes);
        return uid;
      }
      const markUid = await makeAsset('sample-mark', '見本の印');
      const photoUid = await makeAsset('sample-photo', '見本の写真');
      const MARK = markUid.toUpperCase();
      const PHOTO = photoUid.toUpperCase();
      assert.notEqual(MARK, markUid, '大文字の表記が小文字と別の文字列であること（前提）');

      // --- POI ソース: 大文字の UID を icon・selectedIcon・image・html に書く ---
      const fc = {
        type: 'FeatureCollection',
        id: 'sample-poi',
        name: '見本POI',
        properties: { icon: MARK },
        features: [
          { type: 'Feature', id: 'f1',
            geometry: { type: 'Point', coordinates: [135.0, 35.0] },
            properties: {
              name: '見本の点',
              icon: MARK,
              selectedIcon: MARK,
              image: [{ src: PHOTO }, PHOTO],
              html: { ja: '<p>見本</p><img src="maplat-asset:' + PHOTO + '">' },
            } },
        ],
      };

      // 前提: エディタの診断側は大文字でも小文字に直して数える（欠落なしになる）
      assert.deepEqual([...collectIconAssetUids(fc)], [markUid], '診断: アイコンの UID は小文字に直して数えるはず');
      assert.deepEqual([...collectImageAssetUids(fc.features[0].properties.image)], [photoUid],
        '診断: 画像欄の UID は小文字に直して数えるはず');
      assert.deepEqual([...collectAssetRefUids(fc.features[0].properties.html)], [photoUid],
        '診断: html 本文の UID は小文字に直して数えるはず');

      const created = await PoiSourceService.createLocal({
        slug: 'sample-poi', title: { ja: '見本POI' }, lang: 'ja', fc,
      });
      assert.equal(created.result, 'Success', 'POI ソースの作成: ' + JSON.stringify(created));

      const { uid: mapUid } = await SqliteDataService.createMap('uidcasemap', {
        title: { ja: '見本地図' },
      });
      assert.ok(mapUid, '地図 fixture の作成');

      const appDocument = {
        appID: 'uidcase_app',
        title: { ja: '見本アプリ' },
        lang: 'ja',
        sources: [
          { sourceType: 'maplat', mapID: 'uidcasemap', role: 'maplat', startFrom: true,
            data: { mapID: 'uidcasemap', maptype: 'maplat', noload: true } },
        ],
        httpSettings: { previewPort: 43193 },
        appSettings: { homeLng: 135.05, homeLat: 35.05, defaultZoom: 15 },
        startFrom: 'uidcasemap',
        // アプリ側の icon 上書きも大文字の UID で書く
        pois: [{ poiUid: created.uid, icon: MARK }],
      };

      const fakeWin = { webContents: { send() {} } };
      const exported = await AppExportService.exportApp(fakeWin as any, appDocument);
      assert.equal(exported.result, 'Success', 'exportApp は Success のはず: ' + JSON.stringify(exported));

      // ③ 警告が出ない
      assert.ok(!exported.warnings.includes(UNRESOLVED_ICON_KEY),
        '大文字の UID のアイコン・画像で「解決できない」警告が出てはいけない: ' + JSON.stringify(exported.warnings));
      assert.ok(!exported.warnings.includes(MISSING_ASSET_REF_KEY),
        '大文字の UID の html 本文で「欠落」警告が出てはいけない: ' + JSON.stringify(exported.warnings));

      const { default: AdmZip } = await import('adm-zip');
      const exportDir = nodePath.join(${JSON.stringify(workDir)}, 'export-extract');
      new AdmZip(exported.outDir).extractAllTo(exportDir, true);

      // ① 参照が imgs/<slug>.<ext> へ書き換わる
      const appJson = JSON.parse(await fsReadFile(nodePath.join(exportDir, 'apps', 'uidcase_app.json'), 'utf8'));
      assert.equal(appJson.pois[0].icon, 'imgs/sample-mark.png', 'アプリ側の icon 上書きが imgs/ へ解決されるはず');
      const poiDoc = JSON.parse(await fsReadFile(nodePath.join(exportDir, 'pois', 'sample-poi.geojson'), 'utf8'));
      assert.equal(poiDoc.properties?.icon, 'imgs/sample-mark.png', 'レイヤの既定のアイコンが imgs/ へ解決されるはず');
      const props = poiDoc.features[0].properties;
      assert.equal(props.icon, 'imgs/sample-mark.png', 'POI の icon が imgs/ へ解決されるはず');
      assert.equal(props.selectedIcon, 'imgs/sample-mark.png', 'POI の selectedIcon が imgs/ へ解決されるはず');
      assert.deepEqual(props.image, [{ src: 'imgs/sample-photo.png' }, 'imgs/sample-photo.png'],
        '画像欄の UID が imgs/ へ解決されるはず');
      const htmlText = typeof props.html === 'string' ? props.html : props.html?.ja;
      assert.ok(String(htmlText).includes('src="imgs/sample-photo.png"'),
        'html 本文の maplat-asset:<UID> が imgs/ へ解決されるはず: ' + JSON.stringify(props.html));
      const exportedText = JSON.stringify({ appJson, poiDoc });
      assert.ok(!exportedText.includes(MARK) && !exportedText.includes(PHOTO),
        '書き出したファイルに大文字の UID が残ってはいけない');

      // ② 実体が同梱される
      for (const name of ['sample-mark.png', 'sample-photo.png']) {
        const bytes = await fsReadFile(nodePath.join(exportDir, 'imgs', name));
        assert.ok(bytes.equals(assetBytes), 'imgs/' + name + ' の実体が zip に同梱されるはず');
      }

      console.log('asset uid case export smoke passed');
      process.exit(0);
    `
  );

  await build({
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: /^electron$/, replacement: electronStubFile },
        { find: /^electron-store$/, replacement: electronStoreStubFile },
      ],
    },
    build: {
      outDir,
      emptyOutDir: true,
      ssr: true,
      target: 'node20',
      minify: false,
      rollupOptions: {
        input: entryFile,
        output: { entryFileNames: 'asset-uid-case-export-smoke.mjs', format: 'es' },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    env: { ...process.env, APP_ROOT: projectRoot },
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
