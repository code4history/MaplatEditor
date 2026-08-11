// M5-T3 スモーク: url_ 導出の二重実装の一本化
//
// なぜ必要か（設計書 §2.1）:
//   url_（ランタイム専用の導出値）を作る実装が2箇所に分かれ、互いに5軸で異なる挙動をしていた。
//     A whReady ガード      : MapEditService はあり / DataUploadService はなし
//     B json.url の優先     : MapEditService はあり / DataUploadService は完全に無視
//     C URL 組み立て        : MapEditService は fileUrl() / DataUploadService は手組み（エンコードなし）
//     D 置換の正規表現      : MapEditService は末尾アンカーあり / DataUploadService はなし
//     E store2HistMap の引数: MapEditService は byCompiled=true / DataUploadService は既定 false
//   DataUploadService.ts:74 のコメントは自ら「原版の normalizeRequestData 相当」と名乗っており、
//   二重実装は意図された分岐ではなく移植時に本体を呼ばずに書き写した結果である。
//
// 是正の形（設計書 §3）:
//   軸 B・C・D（url_ 導出そのもの）だけを deriveRuntimeTileUrl() へ切り出し、両者が呼ぶ。
//   軸 E は両経路とも byCompiled=true（消費側 renderer が Tin.setCompiled() へ渡す生 Compiled 形を要求）。
//   軸 A は import へ導入しない（持ち込むと renderer が期待する histMap 形式と食い違う）。
//
// 検証方式:
//   既存 smoke（m5-t1 / m13-t1）と同じサンドボックス方式
//   （vite SSR ビルド + electron / electron-store スタブ + 一時 saveFolder/tmpFolder）で
//   DataUploadService / MapEditService を実走させる。
//
// 受け入れ条件との対応:
//   AC1 : 外部URL かつ ローカルタイルの地図 → import/保存/再読込/搬出のすべてで url が外部URLのまま
//   AC2 : import 後の DB と搬出 zip の双方に url_ キーが現れない（不変条件 I-2）
//   AC3 : import 直後と再読込後で url_ の導出結果が一致する【RED 対象・二重実装解消の本丸】
//   AC4 : 空白と非 ASCII を含む保存フォルダで fileUrl() 側（percent-encoding あり）へ揃う
//   AC5 : ローカルタイルのみ（url 空）→ import 直後の url_ が自 uid のタイルを指す（非回帰）
//   AC6 : compiled を持つ層の tins 要素が生 Compiled 形【RED 対象】
//   AC10: byCompiled の切替でメタデータが変わらない（Transform 経由の読みと等価）
//   AC11: MapEditService の whReady 早期 return は無変更 / extractZip はガードを持ち込まない
//   AC12: compiled を持たない層は文字列 sentinel。renderer は setCompiled を呼ばず保持する
//   AC13: byCompiled の false/true で sentinel が同一（no-compiled 層は影響を受けない）
//   AC14: whReady が import 経路で偽になり得るかの実測
//   AC15: Compiled と sentinel が混在する tins の分別処理と並び順
//   （AC7 はソース確認・AC8/AC9 は別コマンドのため本 smoke の対象外）
//
// 参照: docs/superpowers/specs/2026-08-03-m5-t3-url-derivation-unification-design.md
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t3-url-derivation-'));
const entryFile = path.join(workDir, 'm5-t3-url-derivation-unification-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm5-t3-url-derivation-unification-smoke.mjs');

