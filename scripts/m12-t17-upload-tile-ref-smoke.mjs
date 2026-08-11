// M12-T17 スモーク: 新規アップロード地図のタイル化直後にタイルが表示されない回帰の修正。
// m13-t2/t4 と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// MapEditService.save() の tmpCheck 分岐が返す MapSaveResult.url を behavioral に検証する。
// タスク設計 `docs/superpowers/specs/2026-07-24-m12-t17-upload-tile-ref-design.md` §4/§6/§10 準拠。
// シナリオ:
//   Part A: MapSaveResult 型定義 (StorageAdapter.ts / src/electron.d.ts) に url?: string が
//           同期して追加されていること (設計レビュー v1 Major1 の恒久回帰防止)
//   Part B: tmpCheck 分岐 (新規原本アップロード) は恒久タイルURLを url として返し、
//           {z}/{x}/{y}.ext サフィックスが保持される (AC2/AC3 の main process 側根拠)
//   Part C: 置換文字列 $ 特殊シーケンスハザード回帰 (設計レビュー v2 Minor1) —
//           saveFolder パスに $& が含まれても恒久 URL が破損しない
//   Part D: 既存地図の通常更新 (tmpCheck=false) は url を含まない (AC1 無回帰)
//   Part E: clone は url を含むようになった (M12-T19) — 複製先タイルパスを指す恒久URLを返す
//   Part F: rename (改名、tmpCheck=false) は url を含まない (AC6 無回帰)
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';
import assert from 'node:assert/strict';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

// ============================================================
// Part A: MapSaveResult 型定義の同期確認 (ビルド不要、ソース直接読取り)
// ============================================================
{
  const adapterSource = await readFile(
    path.join(projectRoot, 'electron/adapters/StorageAdapter.ts'),
    'utf8'
  );
  const rendererMirrorSource = await readFile(
    path.join(projectRoot, 'src/electron.d.ts'),
    'utf8'
  );
  assert.match(
    adapterSource,
    /\{ result: 'Success'; uid: string; slug: string; revision: number; url\?: string \}/,
    'StorageAdapter.ts の MapSaveResult.Success に url?: string が追加されているはず'
  );
  assert.match(
    rendererMirrorSource,
    /\{ result: 'Success'; uid: string; slug: string; revision: number; url\?: string \}/,
    'src/electron.d.ts (レンダラー側ミラー) の MapSaveResult.Success にも url?: string が同期追加されているはず'
  );
  console.log('ok: (Part A) MapSaveResult.Success.url?: string is defined in both StorageAdapter.ts and src/electron.d.ts');
}

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
// 注意: workDir 自体は vite のエイリアス解決 (electron/electron-store スタブの replacement パス) にも
// 使われるため、$ 特殊シーケンスを含めてはいけない(vite/rollup 内部の文字列置換処理が誤爆し、
// ビルド自体が壊れることを実測確認した)。Part C 用の $& 断片は、workDir 配下の
// 「実行時にのみ MapEditService.save() が扱う」サブディレクトリ名にのみ含める(下記 Part C 参照)。
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t17-upload-tile-ref-'));
const entryFile = path.join(workDir, 'm12-t17-upload-tile-ref-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t17-upload-tile-ref-smoke.mjs');

