// 保存先フォルダの DB を開けないとき、main 側が返す理由の code の単体試験。
// 権限なし（chmod 000 の一時フォルダ）と場所なし（存在しないパス）のそれぞれで、
// 理由が「権限が無い」「場所が無い」と分類されることを検査する。実データは開かない。
// 読み取り専用のフォルダ（chmod 555）と読み取り専用の DB ファイル（chmod 444）は
// 開封に成功してから最初の書き込みで失敗するため、そこも「権限が無い」になること、
// 外付けドライブが外れたパス（/Volumes/<存在しない名前>/x）は ensureDir が EACCES を
// 返しても「場所が無い」を優先すること、読み取り専用の場所（読み取り専用でつないだ
// ディスクイメージ。EROFS）は「読み取り専用の場所」に分けること、権限を戻せば同じフォルダのまま再試行で
// 直ることも検査する。
//
// Part 1: electron/utils/dbOpenFailure.ts の分類・応答写像（vite バンドル → node）
// Part 2: SqliteDataService の実経路（getDb → searchMaps）をスタブ付きバンドルで検査
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'db-open-reason-'));
const entryFile = path.join(workDir, 'db-open-reason-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'db-open-reason-smoke.mjs');

try {
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const dbOpenFailurePath = path.join(projectRoot, 'electron/utils/dbOpenFailure.ts');
  const loadFailurePath = path.join(projectRoot, 'src/components/resource-list/loadFailure.ts');

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
      const fakeWindow = {
        webContents: {
          send() {},
        },
      };
      export const BrowserWindow = class {
        static getAllWindows() { return [fakeWindow]; }
      };
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
      import { chmod, mkdir, rm, stat, symlink } from 'node:fs/promises';
      import { execFile } from 'node:child_process';
      import { promisify } from 'node:util';
      import { DatabaseSync } from 'node:sqlite';
      import path from 'node:path';
      import {
        DbOpenError,
        classifyDbOpenFailure,
        dbOpenFailureCode,
        toDbOpenError,
        toDbOpenFailureReply,
        withDbOpenFailureReply,
      } from ${JSON.stringify(dbOpenFailurePath)};
      import { permissionFixKey } from ${JSON.stringify(loadFailurePath)};

      const execFileAsync = promisify(execFile);

      // 読み取り専用でつないだディスクイメージを外す。外し損ねたら 1 度だけやり直し、それでも
      // 外れなければ警告する（握りつぶさない。残ったイメージは hdiutil detach -force で外す）
      async function detachImage(mountPoint) {
        try {
          await execFileAsync('hdiutil', ['detach', '-quiet', '-force', mountPoint]);
          return;
        } catch {
          // 1 度だけやり直す
        }
        try {
          await execFileAsync('hdiutil', ['detach', '-quiet', '-force', mountPoint]);
        } catch (err) {
          console.warn('[db-open-reason-smoke] ディスクイメージを外せませんでした（hdiutil detach -force で外してください）: ' + mountPoint + ': ' + String(err && err.message ? err.message : err));
        }
      }
      const workDir = ${JSON.stringify(workDir)};
      const scratch = path.join(workDir, 'cases');
      await mkdir(scratch, { recursive: true });

      // --- Part 1a: code の正規化（パスを含まない記号だけを返す） ---
      assert.equal(dbOpenFailureCode({ code: 'EACCES' }), 'EACCES');
      assert.equal(dbOpenFailureCode({ code: 'EPERM' }), 'EPERM');
      assert.equal(dbOpenFailureCode({ code: 'ENOENT' }), 'ENOENT');
      assert.equal(dbOpenFailureCode({ code: 'ERR_SQLITE_ERROR', errcode: 14 }), 'SQLITE_CANTOPEN');
      assert.equal(dbOpenFailureCode({ code: 'ERR_SQLITE_ERROR', errcode: 8 }), 'SQLITE_READONLY');
      // SQLite は拡張 result code を返すことがある（1544 = SQLITE_READONLY_DIRECTORY、
      // 526 = SQLITE_CANTOPEN_ISDIR 等）。基本 code（下位 8bit）まで正規化すること
      assert.equal(dbOpenFailureCode({ code: 'ERR_SQLITE_ERROR', errcode: 1544 }), 'SQLITE_READONLY');
      assert.equal(dbOpenFailureCode({ code: 'ERR_SQLITE_ERROR', errcode: 264 }), 'SQLITE_READONLY');
      assert.equal(dbOpenFailureCode({ code: 'ERR_SQLITE_ERROR', errcode: 526 }), 'SQLITE_CANTOPEN');
      assert.equal(dbOpenFailureCode({}), 'unknown');
      assert.equal(dbOpenFailureCode(null), 'unknown');

      // --- Part 1a': 「権限が無い」の直し方は OS ごとに文言を選ぶ ---
      assert.equal(permissionFixKey('darwin'), 'resource_list.load_error_fix_permission');
      assert.equal(permissionFixKey(undefined), 'resource_list.load_error_fix_permission', 'OS が分からないときは従来の文言');
      assert.equal(permissionFixKey('win32'), 'resource_list.load_error_fix_permission_windows');
      assert.equal(permissionFixKey('linux'), 'resource_list.load_error_fix_permission_linux');
      assert.equal(permissionFixKey('freebsd'), 'resource_list.load_error_fix_permission_linux');

      // --- Part 1b: 分類（合成エラー） ---
      const presentDir = path.join(scratch, 'present');
      await mkdir(presentDir, { recursive: true });
      assert.equal(await classifyDbOpenFailure({ code: 'EACCES' }, presentDir), 'permission');
      assert.equal(await classifyDbOpenFailure({ code: 'EPERM' }, presentDir), 'permission');
      // 失敗そのものが EROFS（読み取り専用のファイルシステム）なら、フォルダを見ずに読み取り専用の場所
      assert.equal(await classifyDbOpenFailure({ code: 'EROFS' }, presentDir), 'readonly-location');
      assert.equal(await classifyDbOpenFailure({ code: 'ENOENT' }, presentDir), 'not-found');
      assert.equal(await classifyDbOpenFailure({ code: 'ENOTDIR' }, presentDir), 'not-found');
      assert.equal(await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 8 }, presentDir), 'permission');
      assert.equal(await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 1544 }, presentDir), 'permission');
      // 外付けドライブが外れたパスは ensureDir が EACCES を返すが、「場所が無い」を優先する
      assert.equal(
        await classifyDbOpenFailure({ code: 'EACCES' }, '/Volumes/maplat-db-open-reason-missing-drive/x'),
        'not-found',
        'マウント点が外れたパスは場所が無い',
      );
      assert.equal(
        await classifyDbOpenFailure({ code: 'EACCES' }, '/Volumes/maplat-db-open-reason-missing-drive'),
        'not-found',
        '外れたドライブそのものも場所が無い',
      );
      // 書けない親フォルダの下で、まだ作られていない保存先は「権限が無い」のまま
      const roParent = path.join(scratch, 'ro-parent');
      await mkdir(roParent, { recursive: true });
      await symlink(roParent, path.join(scratch, 'link-ro'));
      await chmod(roParent, 0o555);
      try {
        for (const target of [
          path.join(roParent, 'MaplatEditor'),
          path.join(roParent, 'a', 'b'),
          path.join(scratch, 'link-ro', 'MaplatEditor'),
        ]) {
          assert.equal(await classifyDbOpenFailure({ code: 'EACCES' }, target), 'permission', '書けない親の下は権限が無い: ' + path.relative(scratch, target));
        }
        // 壊れた DB（26）・ロック中（5）は、フォルダが書けなくても権限へ寄せない
        assert.equal(await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 26 }, roParent), 'other');
        assert.equal(await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 5 }, roParent), 'other');
      } finally {
        await chmod(roParent, 0o755);
      }

      // --- Part 1c: 実測（chmod 000 のフォルダ・存在しないパス） ---
      // SQLite は chmod 000 の中へ開けないとき OS の errno ではなく SQLITE_CANTOPEN しか返さないため、
      // フォルダの状態を見て「権限が無い」「場所が無い」へ分ける
      const lockedDir = path.join(scratch, 'locked');
      await mkdir(lockedDir, { recursive: true });
      await chmod(lockedDir, 0o000);
      // 存在しないパス: 行き先の無い symlink（解決先が無い = その場所は存在しない）
      await symlink(path.join(scratch, 'gone-target'), path.join(scratch, 'dangling'));
      const missingDir = path.join(scratch, 'dangling');
      try {
        assert.equal(
          await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 14 }, lockedDir),
          'permission',
          'chmod 000 のフォルダは権限が無い',
        );
        assert.equal(
          await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 14 }, missingDir),
          'not-found',
          '存在しないパスは場所が無い',
        );

        // --- Part 1d: 失敗の応答（renderer へ渡す形）は理由と code だけで、パスを載せない ---
        const openError = await toDbOpenError(
          { code: 'ERR_SQLITE_ERROR', errcode: 14, message: 'unable to open database file: ' + lockedDir },
          lockedDir,
        );
        assert.ok(openError instanceof DbOpenError, 'toDbOpenError は DbOpenError を返す');
        assert.deepEqual(openError.failure, { reason: 'permission', code: 'SQLITE_CANTOPEN' });
        assert.ok(!openError.message.includes(lockedDir), 'エラーの文言にパスを載せない');
        const reply = toDbOpenFailureReply(openError);
        assert.deepEqual(reply, { failure: { reason: 'permission', code: 'SQLITE_CANTOPEN' } });
        assert.ok(!JSON.stringify(reply).includes(lockedDir), '応答にパスを載せない');
        assert.equal(toDbOpenFailureReply(new Error('boom')), null);

        assert.deepEqual(
          await withDbOpenFailureReply(() => Promise.reject(openError)),
          { failure: { reason: 'permission', code: 'SQLITE_CANTOPEN' } },
          'DbOpenError は理由つきの応答へ写像する',
        );
        assert.deepEqual(await withDbOpenFailureReply(() => Promise.resolve({ docs: [] })), { docs: [] });
        await assert.rejects(
          () => withDbOpenFailureReply(() => Promise.reject(new Error('boom'))),
          /boom/,
          'DB 開封以外の失敗は従来どおり reject する',
        );
      } finally {
        await chmod(lockedDir, 0o700);
      }

      // --- Part 2: SqliteDataService の実経路（getDb → searchMaps） ---
      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});

      const readFailure = async () => {
        try {
          await SqliteDataService.searchMaps('');
        } catch (error) {
          return error;
        }
        throw new Error('searchMaps は失敗するはず');
      };

      // 試験用の DB を作る。wal=true はアプリが作る形（WAL 化済み）、false は未 WAL の形
      const seedDatabase = (file: string, wal: boolean) => {
        const seed = new DatabaseSync(file);
        if (wal) seed.exec('PRAGMA journal_mode=WAL');
        seed.exec('CREATE TABLE t (x)');
        seed.close();
      };

      // 権限なし: chmod 000 の一時フォルダを保存先にする
      const lockedRoot = path.join(scratch, 'locked-store');
      await mkdir(lockedRoot, { recursive: true });
      await chmod(lockedRoot, 0o000);
      try {
        SettingsService.set('saveFolder', lockedRoot);
        const permissionFailure = await readFailure();
        assert.ok(permissionFailure instanceof DbOpenError, '権限なしの失敗は DbOpenError: ' + String(permissionFailure));
        assert.equal(permissionFailure.failure.reason, 'permission', '理由は権限が無い');
        assert.equal(permissionFailure.failure.code, 'SQLITE_CANTOPEN');
      } finally {
        await chmod(lockedRoot, 0o700);
      }

      // 場所なし: 存在しないパス（行き先の無い symlink）を保存先にする
      await SqliteDataService.reset();
      SettingsService.set('saveFolder', missingDir);
      const missingFailure = await readFailure();
      assert.ok(missingFailure instanceof DbOpenError, '場所なしの失敗は DbOpenError: ' + String(missingFailure));
      assert.equal(missingFailure.failure.reason, 'not-found', '理由は場所が無い');
      assert.equal(missingFailure.failure.code, 'ENOENT');

      // 読み取り専用フォルダ（chmod 555）に DB が既にある: 開封と読取りは通り、最初の
      // 書き込み（PRAGMA journal_mode=WAL）で errcode 1544（SQLITE_READONLY_DIRECTORY）になる
      const roDirStore = path.join(scratch, 'ro-dir-store');
      await mkdir(roDirStore, { recursive: true });
      seedDatabase(path.join(roDirStore, 'maplat.sqlite'), false);
      await chmod(roDirStore, 0o555);
      try {
        await SqliteDataService.reset();
        SettingsService.set('saveFolder', roDirStore);
        const roDirFailure = await readFailure();
        assert.ok(roDirFailure instanceof DbOpenError, '読み取り専用フォルダの失敗は DbOpenError: ' + String(roDirFailure));
        assert.equal(roDirFailure.failure.reason, 'permission', '読み取り専用フォルダは権限が無い');
        assert.equal(roDirFailure.failure.code, 'SQLITE_READONLY', '拡張 errcode 1544 は SQLITE_READONLY へ正規化する');
      } finally {
        await chmod(roDirStore, 0o755);
      }

      // WAL 化済みの DB では -shm/-wal が作れず、読取りでも errcode 1544 になる
      const roDirWalStore = path.join(scratch, 'ro-dir-wal-store');
      await mkdir(roDirWalStore, { recursive: true });
      seedDatabase(path.join(roDirWalStore, 'maplat.sqlite'), true);
      await chmod(roDirWalStore, 0o555);
      try {
        await SqliteDataService.reset();
        SettingsService.set('saveFolder', roDirWalStore);
        const roDirWalFailure = await readFailure();
        assert.ok(roDirWalFailure instanceof DbOpenError, 'WAL 化済み DB の読み取り専用フォルダも DbOpenError: ' + String(roDirWalFailure));
        assert.equal(roDirWalFailure.failure.reason, 'permission', 'WAL 化済み DB も権限が無い');
        assert.equal(roDirWalFailure.failure.code, 'SQLITE_READONLY');
      } finally {
        await chmod(roDirWalStore, 0o755);
      }

      // DB ファイルだけが読み取り専用（chmod 444）: 開封と読取りは通り、
      // PRAGMA journal_mode=WAL で errcode 8（SQLITE_READONLY）になる
      const roFileStore = path.join(scratch, 'ro-file-store');
      await mkdir(roFileStore, { recursive: true });
      const roFile = path.join(roFileStore, 'maplat.sqlite');
      seedDatabase(roFile, false);
      await chmod(roFile, 0o444);
      try {
        await SqliteDataService.reset();
        SettingsService.set('saveFolder', roFileStore);
        const roFileFailure = await readFailure();
        assert.ok(roFileFailure instanceof DbOpenError, '読み取り専用 DB ファイルの失敗は DbOpenError: ' + String(roFileFailure));
        assert.equal(roFileFailure.failure.reason, 'permission', '読み取り専用 DB ファイルは権限が無い');
        assert.equal(roFileFailure.failure.code, 'SQLITE_READONLY');
      } finally {
        await chmod(roFile, 0o644);
      }

      // WAL 化済みの DB ファイルだけが読み取り専用（chmod 444）: PRAGMA journal_mode=WAL は
      // 失敗せず wal を返すため、書けることの確かめ（user_version を書いて取り消す）で
      // errcode 8（SQLITE_READONLY）になる。確かめが無いと migrate の書き込みで理由なしに落ちる
      const roWalFileStore = path.join(scratch, 'ro-wal-file-store');
      await mkdir(roWalFileStore, { recursive: true });
      const roWalFile = path.join(roWalFileStore, 'maplat.sqlite');
      seedDatabase(roWalFile, true);
      await chmod(roWalFile, 0o444);
      try {
        await SqliteDataService.reset();
        SettingsService.set('saveFolder', roWalFileStore);
        const roWalFileFailure = await readFailure();
        assert.ok(roWalFileFailure instanceof DbOpenError, 'WAL 化済みの読み取り専用 DB ファイルの失敗は DbOpenError: ' + String(roWalFileFailure));
        assert.equal(roWalFileFailure.failure.reason, 'permission', 'WAL 化済みの読み取り専用 DB ファイルは権限が無い');
        assert.equal(roWalFileFailure.failure.code, 'SQLITE_READONLY');
      } finally {
        await chmod(roWalFile, 0o644);
      }

      // 読み取り専用のディスクイメージ上の未 WAL の DB: PRAGMA journal_mode=WAL は例外を出さず
      // delete を返す。書けることの確かめで errcode 8 になり、場所が読み取り専用（access が
      // EROFS）なので「読み取り専用の場所」へ分ける。
      // hdiutil のある macOS だけで試す（小さなイメージを作り、必ず外して消す）
      if (process.platform === 'darwin') {
        const imageSrc = path.join(scratch, 'ro-image-src');
        await mkdir(imageSrc, { recursive: true });
        seedDatabase(path.join(imageSrc, 'maplat.sqlite'), false);
        const imageFile = path.join(scratch, 'ro-image.dmg');
        const mountPoint = path.join(scratch, 'ro-image-mnt');
        await mkdir(mountPoint, { recursive: true });
        await execFileAsync('hdiutil', ['create', '-quiet', '-srcfolder', imageSrc, '-format', 'UDRO', '-volname', 'maplat-ro-smoke', '-ov', imageFile]);
        let attached = false;
        try {
          await execFileAsync('hdiutil', ['attach', '-quiet', '-readonly', '-nobrowse', '-mountpoint', mountPoint, imageFile]);
          attached = true;
          await SqliteDataService.reset();
          SettingsService.set('saveFolder', mountPoint);
          const roImageFailure = await readFailure();
          assert.ok(roImageFailure instanceof DbOpenError, '読み取り専用イメージ上の DB の失敗は DbOpenError: ' + String(roImageFailure));
          // 権限を足しても直らない（システム設定・chmod では書けるようにならない）ので、
          // 「権限が無い」ではなく「読み取り専用の場所」に分ける
          assert.equal(roImageFailure.failure.reason, 'readonly-location', '読み取り専用イメージ上の DB は読み取り専用の場所');
          assert.equal(roImageFailure.failure.code, 'SQLITE_READONLY');

          // 合成エラーでも、フォルダが読み取り専用のファイルシステム上なら読み取り専用の場所
          assert.equal(await classifyDbOpenFailure({ code: 'EACCES' }, mountPoint), 'readonly-location', 'EACCES でも場所が読み取り専用なら読み取り専用の場所');
          assert.equal(await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 14 }, mountPoint), 'readonly-location', 'SQLITE_CANTOPEN でも場所が読み取り専用なら読み取り専用の場所');
          // まだ無いフォルダでも、作る先（在る最も近い祖先）が読み取り専用なら読み取り専用の場所
          assert.equal(await classifyDbOpenFailure({ code: 'EACCES' }, path.join(mountPoint, 'a', 'b')), 'readonly-location', '読み取り専用の場所の下のまだ無いフォルダも読み取り専用の場所');
          // 壊れた DB（26）は、場所が読み取り専用でも「その他」のまま
          assert.equal(await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 26 }, mountPoint), 'other');

          // 読み取り専用のイメージの中に、まだ無いフォルダを保存先にする: ensureDir の mkdir は
          // EROFS ではなく ENOENT で落ちる（macOS の実測）が、作る先が読み取り専用なので読み取り専用の場所
          await SqliteDataService.reset();
          SettingsService.set('saveFolder', path.join(mountPoint, 'MaplatEditor'));
          const roImageSubFailure = await readFailure();
          assert.ok(roImageSubFailure instanceof DbOpenError, '読み取り専用イメージの中の新しいフォルダの失敗は DbOpenError: ' + String(roImageSubFailure));
          assert.equal(roImageSubFailure.failure.reason, 'readonly-location', '読み取り専用イメージの中の新しいフォルダは読み取り専用の場所');
          assert.equal(roImageSubFailure.failure.code, 'ENOENT');
        } finally {
          await SqliteDataService.reset();
          // 外すのに失敗しても、イメージのファイルは消す。外し損ねは握りつぶさず警告する
          if (attached) await detachImage(mountPoint);
          await rm(imageFile, { force: true });
        }
      }

      // 書けることの確かめは何も残さない: 健全な WAL 化済み DB の user_version と、
      // 確かめの前後で WAL の大きさが変わらないこと（同じ値を確定させる方法なら 1 頁伸びる）
      {
        const probeStore = path.join(scratch, 'probe-store');
        await mkdir(probeStore, { recursive: true });
        await SqliteDataService.reset();
        SettingsService.set('saveFolder', probeStore);
        await SqliteDataService.searchMaps('');
        const probeDb = await SqliteDataService.getDb();
        const versionBefore = (probeDb.prepare('PRAGMA user_version').get() as any).user_version;
        probeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        const walFile = path.join(probeStore, 'maplat.sqlite-wal');
        const walSizeBefore = (await stat(walFile)).size;
        (SqliteDataService as any).probeWritable(probeDb);
        assert.equal((await stat(walFile)).size, walSizeBefore, '確かめで WAL が伸びない');
        assert.equal((probeDb.prepare('PRAGMA user_version').get() as any).user_version, versionBefore, 'user_version は変わらない');
        assert.equal(probeDb.isTransaction, false, '確かめの後に取引を残さない');
        await SqliteDataService.reset();
      }

      // 外付けドライブが外れた状態のパス: ensureDir は ENOENT ではなく EACCES を返すが、
      // 「場所が無い」を優先する（この名前のドライブは無いので作ろうとしても失敗するだけ）
      const goneVolume = '/Volumes/maplat-db-open-reason-missing-drive/x';
      await SqliteDataService.reset();
      SettingsService.set('saveFolder', goneVolume);
      const goneVolumeFailure = await readFailure();
      assert.ok(goneVolumeFailure instanceof DbOpenError, '外れたマウント先の失敗は DbOpenError: ' + String(goneVolumeFailure));
      assert.equal(goneVolumeFailure.failure.reason, 'not-found', '外れたマウント先は場所が無い');

      // 権限を戻した後、同じフォルダのまま再試行で直る（reset() を挟まない）
      const retryStore = path.join(scratch, 'retry-store');
      await mkdir(retryStore, { recursive: true });
      await SqliteDataService.reset();
      SettingsService.set('saveFolder', retryStore);
      await chmod(retryStore, 0o000);
      try {
        const retryFailure = await readFailure();
        assert.ok(retryFailure instanceof DbOpenError, '権限が無い間の失敗は DbOpenError: ' + String(retryFailure));
        assert.equal(retryFailure.failure.reason, 'permission');
      } finally {
        await chmod(retryStore, 0o755);
      }
      assert.deepEqual(
        await SqliteDataService.searchMaps(''),
        [],
        '権限を戻した同じフォルダで再試行すると直る（reset なし）',
      );

      // 健全性: 使える保存先では一覧が返る（包み込みで通常経路を壊していないこと）
      await SqliteDataService.reset();
      const healthyRoot = path.join(scratch, 'healthy-store');
      await mkdir(healthyRoot, { recursive: true });
      SettingsService.set('saveFolder', healthyRoot);
      const docs = await SqliteDataService.searchMaps('');
      assert.deepEqual(docs, []);

      await rm(scratch, { recursive: true, force: true });
      console.log('db-open-reason smoke Part 1+2: OK');
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
        external: ['jimp'],
        output: {
          entryFileNames: 'db-open-reason-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8,
  });

  // --- Part 3: 画面の文言（全言語）と一覧の失敗表示の結線 ---
  const { readFile } = await import('node:fs/promises');
  const LOCALES = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  const REASON_KEYS = [
    'load_error_reason_permission',
    'load_error_reason_readonly_location',
    'load_error_reason_not_found',
    'load_error_reason_other',
  ];
  const FIX_KEYS = [
    'load_error_fix_permission',
    'load_error_fix_permission_windows',
    'load_error_fix_permission_linux',
    'load_error_fix_readonly_location',
    'load_error_fix_not_found',
    'load_error_fix_other',
  ];
  for (const locale of LOCALES) {
    const translation = JSON.parse(await readFile(path.join(projectRoot, 'public/locales', locale, 'translation.json'), 'utf8'));
    for (const key of [...REASON_KEYS, ...FIX_KEYS]) {
      assert.ok(
        typeof translation.resource_list?.[key] === 'string' && translation.resource_list[key].trim() !== '',
        'resource_list.' + key + ' missing in ' + locale,
      );
    }
  }
  const ja = JSON.parse(await readFile(path.join(projectRoot, 'public/locales/ja/translation.json'), 'utf8'));
  assert.equal(ja.resource_list.load_error_reason_permission, 'データフォルダを開く権限がありません');
  assert.equal(ja.resource_list.load_error_reason_not_found, 'データフォルダが見つかりません');
  // 読み取り専用の場所は、権限を足しても直らない。許可の場所（システム設定・権限）を案内せず、
  // データフォルダを書き込める場所へ変えることだけを案内する
  assert.equal(ja.resource_list.load_error_reason_readonly_location, 'データフォルダが読み取り専用の場所にあります');
  assert.equal(ja.resource_list.load_error_fix_readonly_location, '設定でデータフォルダを書き込める場所へ変えてください。');
  // 直し方の文は理由の文（読み取り専用の場所にあります）を繰り返さない
  assert.doesNotMatch(ja.resource_list.load_error_fix_readonly_location, /読み取り専用/);
  assert.doesNotMatch(ja.resource_list.load_error_fix_readonly_location, /システム設定|権限|許可/);
  assert.match(ja.resource_list.load_error_fix_permission, /システム設定で/);
  assert.match(ja.resource_list.load_error_fix_permission, /設定でデータフォルダを変えてください/);
  // Windows・Linux の文言に macOS の言い方（システム設定）を持ち込まない
  assert.match(ja.resource_list.load_error_fix_permission_windows, /Windows セキュリティ/);
  assert.match(ja.resource_list.load_error_fix_permission_linux, /書き込みの権限/);
  for (const key of ['load_error_fix_permission_windows', 'load_error_fix_permission_linux']) {
    assert.doesNotMatch(ja.resource_list[key], /システム設定/, key + ' は macOS の言い方を使わない');
    assert.match(ja.resource_list[key], /設定でデータフォルダを変えてください/);
  }

  const status = await readFile(path.join(projectRoot, 'src/components/resource-list/ResourceResultStatus.vue'), 'utf8');
  const loadFailureSource = await readFile(path.join(projectRoot, 'src/components/resource-list/loadFailure.ts'), 'utf8');
  for (const key of [...REASON_KEYS, ...FIX_KEYS]) {
    // 権限の直し方は OS ごとに loadFailure.ts の permissionFixKey が選ぶ
    const source = key.startsWith('load_error_fix_permission') ? loadFailureSource : status;
    assert.match(source, new RegExp('resource_list\\.' + key + '"'), 'resource_list.' + key + ' must be rendered');
  }
  assert.match(status, /permissionFixKey\(/, 'ResultStatus must pick the permission fix per OS');
  assert.match(status, /data-load-failure-reason/, 'ResultStatus must expose the reason hook');
  assert.match(status, /data-load-failure-fix/, 'ResultStatus must expose the fix hook');

  console.log('db-open-reason smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
