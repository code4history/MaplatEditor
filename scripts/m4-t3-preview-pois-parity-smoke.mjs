// M4-T3 スモーク: preview を export と同一形式にする（pois/ 配信）。設計 v1.1。
// m10-t1 / m4-t2 と同じ sandbox 方式（vite SSR ビルド + electron/electron-store スタブ +
// saveFolder=一時dir）で AppPreviewService.prepare の実 HTTP 配信を behavioral に検証する。
//
// Part A: 配信 JSON が参照形（apps / maps ともインライン FC 0件）                      … AC1 / AC2
// Part B: GET pois/<name>.geojson が FC を返し、上書きが焼き込まれていない             … AC3
// Part C: app と map が同一ソースを参照しても外部ファイルは1つ                          … AC4
// Part D: 未知の pois/<name> は {}（404 で POI 全損にしない）                           … AC5
// Part E: 外部ファイル内の icon / asset が imgs/ ルートで実体として取れる               … AC6
// Part F: preview と export が同一形式（ファイル名の一致は要求しない）                  … AC7
// Part G: バンドル viewer の m18-t4 対応（伝播要否の判定を記録する）                     … AC8
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm4-t3-preview-pois-'));
const entryFile = path.join(workDir, 'm4-t3-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm4-t3-smoke.mjs');

// --- Part G: バンドル viewer の m18-t4 対応（sandbox の外で判定する。ファイルを読むだけ） ---
{
  const bundlePath = path.join(projectRoot, 'public/preview/maplat_ui.umd.js');
  const bundle = await readFile(bundlePath, 'utf8');
  const required = [
    // nodesLoader: スラッシュを含めばそのまま、含まなければ pois/ を前置する
    'pois/${',
    'Fail to load poi json',
    // m18-t4: 上書きレイヤ（ラッパー）の許可キーと座標キー
    '"hide","title","icon","selectedIcon"',
    '"lnglat","lng","lat","longitude","latitude"',
    // extractOverrides の未知キー警告
    'pois layer ref: unknown override key ignored',
  ];
  const missing = required.filter((needle) => !bundle.includes(needle));
  if (missing.length > 0) {
    console.error('[m4-t3][AC8] バンドル viewer が m18-t4 に未対応です。'
      + 'MaplatCore の修正をバンドルへ伝播させてください（pnpm run sync:preview-bundle）。'
      + ' 欠落: ' + JSON.stringify(missing));
    process.exit(1);
  }
  console.log('ok: (G) preview bundle viewer supports m18-t4 (伝播不要と判定)');
}