try {
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');

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
      import fs from 'fs-extra';
      import path from 'node:path';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});

      function setSaveFolder(dir: string) {
        SettingsService.set('saveFolder', dir);
        return { dataDir: dir, tileFolder: path.join(dir, 'tiles'), originalsDir: path.join(dir, 'originals') };
      }

      async function prepareTmpUpload(ext: string) {
        const tmpFolder = SettingsService.get('tmpFolder');
        const tmpTileFolder = path.join(tmpFolder, 'tiles');
        await fs.remove(tmpTileFolder);
        await fs.ensureDir(tmpTileFolder);
        await fs.writeFile(path.join(tmpTileFolder, 'original.' + ext), 'uploaded-original-bytes-' + ext);
        await fs.writeFile(path.join(tmpTileFolder, 'thumbnail.jpg'), 'thumb-bytes');
        return tmpTileFolder;
      }

      const fileUrlModule = await import('file-url');
      const fileUrl = fileUrlModule.default;

      // ============================================================
      // Part B: tmpCheck 分岐は恒久タイルURLを url として返し、
      // {z}/{x}/{y}.ext サフィックスが保持される (AC2/AC3)
      // ============================================================
      {
        const { dataDir, tileFolder } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-b'))});
        await fs.ensureDir(dataDir);
        const tmpTileFolder = await prepareTmpUpload('png');
        // 実運用の url_ フォーマット (MapUploadService.imageCutter): tmpタイルURL + テンプレサフィックス
        const uploadedUrl = fileUrl(tmpTileFolder) + '/{z}/{x}/{y}.png';

        const UID_B1 = 'b1111111-1111-4111-8111-111111111111';
        const saveB1 = await MapEditService.save({
          mapObject: {
            mapID: 'b1-new-upload', imageExtension: 'png', url_: uploadedUrl,
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'b1-new-upload',
          uid: UID_B1,
          create: true,
        });
        assert.equal(saveB1.result, 'Success', 'tmpCheck 新規保存は Success のはず: ' + JSON.stringify(saveB1));
        assert.ok(typeof saveB1.url === 'string', 'tmpCheck 分岐は url を返すはず: ' + JSON.stringify(saveB1));

        const expectedPermanentPrefix = fileUrl(path.join(tileFolder, UID_B1));
        assert.ok(
          saveB1.url.startsWith(expectedPermanentPrefix),
          'url は恒久タイルフォルダ(tiles/' + UID_B1 + ')を指すはず: ' + saveB1.url
        );
        assert.ok(
          saveB1.url.endsWith('/{z}/{x}/{y}.png'),
          'url は {z}/{x}/{y}.ext サフィックスを保持するはず: ' + saveB1.url
        );
        assert.ok(!saveB1.url.includes(tmpTileFolder), 'url は旧tmpパスを含まないはず: ' + saveB1.url);

        // バックエンドのファイル移動自体も既存どおり正しく完了していること (回帰確認)
        assert.ok(!(await fs.pathExists(tmpTileFolder)), 'tmpタイルフォルダは移動後に消えているはず');
        assert.ok(await fs.pathExists(path.join(tileFolder, UID_B1)), '恒久タイルフォルダが作られているはず');

        console.log('ok: (Part B) tmpCheck branch returns permanent tile url with {z}/{x}/{y}.ext suffix preserved (AC2/AC3)');
      }

      // ============================================================
      // Part C: 置換文字列 $ 特殊シーケンスハザード回帰 (設計レビュー v2 Minor1)
      // ============================================================
      {
        // workDir 自体が '$&' を含む (スクリプト冒頭で意図的に混入済み)。
        // saveFolder もその配下に作る。
        const { dataDir, tileFolder } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-c-$&-in-path'))});
        await fs.ensureDir(dataDir);
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const uploadedUrl = fileUrl(tmpTileFolder) + '/{z}/{x}/{y}.jpg';

        const UID_C1 = 'c1111111-1111-4111-8111-111111111111';
        const saveC1 = await MapEditService.save({
          mapObject: {
            mapID: 'c1-dollar-hazard', imageExtension: 'jpg', url_: uploadedUrl,
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'c1-dollar-hazard',
          uid: UID_C1,
          create: true,
        });
        assert.equal(saveC1.result, 'Success');
        assert.ok(typeof saveC1.url === 'string');

        const expectedPermanentPrefix = fileUrl(path.join(tileFolder, UID_C1));
        // $ 特殊シーケンスハザードが起きていれば、期待するプレフィックスと一致せず
        // 旧tmpパス断片 ($&) や欠落 ($1 等) が紛れ込む。文字列比較で直接検出する。
        assert.equal(
          saveC1.url,
          expectedPermanentPrefix + '/{z}/{x}/{y}.jpg',
          '$ を含む saveFolder パスでも置換文字列の特殊シーケンスとして解釈されず、' +
            '恒久URLがそのまま構築されるはず (置換は関数形式で行うこと): ' + saveC1.url
        );
        assert.ok(
          !saveC1.url.includes(tmpTileFolder),
          '$& ハザードで旧tmpパスが結果に紛れ込んでいないはず: ' + saveC1.url
        );
        console.log('ok: (Part C) $ characters in saveFolder path do not corrupt the permanent tile url (regex replacement hazard, review Minor1)');
      }

      // ============================================================
      // Part D: 既存地図の通常更新 (tmpCheck=false) は url を含まない (AC1 無回帰)
      // ============================================================
      {
        setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-d'))});
        const UID_D1 = 'd1111111-1111-4111-8111-111111111111';
        const createD1 = await MapEditService.save({
          mapObject: { mapID: 'd1-normal-map', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'd1-normal-map',
          uid: UID_D1,
          create: true,
        });
        assert.equal(createD1.result, 'Success');
        assert.equal(createD1.url, undefined, '新規作成でも url_(tmpCheck対象)が無ければ url は含まれないはず');

        const updateD1 = await MapEditService.save({
          mapObject: { mapID: 'd1-normal-map', imageExtension: 'jpg', gcps: [[[1, 1], [2, 2]]], edges: [], sub_maps: [] },
          tins: ['tooLessGcps'],
          slug: 'd1-normal-map',
          uid: UID_D1,
        });
        assert.equal(updateD1.result, 'Success', '通常更新は成功するはず: ' + JSON.stringify(updateD1));
        assert.equal(updateD1.url, undefined, '画像差し替えを伴わない通常更新は url を含まないはず (AC1)');
        console.log('ok: (Part D) normal update without a fresh upload omits url (AC1 no-regression)');
      }

      // ============================================================
      // Part E: clone は url を含むようになった (M12-T19)。M12-T17時点では「clone は
      // url を含まない」が正しい前提だったが、M12-T19 が「複製保存後もレンダラーが
      // 複製元uidのタイルURLを保持し続ける」潜在不整合を修正した結果、clone 分岐も
      // (tmpCheck 分岐と同様に) 複製先タイルパスを指す恒久URLを返すようになった。
      // これは意図した仕様変更であり、旧アサーション(url===undefined)は本タスクの
      // 目的そのものと矛盾するため更新した(M12-T19設計書§7.1 AC6)。
      // ============================================================
      {
        const { tileFolder } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-e'))});
        const UID_E_SRC = 'e1111111-1111-4111-8111-111111111111';
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveESrc = await MapEditService.save({
          mapObject: {
            mapID: 'e1-clone-src', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder) + '/{z}/{x}/{y}.jpg',
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'e1-clone-src',
          uid: UID_E_SRC,
          create: true,
        });
        assert.equal(saveESrc.result, 'Success');
        assert.ok(typeof saveESrc.url === 'string', '複製元自体の新規保存は url を含むはず(前提確認)');

        const UID_E_DEST = 'e2222222-2222-4222-8222-222222222222';
        // M12-T19: 実際の MapEdit.vue の挙動 (duplicateFrom 経由で複製元の request 結果を
        // 丸ごと受け継ぐ) を模し、複製先の mapObject.url_ に複製元の恒久タイルURL(saveESrc.url)
        // を設定する。これが無いと clone 分岐の newTileUrl 構築ガード(url_ && url_.startsWith(...))
        // が発火せず、この smoke は url を含む新仕様を検証できない(m12-t19 designer が実測で
        // 発見した、旧 Part E 自体のカバレッジの欠落)。
        const saveEDest = await MapEditService.save({
          mapObject: { mapID: 'e1-clone-dest', imageExtension: 'jpg', url_: saveESrc.url, gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'e1-clone-dest',
          uid: UID_E_DEST,
          copyFromUid: UID_E_SRC,
          create: true,
        });
        assert.equal(saveEDest.result, 'Success');
        assert.ok(typeof saveEDest.url === 'string', 'clone は url を含むようになったはず (M12-T19): ' + JSON.stringify(saveEDest));
        const expectedDestPrefix = fileUrl(path.join(tileFolder, UID_E_DEST));
        assert.ok(
          saveEDest.url.startsWith(expectedDestPrefix),
          'url は複製先(' + UID_E_DEST + ')のタイルパスを指すはず(複製元ではない): ' + saveEDest.url
        );
        assert.ok(!saveEDest.url.includes(UID_E_SRC), 'url は複製元(' + UID_E_SRC + ')のパスを含まないはず: ' + saveEDest.url);
        assert.ok(await fs.pathExists(path.join(tileFolder, UID_E_DEST)), '複製先タイルフォルダ自体は作られているはず(既存動作)');
        console.log('ok: (Part E) clone now returns a permanent url pointing to the destination tile path (M12-T19)');
      }

      // ============================================================
      // Part F: rename (改名、tmpCheck=false) は url を含まない (AC6 無回帰)
      // ============================================================
      {
        setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-f'))});
        const UID_F1 = 'f1111111-1111-4111-8111-111111111111';
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const createF1 = await MapEditService.save({
          mapObject: {
            mapID: 'f1-rename-src', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder) + '/{z}/{x}/{y}.jpg',
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'f1-rename-src',
          uid: UID_F1,
          create: true,
        });
        assert.equal(createF1.result, 'Success');

        const renameF1 = await MapEditService.save({
          mapObject: { mapID: 'f1-renamed', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'f1-renamed',
          uid: UID_F1,
        });
        assert.equal(renameF1.result, 'Success', 'rename は成功するはず: ' + JSON.stringify(renameF1));
        assert.equal(renameF1.url, undefined, 'rename (tmpCheck=false) は url を含まないはず (AC6)');
        console.log('ok: (Part F) rename omits url (AC6 no-regression)');
      }

      console.log('M12-T17 upload tile ref smoke passed');
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
          entryFileNames: 'm12-t17-upload-tile-ref-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log(stdout);
  console.log('M12-T17 upload tile ref smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
