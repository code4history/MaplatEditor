// m6-t8 スモーク: Mercator Tile Set の生成・TileJSON 出力・書き出し。
// m9/m10/m13系と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ +
// saveFolder=一時dir) で、WmtsGeneratorService.generate() の merc/{targetBaseMapUid} 出力・
// TileJSON生成 (AC1/AC2)、appSourceModel の baseMapUid 導出・EDITOR_ONLY_KEYS strip (AC5/AC6)、
// AppExportService の merc 抽出・コピー・名前衝突診断 (AC7/AC8)、SqliteDataService の
// deleteUserBaseMap merc タイル削除 (AC9)、元地図削除で merc タイルが無傷であること (AC11) を
// behavioral に検証する。
// タスク設計 `docs/superpowers/specs/2026-08-06-m6-t8-merc-tile-set-design.md` §6 準拠。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm6-t8-merc-tile-set-'));
const entryFile = path.join(workDir, 'm6-t8-merc-tile-set-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm6-t8-merc-tile-set-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const wmtsServicePath = path.join(projectRoot, 'electron/services/WmtsGeneratorService.ts');
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
        getName() { return 'MaplatEditorSmoke'; },
        whenReady() { return Promise.resolve(); },
        exit() {},
      };
      export const ipcMain = { handle() {}, removeHandler() {} };
      export const dialog = {
        async showSaveDialog(_win: any, _opts: any) {
          return (globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined };
        },
        async showMessageBox() { return { response: 0 }; },
        async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      };
      export const BrowserWindow = class {
        static fromWebContents() { return { webContents: { send() {} } }; }
        static getAllWindows() { return []; }
      };
      export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
      export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
    `,
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `,
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import fs from 'node:fs/promises';
      import fse from 'fs-extra';
      import AdmZip from 'adm-zip';
      // @ts-ignore
      import Tin from '@maplat/tin';
      import { Jimp } from 'jimp';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: WmtsGeneratorService, resolveMercDecodeOptions } = await import(${JSON.stringify(wmtsServicePath)});
      const { default: AppExportService, MERC_NAME_COLLISION_WARNING } = await import(${JSON.stringify(appExportServicePath)});
      const {
        createAppSourceFromBaseMap,
        normalizeAppSource,
        composeViewerSource,
      } = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/appSourceModel.ts'))});

      await SqliteDataService.getDb();

      // --- 共通フィクスチャ: GCP/Tin (m13-t2 Part H と同一の実測済み値) ---
      const gcps = [
        [[0, 0], [15550000, 4160000]],
        [[400, 0], [15560000, 4160000]],
        [[400, 300], [15560000, 4150000]],
      ];
      const tin = new Tin({ useV2Algorithm: true });
      tin.setWh([400, 300]);
      tin.setStrictMode('strict');
      tin.setVertexMode('plain');
      tin.setPoints(gcps);
      tin.setEdges([]);
      await tin.updateTinAsync();
      const compiled = tin.getCompiled();

      const originalsDir = path.join(${JSON.stringify(dataDir)}, 'originals');
      await fse.ensureDir(originalsDir);
      const testImage = new Jimp({ width: 400, height: 300, color: 0xff0000ff });
      const imageBuffer = await testImage.getBuffer('image/jpeg');

      async function generateMercFor(sourceUid, targetBaseMapUid) {
        await fs.writeFile(path.join(originalsDir, sourceUid + '.jpg'), imageBuffer);
        const result = await WmtsGeneratorService.generate(
          undefined, sourceUid, sourceUid + '-slug', 400, 300, compiled, 'jpg', 'hash-' + targetBaseMapUid, targetBaseMapUid
        );
        assert.equal(result.err, undefined, 'generate() should not error: ' + JSON.stringify(result.err));
        return result;
      }

      // ============================================================
      // (A) WmtsGeneratorService.generate(): merc/{targetBaseMapUid} 出力 + TileJSON (AC1/AC2)
      // ============================================================
      const SRC_MAP_UID = 'aaaaaaaa-1111-4111-8111-111111111111';
      const TARGET_UID_1 = 'bbbbbbbb-1111-4111-8111-111111111111';
      const gen1 = await generateMercFor(SRC_MAP_UID, TARGET_UID_1);
      const mercDir1 = path.join(${JSON.stringify(dataDir)}, 'merc', TARGET_UID_1);
      assert.ok(await fse.pathExists(mercDir1), 'AC1: merc/{targetBaseMapUid} ディレクトリが作られるはず');
      assert.ok(!(await fse.pathExists(path.join(${JSON.stringify(dataDir)}, 'wmts'))), 'AC1: 旧 wmts/ ディレクトリは作られないはず');
      const tileJsonOnDisk = await fse.readJson(path.join(mercDir1, 'tilejson.json'));
      assert.equal(tileJsonOnDisk.tilejson, '3.0.0', 'AC2: TileJSON version は 3.0.0 のはず');
      assert.deepEqual(tileJsonOnDisk.tiles, ['{z}/{x}/{y}.png'], 'AC2: 生成時点の tiles は自己参照の相対パスのはず');
      assert.equal(typeof tileJsonOnDisk.minzoom, 'number');
      assert.equal(typeof tileJsonOnDisk.maxzoom, 'number');
      assert.equal(tileJsonOnDisk.bounds.length, 4, 'AC2: bounds は [west, south, east, north] の4要素のはず');
      const [w, s, e, n] = tileJsonOnDisk.bounds;
      assert.ok(w < e, 'AC2: bounds の west < east のはず');
      assert.ok(s < n, 'AC2: bounds の south < north のはず');
      assert.ok(w > 130 && e < 145, 'AC2: bounds が対象GCP(東経139度付近)の妥当な範囲にあるはず');
      console.log('ok: (A) WmtsGeneratorService.generate(): merc/{targetBaseMapUid} + TileJSON 3.0.0 (AC1/AC2)');

      // ============================================================
      // (B) merc ベースマップ登録 + baseMapUid/url 導出 (AC5) + EDITOR_ONLY_KEYS strip (AC6)
      // ============================================================
      const { uid: registeredUid } = await SqliteDataService.saveUserBaseMap({
        uid: TARGET_UID_1,
        slug: 'merc-source-a',
        create: true,
        tms: {
          kind: 'merc', lang: 'ja', title: { ja: 'メルカトルA' }, label: { ja: 'メルカトルA' },
          attr: { ja: '帰属A' }, dataAttr: {}, license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {},
          url: '', minZoom: gen1.tileJson.minzoom, maxZoom: gen1.tileJson.maxzoom, thumbnail: '',
          coverageLngLats: [[w, s], [e, s], [e, n], [w, n]],
          tileJsonSourceUrl: null, sourceMapUid: SRC_MAP_UID,
        },
      });
      assert.equal(registeredUid, TARGET_UID_1);
      const catalogItem = await SqliteDataService.findBaseMapByUid(TARGET_UID_1);
      assert.equal(catalogItem.data.kind, 'merc');
      assert.equal(catalogItem.data.sourceMapUid, SRC_MAP_UID, 'sourceMapUid が保存されるはず');
      assert.equal(catalogItem.data.url, '', 'merc は url を保存しないはず（読み込み時は常に空文字）');

      // AppEdit.vue addBaseMapSource 相当: item.mapID(=slug) から url を導出し baseMapUid を付与する
      const isMerc = catalogItem.data.kind === 'merc';
      const derivedUrl = isMerc ? \`merc/\${catalogItem.slug}/{z}/{x}/{y}.png\` : undefined;
      const appSource = createAppSourceFromBaseMap(
        { mapID: catalogItem.slug, ...(catalogItem.data || {}), ...(isMerc ? { url: derivedUrl, baseMapUid: catalogItem.uid } : {}) },
        'ja',
      );
      assert.equal(appSource.data.url, 'merc/merc-source-a/{z}/{x}/{y}.png', 'AC5: url は選択時点の slug から導出されるはず');
      assert.equal(appSource.data.baseMapUid, TARGET_UID_1, 'AC5: baseMapUid が付与されるはず');
      console.log('ok: (B) createAppSourceFromBaseMap: merc の url/baseMapUid 導出 (AC5)');

      // normalizeAppSource は内部表現として baseMapUid を保持する（AppExportService が読むため）
      const stored = { sourceType: appSource.sourceType, mapUid: appSource.mapUid, role: appSource.role, data: appSource.data };
      const normalized = normalizeAppSource(stored, 'ja');
      assert.equal(normalized.data.baseMapUid, TARGET_UID_1, 'normalizeAppSource: baseMapUid は内部表現に残るはず（kindと同じ退避パターン）');
      // composeViewerSource（viewer 出力）からは除去される (AC6)
      const viewerOut = composeViewerSource(normalized, { lang: 'ja' });
      assert.equal('baseMapUid' in viewerOut, false, 'AC6: composeViewerSource の出力に baseMapUid が含まれないはず');
      assert.equal('kind' in viewerOut, false, 'AC6 (回帰): kind も除去されるはず（既存挙動）');
      console.log('ok: (B) EDITOR_ONLY_KEYS: baseMapUid は内部表現に残り viewer 出力からのみ除去される (AC6)');

      // ============================================================
      // (C) AppExportService.exportApp(): merc コピー + tiles[] 差し替え (AC7)
      // ============================================================
      const fakeWin = { webContents: { send() {} } };
      const zipPathC = path.join(${JSON.stringify(exportDir)}, 'export-c.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPathC };
      const docC = {
        appID: 'merc_export_c', title: { ja: 'テスト' }, lang: 'ja',
        sources: [stored],
      };
      const exportedC = await AppExportService.exportApp(fakeWin, docC);
      assert.equal(exportedC.result, 'Success', 'exportApp は成功するはず: ' + JSON.stringify(exportedC));
      const zipC = new AdmZip(zipPathC);
      // ズーム/x/yの厳密一致より、ディレクトリ配下にファイルが存在することを確認する(タイル数は非決定)
      const zipEntries = zipC.getEntries().map((e) => e.entryName);
      const mercEntries = zipEntries.filter((name) => name.startsWith('merc/merc-source-a/'));
      assert.ok(mercEntries.length > 1, 'AC7: merc/{アプリソースのurlディレクトリ名}/ 配下にタイル+tilejson.jsonがコピーされるはず: ' + JSON.stringify(mercEntries));
      const tileJsonEntry = zipC.getEntry('merc/merc-source-a/tilejson.json');
      assert.ok(tileJsonEntry, 'AC7: tilejson.json がコピーされるはず');
      const exportedTileJson = JSON.parse(zipC.readAsText(tileJsonEntry));
      assert.deepEqual(exportedTileJson.tiles, ['merc-source-a/{z}/{x}/{y}.png'], 'AC7: tiles[] が書き出し時ディレクトリ名へ差し替わるはず（3者一致）');
      console.log('ok: (C) AppExportService.exportApp: merc/{dirName} コピー + tiles[] 差し替え (AC7)');

      // ============================================================
      // (D) 名前衝突診断: 同一 dirName・異なる baseMapUid は最初の1件のみコピー (AC8)
      // ============================================================
      const TARGET_UID_2 = 'cccccccc-2222-4222-8222-222222222222';
      await generateMercFor(SRC_MAP_UID, TARGET_UID_2);
      const storedDup = {
        sourceType: 'tms', mapUid: 'merc-source-a', role: 'base',
        data: { kind: 'merc', baseMapUid: TARGET_UID_2, url: 'merc/merc-source-a/{z}/{x}/{y}.png', lang: 'ja', title: { ja: 'B' }, label: { ja: 'B' }, attr: { ja: 'b' } },
      };
      const zipPathD = path.join(${JSON.stringify(exportDir)}, 'export-d.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPathD };
      const docD = {
        appID: 'merc_export_d', title: { ja: 'テスト' }, lang: 'ja',
        sources: [stored, storedDup],
      };
      const exportedD = await AppExportService.exportApp(fakeWin, docD);
      assert.equal(exportedD.result, 'Success');
      assert.ok(exportedD.warnings.includes(MERC_NAME_COLLISION_WARNING), 'AC8: 名前衝突で warning が出るはず: ' + JSON.stringify(exportedD.warnings));
      const zipD = new AdmZip(zipPathD);
      const mercEntriesD = zipD.getEntries().map((e) => e.entryName).filter((name) => name.startsWith('merc/merc-source-a/'));
      assert.ok(mercEntriesD.length > 1, 'AC8: 衝突していても最初の1件はコピーされるはず');
      console.log('ok: (D) AppExportService.exportApp: 名前衝突診断 + 最初の1件のみコピー (AC8)');

      // ============================================================
      // (E) SqliteDataService.deleteUserBaseMap: merc タイル削除 (AC9)。他 kind は非発火
      // ============================================================
      assert.ok(await fse.pathExists(mercDir1), '前提: 削除前は merc タイルが存在するはず');
      await SqliteDataService.deleteUserBaseMap(TARGET_UID_1);
      assert.ok(!(await fse.pathExists(mercDir1)), 'AC9: merc ベースマップ削除で merc/{uid} が削除されるはず');

      const { uid: tmsUid } = await SqliteDataService.saveUserBaseMap({
        slug: 'tms-unrelated', create: true,
        tms: { kind: 'tms', lang: 'ja', title: { ja: 'T' }, label: { ja: 'T' }, attr: { ja: 't' }, dataAttr: {}, license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {}, url: 'https://x/{z}/{x}/{y}.png', minZoom: null, maxZoom: null, thumbnail: '', coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null },
      });
      const mercDir2 = path.join(${JSON.stringify(dataDir)}, 'merc', TARGET_UID_2);
      assert.ok(await fse.pathExists(mercDir2), '前提: TARGET_UID_2 の merc タイルはまだ存在するはず');
      await SqliteDataService.deleteUserBaseMap(tmsUid);
      assert.ok(await fse.pathExists(mercDir2), 'AC9: 他 kind (tms) の削除では merc/ に一切触れないはず（無関係な merc タイルが残る）');
      console.log('ok: (E) SqliteDataService.deleteUserBaseMap: merc タイル削除は kind===merc のみ発火 (AC9)');

      // ============================================================
      // (F) 元地図(sourceMapUid の参照先)を削除しても merc タイルは無傷 (AC11)
      // ============================================================
      const { uid: sourceMapForF } = await SqliteDataService.createMap('source-map-f', {
        title: 'Source Map F', gcps: [], edges: [], sub_maps: [],
        strictMode: 'strict', vertexMode: 'plain',
      });
      const TARGET_UID_F = 'dddddddd-3333-4333-8333-333333333333';
      await generateMercFor(sourceMapForF, TARGET_UID_F);
      await SqliteDataService.saveUserBaseMap({
        uid: TARGET_UID_F, slug: 'merc-source-f', create: true,
        tms: { kind: 'merc', lang: 'ja', title: { ja: 'F' }, label: { ja: 'F' }, attr: { ja: 'f' }, dataAttr: {}, license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {}, url: '', minZoom: 0, maxZoom: 1, thumbnail: '', coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: sourceMapForF },
      });
      const mercDirF = path.join(${JSON.stringify(dataDir)}, 'merc', TARGET_UID_F);
      assert.ok(await fse.pathExists(mercDirF), '前提: F の merc タイルが存在するはず');
      const { deleteMapWithTrash } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/MapDeleteTrashService.ts'))});
      await deleteMapWithTrash(sourceMapForF);
      assert.ok(await fse.pathExists(mercDirF), 'AC11: 元地図(sourceMapUid参照先)を削除しても merc/{uid} は無傷のはず');
      const stillRegistered = await SqliteDataService.findBaseMapByUid(TARGET_UID_F);
      assert.ok(stillRegistered, 'AC11: merc ベースマップ自体も削除されないはず（参照整合性を課さない出自メモ）');
      console.log('ok: (F) 元地図削除は merc タイル/ベースマップに一切影響しない (AC11)');

      // ============================================================
      // (G) resolveMercDecodeOptions(): 実装レビュー M-2 — 実サイズ画像での生成失敗の回帰線。
      //     実デコードは不要。SOF ヘッダのみの合成 JPEG で予測・分岐を検証する
      //     （m5-t6-decode-budget-phase-a.mjs の synthSofHeader と同型の技法）
      // ============================================================
      /** SOF ヘッダだけを持つ最小の JPEG 断片を組む（実デコード不要。4:2:0 相当のsampling） */
      function synthSofHeader(w, h, comps, marker = 0xC0) {
        const n = comps.length;
        const segLen = 8 + n * 3;
        const buf = Buffer.alloc(2 + 2 + segLen);
        buf.writeUInt16BE(0xFFD8, 0);
        buf.writeUInt16BE(0xFF00 | marker, 2);
        buf.writeUInt16BE(segLen, 4);
        buf.writeUInt8(8, 6);
        buf.writeUInt16BE(h, 7);
        buf.writeUInt16BE(w, 9);
        buf.writeUInt8(n, 11);
        comps.forEach((c, idx) => {
          const o = 12 + idx * 3;
          buf.writeUInt8(idx + 1, o);
          buf.writeUInt8((c.h << 4) | c.v, o + 1);
          buf.writeUInt8(0, o + 2);
        });
        return buf;
      }
      const YUV420 = [{ h: 2, v: 2 }, { h: 1, v: 1 }, { h: 1, v: 1 }];

      // G-1: レビューが実測した失敗ケース(1)相当（10000x6915, 4:2:0）。
      //      機械の安全キャップを非常に低く設定し、jpeg_machine_limit を固定する
      {
        const buf = synthSofHeader(10000, 6915, YUV420);
        const tinySafety = { heapSizeLimitMB: 100, maxDecoderHeapMB: 1, maxResolutionMP: 1000, maxMemoryMB: 100000 };
        const result = resolveMercDecodeOptions(buf, { maxMemoryUsageInMB: null, maxResolutionInMP: null }, tinySafety);
        assert.equal(result.errorCode, 'jpeg_machine_limit', 'G-1: 機械の安全キャップを超える巨大画像は jpeg_machine_limit を返すはず: ' + JSON.stringify(result));
        assert.ok(result.machine.requiredHeapMB > tinySafety.maxDecoderHeapMB, 'G-1: machine.requiredHeapMB が安全キャップを上回っているはず');
      }
      console.log('ok: (G-1) resolveMercDecodeOptions: 巨大画像は jpeg_machine_limit を返す (M-2回帰)');

      // G-2: レビューが実測した失敗ケース(2)相当（7987x5544, 4:2:0）。機械キャップは十分だが
      //      利用者設定キャップ(小さい値)を超えるため jpeg_memory_limit を固定する
      {
        const buf = synthSofHeader(7987, 5544, YUV420);
        const generousSafety = { heapSizeLimitMB: 100000, maxDecoderHeapMB: 100000, maxResolutionMP: 100000, maxMemoryMB: 100000 };
        const result = resolveMercDecodeOptions(buf, { maxMemoryUsageInMB: 512, maxResolutionInMP: null }, generousSafety);
        assert.equal(result.errorCode, 'jpeg_memory_limit', 'G-2: 設定キャップ(512MB)を超える画像は jpeg_memory_limit を返すはず: ' + JSON.stringify(result));
        assert.equal(result.configuredMB, 512);
        assert.ok(result.prediction.requiredMemoryMB > 512, 'G-2: prediction.requiredMemoryMB が設定キャップを上回っているはず（612〜929MB程度を期待）');
      }
      console.log('ok: (G-2) resolveMercDecodeOptions: 実測失敗ケース(2)相当は jpeg_memory_limit を返す (M-2回帰)');

      // G-3: 解像度キャップ超過は jpeg_resolution_limit を返す
      {
        const buf = synthSofHeader(10000, 6915, YUV420);
        const generousSafety = { heapSizeLimitMB: 100000, maxDecoderHeapMB: 100000, maxResolutionMP: 100000, maxMemoryMB: 100000 };
        const result = resolveMercDecodeOptions(buf, { maxMemoryUsageInMB: null, maxResolutionInMP: 10 }, generousSafety);
        assert.equal(result.errorCode, 'jpeg_resolution_limit', 'G-3: 解像度キャップ(10MP)を超える画像は jpeg_resolution_limit を返すはず: ' + JSON.stringify(result));
        assert.equal(result.configuredMP, 10);
      }
      console.log('ok: (G-3) resolveMercDecodeOptions: 解像度キャップ超過は jpeg_resolution_limit を返す');

      // G-4: キャップ内に収まる画像はエラーを返さず、budget 由来の推奨値を返す
      {
        const buf = synthSofHeader(400, 300, YUV420);
        const generousSafety = { heapSizeLimitMB: 100000, maxDecoderHeapMB: 100000, maxResolutionMP: 100000, maxMemoryMB: 100000 };
        const result = resolveMercDecodeOptions(buf, { maxMemoryUsageInMB: null, maxResolutionInMP: null }, generousSafety);
        assert.equal('errorCode' in result, false, 'G-4: キャップ内の画像はエラーを返さないはず: ' + JSON.stringify(result));
        assert.ok(result.maxMemoryUsageInMB > 0 && result.maxResolutionInMP > 0, 'G-4: 実効デコードオプションが返るはず');
      }
      console.log('ok: (G-4) resolveMercDecodeOptions: キャップ内の画像は budget 由来の推奨値を返す');

      // G-5: JPEG でない（SOF を解析できない）入力は機械の安全枠へフォールバックする（PNG 等）
      {
        const pngLike = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const safety = { heapSizeLimitMB: 1000, maxDecoderHeapMB: 500, maxResolutionMP: 250, maxMemoryMB: 300 };
        const result = resolveMercDecodeOptions(pngLike, { maxMemoryUsageInMB: 10, maxResolutionInMP: 10 }, safety);
        assert.equal('errorCode' in result, false, 'G-5: 非JPEG入力はエラーにならず安全枠へフォールバックするはず');
        assert.equal(result.maxMemoryUsageInMB, safety.maxMemoryMB, 'G-5: 非JPEGは設定キャップではなく機械の安全枠を使うはず（§3.8: PNGはoptions非参照のため無害）');
        assert.equal(result.maxResolutionInMP, safety.maxResolutionMP);
      }
      console.log('ok: (G-5) resolveMercDecodeOptions: 非JPEG入力は機械の安全枠へフォールバックする');

      // ============================================================
      // (H) SqliteDataService.saveUserBaseMap: merc 新規作成時のサムネイル継承 (実装レビュー round3 M-6)
      // ============================================================
      {
        const THUMB_SRC_UID = 'eeeeeeee-4444-4444-8444-444444444444';
        const THUMB_TARGET_UID = 'ffffffff-4444-4444-8444-444444444444';
        const tmbsDir = path.join(${JSON.stringify(dataDir)}, 'tmbs');
        await fse.ensureDir(tmbsDir);
        await fs.writeFile(path.join(tmbsDir, THUMB_SRC_UID + '.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        await fs.writeFile(path.join(tmbsDir, THUMB_SRC_UID + '_512.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

        const savedH = await SqliteDataService.saveUserBaseMap({
          uid: THUMB_TARGET_UID, slug: 'merc-thumb-h', create: true,
          tms: {
            kind: 'merc', lang: 'ja', title: { ja: 'H' }, label: { ja: 'H' },
            attr: { ja: 'h' }, dataAttr: {}, license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {},
            url: '', minZoom: 0, maxZoom: 1, thumbnail: '', coverageLngLats: null,
            tileJsonSourceUrl: null, sourceMapUid: THUMB_SRC_UID,
          },
        });
        assert.equal(savedH.revision, 2, 'M-6: サムネイル継承で行が2回目の更新を受けるはず（revision=2）');
        assert.ok(await fse.pathExists(path.join(tmbsDir, THUMB_TARGET_UID + '.jpg')), 'M-6: 52px サムネイルが own uid 名へ複製されるはず');
        assert.ok(await fse.pathExists(path.join(tmbsDir, THUMB_TARGET_UID + '_512.jpg')), 'M-6: 512px サムネイルも複製されるはず');
        assert.ok(await fse.pathExists(path.join(tmbsDir, THUMB_SRC_UID + '.jpg')), 'M-6: 複製元（元地図側）のファイルは move ではなく copy のため残るはず');
        const catalogH = await SqliteDataService.findBaseMapByUid(THUMB_TARGET_UID);
        assert.equal(catalogH.data.thumbnail, 'tmbs/' + THUMB_TARGET_UID + '.jpg', 'M-6: thumbnail フィールドが own uid 名を指すはず');
        console.log('ok: (H-1) saveUserBaseMap: merc新規作成でサムネイル未指定なら元地図から継承する (M-6)');

        // 明示的に thumbnail が指定されていれば継承は起きない（既存動作を壊さない）
        const THUMB_TARGET_UID_2 = '11111111-4444-4444-8444-444444444444';
        const savedH2 = await SqliteDataService.saveUserBaseMap({
          uid: THUMB_TARGET_UID_2, slug: 'merc-thumb-h2', create: true,
          tms: {
            kind: 'merc', lang: 'ja', title: { ja: 'H2' }, label: { ja: 'H2' },
            attr: { ja: 'h2' }, dataAttr: {}, license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {},
            url: '', minZoom: 0, maxZoom: 1, thumbnail: 'tmbs/custom-explicit.jpg', coverageLngLats: null,
            tileJsonSourceUrl: null, sourceMapUid: THUMB_SRC_UID,
          },
        });
        assert.equal(savedH2.revision, 1, 'M-6: thumbnail 明示指定時は継承処理が起きず revision=1 のままのはず');
        assert.ok(!(await fse.pathExists(path.join(tmbsDir, THUMB_TARGET_UID_2 + '.jpg'))), 'M-6: thumbnail 明示指定時は own uid 名の複製が作られないはず');
        const catalogH2 = await SqliteDataService.findBaseMapByUid(THUMB_TARGET_UID_2);
        assert.equal(catalogH2.data.thumbnail, 'tmbs/custom-explicit.jpg', 'M-6: 明示指定した thumbnail がそのまま保存されるはず');
        console.log('ok: (H-2) saveUserBaseMap: thumbnail 明示指定時は継承しない (M-6)');
      }

      // ============================================================
      // (I) 実装レビュー round3 Minor m-4: WmtsGeneratorService.generate() が
      //     Jimp.fromBuffer を実際に使っていることをソーステキストで固定する。
      //     Part G は純粋関数 resolveMercDecodeOptions() のみを検証しており、呼び出し側
      //     （generate() 本体）を round2 の欠陥形 Jimp.read(imagePath) へ戻しても Part A〜G は
      //     通ってしまう（レビュアーが実証）。m3-t1-poi-source-contract-smoke.mjs の
      //     ソーステキストassert前例に倣う
      // ============================================================
      {
        const serviceSource = await fs.readFile(${JSON.stringify(wmtsServicePath)}, 'utf-8');
        assert.match(serviceSource, /Jimp\\.fromBuffer\\(/, 'm-4: generate() は Jimp.fromBuffer を使うはず');
        assert.doesNotMatch(serviceSource, /Jimp\\.read\\(imagePath\\)/, 'm-4: round2 の欠陥形 Jimp.read(imagePath) が復活していないはず');
        console.log('ok: (I) WmtsGeneratorService.ts: Jimp.fromBuffer 使用をソーステキストで固定 (Minor m-4)');
      }

      console.log('M6-T8 merc tile set smoke passed');
      process.exit(0);
    `,
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
          'adm-zip',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
        ],
        output: { entryFileNames: 'm6-t8-merc-tile-set-smoke.mjs', format: 'es' },
      },
    },
  });

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log(stdout);
  console.log('M6-T8 merc tile set smoke: process exited cleanly');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
