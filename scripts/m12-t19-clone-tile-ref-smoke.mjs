// M12-T19 スモーク: clone 後のタイル URL が複製元 uid を指し続ける潜在不整合の修正。
// m12-t17/m13-t4 と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// MapEditService.save() の copySourceUid (clone) 分岐が返す MapSaveResult.url を behavioral に検証する。
// タスク設計 `docs/superpowers/specs/2026-07-24-m12-t19-clone-tile-ref-design.md` §6/§10/§11 準拠。
// シナリオ:
//   Part A (AC2/AC3): clone 保存成功時、MapSaveResult.url は複製先(savedUid)のタイルパスを指し
//                      (複製元のパスではない)、実際にディスク上に存在するファイルを指す
//   Part B (AC4、決定的検証): clone 保存後、複製元地図を削除 (MapDeleteTrashService.deleteMapWithTrash)
//                      しても、複製先タイル実体は影響を受けず存在し続ける
//   Part C (AC5): 複製先地図を MapEditService.request(savedUid) で再オープンした場合も、
//                      (disk-scan 経路により) 正しく複製先自身のタイルパスを指す url_ が構築される
//   Part D (AC7): 複製元タイルが存在しない場合、url は含まれない (既存ガードの無回帰)
//   Part E (設計レビュー v1 Minor1 回帰): startsWith 境界チェック厳密化 — 複製元 uid が別 uid の
//                      文字列プレフィックスに一致してしまう異常な url_ に対して、誤った URL を
//                      構築せず url を省略する (壊れた URL を返すくらいなら省略する安全側)
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';
import assert from 'node:assert/strict';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t19-clone-tile-ref-'));
const entryFile = path.join(workDir, 'm12-t19-clone-tile-ref-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t19-clone-tile-ref-smoke.mjs');

