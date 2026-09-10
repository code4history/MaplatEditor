// oct26-m4-t1 スモーク: ZIP 残経路のストリーミング化と zipWriter 自己防衛（タスク設計 v1 §7）。
//
// 固定する受け入れ条件:
//   AC2  writeZipStreaming が危険なエントリ名（../・絶対パス・ドライブ文字・NUL・
//        バックスラッシュ）を reject（throw）し、正常名は従来どおり書けること（#103 MIN-2）
//   AC3  DataUploadService.extractZip が 2 GiB 超を ERR_FS_FILE_TOO_LARGE ではなく
//        明確なエラー（{ err: <メッセージ> }）で拒否し、通常サイズの地図 ZIP は
//        従来どおり import できること（#98 item 3・#102 読取側）
//   MIN-2（設計レビュー申し送り）mapDownloadZip.ts が writeZipStreaming 呼び出し前に
//        slug 由来 staging パス（`${slug}.zip`）の非存在を先行削除で保証していること
//        （'wx' 化後、残留 staging ファイルによる EEXIST の地図 DL 失敗を防ぐ）
//   MAJ-1（実装レビュー是正）writeZipStreaming が失敗した際、実際に open できた targetPath
//        のみ後始末で削除し、'wx' で開けなかった既存ファイル・symlink は削除しないこと
//
// 実行方法: node scripts/oct26-m4-t1-zip-residual-smoke.mjs（pnpm run は使わない。
//   outer lock 汚染回避。m6-t10 と同じ vite SSR ビルド + electron/electron-store スタブ方式）。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'oct26-m4-t1-residual-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); } };
    export const ipcMain = { handle() {} };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
  `);
  await writeFile(storeStub, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { writeFile as fsWriteFile, mkdir as fsMkdir, readFile as fsReadFile, open as fsOpen, symlink as fsSymlink, lstat as fsLstat, readlink as fsReadlink } from 'node:fs/promises';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { writeZipStreaming } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/zipWriter.ts'))});

    // =====================================================================
    // AC2: writeZipStreaming が危険なエントリ名を reject する（#103 MIN-2）
    // =====================================================================
    {
      // 実在するソースファイル（危険名の拒否は検証が先に走るため実体は何でもよいが、
      // 正常名の書き出しが実 ZIP になるよう実ファイルを用意する）
      const srcDir = nodePath.join(workDir, 'ac2-src');
      await fsMkdir(srcDir, { recursive: true });
      const srcFile = nodePath.join(srcDir, 'foo.json');
      await fsWriteFile(srcFile, JSON.stringify({ ok: true }));

      const dangerous = [
        '../../../../etc/evil.txt',
        '/absolute/path.txt',
        'C:\\\\Windows\\\\evil.txt',
        'a\\\\b.txt',
        'evil\\u0000name.txt',
      ];
      let caseNo = 0;
      for (const entryName of dangerous) {
        caseNo++;
        const target = nodePath.join(workDir, 'ac2-reject-' + caseNo + '.zip');
        await assert.rejects(
          writeZipStreaming(target, [{ entryName, localPath: srcFile }]),
          (err) => /安全でないエントリ名/.test(String(err?.message)),
          'AC2: 危険なエントリ名 ' + JSON.stringify(entryName) + ' が reject されること',
        );
      }

      // 正常名は従来どおり書けること（adm-zip で読める実 ZIP になる）
      const okTarget = nodePath.join(workDir, 'ac2-ok.zip');
      await writeZipStreaming(okTarget, [{ entryName: 'maps/foo.json', localPath: srcFile }]);
      const okEntries = new AdmZip(okTarget).getEntries().map((e) => e.entryName);
      assert.deepEqual(okEntries, ['maps/foo.json'], 'AC2: 正常名は従来どおり書けること');
      console.log('ok AC2: 危険なエントリ名を reject し、正常名は書ける（' + dangerous.length + ' 種）');
    }

    // =====================================================================
    // MAJ-1（実装レビュー是正）: 失敗時後始末が、'wx' で開けなかった既存ファイル・symlink を
    // 削除しないこと。'wx' は既存があると EEXIST で開けない（= 自己防衛の意図）。その際、
    // catch の fs.remove が「開けなかった既存ファイル・symlink」まで消すとデータ消失になる。
    // =====================================================================
    {
      const maj1Src = nodePath.join(workDir, 'maj1-src.json');
      await fsWriteFile(maj1Src, JSON.stringify({ payload: true }));

      // 既存の通常ファイル
      const existingFile = nodePath.join(workDir, 'maj1-existing.txt');
      await fsWriteFile(existingFile, 'ORIGINAL-CONTENT');
      await assert.rejects(
        writeZipStreaming(existingFile, [{ entryName: 'maps/foo.json', localPath: maj1Src }]),
        (err) => err && (err.code === 'EEXIST' || /EEXIST/.test(String(err?.message))),
        'MAJ-1: 既存ファイルへ書くと EEXIST で reject されること',
      );
      assert.equal(await fsReadFile(existingFile, 'utf8'), 'ORIGINAL-CONTENT',
        'MAJ-1: EEXIST の後、既存ファイルが削除されず残ること');

      // 既存の symlink
      const linkTarget = nodePath.join(workDir, 'maj1-link-target.txt');
      await fsWriteFile(linkTarget, 'LINK-TARGET-CONTENT');
      const symlinkPath = nodePath.join(workDir, 'maj1-existing-symlink');
      await fsSymlink(linkTarget, symlinkPath);
      await assert.rejects(
        writeZipStreaming(symlinkPath, [{ entryName: 'maps/foo.json', localPath: maj1Src }]),
        (err) => err && (err.code === 'EEXIST' || /EEXIST/.test(String(err?.message))),
        'MAJ-1: 既存 symlink へ書くと EEXIST で reject されること',
      );
      const lst = await fsLstat(symlinkPath);
      assert.ok(lst.isSymbolicLink(), 'MAJ-1: EEXIST の後、symlink 自体が削除されず残ること');
      assert.equal(await fsReadlink(symlinkPath), linkTarget,
        'MAJ-1: symlink の参照先（名前）が維持されること');
      assert.equal(await fsReadFile(linkTarget, 'utf8'), 'LINK-TARGET-CONTENT',
        'MAJ-1: symlink のリンク先ファイルが生存すること');
      console.log('ok MAJ-1: 失敗時後始末が開けなかった既存ファイル・symlink を削除しない');
    }

    // =====================================================================
    // AC3: extractZip が 2 GiB 超を明確なエラーで拒否する（#98 item 3・#102 読取側）
    // =====================================================================
    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    await SqliteDataService.getDb();

    // 地図 ZIP の最小 fixture（m5-t5 と同型）。
    const makeMapZip = (slug) => {
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: '残経路 ' + slug, attr: 'test', lang: 'ja',
        width: 400, height: 300, gcps: [], edges: [],
      })));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB:' + slug));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE:' + slug));
      const p = nodePath.join(workDir, slug + '.zip');
      zip.writeZip(p);
      return p;
    };

    {
      // 負検査: 通常サイズの地図 ZIP は従来どおり import できること
      const normal = await dataUploadService.extractZip(makeMapZip('residual-normal'));
      assert.ok(normal.mapData, 'AC3 負検査: 通常サイズの地図 ZIP が import できること（実際: '
        + JSON.stringify(normal).slice(0, 200) + '）');
      assert.equal(normal.mapData.mapID, 'residual-normal', 'AC3 負検査: slug で取り込まれること');
      console.log('ok AC3 負検査: 通常サイズの地図 ZIP は従来どおり import できる');
    }

    {
      // 正検査: > 2 GiB の sparse fixture が ERR_FS_FILE_TOO_LARGE ではなく明確なエラーになること
      const oversize = nodePath.join(workDir, 'oversize-map.zip');
      const fh = await fsOpen(oversize, 'w');
      await fh.truncate(2 * 1024 * 1024 * 1024 + 1); // 2 GiB + 1 byte の sparse file（実ディスク消費ほぼ 0）
      await fh.close();
      const rejected = await dataUploadService.extractZip(oversize);
      assert.equal(typeof rejected, 'object', 'AC3: 拒否が { err } 形で返ること');
      assert.equal(typeof rejected.err, 'string', 'AC3: err が文字列であること');
      assert.match(rejected.err, /too large to import/, 'AC3: 明確なメッセージであること（実際: ' + JSON.stringify(rejected.err) + '）');
      assert.equal(rejected.err.includes('ERR_FS_FILE_TOO_LARGE'), false,
        'AC3: ERR_FS_FILE_TOO_LARGE ではなく意図したエラーであること（実際: ' + JSON.stringify(rejected.err) + '）');
      console.log('ok AC3 正検査: 2 GiB 超を明確なエラーで拒否する（ERR_FS_FILE_TOO_LARGE ではない）');
    }

    // ソース直読: extractZip のサイズ検査が adm-zip の読み取り（new AdmZip(zipFile)）より前にあること。
    // DataUploadService.ts の new AdmZip(zipFile) は 2 箇所（restoreManagedPois / extractZip）。
    // restoreManagedPois は extractZip のガードより後からしか呼ばれないため、
    // ファイル末尾側（extractZip 側）の new AdmZip より前にガードがあれば両者を覆う。
    {
      const duSrc = await fsReadFile(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))}, 'utf8');
      const guardIdx = duSrc.indexOf('zipSize > ZIP_IMPORT_MAX_BYTES');
      const extractAdmIdx = duSrc.lastIndexOf('new AdmZip(zipFile)');
      assert.ok(guardIdx !== -1, 'AC3: サイズ検査（ZIP_IMPORT_MAX_BYTES 比較）が存在する');
      assert.ok(extractAdmIdx !== -1, 'AC3: extractZip の new AdmZip が存在する');
      assert.ok(guardIdx < extractAdmIdx, 'AC3: サイズ検査が extractZip の new AdmZip より前に走る');
      console.log('ok AC3 ソース直読: サイズ検査が new AdmZip より前に走る');
    }

    // =====================================================================
    // MIN-2（設計レビュー申し送り）: mapDownloadZip の staging パス非存在保証
    // =====================================================================
    {
      const mapSrc = await fsReadFile(${JSON.stringify(path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'))}, 'utf8');
      const removeIdx = mapSrc.indexOf('await fs.remove(zipFilePath)');
      const writeIdx = mapSrc.indexOf('writeZipStreaming(zipFilePath');
      assert.ok(removeIdx !== -1, 'MIN-2: staging パスの先行削除が存在する');
      assert.ok(writeIdx !== -1, 'MIN-2: writeZipStreaming 呼び出しが存在する');
      assert.ok(removeIdx < writeIdx,
        'MIN-2: 先行削除が writeZipStreaming 呼び出しより前にある（残留 staging による EEXIST 防止）');
      console.log('ok MIN-2: mapDownloadZip が writeZipStreaming 前に staging パス非存在を保証する');
    }

    console.log('oct26-m4-t1 zip residual smoke passed');
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [
      { find: 'electron', replacement: electronStub },
      { find: 'electron-store', replacement: storeStub },
    ]},
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: {
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [bundled], {
      cwd: projectRoot, timeout: 180000, maxBuffer: 1024 * 1024 * 16,
    }));
  } catch (e) {
    if (e && e.stdout) process.stdout.write(e.stdout);
    if (e && e.stderr) process.stderr.write(e.stderr);
    throw e;
  }
  process.stdout.write(stdout);
  if (!stdout.includes('oct26-m4-t1 zip residual smoke passed')) {
    throw new Error('oct26-m4-t1 smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
  }
  console.log('oct26-m4-t1 zip residual smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
