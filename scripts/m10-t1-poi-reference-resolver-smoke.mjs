// M10-T1 スモーク: 登録 POI ソース参照 ({poiUid}) の preview / package export 解決層 (Phase 7 Task 1)。
// m9 系と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// AppPreviewService.prepare (HTTP 配信の app/map JSON) と AppExportService.exportApp (実出力) を behavioral に検証する。
// シナリオ:
//   ① poi_source を createLocal+save (name・8桁精度座標・_maplatUid 付き) → app document の pois に
//      {poiUid} → prepare → 配信 app JSON の pois[0] が export 形 FC (FC.id=slug / FC.name=title /
//      _maplat* キーなし / 座標7桁丸め)
//   ② pois に生 URL 文字列と生 FC を混在 → そのまま透過 (生 FC の座標も丸めない)
//   ③ 存在しない poiUid → 要素が落ち、warnings に appedit.warn_missing_poi_source (キーは1回)
//   ④ app の pois と map data_json の pois の両方に同じ poiUid → warnings に
//      appedit.warn_duplicate_poi_reference。map JSON 側の pois[0] も FC に解決される
//   ⑤ {poiUid} を pois に持つ app を保存 (AppDataService.saveApp) → findReferences(uid) が
//      その app (と pois を持つ map) を返す (AID-006 実効化)
//   ⑥ export 経路: AppExportService.exportApp の実出力 (apps/{appID}.json / maps/{slug}.json) の
//      pois が①④と同じ解決結果になり、result.warnings に③④のキーが載る
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-reference-resolver-'));
const entryFile = path.join(workDir, 'poi-reference-resolver-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'poi-reference-resolver-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const exportRoot = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportRoot, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const poiServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');
  const appPreviewServicePath = path.join(projectRoot, 'electron/services/AppPreviewService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const poiReferenceResolverPath = path.join(projectRoot, 'electron/services/poiReferenceResolver.ts');

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
      // export 先ディレクトリを返す (AppExportService.exportApp のフォルダ選択ダイアログ相当)
      export const dialog = {
        showOpenDialog() {
          return Promise.resolve({ canceled: false, filePaths: [${JSON.stringify(exportRoot)}] });
        },
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

      // AppPreviewService/AppExportService の appRoot 解決 (public/preview 等) を実プロジェクトに向ける
      process.env.APP_ROOT = ${JSON.stringify(projectRoot)};

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: PoiSourceService } = await import(${JSON.stringify(poiServicePath)});
      const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});
      const { default: AppPreviewService } = await import(${JSON.stringify(appPreviewServicePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      const { resolvePoisArray } = await import(${JSON.stringify(poiReferenceResolverPath)});
      await SqliteDataService.getDb();

      const MISSING_KEY = 'appedit.warn_missing_poi_source';
      const DUPLICATE_KEY = 'appedit.warn_duplicate_poi_reference';
      const MISSING_UID = '99999999-9999-4999-8999-999999999999';

      // --- fixture: 登録 POI ソース (name・8桁精度座標・_maplatUid 付き feature) ---
      const created = await PoiSourceService.createLocal({ slug: 'kyoto-poi', title: '京都POI' });
      assert.equal(created.result, 'Success', 'createLocal は Success のはず: ' + JSON.stringify(created));
      const srcUid = created.uid;
      const saved = await PoiSourceService.save(srcUid, {
        slug: 'kyoto-poi',
        title: '京都POI',
        fc: {
          type: 'FeatureCollection',
          icon: 'builtin:defaultpin',
          features: [
            { type: 'Feature', id: 'kinkakuji',
              geometry: { type: 'Point', coordinates: [135.12345678, 35.12345678] },
              properties: { _maplatUid: '11111111-1111-4111-8111-111111111111', name: '金閣寺' } },
          ],
        },
        expectedRevision: 1,
      });
      assert.equal(saved.result, 'Success', 'save は Success のはず: ' + JSON.stringify(saved));

      // --- fixture: pois に同じ {poiUid} を持つ登録地図 (map data_json 側参照, POI-137 の受け皿) ---
      const { uid: mapUid } = await SqliteDataService.createMap('poimap', {
        title: 'POI Map',
        width: 400,
        height: 300,
        strictMode: 'loose',
        vertexMode: 'plain',
        gcps: [
          [[0, 0], [135.0, 35.1]],
          [[400, 0], [135.1, 35.1]],
          [[200, 300], [135.05, 35.0]],
        ],
        pois: [{ poiUid: srcUid, cachedTitle: '京都POI' }],
      });
      assert.ok(mapUid, '登録地図が作成されるはず');

      // --- fixture: 生 URL / 生 FC (透過対象) ---
      const rawUrl = 'https://example.com/pois.geojson';
      const rawFc = {
        type: 'FeatureCollection',
        id: 'embedded-raw',
        features: [
          { type: 'Feature',
            geometry: { type: 'Point', coordinates: [130.41512345678, 33.59612345678] },
            properties: { name: '既存FC' } },
        ],
      };

      const appDocument = {
        appID: 'poi_ref_app',
        title: { ja: 'POI参照アプリ' },
        lang: 'ja',
        sources: [
          { sourceType: 'maplat', mapID: 'poimap', role: 'maplat', startFrom: true,
            data: { mapID: 'poimap', maptype: 'maplat', noload: true } },
        ],
        httpSettings: { previewPort: 43181 },
        appSettings: { homeLng: 135.05, homeLat: 35.05, defaultZoom: 15 },
        startFrom: 'poimap',
        pois: [
          { poiUid: srcUid, cachedTitle: '京都POI' },
          rawUrl,
          rawFc,
          { poiUid: MISSING_UID, cachedTitle: '消えたPOI' },
        ],
      };

      // 共通アサーション: 解決済み export 形 FC (①)
      function assertResolvedFc(fc: any, label: string) {
        assert.ok(fc && typeof fc === 'object' && !Array.isArray(fc), label + ': pois[0] はオブジェクトのはず');
        assert.equal(fc.type, 'FeatureCollection', label + ': pois[0] は FeatureCollection のはず');
        assert.equal(fc.id, 'kyoto-poi', label + ': FC.id === slug のはず (POI-133)');
        assert.equal(fc.name, '京都POI', label + ': FC.name === title のはず (ADR-0005 collapse)');
        assert.equal(fc.icon, 'builtin:defaultpin', label + ': layer metadata が export 形に持ち越されるはず');
        assert.equal(fc.features.length, 1);
        const feature = fc.features[0];
        assert.equal(feature.id, 'kinkakuji');
        assert.equal(feature.properties.name, '金閣寺', label + ': feature name も交換形へ collapse されるはず');
        const internalKeys = Object.keys(feature.properties).filter((key: string) => key.startsWith('_maplat'));
        assert.deepEqual(internalKeys, [], label + ': _maplat* キーが剥がされているはず');
        assert.deepEqual(
          feature.geometry.coordinates,
          [135.1234568, 35.1234568],
          label + ': 座標が7桁丸めされているはず (POI-143)'
        );
      }

      // --- preview 経路 (prepare → 配信 JSON を fetch) ---
      const prepared = await AppPreviewService.prepare(appDocument);
      assert.ok(prepared.url, 'prepare は preview URL を返すはず');
      const token = new URL(prepared.url).pathname.split('/').filter(Boolean)[1];
      const appJson = await (await fetch(prepared.url + 'apps/' + token + '.json')).json();

      // ① {poiUid} → export 形 FC
      assertResolvedFc(appJson.pois[0], 'preview app JSON');

      // ② 生 URL / 生 FC は透過 (生 FC の座標は丸めない)
      assert.equal(appJson.pois.length, 3, 'missing 参照が落ちて 3 要素のはず');
      assert.equal(appJson.pois[1], rawUrl, '生 URL 文字列は透過されるはず');
      assert.deepEqual(appJson.pois[2], rawFc, '生 FC は無加工で透過されるはず');

      // ③ 存在しない poiUid → 要素落ち + warning キー (1回)
      assert.ok(!JSON.stringify(appJson.pois).includes('poiUid'), '未解決の {poiUid} 要素が残らないはず');
      assert.ok(Array.isArray(prepared.warnings), 'prepare は warnings 配列を返すはず');
      assert.ok(prepared.warnings.includes(MISSING_KEY), 'missing 警告キーが載るはず: ' + JSON.stringify(prepared.warnings));
      assert.equal(
        prepared.warnings.filter((key: string) => key === MISSING_KEY).length, 1,
        'missing 警告キーは1回だけのはず'
      );

      // ④ app × map の二重参照 → duplicate warning + map JSON 側も解決
      assert.ok(prepared.warnings.includes(DUPLICATE_KEY), 'duplicate 警告キーが載るはず: ' + JSON.stringify(prepared.warnings));
      assert.equal(
        prepared.warnings.filter((key: string) => key === DUPLICATE_KEY).length, 1,
        'duplicate 警告キーは1回だけのはず'
      );
      const mapJson = await (await fetch(prepared.url + 'maps/poimap.json')).json();
      assert.equal(mapJson.pois.length, 1, 'map JSON の pois も解決されるはず');
      assertResolvedFc(mapJson.pois[0], 'preview map JSON');
      console.log('ok: (1)-(4) preview app/map JSON resolve {poiUid} references with warnings');

      // ⑤ 参照を持つ app の保存で findReferences が実効化 (AID-006)
      const appSaved = await AppDataService.saveApp({ document: appDocument, slug: 'poi_ref_app' });
      assert.equal(appSaved.result, 'Success', 'saveApp は Success のはず: ' + JSON.stringify(appSaved));
      const references = await PoiSourceService.findReferences(srcUid);
      assert.ok(
        references.some((ref: any) => ref.kind === 'app' && ref.slug === 'poi_ref_app'),
        '保存した app が逆参照に載るはず: ' + JSON.stringify(references)
      );
      assert.ok(
        references.some((ref: any) => ref.kind === 'map' && ref.slug === 'poimap'),
        'pois を持つ map も逆参照に載るはず: ' + JSON.stringify(references)
      );
      console.log('ok: (5) findReferences returns referencing app/map (AID-006)');

      // ⑥ export 経路 (exportApp の実出力)
      const fakeWin = { webContents: { send() {} } };
      const exported = await AppExportService.exportApp(fakeWin as any, appDocument);
      assert.equal(exported.result, 'Success', 'exportApp は Success のはず: ' + JSON.stringify(exported));
      const exportedAppJson = JSON.parse(
        await fsReadFile(nodePath.join(exported.outDir, 'apps', 'poi_ref_app.json'), 'utf8')
      );
      assertResolvedFc(exportedAppJson.pois[0], 'export app JSON');
      assert.equal(exportedAppJson.pois.length, 3, 'export でも missing 参照が落ちて 3 要素のはず');
      assert.equal(exportedAppJson.pois[1], rawUrl, 'export でも生 URL は透過されるはず');
      assert.deepEqual(exportedAppJson.pois[2], rawFc, 'export でも生 FC は無加工透過されるはず');
      const exportedMapJson = JSON.parse(
        await fsReadFile(nodePath.join(exported.outDir, 'maps', 'poimap.json'), 'utf8')
      );
      assertResolvedFc(exportedMapJson.pois[0], 'export map JSON');
      assert.ok(exported.warnings.includes(MISSING_KEY), 'export warnings に missing キーが載るはず: ' + JSON.stringify(exported.warnings));
      assert.equal(exported.warnings.filter((key: string) => key === MISSING_KEY).length, 1, 'export missing 警告キーは1回だけのはず');
      assert.ok(exported.warnings.includes(DUPLICATE_KEY), 'export warnings に duplicate キーが載るはず: ' + JSON.stringify(exported.warnings));
      assert.equal(exported.warnings.filter((key: string) => key === DUPLICATE_KEY).length, 1, 'export duplicate 警告キーは1回だけのはず');
      console.log('ok: (6) exportApp resolves {poiUid} in app/map JSON output with warnings');

      // Write Store 側の POI ソース (内部形) は解決で劣化しない (8桁精度・_maplatUid 維持)
      const afterAll = await PoiSourceService.get(srcUid);
      assert.deepEqual(
        afterAll.fc.features[0].geometry.coordinates,
        [135.12345678, 35.12345678],
        '解決処理は Write Store 内の座標精度を劣化させないはず'
      );
      assert.equal(afterAll.fc.features[0].properties._maplatUid, '11111111-1111-4111-8111-111111111111');
      console.log('ok: (7) resolution does not degrade the Write Store source');

      // --- (8) 非 UUID poiUid → 参照とみなさず生要素として透過。missing 警告も立たない (M4) ---
      const nonUuidElement = { poiUid: 'legacy-not-a-uuid', cachedTitle: '将来拡張の手書き形' };
      const nonUuidResult = await resolvePoisArray([nonUuidElement]);
      assert.deepEqual(
        nonUuidResult.pois, [nonUuidElement],
        '非 UUID poiUid の要素は無加工で透過されるはず: ' + JSON.stringify(nonUuidResult.pois)
      );
      assert.deepEqual(
        nonUuidResult.warnings, [],
        '非 UUID poiUid は参照とみなさないため missing 警告は立たないはず: ' + JSON.stringify(nonUuidResult.warnings)
      );
      console.log('ok: (8) non-UUID poiUid is passed through as a raw element without a missing warning (M4)');

      // --- (9) 同一配列内で同じ uid を複数回参照 → どちらも export 形 FC に解決される ---
      const duplicateUidResult = await resolvePoisArray([
        { poiUid: srcUid, cachedTitle: '京都POI' },
        { poiUid: srcUid, cachedTitle: '京都POI(2回目)' },
      ]);
      assert.equal(duplicateUidResult.pois.length, 2, '同一 uid の重複参照も両方解決されて2件残るはず');
      assertResolvedFc(duplicateUidResult.pois[0], 'duplicate uid [0]');
      assertResolvedFc(duplicateUidResult.pois[1], 'duplicate uid [1]');
      assert.deepEqual(duplicateUidResult.warnings, [], '重複参照だけでは警告は立たないはず');
      console.log('ok: (9) duplicate uid references within the same array both resolve');

      console.log('M10-T1 poi reference resolver smoke passed');
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
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          /^@duckdb\/node-bindings-.*/,
          'jimp',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
        ],
        output: {
          entryFileNames: 'poi-reference-resolver-smoke.mjs',
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
  console.log('M10-T1 poi reference resolver smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