try {
  const dataDir = path.join(workDir, 'data');
  const exportRoot = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportRoot, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const poiServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const appPreviewServicePath = path.join(projectRoot, 'electron/services/AppPreviewService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');

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
            filePath: ${JSON.stringify(path.join(exportRoot, 'm4t3_app.zip'))},
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
      const { default: AppPreviewService } = await import(${JSON.stringify(appPreviewServicePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      await SqliteDataService.getDb();

      // ---- fixture ----
      const assetBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const { uid: assetUid } = await SqliteDataService.createAsset('t3-mark', {
        lang: 'ja', title: { ja: 'マーク' }, mime: 'image/png', ext: 'png',
        width: 1, height: 1, byteSize: assetBytes.length,
      });
      const assetsDir = nodePath.join(${JSON.stringify(dataDir)}, 'assets');
      const fsExtra = (await import('fs-extra')).default;
      await fsExtra.ensureDir(assetsDir);
      await fsExtra.writeFile(nodePath.join(assetsDir, assetUid + '.png'), assetBytes);

      function fcOf(id: string, name: string, extra: Record<string, unknown> = {}) {
        return {
          type: 'FeatureCollection', id, name, lang: 'ja',
          features: [
            { type: 'Feature', id: 'f1',
              geometry: { type: 'Point', coordinates: [135.0, 35.0] },
              // html の maplat-asset は外部ファイル側で imgs/{slug}.{ext} へ解決されるはず
              properties: { name: name + 'の点', html: { ja: '<img src="maplat-asset:' + assetUid + '" />' } } },
          ],
          ...extra,
        };
      }

      const createdA = await PoiSourceService.createLocal({
        slug: 't3-poi-a', title: { ja: 'レイヤA' }, lang: 'ja',
        fc: fcOf('t3-poi-a', 'レイヤA', { icon: 'builtin:defaultpin' }),
      });
      assert.equal(createdA.result, 'Success', 'POI ソース A: ' + JSON.stringify(createdA));
      const uidA = createdA.uid;
      const createdB = await PoiSourceService.createLocal({
        slug: 't3-poi-b', title: { ja: 'レイヤB' }, lang: 'ja', fc: fcOf('t3-poi-b', 'レイヤB'),
      });
      assert.equal(createdB.result, 'Success', 'POI ソース B: ' + JSON.stringify(createdB));
      const uidB = createdB.uid;

      const { uid: mapUid } = await SqliteDataService.createMap('t3map', {
        title: 't3地図',
        width: 400,
        height: 300,
        strictMode: 'loose',
        vertexMode: 'plain',
        // preview の compiled 生成に GCP が3点以上要る（m10-t1 の fixture と同型）
        gcps: [
          [[0, 0], [135.0, 35.1]],
          [[400, 0], [135.1, 35.1]],
          [[200, 300], [135.05, 35.0]],
        ],
        // app と同じ POI ソース A を参照する（AC4: 1ファイルへ畳む）
        pois: [{ poiUid: uidA, hide: true }],
      });
      assert.ok(mapUid, '地図 fixture');

      const appDocument = {
        appID: 'm4t3_app',
        title: { ja: 'm4t3アプリ' },
        lang: 'ja',
        sources: [
          { sourceType: 'maplat', mapID: 't3map', role: 'maplat', startFrom: true,
            data: { mapID: 't3map', maptype: 'maplat', noload: true } },
        ],
        httpSettings: { previewPort: 43201 },
        appSettings: { homeLng: 135.05, homeLat: 35.05, defaultZoom: 15 },
        startFrom: 't3map',
        pois: [
          { poiUid: uidA, title: { ja: 'アプリ側差替' }, icon: assetUid },
          { poiUid: uidB },
          'https://example.com/external.geojson',
        ],
      };

      // ============================================================
      // preview を起動して実 HTTP で検証する
      // ============================================================
      const prepared = await AppPreviewService.prepare(appDocument);
      assert.ok(prepared.url, 'prepare は preview URL を返すはず');
      const token = new URL(prepared.url).pathname.split('/').filter(Boolean)[1];
      const base = prepared.url.replace(/\\/$/, '');

      const fetchJson = async (url: string) => {
        const resp = await fetch(url);
        assert.equal(resp.status, 200, 'GET ' + url + ' は 200 のはず');
        return await resp.json();
      };

      // ---- Part A: 配信 JSON が参照形（AC1 / AC2） ----
      const appJson: any = await fetchJson(base + '/apps/' + token + '.json');
      assert.equal(appJson.pois.length, 3);
      for (const entry of appJson.pois) {
        assert.notEqual(entry?.type, 'FeatureCollection',
          'preview の app JSON にインライン FC が残ってはいけない: ' + JSON.stringify(entry));
        assert.equal(typeof entry?.layer, 'string',
          'preview の app JSON の pois 要素は {layer:…} 形のはず: ' + JSON.stringify(entry));
      }
      assert.equal(appJson.pois[0].layer, 'pois/t3-poi-a.geojson');
      assert.equal(appJson.pois[0].title, 'アプリ側差替', 'app 側 title 上書きが wrapper に載る');
      assert.equal(appJson.pois[0].icon, 'imgs/t3-mark.png',
        'app 側 icon 上書きが imgs/ へ解決されて wrapper に載る');
      assert.equal(appJson.pois[1].layer, 'pois/t3-poi-b.geojson');
      assert.deepEqual(appJson.pois[2], { layer: 'https://example.com/external.geojson' });

      const mapJson: any = await fetchJson(base + '/maps/t3map.json');
      assert.equal(mapJson.pois.length, 1);
      assert.notEqual(mapJson.pois[0]?.type, 'FeatureCollection',
        'preview の map JSON にインライン FC が残ってはいけない');
      assert.equal(mapJson.pois[0].layer, 'pois/t3-poi-a.geojson',
        'map JSON も同じ外部ファイルを参照するはず（AC4）');
      assert.equal(mapJson.pois[0].hide, true, 'map 側 hide 上書きが wrapper に載る');
      console.log('ok: (A) preview serves reference-form pois in apps/ and maps/');

      // ---- Part B: pois/<name>.geojson の配信と上書き非焼き込み（AC3） ----
      const poiFileA: any = await fetchJson(base + '/pois/t3-poi-a.geojson');
      assert.equal(poiFileA.type, 'FeatureCollection');
      assert.equal(poiFileA.id, 't3-poi-a');
      assert.equal(poiFileA.name, 'レイヤA',
        '外部ファイルの name はソース側のまま（app 側の title 上書きを焼き込まない）');
      assert.equal(poiFileA.properties?.hide, undefined,
        '外部ファイルに map 側の hide が焼き込まれていないはず');
      assert.equal(poiFileA.properties?.icon, 'imgs/icons/builtin/defaultpin.png',
        '外部ファイル内の icon 参照は imgs/ へ解決されるはず');
      assert.equal(poiFileA.features[0].properties.name, 'レイヤAの点');
      console.log('ok: (B) preview serves pois/<name>.geojson without baked overrides');

      // ---- Part C: 畳み込み（AC4） ----
      const poiFileB: any = await fetchJson(base + '/pois/t3-poi-b.geojson');
      assert.equal(poiFileB.id, 't3-poi-b');
      const layers = [...appJson.pois, ...mapJson.pois]
        .map((p: any) => p.layer).filter((l: string) => l.startsWith('pois/'));
      assert.deepEqual([...new Set(layers)].sort(),
        ['pois/t3-poi-a.geojson', 'pois/t3-poi-b.geojson'],
        'app と map が同一ソースを参照しても外部ファイルは1つに畳まれるはず');
      console.log('ok: (C) app and map share a single external file');

      // ---- Part D: 未知の pois は {}（AC5） ----
      const unknownResp = await fetch(base + '/pois/does-not-exist.geojson');
      assert.equal(unknownResp.status, 200,
        '未知の pois は 404 にしない（viewer の nodesLoader が throw して POI 全損になるため）');
      assert.deepEqual(await unknownResp.json(), {}, '未知の pois は空オブジェクトのはず');
      console.log('ok: (D) unknown pois name returns {} instead of 404');

      // ---- Part E: 外部ファイル内の icon / asset の実体が imgs/ で取れる（AC6） ----
      const builtinResp = await fetch(base + '/' + poiFileA.properties.icon);
      assert.equal(builtinResp.status, 200, 'icon set 参照の実体が配信されるはず');
      const builtinBytes = new Uint8Array(await builtinResp.arrayBuffer());
      assert.deepEqual([...builtinBytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG マジック');

      const htmlValue = JSON.stringify(poiFileA.features[0].properties.html);
      assert.ok(!htmlValue.includes('maplat-asset:'),
        '外部ファイル内の html の maplat-asset は解決済みのはず: ' + htmlValue);
      assert.ok(htmlValue.includes('imgs/t3-mark.png'),
        '外部ファイル内の html が imgs/{slug}.{ext} を指すはず: ' + htmlValue);
      const assetResp = await fetch(base + '/imgs/t3-mark.png');
      assert.equal(assetResp.status, 200,
        'export 形 imgs/{slug}.{ext} が preview の既存ルートで配信されるはず（設計 §2.3）');
      const assetRespBytes = new Uint8Array(await assetResp.arrayBuffer());
      assert.deepEqual([...assetRespBytes], [...assetBytes], '配信された実体が登録バイト列と一致');
      console.log('ok: (E) icon/asset inside the external file resolve over imgs/');

      // ---- Part F: preview と export が同一形式（AC7） ----
      const fakeWin = { webContents: { send() {} } };
      const exported = await AppExportService.exportApp(fakeWin as any, appDocument);
      assert.equal(exported.result, 'Success', 'exportApp: ' + JSON.stringify(exported));
      const { default: AdmZip } = await import('adm-zip');
      const exportDir = nodePath.join(${JSON.stringify(workDir)}, 'export-extract');
      new AdmZip(exported.outDir).extractAllTo(exportDir, true);
      const exportedApp = JSON.parse(
        await fsReadFile(nodePath.join(exportDir, 'apps', 'm4t3_app.json'), 'utf8'));

      // 形の一致: 要素数・キー集合・上書き値。ファイル名の一致は要求しない（設計 §5.3）
      assert.equal(exportedApp.pois.length, appJson.pois.length, 'preview と export で pois 要素数が一致');
      for (let i = 0; i < exportedApp.pois.length; i++) {
        const e = exportedApp.pois[i];
        const p = appJson.pois[i];
        assert.deepEqual(Object.keys(e).sort(), Object.keys(p).sort(),
          'preview と export で pois[' + i + '] のキー集合が一致するはず: '
            + JSON.stringify(e) + ' vs ' + JSON.stringify(p));
        for (const key of Object.keys(e)) {
          if (key === 'layer') continue; // ファイル名の一致は要求しない
          assert.deepEqual(e[key], p[key],
            'preview と export で pois[' + i + '].' + key + ' が一致するはず');
        }
      }
      // 外部ファイルの中身の一致（同一 POI ソース由来）
      const exportedFileA = JSON.parse(
        await fsReadFile(nodePath.join(exportDir, 'pois', 't3-poi-a.geojson'), 'utf8'));
      assert.deepEqual(exportedFileA, poiFileA,
        'preview と export で外部ファイルの中身が一致するはず（MC3）');
      console.log('ok: (F) preview and export emit the same format');

      await AppPreviewService.stop?.();
      console.log('m4-t3 preview pois parity smoke passed');
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
        output: { entryFileNames: 'm4-t3-smoke.mjs', format: 'es' },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    env: { ...process.env, APP_ROOT: projectRoot },
    maxBuffer: 1024 * 1024 * 16,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
