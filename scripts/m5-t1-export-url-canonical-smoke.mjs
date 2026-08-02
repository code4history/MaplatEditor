// M5-T1 スモーク: 搬出経路の url 汚染の是正（交換形 url を DB 正本へ戻す）
//
// なぜ必要か（設計書 §1）:
//   MapPurposeService.downloadSavedMap() は MapEditService.buildPreviewSource() を搬出に流用していた。
//   buildPreviewSource() は preview 用途のために `url: store.url_ ?? previewJson.url` を返す
//   （= ランタイムのタイルURL。ローカルタイル地図では file:///Users/<ユーザ名>/… という絶対パス）。
//   その結果、url を持たない地図（実データ264件中176件）の搬出 zip の maps/<slug>.json に
//   **実行環境の絶対ローカルパスが焼き込まれ**、その zip を取り込むと DataUploadService が
//   生の mapData をそのまま DB へ書くため、絶対パスが新しい地図の url として**永続化**された。
//   以後 normalizeRequestData は json.url を優先するので、同梱された自分のタイルは二度と使われない。
//
// 是正の形（設計書 §3.1）:
//   downloadSavedMap() が既に取得している mapDoc（slug/fileKey 解決用）の url を mapObject へ載せ直す。
//   buildPreviewSource() の preview 契約（strict-free 読み出し・compiled 整備・tins）は無変更とし、
//   m13-t1 が守る搬出契約を壊さない。∴ 是正は url 1フィールドに閉じる。
//
// 検証方式:
//   既存 smoke（m13-t1 / m10-t1）と同じサンドボックス方式
//   （vite SSR ビルド + electron / electron-store スタブ + 一時 saveFolder/tmpFolder）で、
//   mapedit:download-saved ハンドラと DataUploadService を実走させる。
//
// 受け入れ条件との対応:
//   AC1a: DB の url が ""（実データ176件と同じ形）→ 搬出 zip の url が "" と完全一致
//         ※「file: でない」の否定 assert では undefined でも別の非 file: 値でも通り、
//           「交換形の url は DB 正本」（不変条件 I-3）を実証できないため完全一致で証明する
//   AC1b: DB に url キーが無い → 搬出 zip にも url キーが存在しない
//   AC2 : 外部タイルURL地図 → 外部URLが完全一致で保持される
//   AC3 : AC1a の zip を別スラッグで再インポート → preview が自分の uid のタイルを指す
//   AC4 : ローカルタイルが実在する地図（設計 §6.1 分岐表の行3）の preview の url は
//         従来どおり file://…/tiles/<uid>/{z}/{x}/{y}.<ext>（preview 経路の非回帰）
//   AC6 : 保存ダイアログのキャンセルで 'Canceled' を返し、出力先ファイルを作らない
//         ※既存 m13-t1 smoke は全ケース canceled:false を注入しており、この分岐は未検証だった
//
// 参照: docs/superpowers/specs/2026-08-02-m5-t1-export-url-canonical-design.md
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t1-export-url-canonical-'));
const entryFile = path.join(workDir, 'm5-t1-export-url-canonical-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm5-t1-export-url-canonical-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');
  const dataUploadServicePath = path.join(projectRoot, 'electron/services/DataUploadService.ts');
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
      // __nextSaveDialog を注入して保存先/キャンセルを制御する (AC6 はここに canceled:true を入れる)
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
      import fs from 'node:fs';
      import fse from 'fs-extra';
      import AdmZip from 'adm-zip';

      const EXT_URL = 'https://t.example.jp/ext/{z}/{x}/{y}.jpg';
      const dataDir = ${JSON.stringify(dataDir)};
      const exportDir = ${JSON.stringify(exportDir)};

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      const { default: DataUploadService } = await import(${JSON.stringify(dataUploadServicePath)});
      const { registerMapEditHandlers } = await import(${JSON.stringify(mapeditIpcPath)});
      const { __handlers } = await import(${JSON.stringify(electronStubFile)});
      await SqliteDataService.getDb();
      registerMapEditHandlers();

      const downloadSaved = __handlers.get('mapedit:download-saved');
      assert.ok(downloadSaved, 'mapedit:download-saved ハンドラが登録されているはず');
      const fakeEvent = { sender: {} };

      // --- 共通 fixture ---
      // GCP は 4点。buildPreviewSource の ensurePreviewCompiled() が compiled を生成できる最小構成
      const GCPS = [
        [[10, 10], [135.0, 35.0]],
        [[90, 10], [135.1, 35.0]],
        [[90, 90], [135.1, 34.9]],
        [[10, 90], [135.0, 34.9]],
      ];
      // 1x1 の JPEG。tiles/<uid>/0/0/0.jpg と tmbs/<uid>.jpg の実体として置く
      const TILE_BYTES = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AP7+KKKKAP/Z',
        'base64'
      );
      async function putTileAndThumb(uid: string) {
        const tileDir = path.join(dataDir, 'tiles', uid, '0', '0');
        await fse.ensureDir(tileDir);
        await fsp.writeFile(path.join(tileDir, '0.jpg'), TILE_BYTES);
        const thumbDir = path.join(dataDir, 'tmbs');
        await fse.ensureDir(thumbDir);
        await fsp.writeFile(path.join(thumbDir, uid + '.jpg'), TILE_BYTES);
      }
      function baseMapDoc(title: string) {
        return {
          title, lang: 'ja', imageExtension: 'jpg',
          width: 100, height: 100,
          gcps: GCPS, edges: [], sub_maps: [],
          strictMode: 'strict', vertexMode: 'plain',
          homePosition: [135.05, 34.95], mercZoom: 14,
        };
      }
      // 搬出して zip 内の maps/<slug>.json を読む
      async function exportAndReadMapJson(uid: string, slug: string, zipName: string) {
        const zipPath = path.join(exportDir, zipName);
        (globalThis as any).__nextSaveDialog = { canceled: false, filePath: zipPath };
        const result = await downloadSaved(fakeEvent, uid);
        assert.equal(result, 'Success', slug + ' の download-saved は Success のはず: ' + result);
        const zip = new AdmZip(zipPath);
        const entry = zip.getEntry('maps/' + slug + '.json');
        assert.ok(entry, 'zip に maps/' + slug + '.json が含まれるはず');
        return { json: JSON.parse(zip.readAsText(entry)), zipPath, zip };
      }

      // ===== AC1a: DB の url が "" の地図 → 搬出 zip の url が "" と完全一致 =====
      // 実データ264件中176件がこの形（url: ""）。修正前はここに
      // file:///Users/<ユーザ名>/…/tiles/<uid>/{z}/{x}/{y}.jpg が焼き込まれていた
      const { uid: emptyUid } = await SqliteDataService.createMap('local-empty-url', {
        ...baseMapDoc('Local Empty Url Map'), url: '',
      });
      await putTileAndThumb(emptyUid);
      {
        const { json } = await exportAndReadMapJson(emptyUid, 'local-empty-url', 'local-empty-url.zip');
        assert.strictEqual(
          json.url, '',
          'AC1a: DB の url が "" なら搬出 zip の url も "" と完全一致するはず（交換形の url は DB 正本 = 不変条件 I-3）。実際の値: ' + JSON.stringify(json.url)
        );
        console.log('ok: AC1a exported url is exactly the DB canonical empty string');
      }

      // ===== AC1b: DB に url キーが無い地図 → 搬出 zip にも url キーが無い =====
      // I-3 が「DB に無いものを作らない」向きにも成り立つことを示す
      const { uid: noKeyUid } = await SqliteDataService.createMap('local-no-url-key', baseMapDoc('Local No Url Key Map'));
      await putTileAndThumb(noKeyUid);
      {
        const { json } = await exportAndReadMapJson(noKeyUid, 'local-no-url-key', 'local-no-url-key.zip');
        assert.ok(
          !('url' in json),
          'AC1b: DB に url キーが無ければ搬出 zip にも url キーが存在しないはず。実際の値: ' + JSON.stringify(json.url)
        );
        console.log('ok: AC1b exported json has no url key when the DB document has none');
      }

      // ===== AC2: 外部タイルURL地図 → 外部URLが完全一致で保持される =====
      const { uid: extUid } = await SqliteDataService.createMap('ext-url-map', {
        ...baseMapDoc('External Tile Url Map'), url: EXT_URL,
      });
      await putTileAndThumb(extUid);
      {
        const { json } = await exportAndReadMapJson(extUid, 'ext-url-map', 'ext-url-map.zip');
        assert.strictEqual(json.url, EXT_URL, 'AC2: 外部タイルURLは完全一致で保持されるはず');
        console.log('ok: AC2 external tile url is preserved verbatim');
      }

      // ===== AC4: ローカルタイルが実在する地図の preview は従来どおりランタイムURL =====
      // 設計 §6.1 分岐表の行3（whReady かつ DB url が falsy かつ tiles/<uid>/0/0/0.jpg が実在）に限定する。
      // 行1（!whReady）・行4（タイル未検出）では url が "" や undefined になり得るため、
      // 「preview は常に file://」という主張は成り立たない
      {
        const preview = await MapEditService.requestPreviewSource(emptyUid);
        assert.match(
          String(preview.url), /^file:\\/\\//,
          'AC4: ローカルタイル地図の preview の url は file:// のままのはず（preview 経路の非回帰）。実際の値: ' + preview.url
        );
        assert.ok(
          String(preview.url).includes(emptyUid),
          'AC4: preview の url は自分の uid のタイルを指すはず。実際の値: ' + preview.url
        );
        assert.match(String(preview.url), /\\{z\\}\\/\\{x\\}\\/\\{y\\}\\.jpg$/, 'AC4: preview の url はタイルテンプレート形のはず');
        console.log('ok: AC4 preview-source still returns the runtime file:// tile url');
      }

      // ===== AC3: AC1a の zip を別スラッグで再インポート → preview が自分の uid のタイルを指す =====
      // 親設計 測定4 の反転。修正前は旧 uid のディレクトリを指し続けていた（points_to_own_tiles = false）
      {
        const srcZip = new AdmZip(path.join(exportDir, 'local-empty-url.zip'));
        const renamed = new AdmZip();
        for (const e of srcZip.getEntries()) {
          if (e.isDirectory) continue;
          renamed.addFile(e.entryName.replace(/local-empty-url/g, 'reimported-map'), srcZip.readFile(e));
        }
        const reimportZipPath = path.join(exportDir, 'reimported-map.zip');
        renamed.writeZip(reimportZipPath);

        const imported = await DataUploadService.extractZip(reimportZipPath);
        assert.ok(!imported.err, 'AC3: 再インポートは成功するはず: ' + imported.err);
        const newUid = imported.mapData.uid;
        assert.notEqual(newUid, emptyUid, 'AC3: 再インポートでは新しい uid が採番されるはず');

        const dbDoc = await SqliteDataService.findMapByRef(newUid);
        assert.ok(
          !String(dbDoc.url ?? '').startsWith('file:'),
          'AC3: 再インポートした地図の DB の url に絶対ローカルパスが永続化されていないはず。実際の値: ' + JSON.stringify(dbDoc.url)
        );

        const preview = await MapEditService.buildPreviewSource(newUid);
        assert.ok(
          String(preview.url).includes(newUid),
          'AC3: 再インポートした地図の preview は**自分の** uid のタイルを指すはず（修正前は旧 uid を指し続けた）。実際の値: ' + preview.url
        );
        assert.ok(
          !String(preview.url).includes(emptyUid),
          'AC3: 再インポートした地図の preview が搬出元の uid を指してはいけない。実際の値: ' + preview.url
        );
        console.log('ok: AC3 re-imported map resolves tiles under its own uid');
      }

      // ===== AC6: 保存ダイアログのキャンセルで 'Canceled' を返し、出力先ファイルを作らない =====
      // 既存 m13-t1 smoke は AC-T1-1 の3ケースとも canceled:false を注入しており、この分岐は未検証だった
      {
        const canceledTarget = path.join(exportDir, 'should-not-exist.zip');
        (globalThis as any).__nextSaveDialog = { canceled: true, filePath: canceledTarget };
        const result = await downloadSaved(fakeEvent, emptyUid);
        assert.equal(result, 'Canceled', 'AC6: ダイアログのキャンセルでは Canceled を返すはず: ' + result);
        assert.equal(
          fs.existsSync(canceledTarget), false,
          'AC6: キャンセル時は出力先ファイルを作らないはず: ' + canceledTarget
        );

        // filePath 未設定（ダイアログが path を返さない）でも同じ契約であることを併せて固定する
        (globalThis as any).__nextSaveDialog = { canceled: false, filePath: undefined };
        const result2 = await downloadSaved(fakeEvent, emptyUid);
        assert.equal(result2, 'Canceled', 'AC6: filePath 未設定でも Canceled を返すはず: ' + result2);
        console.log('ok: AC6 canceled dialog returns Canceled and writes no output file');
      }

      console.log('M5-T1 export url canonical smoke passed');
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
          '@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/,
          'jimp', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform',
        ],
        output: { entryFileNames: 'm5-t1-export-url-canonical-smoke.mjs', format: 'es' },
      },
    },
  });

  // 子プロセスの stdout（AC ごとの ok 行）をそのまま出す。どの受け入れ条件が通ったかを
  // ログで追えるようにするため（失敗時は execFileAsync が throw し stderr に assert が出る）
  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 300000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
