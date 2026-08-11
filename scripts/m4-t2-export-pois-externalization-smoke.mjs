// M4-T2 スモーク: export の POI 外部ファイル化 (設計 v1.1)。
// m10-t1 と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// 純関数と AppExportService.exportApp の実出力を behavioral に検証する。
//
// Part A: poiExportFileName の表駆動 (sanitize / 一意化)                                      … AC6
// Part B: externalizePoisArray の要素変換規則 E1〜E7 (設計 §5.2 の正本表)                     … AC3/AC5/AC7/AC8/AC9
// Part C: exportApp の実出力 (zip 展開) — pois/ 実在・両 JSON の参照化・上書き非焼き込み・
//         icon 実体同梱・app と map で1ファイルへ畳む・sanitize が pois/ の外へ出さない        … AC1/AC2/AC3/AC4/AC5/AC6
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm4-t2-export-pois-'));
const entryFile = path.join(workDir, 'm4-t2-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm4-t2-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const exportRoot = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportRoot, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const poiServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const poiReferenceResolverPath = path.join(projectRoot, 'electron/services/poiReferenceResolver.ts');
  const poiExportFileNamePath = path.join(projectRoot, 'src/utils/poiExportFileName.ts');

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
            filePath: ${JSON.stringify(path.join(exportRoot, 'm4t2_app.zip'))},
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
      import { readFile as fsReadFile, readdir as fsReaddir } from 'node:fs/promises';
      import nodePath from 'node:path';

      process.env.APP_ROOT = ${JSON.stringify(projectRoot)};

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: PoiSourceService } = await import(${JSON.stringify(poiServicePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      const {
        externalizePoisArray,
        createPoiExternalizationContext,
      } = await import(${JSON.stringify(poiReferenceResolverPath)});
      const {
        sanitizePoiFileBase,
        reservePoiFileBase,
        POI_FILE_BASE_FALLBACK,
      } = await import(${JSON.stringify(poiExportFileNamePath)});
      await SqliteDataService.getDb();

      const MISSING_KEY = 'appedit.warn_missing_poi_source';
      const MIXED_KEY = 'appedit.warn_mixed_pois';
      const UNRESOLVED_ICON_KEY = 'appedit.warn_unresolved_icon';
      const MISSING_UID = '99999999-9999-4999-8999-999999999999';

      // ============================================================
      // Part A: poiExportFileName の表駆動 (AC6)
      // ============================================================
      assert.equal(POI_FILE_BASE_FALLBACK, 'poi', 'fallback 基底名は poi のはず');
      const sanitizeCases: Array<[unknown, string, string]> = [
        ['kyoto-poi', 'kyoto-poi', '規則を満たす slug は無変更'],
        ['Kyoto_1', 'Kyoto_1', '大文字と _ は保存する (suggestSlug の小文字化を流用しない)'],
        ['../etc/passwd', 'etc-passwd', 'path traversal の . と / が落ちる'],
        ['..', 'poi', '. のみは全除去 → fallback'],
        ['a/b', 'a-b', '/ はハイフンへ'],
        ['京都POI', 'POI', '非 ASCII は除去され残りが基底名になる'],
        ['京都', 'poi', '全除去 → fallback'],
        ['', 'poi', '空文字は fallback'],
        ['--a--', 'a', '前後のハイフンを除去'],
        ['a--b', 'a-b', '連続ハイフンを畳む'],
        ['a'.repeat(150), 'a'.repeat(100), '100 字へ切り詰め (SLUG_MAX)'],
        [('b'.repeat(99) + '/c'), 'b'.repeat(99) + '-', 'DUMMY'],
        [null, 'poi', '非文字列は fallback'],
        [123, 'poi', '非文字列は fallback'],
        [undefined, 'poi', '非文字列は fallback'],
      ];
      for (const [input, expected, label] of sanitizeCases) {
        if (label === 'DUMMY') continue; // 切り詰め後の末尾ハイフンは下で個別検証する
        assert.equal(sanitizePoiFileBase(input), expected,
          'sanitizePoiFileBase(' + JSON.stringify(input) + ') = ' + expected + ' — ' + label);
      }
      // 切り詰めで末尾がハイフンになった場合も除去する (pois/xxx-.geojson を作らない)
      assert.equal(sanitizePoiFileBase('b'.repeat(99) + '/c'), 'b'.repeat(99),
        '100 字切り詰めで末尾に残ったハイフンも落とすはず');
      assert.match(sanitizePoiFileBase('../../x'), /^[A-Za-z0-9_-]+$/,
        'sanitize 後は必ず SLUG_PATTERN を満たすはず');

      const taken = new Set<string>();
      assert.equal(reservePoiFileBase('x', taken), 'x', '1件目は base そのもの');
      // M5-T5: 生成部は必ず "-" 始まり（正本 slugCandidate の規則変更に追随）
      assert.equal(reservePoiFileBase('x', taken), 'x-2', '2件目は base-2');
      assert.equal(reservePoiFileBase('x', taken), 'x-3', '3件目は base-3');
      assert.equal(reservePoiFileBase('y', taken), 'y', '別 base は影響を受けない');
      assert.deepEqual([...taken].sort(), ['x', 'x-2', 'x-3', 'y'], '確保した名前が taken に記録される');
      const exhausted = new Set<string>();
      for (let n = 1; n <= 100; n++) assert.ok(reservePoiFileBase('z', exhausted) !== null);
      assert.equal(reservePoiFileBase('z', exhausted), null, '101 件目は枯渇して null');
      console.log('ok: (A) poiExportFileName sanitize/unique table');

      // ============================================================
      // fixture
      // ============================================================
      const assetBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const { uid: assetUid } = await SqliteDataService.createAsset('temple-mark', {
        lang: 'ja', title: { ja: '寺マーク' }, mime: 'image/png', ext: 'png',
        width: 1, height: 1, byteSize: assetBytes.length,
      });
      const assetsDir = nodePath.join(${JSON.stringify(dataDir)}, 'assets');
      const fsExtra = (await import('fs-extra')).default;
      await fsExtra.ensureDir(assetsDir);
      await fsExtra.writeFile(nodePath.join(assetsDir, assetUid + '.png'), assetBytes);

      function fcOf(id: string, name: string) {
        return {
          type: 'FeatureCollection',
          id,
          name,
          features: [
            { type: 'Feature', id: 'f1',
              geometry: { type: 'Point', coordinates: [135.0, 35.0] },
              properties: { name: name + 'の点' } },
          ],
        };
      }

      // POI ソース A (icon にビルトイン参照・title 付き)
      const createdA = await PoiSourceService.createLocal({
        slug: 'kyoto-poi', title: { ja: '京都POI' }, lang: 'ja',
        fc: { ...fcOf('kyoto-poi', '京都POI'), icon: 'builtin:defaultpin' },
      });
      assert.equal(createdA.result, 'Success', 'POI ソース A の作成: ' + JSON.stringify(createdA));
      const uidA = createdA.uid;
      // POI ソース B
      const createdB = await PoiSourceService.createLocal({
        slug: 'nara-poi', title: { ja: '奈良POI' }, lang: 'ja', fc: fcOf('nara-poi', '奈良POI'),
      });
      assert.equal(createdB.result, 'Success', 'POI ソース B の作成: ' + JSON.stringify(createdB));
      const uidB = createdB.uid;

      // ============================================================
      // Part B: externalizePoisArray の要素変換規則 (設計 §5.2 の E1〜E7)
      // ============================================================
      {
        const ctx = createPoiExternalizationContext();
        const rawFc = fcOf('embedded-raw', '生FC');
        const result = await externalizePoisArray(
          [
            // E1: 参照 + 上書き4種 (icon は asset UUID = 参照文法)
            { poiUid: uidA, cachedTitle: '京都POI', hide: true, title: { ja: '差替タイトル' },
              icon: assetUid, selectedIcon: 'builtin:defaultpin' },
            // E2: 生 FC
            rawFc,
            // E3: 裸 URL 文字列
            'https://example.com/pois.geojson',
            // E4: layer が文字列のラッパー
            { layer: 'pois/hand-written.geojson', hide: true },
            // E7: 解決できない poiUid
            { poiUid: MISSING_UID },
          ],
          ctx,
        );

        // --- E1 ---
        const w0: any = result.pois[0];
        assert.deepEqual(Object.keys(w0).sort(), ['hide', 'icon', 'layer', 'selectedIcon', 'title'],
          'E1: wrapper は layer + 有効な上書きのみを持つ (cachedTitle は出力しない): ' + JSON.stringify(w0));
        assert.equal(w0.layer, 'pois/kyoto-poi.geojson', 'E1: layer は pois/<slug>.geojson');
        assert.equal(w0.hide, true, 'E1: hide が wrapper に載る');
        assert.equal(w0.title, '差替タイトル', 'E1: title が交換形 collapse で wrapper に載る');
        assert.equal(w0.icon, 'imgs/temple-mark.png',
          'E1: wrapper の icon は asset UUID が imgs/<slug>.<ext> へ解決されるはず (§5.4 の落とし穴)');
        assert.equal(w0.selectedIcon, 'imgs/icons/builtin/defaultpin.png',
          'E1: wrapper の selectedIcon も icon set 参照が解決されるはず');
        assert.ok(result.files.some((f: any) => f.dest === 'imgs/temple-mark.png'),
          'E1: wrapper icon の実体コピー要求が files に載るはず');

        // --- 外部ファイル側に上書きが焼き込まれていない (AC3) ---
        const docA = result.documents.find((d: any) => d.dest === 'pois/kyoto-poi.geojson');
        assert.ok(docA, '外部ファイル pois/kyoto-poi.geojson が documents に載るはず');
        assert.equal(docA.json.type, 'FeatureCollection');
        assert.equal(docA.json.id, 'kyoto-poi', '外部ファイルの FC.id は slug のまま');
        assert.equal(docA.json.name, '京都POI',
          '外部ファイルの name はソース側の title のまま (上書き title を焼き込まない)');
        assert.equal(docA.json.properties?.hide, undefined,
          '外部ファイルに hide が焼き込まれていないはず');
        assert.equal(docA.json.properties?.icon, 'imgs/icons/builtin/defaultpin.png',
          'ソース側 FC 自身の icon 参照は従来どおり解決される (上書き icon で置き換えない)');

        // --- E2 ---
        const w1: any = result.pois[1];
        assert.deepEqual(w1, { layer: 'pois/embedded-raw.geojson' }, 'E2: 生 FC も外部化される');
        assert.ok(result.documents.some((d: any) => d.dest === 'pois/embedded-raw.geojson'),
          'E2: 生 FC の実体が documents に載るはず');

        // --- E3 ---
        assert.deepEqual(result.pois[2], { layer: 'https://example.com/pois.geojson' },
          'E3: 裸 URL 文字列は {layer:URL} へ包む (配列要素位置の viewer 判別欠陥を出力側で回避)');

        // --- E4 ---
        assert.deepEqual(result.pois[3], { layer: 'pois/hand-written.geojson', hide: true },
          'E4: layer が文字列のラッパーは素通し');

        // --- E7 ---
        assert.equal(result.pois.length, 4, 'E7: 解決できない参照は要素ごと落ちる');
        assert.equal(result.warnings.filter((k: string) => k === MISSING_KEY).length, 1,
          'E7: missing 警告は1回だけ');

        // --- インライン FC が出力に一切現れない (AC1 の関数版) ---
        for (const entry of result.pois) {
          assert.notEqual((entry as any)?.type, 'FeatureCollection',
            '出力 pois にインライン FC が残ってはいけない: ' + JSON.stringify(entry));
        }
        console.log('ok: (B1) externalizePoisArray element rules E1-E4/E7');
      }

      // --- E5: layer が FC のラッパー ---
      {
        const ctx = createPoiExternalizationContext();
        const result = await externalizePoisArray(
          [{ layer: fcOf('wrapped-fc', '包まれたFC'), hide: true, title: { ja: '包み差替' } }],
          ctx,
        );
        assert.deepEqual(result.pois[0], {
          layer: 'pois/wrapped-fc.geojson', hide: true, title: '包み差替',
        }, 'E5: layer が FC のラッパーは実体を外部化し layer を URL へ差し替える');
        assert.ok(result.documents.some((d: any) => d.dest === 'pois/wrapped-fc.geojson'),
          'E5: 包まれた FC の実体が documents に載るはず');
        console.log('ok: (B2) externalizePoisArray E5 (wrapper with FC layer)');
      }

      // --- E6: レガシー POI object はそのまま透過 / 混在判定は解決後基準を維持 ---
      {
        const ctx = createPoiExternalizationContext();
        const legacy = { name: '素のPOI', lat: 35, lng: 135 };
        const mixed = await externalizePoisArray([legacy, { poiUid: uidA }], ctx);
        assert.deepEqual(mixed.pois[0], legacy, 'E6: レガシー POI object は無加工透過');
        assert.ok(mixed.warnings.includes(MIXED_KEY),
          'レガシー object + 参照 の混在は従来どおり警告されるはず');

        const ctx2 = createPoiExternalizationContext();
        const notMixed = await externalizePoisArray([{ poiUid: uidA }, fcOf('raw2', '生2')], ctx2);
        assert.ok(!notMixed.warnings.includes(MIXED_KEY),
          '参照 + 生 FC は解決後どちらも FC なので混在警告を出さない (現行契約の維持)');
        console.log('ok: (B3) externalizePoisArray E6 / mixed warning parity');
      }

      // --- 畳み込み: 同一 uid を複数回参照しても外部ファイルは1つ (AC5) ---
      {
        const ctx = createPoiExternalizationContext();
        const first = await externalizePoisArray([{ poiUid: uidA, hide: true }], ctx);
        const second = await externalizePoisArray([{ poiUid: uidA }, { poiUid: uidB }], ctx);
        assert.equal((first.pois[0] as any).layer, 'pois/kyoto-poi.geojson');
        assert.equal((second.pois[0] as any).layer, 'pois/kyoto-poi.geojson',
          '別の呼び出しでも同一 uid は同じ dest を指すはず');
        assert.equal((second.pois[0] as any).hide, undefined,
          '畳んでも上書きは参照ごとに独立するはず');
        assert.equal((first.pois[0] as any).hide, true);
        const dests = second.documents.map((d: any) => d.dest).sort();
        assert.deepEqual(dests, ['pois/kyoto-poi.geojson', 'pois/nara-poi.geojson'],
          'documents は ctx 全体で一意 (同一 uid が2ファイルにならない)');
        console.log('ok: (B4) externalizePoisArray dedupes by poiUid across calls');
      }

      // --- sanitize と一意化 (AC6) ---
      // 【実測 2026-08-02】POI ソースの slug は SqliteDataService.registerAsset が
      // isValidSlug (= SLUG_PATTERN) で弾くため、危険な slug は DB に入らない。
      // ∴ 実際の攻撃面は **生 FC / ラッパーの FC.id** — これは利用者が raw JSON で書ける
      // 任意の文字列で、DB の検査を一切通らずに外部ファイル名の基底になる。
      {
        const rejected = await PoiSourceService.createLocal({
          slug: '../evil', title: { ja: '危険' }, lang: 'ja', fc: fcOf('x', '危険'),
        });
        assert.notEqual(rejected.result, 'Success',
          'POI ソース slug は DB 層 (registerAsset → isValidSlug) が弾くはず: ' + JSON.stringify(rejected));

        const ctx = createPoiExternalizationContext();
        const result = await externalizePoisArray(
          [
            fcOf('../../etc/passwd', 'traversal'),          // 生 FC の id は無検査 = 真の攻撃面
            { layer: fcOf('/abs/path', 'wrapped traversal') }, // ラッパー内 FC も同じ
            { type: 'FeatureCollection', properties: { id: 'a/b' }, features: [] }, // properties.id 側
          ],
          ctx,
        );
        const dests = result.pois.map((p: any) => p.layer);
        assert.deepEqual(dests,
          ['pois/etc-passwd.geojson', 'pois/abs-path.geojson', 'pois/a-b.geojson'],
          '生 FC / ラッパー FC の id は sanitize されて pois/ の外へ出ないはず: ' + JSON.stringify(dests));
        for (const dest of dests) {
          assert.ok(!dest.includes('..'), 'dest に .. が残ってはいけない: ' + dest);
          assert.match(dest, /^pois\\/[A-Za-z0-9_-]+\\.geojson$/, 'dest は pois/<SLUG_PATTERN>.geojson のはず: ' + dest);
        }
        console.log('ok: (B5) untrusted FC ids are sanitized at output');
      }

      // --- 衝突時の連番一意化 (AC6)。POI ソース slug 同士は DB が一意にするため、
      //     実際に衝突し得るのは「生 FC の id 同士」「生 FC の id と POI ソース slug」 ---
      {
        const ctx = createPoiExternalizationContext();
        const result = await externalizePoisArray(
          [
            { poiUid: uidA },                 // pois/kyoto-poi.geojson
            fcOf('kyoto-poi', '同名の生FC'),   // 衝突 → 連番
            fcOf('kyoto/poi', 'sanitize後に衝突'), // 'kyoto-poi' へ潰れてさらに衝突
          ],
          ctx,
        );
        assert.deepEqual(result.pois.map((p: any) => p.layer), [
          'pois/kyoto-poi.geojson', 'pois/kyoto-poi-2.geojson', 'pois/kyoto-poi-3.geojson',
        ], '基底名の衝突は連番で一意化されるはず');
        assert.equal(result.documents.length, 3, '3件とも別ファイルとして書き出されるはず');
        console.log('ok: (B6) file base collisions are made unique by sequence');
      }

      // ============================================================
      // Part C: exportApp の実出力 (AC1/AC2/AC3/AC4/AC5)
      // ============================================================
      const { uid: mapUid } = await SqliteDataService.createMap('m4t2map', {
        title: { ja: 'm4t2地図' },
        // app と同じ POI ソース A を参照する (AC5: 1ファイルへ畳む)
        pois: [{ poiUid: uidA, hide: true }],
      });
      assert.ok(mapUid, '地図 fixture の作成');

      const appDocument = {
        appID: 'm4t2_app',
        title: { ja: 'm4t2アプリ' },
        lang: 'ja',
        sources: [
          { sourceType: 'maplat', mapID: 'm4t2map', role: 'maplat', startFrom: true,
            data: { mapID: 'm4t2map', maptype: 'maplat', noload: true } },
        ],
        httpSettings: { previewPort: 43191 },
        appSettings: { homeLng: 135.05, homeLat: 35.05, defaultZoom: 15 },
        startFrom: 'm4t2map',
        pois: [
          { poiUid: uidA, title: { ja: 'アプリ側差替' }, icon: assetUid },
          { poiUid: uidB },
          'https://example.com/external.geojson',
        ],
      };

      const fakeWin = { webContents: { send() {} } };
      const exported = await AppExportService.exportApp(fakeWin as any, appDocument);
      assert.equal(exported.result, 'Success', 'exportApp は Success のはず: ' + JSON.stringify(exported));
      const { default: AdmZip } = await import('adm-zip');
      const exportDir = nodePath.join(${JSON.stringify(workDir)}, 'export-extract');
      new AdmZip(exported.outDir).extractAllTo(exportDir, true);

      // --- AC1: apps/{appID}.json ---
      const appJson = JSON.parse(await fsReadFile(nodePath.join(exportDir, 'apps', 'm4t2_app.json'), 'utf8'));
      assert.equal(appJson.pois.length, 3);
      for (const entry of appJson.pois) {
        assert.notEqual(entry?.type, 'FeatureCollection',
          'app JSON にインライン FC が残ってはいけない: ' + JSON.stringify(entry));
        assert.equal(typeof entry?.layer, 'string',
          'app JSON の pois 要素は {layer:...} 形のはず: ' + JSON.stringify(entry));
      }
      assert.equal(appJson.pois[0].layer, 'pois/kyoto-poi.geojson');
      assert.equal(appJson.pois[0].title, 'アプリ側差替', 'app 側の title 上書きが wrapper に載る');
      assert.equal(appJson.pois[0].icon, 'imgs/temple-mark.png',
        'app 側の icon 上書きが imgs/ へ解決されて wrapper に載る (AC4)');
      assert.equal(appJson.pois[1].layer, 'pois/nara-poi.geojson');
      assert.deepEqual(appJson.pois[2], { layer: 'https://example.com/external.geojson' });

      // --- AC2: maps/{slug}.json ---
      // M5-T4B: **地図 JSON は搬出種別を問わず minify** である。
      // マイルストーン設計 I-5 は「アプリ JSON は pretty / 地図 ZIP の maps/<slug>.json は minify」と
      // **パッケージ単位**で書かれていたが、人間の指示は m5-t4 再設計時から一貫して
      // 「地図 JSON は minify」という **内容種別単位**であった（2026-08-03 に指摘・訂正）。
      // アプリ ZIP の中の地図 JSON も同じ扱いにする（地図データは容量が大きくなりやすい）。
      // pretty のままにするのは手編集用途の apps/<appID>.json と pois/*.geojson である。
      const mapJsonText = await fsReadFile(nodePath.join(exportDir, 'maps', 'm4t2map.json'), 'utf8');
      // minify 判定はエスケープに頼らず「正規の minify 直列化と一致するか」で見る
      // （fs-extra は末尾へ改行を足すため trim してから比べる）
      const isMinified = (text: string) => text.trim() === JSON.stringify(JSON.parse(text));
      assert.ok(
        isMinified(mapJsonText),
        'M5-T4B: アプリ ZIP の maps/<slug>.json も minify のはず: '
          + JSON.stringify(mapJsonText.slice(0, 120)),
      );
      // pretty 側は **2-space** で固定する（2026-08-03 人間指示）。
      // POI 単体パッケージの搬出（PoiPackageService:90,93）が既に 2-space であり、
      // アプリ ZIP の pois/*.geojson だけ 4-space だったのを揃える
      const prettyWith = (text: string, indent: number) =>
        text.trim() === JSON.stringify(JSON.parse(text), null, indent);
      const appJsonText = await fsReadFile(nodePath.join(exportDir, 'apps', 'm4t2_app.json'), 'utf8');
      assert.ok(
        prettyWith(appJsonText, 2),
        'M5-T4B: apps/<appID>.json は 2-space pretty のはず: '
          + JSON.stringify(appJsonText.slice(0, 120)),
      );
      const poiDocText = await fsReadFile(nodePath.join(exportDir, 'pois', 'kyoto-poi.geojson'), 'utf8');
      assert.ok(
        prettyWith(poiDocText, 2),
        'M5-T4B: pois/*.geojson は 2-space pretty のはず（POI 単体搬出と同じ）: '
          + JSON.stringify(poiDocText.slice(0, 120)),
      );
      const mapJson = JSON.parse(mapJsonText);
      assert.equal(mapJson.pois.length, 1);
      assert.notEqual(mapJson.pois[0]?.type, 'FeatureCollection',
        'map JSON にインライン FC が残ってはいけない');
      assert.equal(mapJson.pois[0].layer, 'pois/kyoto-poi.geojson',
        'map JSON も同じ外部ファイルを参照するはず (AC5)');
      assert.equal(mapJson.pois[0].hide, true, 'map 側の hide 上書きが wrapper に載る');

      // --- AC1: pois/ の実体 ---
      const poiFiles = (await fsReaddir(nodePath.join(exportDir, 'pois'))).sort();
      assert.deepEqual(poiFiles, ['kyoto-poi.geojson', 'nara-poi.geojson'],
        'app と map が同じソースを参照しても外部ファイルは1つに畳まれるはず (AC5): ' + poiFiles.join(','));
      const poiFileA = JSON.parse(
        await fsReadFile(nodePath.join(exportDir, 'pois', 'kyoto-poi.geojson'), 'utf8'));
      assert.equal(poiFileA.type, 'FeatureCollection');
      assert.equal(poiFileA.id, 'kyoto-poi');
      assert.equal(poiFileA.name, '京都POI',
        '外部ファイルの name はソース側のまま (app 側の title 上書きを焼き込まない — AC3)');
      assert.equal(poiFileA.properties?.hide, undefined,
        '外部ファイルに map 側の hide が焼き込まれていないはず (AC3)');
      assert.equal(poiFileA.properties?.icon, 'imgs/icons/builtin/defaultpin.png',
        '外部ファイル内の icon 参照は従来どおり imgs/ へ解決されるはず');
      assert.equal(poiFileA.features[0].properties.name, '京都POIの点');

      // --- AC4: icon 実体の同梱 ---
      const bundledAsset = await fsReadFile(nodePath.join(exportDir, 'imgs', 'temple-mark.png'));
      assert.ok(bundledAsset.equals(assetBytes), 'wrapper icon の実体が zip に同梱されるはず');
      const bundledBuiltin = await fsReadFile(
        nodePath.join(exportDir, 'imgs', 'icons', 'builtin', 'defaultpin.png'));
      assert.ok(bundledBuiltin.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        '外部ファイル内 icon の実体も従来どおり同梱されるはず');
      console.log('ok: (C) exportApp externalizes pois into pois/*.geojson');

      // ============================================================
      // Part D: 単独形の文書が export に出る (M4-T4 AC16)
      // ------------------------------------------------------------
      // M4-T4 で readAppDocumentPois が単独形（レイヤ1つを配列に包まず直接置く形）を
      // supported にしたことの **副次効果**。export / preview / 診断はいずれも
      // readAppDocumentPois(document).pois を受け取るため、現行まで Array.isArray の判定に
      // 落ちて無視されていた単独形の POI が出力されるようになる。t2/t3 の出力契約
      // （配列 + ラッパー参照）に沿った形になることをここで確定させる。
      // ============================================================
      {
        const { uid: soloMapUid } = await SqliteDataService.createMap('m4t2solo', {
          title: { ja: 'm4t2単独形地図' },
          pois: 'https://example.com/solo-pois.geojson',   // 実データ maps/morioka.json と同形
        });
        assert.ok(soloMapUid, '単独形 map fixture の作成');

        const soloApp = {
          appID: 'm4t2_solo_app',
          title: { ja: 'm4t2単独形アプリ' },
          lang: 'ja',
          sources: [
            { sourceType: 'maplat', mapID: 'm4t2solo', role: 'maplat', startFrom: true,
              data: { mapID: 'm4t2solo', maptype: 'maplat', noload: true } },
          ],
          httpSettings: { previewPort: 43192 },
          appSettings: { homeLng: 135.05, homeLat: 35.05, defaultZoom: 15 },
          startFrom: 'm4t2solo',
          pois: { layer: 'https://example.com/solo-app-pois.geojson', hide: true },
        };
        const soloResult: any = await AppExportService.exportApp(fakeWin as any, soloApp);
        assert.ok(soloResult && soloResult.result === 'Success',
          'AC16: 単独形の文書でも export が成功する: ' + JSON.stringify(soloResult));
        const soloDir = nodePath.join(${JSON.stringify(workDir)}, 'export-extract-solo');
        new AdmZip(soloResult.outDir).extractAllTo(soloDir, true);
        const soloAppJson = JSON.parse(await fsReadFile(nodePath.join(soloDir, 'apps', 'm4t2_solo_app.json'), 'utf8'));
        assert.deepEqual(
          soloAppJson.pois,
          [{ layer: 'https://example.com/solo-app-pois.geojson', hide: true }],
          'AC16: 単独形の上書きレイヤが配列1件として出力される（t2 の出力契約と同形）',
        );
        const soloMapJson = JSON.parse(await fsReadFile(nodePath.join(soloDir, 'maps', 'm4t2solo.json'), 'utf8'));
        assert.deepEqual(
          soloMapJson.pois,
          [{ layer: 'https://example.com/solo-pois.geojson' }],
          'AC16: 単独形の裸 URL も配列要素位置ではラッパーへ包まれる（t2 の E3）',
        );
        console.log('ok: (D) single-layer-form documents now reach the export output (M4-T4 AC16)');
      }

      console.log('m4-t2 export pois externalization smoke passed');
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
        output: { entryFileNames: 'm4-t2-smoke.mjs', format: 'es' },
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