try {
  // AC4: 保存フォルダのパスに**空白と非 ASCII**を含める。
  // 手組み（split(path.sep).join('/')）は percent-encoding しないため、
  // fileUrl() 側と異なる URL を生成する。統一後は fileUrl() 側に揃う
  const dataDir = path.join(workDir, 'データ folder');
  const tmpDir = path.join(workDir, 'tmp');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');
  const dataUploadServicePath = path.join(projectRoot, 'electron/services/DataUploadService.ts');
  const storeHandlerPath = path.join(projectRoot, 'electron/utils/store_handler.ts');
  const runtimeTileUrlPath = path.join(projectRoot, 'electron/utils/runtimeTileUrl.ts');
  const mapeditIpcPath = path.join(projectRoot, 'electron/ipc/mapedit.ts');

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
        getName() { return 'MaplatEditorSmoke'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const ipcMain = {
        handle: (ch: string, fn: any) => handlers.set(ch, fn),
        removeHandler: (ch: string) => handlers.delete(ch),
      };
      export const dialog = {
        async showSaveDialog() {
          return (globalThis as any).__nextSaveDialog || { canceled: true, filePath: undefined };
        },
        async showOpenDialog() { return { canceled: true, filePaths: [] }; },
        async showMessageBox() { return { response: 0 }; },
      };
      export const BrowserWindow = class {
        static fromWebContents() { return { webContents: { send() {} } }; }
        static getAllWindows() { return []; }
      };
      export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
      export const shell = { trashItem(_p: string) { return Promise.resolve(); } };
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
      import fsp from 'node:fs/promises';
      import fse from 'fs-extra';
      import AdmZip from 'adm-zip';
      import fileUrl from 'file-url';
      import { Transform } from '@maplat/transform';

      const EXT_URL = 'https://t.example.jp/ext/{z}/{x}/{y}.jpg';
      const dataDir = ${JSON.stringify(dataDir)};
      const tmpDir = ${JSON.stringify(tmpDir)};
      const exportDir = ${JSON.stringify(exportDir)};

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('tmpFolder', tmpDir);

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      const { default: DataUploadService } = await import(${JSON.stringify(dataUploadServicePath)});
      const storeHandler = await import(${JSON.stringify(storeHandlerPath)});
      const { deriveRuntimeTileUrl } = await import(${JSON.stringify(runtimeTileUrlPath)});
      const { registerMapEditHandlers } = await import(${JSON.stringify(mapeditIpcPath)});
      const { __handlers } = await import(${JSON.stringify(electronStubFile)});
      await SqliteDataService.getDb();
      registerMapEditHandlers();
      const downloadSaved = __handlers.get('mapedit:download-saved');
      const fakeEvent = { sender: {} };

      const GCPS = [
        [[10, 10], [135.0, 35.0]],
        [[90, 10], [135.1, 35.0]],
        [[90, 90], [135.1, 34.9]],
        [[10, 90], [135.0, 34.9]],
      ];
      const TILE_BYTES = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AP7+KKKKAP/Z',
        'base64'
      );
      function baseMapDoc(title: string) {
        return {
          title, lang: 'ja', imageExtension: 'jpg',
          width: 100, height: 100,
          gcps: GCPS, edges: [], sub_maps: [],
          strictMode: 'strict', vertexMode: 'plain',
          homePosition: [135.05, 34.95], mercZoom: 14,
        };
      }
      // import 用の地図 zip を組み立てる（maps/ + tiles/ + tmbs/ の3点が extractZip の必須要件）
      async function makeImportZip(slug: string, mapDoc: any) {
        const zip = new AdmZip();
        zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify(mapDoc), 'utf8'));
        zip.addFile('tiles/' + slug + '/0/0/0.jpg', TILE_BYTES);
        zip.addFile('tmbs/' + slug + '.jpg', TILE_BYTES);
        const zipPath = path.join(exportDir, slug + '.zip');
        zip.writeZip(zipPath);
        return zipPath;
      }
      // compiled の実体を得る。createTinFromGcpsAsync は常に文字列 sentinel を返すため
      // gcps からは作れない。ensurePreviewCompiled を通す buildPreviewSource から取得する
      async function realCompiled() {
        const { uid } = await SqliteDataService.createMap('compiled-seed', baseMapDoc('Compiled Seed'));
        const tileDir = path.join(dataDir, 'tiles', uid, '0', '0');
        await fse.ensureDir(tileDir);
        await fsp.writeFile(path.join(tileDir, '0.jpg'), TILE_BYTES);
        const preview = await MapEditService.buildPreviewSource(uid);
        assert.ok(preview.compiled && preview.compiled.wh, 'compiled 生成の前提が崩れている');
        return preview.compiled;
      }
      const COMPILED = await realCompiled();

      // ===== AC1 / AC3: 外部URL かつ ローカルタイルの地図 =====
      // 設計 §2.4 の存在条件。この形でなければ統一前後で差が出ずテストにならない
      {
        const zipPath = await makeImportZip('ext-url-map', {
          ...baseMapDoc('External Url Map'), compiled: COMPILED, url: EXT_URL,
        });
        const imported = await DataUploadService.extractZip(zipPath);
        assert.ok(!imported.err, 'import は成功するはず: ' + imported.err);
        const uid = imported.mapData.uid;

        // AC3【RED 対象】: import 直後と再読込後で url_ が一致する
        const reloaded = await MapEditService.request(uid);
        assert.strictEqual(
          imported.mapData.url_, reloaded.url_,
          'AC3: import 直後と再読込後で url_ の導出結果が一致するはず（二重実装解消の本丸）。' +
          ' import直後=' + JSON.stringify(imported.mapData.url_) +
          ' / 再読込後=' + JSON.stringify(reloaded.url_)
        );
        assert.strictEqual(
          imported.mapData.url_, EXT_URL,
          'AC3: 統一後は json.url 優先（不変条件 I-1）により外部URLになるはず。実際: ' + JSON.stringify(imported.mapData.url_)
        );
        console.log('ok: AC3 url_ derivation agrees between import and reload');

        // AC1: 保存 → 再読込 → 搬出 のすべてで url が外部URLのまま
        const dbDoc = await SqliteDataService.findMapByRef(uid);
        assert.strictEqual(dbDoc.url, EXT_URL, 'AC1: import 後の DB の url は外部URLのまま');
        const zipOut = path.join(exportDir, 'ext-url-map-out.zip');
        (globalThis as any).__nextSaveDialog = { canceled: false, filePath: zipOut };
        const res = await downloadSaved(fakeEvent, uid);
        assert.equal(res, 'Success', 'AC1: 搬出は Success のはず: ' + res);
        const outJson = JSON.parse(new AdmZip(zipOut).readAsText('maps/ext-url-map.json'));
        assert.strictEqual(outJson.url, EXT_URL, 'AC1: 搬出 zip の url も外部URLのまま');
        console.log('ok: AC1 external url survives import/save/reload/export');

        // AC2: DB と搬出 zip の双方に url_ キーが現れない（不変条件 I-2）
        assert.ok(!('url_' in dbDoc), 'AC2: DB に url_ キーが現れてはいけない');
        assert.ok(!('url_' in outJson), 'AC2: 搬出 zip に url_ キーが現れてはいけない');
        console.log('ok: AC2 url_ never persists to DB or export zip');
      }

      // ===== AC5: ローカルタイルのみ（url 空）→ import 直後の url_ が自 uid のタイルを指す =====
      {
        const zipPath = await makeImportZip('local-only-map', {
          ...baseMapDoc('Local Only Map'), compiled: COMPILED, url: '',
        });
        const imported = await DataUploadService.extractZip(zipPath);
        assert.ok(!imported.err, 'AC5: import は成功するはず: ' + imported.err);
        const uid = imported.mapData.uid;
        assert.ok(
          String(imported.mapData.url_).includes(uid),
          'AC5: url 空なら自 uid のタイルを指すはず。実際: ' + imported.mapData.url_
        );
        assert.ok(
          /\\/\\{z\\}\\/\\{x\\}\\/\\{y\\}\\.jpg$/.test(String(imported.mapData.url_)),
          'AC5: 末尾が /{z}/{x}/{y}.jpg のテンプレートになるはず。実際: ' + imported.mapData.url_
        );

        // AC4【RED 対象】: 空白と非 ASCII を含む保存フォルダで fileUrl() 側へ揃う
        const thumbFolder = path.join(dataDir, 'tiles', uid, '0', '0');
        const expected = fileUrl(path.join(thumbFolder, '0.jpg')).replace(/\\/0\\/0\\/0\\.jpg$/, '/{z}/{x}/{y}.jpg');
        const naive = ('file://' + path.join(thumbFolder, '0.jpg').split(path.sep).join('/'))
          .replace(/\\/0\\/0\\/0\\./, '/{z}/{x}/{y}.');
        assert.notStrictEqual(
          expected, naive,
          'AC4 の前提: 空白と非 ASCII を含むパスでは fileUrl() と手組みの出力が異なるはず（同じなら fixture が効いていない）'
        );
        assert.strictEqual(
          imported.mapData.url_, expected,
          'AC4: 統一後は fileUrl() 側（percent-encoding あり）へ揃うはず。実際: ' + imported.mapData.url_ + ' / 期待: ' + expected
        );
        console.log('ok: AC4/AC5 local tile url_ uses fileUrl() form under space+non-ASCII path');
      }

      // ===== AC6 / AC10: compiled を持つ層の tins =====
      {
        const zipPath = await makeImportZip('compiled-map', {
          ...baseMapDoc('Compiled Map'), compiled: COMPILED, url: '',
        });
        const imported = await DataUploadService.extractZip(zipPath);
        assert.ok(!imported.err, 'AC6: import は成功するはず: ' + imported.err);
        const tins = imported.tins;
        assert.ok(Array.isArray(tins) && tins.length === 1, 'AC6: 主層1件の tins が返るはず: ' + JSON.stringify(tins && tins.length));

        // AC6【RED 対象】: 生 Compiled 形であること（Transform インスタンスではない）
        const t0: any = tins[0];
        assert.ok(t0 && typeof t0 === 'object', 'AC6: tins[0] はオブジェクトのはず');
        assert.ok(
          'tins_points' in t0,
          'AC6: tins[0] は生 Compiled 形（tins_points を持つ）のはず。実際のキー: ' + Object.keys(t0).join(',')
        );
        assert.ok(
          'weight_buffer' in t0,
          'AC6: tins[0] は生 Compiled 形（weight_buffer を持つ）のはず。実際のキー: ' + Object.keys(t0).join(',')
        );
        assert.ok(
          !(t0 instanceof Transform),
          'AC6: tins[0] は Transform インスタンスであってはいけない（renderer は setCompiled へ渡す）'
        );
        // renderer と同じ受理経路（Tin.setCompiled 相当）が例外なく通ること
        const probe = new Transform();
        probe.setCompiled(t0);
        console.log('ok: AC6 tins element for a compiled-bearing layer is a raw Compiled');

        // AC10: メタデータが Transform 経由の読みと等価であること
        const ref = new Transform();
        ref.setCompiled(COMPILED);
        ref.addIndexedTin();
        const md = imported.mapData;
        assert.deepStrictEqual(md.gcps, ref.points, 'AC10: gcps が Transform 経由の読みと等価のはず');
        assert.deepStrictEqual(md.edges, ref.edges, 'AC10: edges が Transform 経由の読みと等価のはず');
        assert.strictEqual(md.width, ref.wh?.[0], 'AC10: width が等価のはず');
        assert.strictEqual(md.height, ref.wh?.[1], 'AC10: height が等価のはず');
        assert.strictEqual(md.strictMode, ref.strictMode, 'AC10: strictMode が等価のはず');
        assert.strictEqual(md.vertexMode, ref.vertexMode, 'AC10: vertexMode が等価のはず');
        assert.strictEqual(md.yaxisMode, ref.yaxisMode, 'AC10: yaxisMode が等価のはず');
        console.log('ok: AC10 metadata is equivalent between byCompiled=false and true');
      }

      // ===== AC12 / AC13: compiled を持たない層は文字列 sentinel =====
      {
        // gcps 4点・compiled なし → createTinFromGcpsAsync は "compiledRequired" を返す
        const noCompiled = { ...baseMapDoc('No Compiled Map'), url: '' };
        const zipPath = await makeImportZip('no-compiled-map', noCompiled);
        const imported = await DataUploadService.extractZip(zipPath);
        assert.ok(!imported.err, 'AC12: import は成功するはず: ' + imported.err);
        const tins = imported.tins;
        assert.ok(Array.isArray(tins), 'AC12: tins は undefined にも非配列にもならないはず');
        assert.strictEqual(tins.length, 1, 'AC12: 層ごとに1要素を持つはず（空配列にならない）');
        assert.strictEqual(
          typeof tins[0], 'string',
          'AC12: compiled を持たない層は文字列 sentinel のはず。実際: ' + JSON.stringify(tins[0])
        );
        assert.ok(
          tins[0] === 'compiledRequired' || tins[0] === 'tooLessGcps',
          'AC12: sentinel は compiledRequired / tooLessGcps のいずれかのはず。実際: ' + tins[0]
        );

        // renderer と同じ分岐: 文字列はそのまま返し setCompiled を呼ばない
        let setCompiledCalls = 0;
        const tinObjects = tins.map((entry: any) => {
          if (typeof entry === 'string') return entry;
          setCompiledCalls++;
          const t = new Transform();
          t.setCompiled(entry);
          return t;
        });
        assert.strictEqual(setCompiledCalls, 0, 'AC12: sentinel に setCompiled を呼んではいけない');
        assert.strictEqual(tinObjects[0], tins[0], 'AC12: sentinel は文字列のまま保持されるはず');

        // AC13: byCompiled の false/true で sentinel が同一（no-compiled 層は影響を受けない）
        const [, tinsFalse] = await storeHandler.store2HistMap({ ...noCompiled } as any, false);
        const [, tinsTrue] = await storeHandler.store2HistMap({ ...noCompiled } as any, true);
        assert.deepStrictEqual(
          tinsFalse, tinsTrue,
          'AC13: compiled を持たない層は byCompiled の値に影響されないはず'
        );
        assert.ok(
          tinsTrue.every((t: any) => typeof t === 'string'),
          'AC13: byCompiled=true でも undefined が混入してはいけない。実際: ' + JSON.stringify(tinsTrue)
        );
        console.log('ok: AC12/AC13 sentinel contract holds and byCompiled does not touch uncompiled layers');
      }

      // ===== AC15: Compiled と sentinel が混在する tins の分別処理と並び順 =====
      {
        const mixed = {
          ...baseMapDoc('Mixed Map'),
          compiled: COMPILED,            // 主層は compiled あり
          url: '',
          sub_maps: [                    // sub_map は compiled なし → sentinel
            { importance: 1, priority: 1, gcps: [], edges: [], bounds: [[0, 0], [1, 1]] },
          ],
        };
        const zipPath = await makeImportZip('mixed-map', mixed);
        const imported = await DataUploadService.extractZip(zipPath);
        assert.ok(!imported.err, 'AC15: import は成功するはず: ' + imported.err);
        const tins = imported.tins;
        assert.strictEqual(tins.length, 2, 'AC15: 主層 + sub_map1件 で tins は2要素のはず: ' + tins.length);
        assert.strictEqual(typeof tins[0], 'object', 'AC15: index 0（主層）は Compiled のはず');
        assert.strictEqual(typeof tins[1], 'string', 'AC15: index 1（sub_map）は sentinel のはず: ' + JSON.stringify(tins[1]));

        let calls = 0;
        const tinObjects = tins.map((entry: any) => {
          if (typeof entry === 'string') return entry;
          calls++;
          const t = new Transform();
          t.setCompiled(entry);
          return t;
        });
        assert.strictEqual(calls, 1, 'AC15: setCompiled は Compiled 要素にだけ呼ばれるはず（1回）。実際: ' + calls);
        assert.ok(tinObjects[0] instanceof Transform, 'AC15: index 0 は Transform に変換されるはず');
        assert.strictEqual(tinObjects[1], tins[1], 'AC15: index 1 は sentinel 文字列のまま残るはず');
        console.log('ok: AC15 mixed tins array is split correctly and order is preserved');
      }

      // ===== AC11 / AC14: whReady =====
      {
        // AC11: MapEditService の whReady 早期 return は無変更
        // width/height なし・compiled なし → normalizeRequestData は [json] を返す（store2HistMap を通さない）
        const { uid } = await SqliteDataService.createMap('wh-unready', {
          title: 'WH Unready', lang: 'ja', imageExtension: 'jpg',
          gcps: GCPS, edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain',
          homePosition: [135.05, 34.95], mercZoom: 14, url: '',
        });
        const reloaded = await MapEditService.request(uid);
        assert.ok(
          !('url_' in reloaded) || reloaded.url_ === undefined,
          'AC11: whReady 偽では url_ を付けずに返すはず（早期 return が無変更）。実際: ' + JSON.stringify(reloaded.url_)
        );
        assert.ok(
          !('compiledTins' in reloaded),
          'AC11: whReady 偽では tins が無く compiledTins も付かないはず'
        );
        console.log('ok: AC11 whReady early-return in MapEditService is unchanged');

        // AC14: import 経路で whReady が偽になり得るかの実測。
        // 偽でも extractZip はガードを持ち込まないため histMap 形式を返し続けること
        const zipPath = await makeImportZip('wh-unready-import', {
          title: 'WH Unready Import', lang: 'ja', imageExtension: 'jpg',
          gcps: GCPS, edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain',
          homePosition: [135.05, 34.95], mercZoom: 14, url: '',
        });
        const imported = await DataUploadService.extractZip(zipPath);
        assert.ok(!imported.err, 'AC14: whReady 偽の入力でも import は成功するはず: ' + imported.err);
        assert.ok(Array.isArray(imported.tins), 'AC14: extractZip はガードを持ち込まないため tins を返し続けるはず');
        assert.ok('gcps' in imported.mapData, 'AC14: store2HistMap を通した histMap 形式を返すはず');
        console.log('ok: AC14 import path does not short-circuit even when whReady is false');
      }

      console.log('m5-t3 smoke: all acceptance criteria passed');
    `,
  );

  await build({
    configFile: false,
    logLevel: 'error',
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
          '@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/,
          'jimp', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform',
        ],
        output: { entryFileNames: 'm5-t3-url-derivation-unification-smoke.mjs', format: 'es' },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 300000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