try {
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');
  const mapDeleteTrashServicePath = path.join(projectRoot, 'electron/services/MapDeleteTrashService.ts');

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
      // M12-T18: バンドルに含まれる MapDeleteTrashService が shell を named import するため
      // export が必要 (本 smoke の削除シナリオは originals 無しのため trashItem は呼ばれず、
      // no-op で可。assert は不変)
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
      import fs from 'fs-extra';
      import path from 'node:path';
      import { fileURLToPath } from 'node:url';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      const { deleteMapWithTrash } = await import(${JSON.stringify(mapDeleteTrashServicePath)});

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
      // Part A (AC2/AC3): clone 保存成功時、MapSaveResult.url は複製先のタイルパスを指し
      // (複製元のパスではない)、実際にディスク上に存在するファイルを指す
      // ============================================================
      let tileFolderPartA = '';
      let UID_A_SRC = '';
      let UID_A_DEST = '';
      {
        const { tileFolder } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-a'))});
        tileFolderPartA = tileFolder;
        UID_A_SRC = 'a1111111-1111-4111-8111-111111111111';
        UID_A_DEST = 'a2222222-2222-4222-8222-222222222222';

        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveASrc = await MapEditService.save({
          mapObject: {
            mapID: 'a1-clone-src', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder) + '/{z}/{x}/{y}.jpg',
            width: 100, height: 100, gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'a1-clone-src',
          uid: UID_A_SRC,
          create: true,
        });
        assert.equal(saveASrc.result, 'Success', '複製元自体の新規保存は Success のはず: ' + JSON.stringify(saveASrc));
        assert.ok(typeof saveASrc.url === 'string', '複製元自体の新規保存は url を含むはず(前提確認, tmpCheck分岐)');

        // 実在するタイル実体を複製元に作る (z=0,x=0,y=0)。fs.copy はディレクトリ全体を
        // 複製先へコピーするため、この実ファイルも複製先へ引き継がれる。
        await fs.ensureDir(path.join(tileFolder, UID_A_SRC, '0', '0'));
        await fs.writeFile(path.join(tileFolder, UID_A_SRC, '0', '0', '0.jpg'), 'real-tile-bytes-a-src');

        // MapEdit.vue の実際の挙動 (duplicateFrom 経由の request(dupFrom) 結果丸ごと代入) を模す:
        // mapData.value.url_ は複製元自身の恒久タイルURL (= saveASrc.url) を保持したまま保存される。
        const saveADest = await MapEditService.save({
          mapObject: {
            mapID: 'a1-clone-dest', imageExtension: 'jpg', url_: saveASrc.url,
            width: 100, height: 100, gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'a1-clone-dest',
          uid: UID_A_DEST,
          copyFromUid: UID_A_SRC,
          create: true,
        });
        assert.equal(saveADest.result, 'Success', '複製保存は Success のはず: ' + JSON.stringify(saveADest));
        assert.ok(typeof saveADest.url === 'string', 'AC2: clone 保存成功時、MapSaveResult.url が定義されるはず: ' + JSON.stringify(saveADest));

        const expectedDestPrefix = fileUrl(path.join(tileFolder, UID_A_DEST));
        assert.ok(
          saveADest.url.startsWith(expectedDestPrefix),
          'AC2: url は複製先(' + UID_A_DEST + ')のタイルパスを指すはず: ' + saveADest.url
        );
        assert.ok(
          !saveADest.url.includes(UID_A_SRC),
          'AC2: url は複製元(' + UID_A_SRC + ')のパスを含まないはず: ' + saveADest.url
        );
        assert.ok(
          saveADest.url.endsWith('/{z}/{x}/{y}.jpg'),
          'url は {z}/{x}/{y}.ext サフィックスを保持するはず: ' + saveADest.url
        );

        // AC3: 実際にディスク上に存在するファイルを指す ({z}/{x}/{y} を実在座標 0/0/0 に置換して解決)
        const resolvedPath = fileURLToPath(saveADest.url.replace('/{z}/{x}/{y}', '/0/0/0'));
        assert.ok(
          await fs.pathExists(resolvedPath),
          'AC3: url が指す実体ファイルがディスク上に存在するはず: ' + resolvedPath
        );
        assert.equal(
          await fs.readFile(resolvedPath, 'utf8'),
          'real-tile-bytes-a-src',
          'AC3: 複製先の実体ファイルは複製元からコピーされた内容と一致するはず'
        );
        console.log('ok: (Part A) clone save returns a permanent url pointing to the destination tile path, backed by a real file on disk (AC2/AC3)');
      }

      // ============================================================
      // Part B (AC4、決定的検証): clone 保存後、複製元地図を削除しても複製先タイル実体は
      // 影響を受けず存在し続ける
      // ============================================================
      {
        const destTileFile = path.join(tileFolderPartA, UID_A_DEST, '0', '0', '0.jpg');
        assert.ok(await fs.pathExists(destTileFile), '前提: Part A で複製先タイル実体が存在すること');

        await deleteMapWithTrash(UID_A_SRC);

        assert.ok(
          !(await fs.pathExists(path.join(tileFolderPartA, UID_A_SRC))),
          'AC4 前提: 複製元の tiles/' + UID_A_SRC + ' は削除されているはず(trash退避なしの直接削除)'
        );
        assert.ok(
          await fs.pathExists(destTileFile),
          'AC4: 複製元削除後も複製先タイル実体(tiles/' + UID_A_DEST + '/...) は影響を受けず存在し続けるはず'
        );
        assert.equal(
          await fs.readFile(destTileFile, 'utf8'),
          'real-tile-bytes-a-src',
          'AC4: 複製先タイル実体の内容も変化しないはず'
        );
        console.log('ok: (Part B) deleting the clone source does not affect the destination tile files that already exist on disk (AC4)');
      }

      // ============================================================
      // Part C (AC5): 複製先地図を MapEditService.request(savedUid) で再オープンした場合も、
      // (disk-scan 経路により) 正しく複製先自身のタイルパスを指す url_ が構築される
      // (複製元が Part B で既に削除済みであっても正しく解決できること)
      // ============================================================
      {
        const reloaded = await MapEditService.request(UID_A_DEST);
        assert.ok(typeof reloaded.url_ === 'string', 'AC5: request() は url_ を構築するはず: ' + JSON.stringify(reloaded.url_));
        const expectedDestPrefix = fileUrl(path.join(tileFolderPartA, UID_A_DEST));
        assert.ok(
          reloaded.url_.startsWith(expectedDestPrefix),
          'AC5: 再オープン時の url_ は複製先自身(' + UID_A_DEST + ')のタイルパスを指すはず(自己修復の無回帰): ' + reloaded.url_
        );
        assert.ok(
          !reloaded.url_.includes(UID_A_SRC),
          'AC5: 再オープン時の url_ は(既に削除済みの)複製元(' + UID_A_SRC + ')を含まないはず: ' + reloaded.url_
        );
        console.log('ok: (Part C) reopening the clone destination via request() correctly rebuilds url_ from its own tiles via disk-scan, independent of the (now-deleted) source (AC5)');
      }

      // ============================================================
      // Part D (AC7): 複製元タイルが存在しない場合、url は含まれない (既存ガードの無回帰)
      // ============================================================
      {
        const { tileFolder } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-d'))});
        const UID_D_SRC = 'd1111111-1111-4111-8111-111111111111';
        // DB row のみ存在し、tiles/ ディレクトリは一切作らない(タイル未生成の複製元)
        await SqliteDataService.createMap('d1-clone-src-missing', { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_D_SRC);
        assert.ok(!(await fs.pathExists(path.join(tileFolder, UID_D_SRC))), '前提: 複製元 tiles/ ディレクトリが存在しないこと');

        const UID_D_DEST = 'd2222222-2222-4222-8222-222222222222';
        const saveDDest = await MapEditService.save({
          mapObject: {
            mapID: 'd1-clone-dest-missing', imageExtension: 'jpg',
            // url_ を敢えて設定しても(異常な入力として)、fs.pathExists(oldTile) ガードで
            // コピー自体が実行されないため url は構築されないはず
            url_: fileUrl(path.join(tileFolder, UID_D_SRC)) + '/{z}/{x}/{y}.jpg',
            width: 100, height: 100, gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'd1-clone-dest-missing',
          uid: UID_D_DEST,
          copyFromUid: UID_D_SRC,
          create: true,
        });
        assert.equal(saveDDest.result, 'Success', '複製元タイル未生成でも clone 保存自体は成功するはず(既存動作)');
        assert.equal(saveDDest.url, undefined, 'AC7: 複製元タイルが存在しない場合 url は含まれないはず');
        assert.ok(!(await fs.pathExists(path.join(tileFolder, UID_D_DEST))), '複製先にもタイルは作られないはず(コピー元が無いため)');
        console.log('ok: (Part D) clone with a missing source tile directory omits url (AC7 no-regression)');
      }

      // ============================================================
      // Part E (設計レビュー v1 Minor1 回帰): startsWith 境界チェック厳密化。
      // 複製元 uid が別 uid の文字列プレフィックスに一致してしまう異常な url_ に対して、
      // 誤った(壊れた)URL を構築せず url を省略する(区切り文字込みで判定すべき)
      // ============================================================
      {
        const { tileFolder } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-e'))});
        // UID_E_SRC は UID_E_OTHER の文字列プレフィックスになるよう意図的に選ぶ
        const UID_E_SRC = 'e1111111-1111-4111-8111-111111111111';
        const UID_E_OTHER = UID_E_SRC + '-other-suffix-that-happens-to-continue-the-same-prefix';

        // 複製元(E_SRC)自体は正常にタイルを持つ(コピー自体は実行される前提を成立させる)
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveESrc = await MapEditService.save({
          mapObject: {
            mapID: 'e1-clone-src', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder) + '/{z}/{x}/{y}.jpg',
            width: 100, height: 100, gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'e1-clone-src',
          uid: UID_E_SRC,
          create: true,
        });
        assert.equal(saveESrc.result, 'Success');

        // 異常な url_: UID_E_SRC のタイルパスを文字列プレフィックスとして含む別 uid (UID_E_OTHER)
        // 由来のタイルURL。区切り文字(/)を跨がずに前方一致するため、'/'を含めない startsWith だけでは
        // 誤って一致してしまう(壊れた置換結果を生む)危険がある。
        const otherTilePrefix = fileUrl(path.join(tileFolder, UID_E_OTHER));
        const maliciousUrl_ = otherTilePrefix + '/{z}/{x}/{y}.jpg';
        assert.ok(
          maliciousUrl_.startsWith(fileUrl(path.join(tileFolder, UID_E_SRC))),
          '前提: UID_E_SRC のタイルURLプレフィックスは(区切りなしで)UID_E_OTHER 由来のurl_の文字列プレフィックスであること'
        );

        const UID_E_DEST = 'e2222222-2222-4222-8222-222222222222';
        const saveEDest = await MapEditService.save({
          mapObject: {
            mapID: 'e1-clone-dest', imageExtension: 'jpg', url_: maliciousUrl_,
            width: 100, height: 100, gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'e1-clone-dest',
          uid: UID_E_DEST,
          copyFromUid: UID_E_SRC,
          create: true,
        });
        assert.equal(saveEDest.result, 'Success', '境界ハザードがあっても clone 保存自体は成功するはず');
        assert.equal(
          saveEDest.url,
          undefined,
          '設計レビュー v1 Minor1: 区切り文字を跨がない前方一致(UID_E_SRC が UID_E_OTHER の文字列プレフィックス)の' +
            '場合、壊れたURLを構築するくらいなら url を省略すべき: ' + JSON.stringify(saveEDest)
        );
        assert.ok(
          await fs.pathExists(path.join(tileFolder, UID_E_DEST)),
          '複製先タイルフォルダ自体は(url省略とは独立して)作られているはず(既存動作)'
        );
        console.log('ok: (Part E) a source uid that is a bare string-prefix (no separator) of another tile url does not corrupt the destination url; it is safely omitted (design review v1 Minor1)');
      }

      console.log('M12-T19 clone tile ref smoke passed');
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
          entryFileNames: 'm12-t19-clone-tile-ref-smoke.mjs',
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
  console.log('M12-T19 clone tile ref smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
