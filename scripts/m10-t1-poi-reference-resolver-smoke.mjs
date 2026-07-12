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
//   ⑥ export 経路: AppExportService.exportApp の実出力 (zip、Phase 8 Task 6) を展開した
//      apps/{appID}.json / maps/{slug}.json の pois が①④と同じ解決結果になり、
//      result.warnings に③④のキーが載る
//   ⑩ icon 参照文法の解決 (POI-117): feature properties.icon='builtin:defaultpin' / layer metadata
//      icon=asset UUID → preview の app JSON で 'imgs/icons/builtin/defaultpin.png' /
//      'imgs/{slug}.{ext}' に書き換わり、その URL を HTTP fetch すると 200 + 実体 (画像バイト)。
//      builtin:defaultpin の実体は Phase 8 Task 4 でビューア標準の png に差し替え済み
//   ⑪ export zip の展開結果に imgs/icons/builtin/defaultpin.png と imgs/{slug}.{ext} が実在し、
//      app JSON の参照がそれを指す
//   ⑫ 未登録 setId ('maki:bank') → 原文維持 + warnings に appedit.warn_unresolved_icon (1回)
//   ⑬ Write Store 内の data_json は参照文法のまま無変化
//   ⑯ favicon/デフォルトアイコン: iconSource 未指定 (fixture に manifestSettings なし = デフォルト
//      SVG 経路) + pwaManifest 有効の export で、zip に favicon.ico (ICO マジック 00 00 01 00) が
//      同梱され、index.html に favicon リンクがあり、manifest の icons が非空。
//      サンドボックス等で Chrome が起動できない場合も jimp フォールバックで同条件を満たす
//   ⑰ 参照要素の title 上書き (GUI 検証 D1): {poiUid, title: LangResource} → 解決後 FC.name が
//      交換形 (compactLangResource collapse) でソース側 title より優先。空 title は上書きなし
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
  const poiReferenceUiPath = path.join(projectRoot, 'src/utils/poiReferenceUi.ts');

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
      // export 先 zip パスを返す (AppExportService.exportApp の zip 保存ダイアログ相当, Phase 8 Task 6)
      export const dialog = {
        showSaveDialog() {
          return Promise.resolve({
            canceled: false,
            filePath: ${JSON.stringify(path.join(exportRoot, 'poi_ref_app.zip'))},
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
      const UNRESOLVED_ICON_KEY = 'appedit.warn_unresolved_icon';
      const MISSING_UID = '99999999-9999-4999-8999-999999999999';

      // --- fixture: image asset (icon の asset UUID 参照先, POI-117) ---
      // ImageAssetService.add は jimp デコードを要するため、DB 行 + 実体ファイルを直接作る
      const assetBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const { uid: assetUid } = await SqliteDataService.createAsset('temple-mark', {
        title: { ja: '寺マーク' },
        mime: 'image/png',
        ext: 'png',
        width: 1,
        height: 1,
        byteSize: assetBytes.length,
      });
      const assetsDir = nodePath.join(${JSON.stringify(dataDir)}, 'assets');
      await (await import('fs-extra')).default.ensureDir(assetsDir);
      await (await import('node:fs/promises')).writeFile(nodePath.join(assetsDir, assetUid + '.png'), assetBytes);

      // --- fixture: 登録 POI ソース (name・8桁精度座標・_maplatUid 付き feature) ---
      // layer metadata icon=asset UUID / feature icon=builtin 参照 / selectedIcon=未登録 setId (⑩⑫)
      const created = await PoiSourceService.createLocal({ slug: 'kyoto-poi', title: '京都POI' });
      assert.equal(created.result, 'Success', 'createLocal は Success のはず: ' + JSON.stringify(created));
      const srcUid = created.uid;
      const saved = await PoiSourceService.save(srcUid, {
        slug: 'kyoto-poi',
        title: '京都POI',
        fc: {
          type: 'FeatureCollection',
          icon: assetUid,
          features: [
            { type: 'Feature', id: 'kinkakuji',
              geometry: { type: 'Point', coordinates: [135.12345678, 35.12345678] },
              properties: { _maplatUid: '11111111-1111-4111-8111-111111111111', name: '金閣寺',
                icon: 'builtin:defaultpin', selectedIcon: 'maki:bank' } },
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
        assert.equal(fc.icon, 'imgs/temple-mark.png',
          label + ': layer metadata の asset UUID 参照が imgs/{slug}.{ext} に解決されるはず (POI-117)');
        assert.equal(fc.features.length, 1);
        const feature = fc.features[0];
        assert.equal(feature.id, 'kinkakuji');
        assert.equal(feature.properties.name, '金閣寺', label + ': feature name も交換形へ collapse されるはず');
        assert.equal(feature.properties.icon, 'imgs/icons/builtin/defaultpin.png',
          label + ': feature の builtin 参照が imgs/icons/{setId}/{iconId}.{ext} (実体 = png) に解決されるはず (POI-117, Phase 8 Task 4)');
        assert.equal(feature.properties.selectedIcon, 'maki:bank',
          label + ': 未登録 setId の参照は原文維持のはず (⑫)');
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

      // --- (10) 解決後の imgs/... URL が preview セッションから実際に配信される (POI-117) ---
      const builtinRes = await fetch(prepared.url + 'imgs/icons/builtin/defaultpin.png');
      assert.equal(builtinRes.status, 200, 'builtin icon の配信は 200 のはず');
      const builtinBody = Buffer.from(await builtinRes.arrayBuffer());
      // PNG シグネチャ (\x89PNG) — defaultpin の実体はビューア標準の png (Phase 8 Task 4)
      assert.ok(builtinBody.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        'builtin icon の中身は PNG のはず: ' + builtinBody.subarray(0, 8).toString('hex'));
      const assetRes = await fetch(prepared.url + 'imgs/temple-mark.png');
      assert.equal(assetRes.status, 200, 'asset icon の配信は 200 のはず');
      const assetBody = Buffer.from(await assetRes.arrayBuffer());
      assert.ok(assetBody.equals(assetBytes), 'asset icon の中身は登録したバイト列のはず');
      console.log('ok: (10) preview serves resolved imgs/... icon URLs with real bytes');

      // --- (12) 未登録 setId → 原文維持 (assertResolvedFc 内) + unresolved 警告キー1回 ---
      assert.ok(prepared.warnings.includes(UNRESOLVED_ICON_KEY),
        'unresolved icon 警告キーが載るはず: ' + JSON.stringify(prepared.warnings));
      assert.equal(
        prepared.warnings.filter((key: string) => key === UNRESOLVED_ICON_KEY).length, 1,
        'unresolved icon 警告キーは1回だけのはず'
      );
      console.log('ok: (12) unregistered icon set stays as-is with a single unresolved warning');

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

      // ⑥ export 経路 (exportApp の実出力 = zip、Phase 8 Task 6)。
      //    生成 zip を展開し、従来のディレクトリ出力と同じアサーションを展開結果へ適用する
      const fakeWin = { webContents: { send() {} } };
      // ⑯ favicon/manifest 検証のため export では pwaManifest を有効化する (preview 側の
      //    fixture 挙動は変えない)。manifestSettings は未指定のまま = デフォルト SVG 経路
      const exportDocument = {
        ...appDocument,
        httpSettings: { ...appDocument.httpSettings, pwaManifest: true },
      };
      const exported = await AppExportService.exportApp(fakeWin as any, exportDocument);
      assert.equal(exported.result, 'Success', 'exportApp は Success のはず: ' + JSON.stringify(exported));
      assert.ok(
        String(exported.outDir).endsWith('poi_ref_app.zip'),
        'Success 時の outDir はダイアログで選んだ zip パスのはず: ' + exported.outDir
      );
      const { default: AdmZip } = await import('adm-zip');
      const exportDir = nodePath.join(${JSON.stringify(workDir)}, 'export-extract');
      new AdmZip(exported.outDir).extractAllTo(exportDir, true);
      const exportedAppJson = JSON.parse(
        await fsReadFile(nodePath.join(exportDir, 'apps', 'poi_ref_app.json'), 'utf8')
      );
      assertResolvedFc(exportedAppJson.pois[0], 'export app JSON');
      assert.equal(exportedAppJson.pois.length, 3, 'export でも missing 参照が落ちて 3 要素のはず');
      assert.equal(exportedAppJson.pois[1], rawUrl, 'export でも生 URL は透過されるはず');
      assert.deepEqual(exportedAppJson.pois[2], rawFc, 'export でも生 FC は無加工透過されるはず');
      const exportedMapJson = JSON.parse(
        await fsReadFile(nodePath.join(exportDir, 'maps', 'poimap.json'), 'utf8')
      );
      assertResolvedFc(exportedMapJson.pois[0], 'export map JSON');
      assert.ok(exported.warnings.includes(MISSING_KEY), 'export warnings に missing キーが載るはず: ' + JSON.stringify(exported.warnings));
      assert.equal(exported.warnings.filter((key: string) => key === MISSING_KEY).length, 1, 'export missing 警告キーは1回だけのはず');
      assert.ok(exported.warnings.includes(DUPLICATE_KEY), 'export warnings に duplicate キーが載るはず: ' + JSON.stringify(exported.warnings));
      assert.equal(exported.warnings.filter((key: string) => key === DUPLICATE_KEY).length, 1, 'export duplicate 警告キーは1回だけのはず');
      console.log('ok: (6) exportApp resolves {poiUid} in app/map JSON output with warnings');

      // --- (11) export zip の展開結果に icon 実体が同梱される (POI-117) ---
      const exportedBuiltin = await fsReadFile(
        nodePath.join(exportDir, 'imgs', 'icons', 'builtin', 'defaultpin.png'));
      assert.ok(exportedBuiltin.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        'export された builtin icon の中身は PNG のはず (Phase 8 Task 4: ビューア標準 png)');
      const exportedAsset = await fsReadFile(nodePath.join(exportDir, 'imgs', 'temple-mark.png'));
      assert.ok(exportedAsset.equals(assetBytes), 'export された asset icon の中身は登録したバイト列のはず');
      // app JSON の参照が同梱ファイルを指すこと (assertResolvedFc で imgs/... 化は確認済み)
      assert.equal(exportedAppJson.pois[0].icon, 'imgs/temple-mark.png');
      assert.equal(exportedAppJson.pois[0].features[0].properties.icon, 'imgs/icons/builtin/defaultpin.png');
      assert.ok(exported.warnings.includes(UNRESOLVED_ICON_KEY),
        'export warnings に unresolved icon キーが載るはず: ' + JSON.stringify(exported.warnings));
      assert.equal(
        exported.warnings.filter((key: string) => key === UNRESOLVED_ICON_KEY).length, 1,
        'export unresolved icon 警告キーは1回だけのはず'
      );
      console.log('ok: (11) exportApp bundles resolved icon files under imgs/');

      // --- (16) favicon.ico / デフォルトアイコン (iconSource 未指定 → 同梱デフォルト SVG 経路) ---
      const faviconIco = await fsReadFile(nodePath.join(exportDir, 'favicon.ico'));
      assert.ok(faviconIco.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])),
        'favicon.ico は ICO マジック (00 00 01 00) で始まるはず: ' + faviconIco.subarray(0, 4).toString('hex'));
      // ICONDIRENTRY のオフセット位置に PNG マジック (PNG-in-ICO)
      const icoImageOffset = faviconIco.readUInt32LE(18);
      assert.ok(
        faviconIco.subarray(icoImageOffset, icoImageOffset + 4)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        'favicon.ico の画像データは PNG のはず'
      );
      const exportedIndexHtml = await fsReadFile(nodePath.join(exportDir, 'index.html'), 'utf8');
      assert.ok(exportedIndexHtml.includes('<link rel="icon" href="favicon.ico">'),
        'index.html に favicon.ico のリンクがあるはず');
      const exportedManifest = JSON.parse(
        await fsReadFile(nodePath.join(exportDir, 'pwa', 'poi_ref_app_manifest.json'), 'utf8')
      );
      assert.ok(Array.isArray(exportedManifest.icons) && exportedManifest.icons.length > 0,
        'manifest の icons はデフォルト経路でも非空のはず: ' + JSON.stringify(exportedManifest.icons));
      for (const icon of exportedManifest.icons) {
        const iconFile = await fsReadFile(nodePath.join(exportDir, ...String(icon.src).split('/')));
        assert.ok(iconFile.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
          'manifest icons の実体 PNG が zip に同梱されるはず: ' + icon.src);
      }
      console.log('ok: (16) exportApp bundles favicon.ico and default-generated manifest icons');

      // (7)+(13) Write Store 側の POI ソース (内部形) は解決で劣化しない (8桁精度・_maplatUid 維持、
      // icon/selectedIcon は参照文法のまま無変化)
      const afterAll = await PoiSourceService.get(srcUid);
      assert.deepEqual(
        afterAll.fc.features[0].geometry.coordinates,
        [135.12345678, 35.12345678],
        '解決処理は Write Store 内の座標精度を劣化させないはず'
      );
      assert.equal(afterAll.fc.features[0].properties._maplatUid, '11111111-1111-4111-8111-111111111111');
      assert.equal(afterAll.fc.icon, assetUid, 'Write Store 内の layer icon は asset UUID のままのはず (⑬)');
      assert.equal(afterAll.fc.features[0].properties.icon, 'builtin:defaultpin',
        'Write Store 内の feature icon は参照文法のままのはず (⑬)');
      assert.equal(afterAll.fc.features[0].properties.selectedIcon, 'maki:bank',
        'Write Store 内の selectedIcon も無変化のはず (⑬)');
      console.log('ok: (7)(13) resolution does not degrade the Write Store source (icons stay in reference form)');

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
      // fixture の selectedIcon='maki:bank' 由来の unresolved icon 警告 (1回) 以外は立たないはず
      assert.deepEqual(
        duplicateUidResult.warnings.filter((key: string) => key !== UNRESOLVED_ICON_KEY), [],
        '重複参照だけでは missing/duplicate 警告は立たないはず'
      );
      assert.equal(
        duplicateUidResult.warnings.filter((key: string) => key === UNRESOLVED_ICON_KEY).length, 1,
        '同一参照の unresolved icon 警告は畳まれて1回のはず'
      );
      console.log('ok: (9) duplicate uid references within the same array both resolve');

      // --- (14) 参照要素の icon/selectedIcon 上書き (Phase 8 Task 2, POI-112 最小形) ---
      // 参照側の上書きが解決後 FC のトップレベル icon/selectedIcon に適用され、ソース側の
      // 既存値 (layer icon=asset UUID → imgs/temple-mark.png) より参照側が勝つ。
      // 上書き値も既存の icon 参照文法解決 (imgs/ 書き換え + files 収集) を通る
      const overrideResult = await resolvePoisArray([
        { poiUid: srcUid, cachedTitle: '京都POI',
          icon: 'builtin:defaultpin-red', selectedIcon: assetUid },
      ]);
      const overriddenFc: any = overrideResult.pois[0];
      assert.equal(overriddenFc.type, 'FeatureCollection', '上書きケースでも FC に解決されるはず');
      assert.equal(
        overriddenFc.icon, 'imgs/icons/builtin/defaultpin-red.svg',
        '参照側 icon 上書きがソース側 layer icon より勝ち、imgs/ へ解決されるはず: ' + overriddenFc.icon
      );
      assert.equal(
        overriddenFc.selectedIcon, 'imgs/temple-mark.png',
        '参照側 selectedIcon 上書き (asset UUID) も imgs/{slug}.{ext} へ解決されるはず: ' + overriddenFc.selectedIcon
      );
      assert.ok(
        overrideResult.files.some((file: any) => file.dest === 'imgs/icons/builtin/defaultpin-red.svg'),
        '上書き icon の実体コピー要求が files に載るはず: ' + JSON.stringify(overrideResult.files)
      );
      assert.ok(
        overrideResult.files.some((file: any) => file.dest === 'imgs/temple-mark.png'),
        '上書き selectedIcon (asset) の実体コピー要求が files に載るはず'
      );
      // feature 側の icon 解決は上書きの影響を受けない
      assert.equal(overriddenFc.features[0].properties.icon, 'imgs/icons/builtin/defaultpin.png');
      // 非文字列/空文字の上書きは無視され、ソース側の値が残る
      const noOverrideResult = await resolvePoisArray([
        { poiUid: srcUid, cachedTitle: '京都POI', icon: '', selectedIcon: 42 },
      ]);
      const noOverrideFc: any = noOverrideResult.pois[0];
      assert.equal(noOverrideFc.icon, 'imgs/temple-mark.png', '空文字 icon 上書きは無視されるはず');
      assert.equal(noOverrideFc.selectedIcon, undefined, '非文字列 selectedIcon 上書きは無視されるはず');
      console.log('ok: (14) reference-level icon/selectedIcon overrides win over source values and resolve');

      // --- (17) 参照要素の title 上書き (GUI 検証 D1) ---
      // 参照側 title (LangResource) が非空なら、toExportForm が FC.name に書くのと同じ交換形
      // (compactLangResource collapse) でソース側 title (FC.name='京都POI') より参照側が勝つ
      const titleOverrideResult = await resolvePoisArray([
        { poiUid: srcUid, cachedTitle: '京都POI', title: { ja: '上書き名' } },
      ]);
      const titleOverriddenFc: any = titleOverrideResult.pois[0];
      assert.equal(titleOverriddenFc.type, 'FeatureCollection', 'title 上書きケースでも FC に解決されるはず');
      assert.equal(
        titleOverriddenFc.name, '上書き名',
        'ja のみの title 上書きは交換形 string に collapse され FC.name を上書きするはず: ' + JSON.stringify(titleOverriddenFc.name)
      );
      assert.equal(titleOverriddenFc.id, 'kyoto-poi', 'title 上書きでも FC.id=slug は不変のはず');
      // 複数言語の上書きは交換形 object のまま
      const multiLangTitleResult = await resolvePoisArray([
        { poiUid: srcUid, title: { ja: '上書き名', en: 'Override Name' } },
      ]);
      assert.deepEqual(
        (multiLangTitleResult.pois[0] as any).name, { ja: '上書き名', en: 'Override Name' },
        '複数言語の title 上書きは交換形 object のまま FC.name に載るはず'
      );
      // 空 title (空文字/空 object) は上書きなし = ソース側 title が残る
      for (const emptyTitle of ['', {}]) {
        const emptyTitleResult = await resolvePoisArray([
          { poiUid: srcUid, title: emptyTitle },
        ]);
        assert.equal(
          (emptyTitleResult.pois[0] as any).name, '京都POI',
          '空 title (' + JSON.stringify(emptyTitle) + ') は上書きなしでソース側 title が残るはず'
        );
      }
      console.log('ok: (17) reference-level title override rewrites FC.name in exchange form (D1)');

      // --- (15) poiReferenceUi.applyPoiSelection が上書きキーを温存する (Phase 8 Task 2) ---
      const { extractPoiRefs, applyPoiSelection } = await import(${JSON.stringify(poiReferenceUiPath)});
      const poisWithOverride = [
        'https://example.com/raw.geojson',
        { poiUid: srcUid, cachedTitle: '京都POI', icon: 'builtin:defaultpin-red', selectedIcon: assetUid,
          title: { ja: '上書き名' } },
        { poiUid: MISSING_UID, cachedTitle: '別参照' },
      ];
      const refs = extractPoiRefs(poisWithOverride);
      assert.equal(refs.length, 2, 'extractPoiRefs は参照2件を復元するはず');
      // 選択維持 (同じ集合を書き戻し) → 上書きキーが温存され、生要素も位置ごと不変
      const kept = applyPoiSelection(poisWithOverride, refs);
      assert.deepEqual(kept, poisWithOverride,
        '選択維持の書き戻しで icon/selectedIcon 上書きキーが温存されるはず: ' + JSON.stringify(kept));
      // 片方を解除 → 残る参照の上書きキーは温存されたまま
      const partial = applyPoiSelection(poisWithOverride, refs.filter((r: any) => r.sourceId === srcUid));
      assert.deepEqual(partial, [poisWithOverride[0], poisWithOverride[1]],
        '解除後も残存参照の上書きキーが温存されるはず: ' + JSON.stringify(partial));
      console.log('ok: (15) applyPoiSelection preserves reference override keys');

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
