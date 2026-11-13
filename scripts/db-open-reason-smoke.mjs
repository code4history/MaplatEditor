// 保存先フォルダの DB を開けないとき、main 側が返す理由の code の単体試験。
// 権限なし（chmod 000 の一時フォルダ）と場所なし（存在しないパス）のそれぞれで、
// 理由が「権限が無い」「場所が無い」と分類されることを検査する。実データは開かない。
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
      import { chmod, mkdir, rm, symlink } from 'node:fs/promises';
      import path from 'node:path';
      import {
        DbOpenError,
        classifyDbOpenFailure,
        dbOpenFailureCode,
        toDbOpenError,
        toDbOpenFailureReply,
        withDbOpenFailureReply,
      } from ${JSON.stringify(dbOpenFailurePath)};

      const workDir = ${JSON.stringify(workDir)};
      const scratch = path.join(workDir, 'cases');
      await mkdir(scratch, { recursive: true });

      // --- Part 1a: code の正規化（パスを含まない記号だけを返す） ---
      assert.equal(dbOpenFailureCode({ code: 'EACCES' }), 'EACCES');
      assert.equal(dbOpenFailureCode({ code: 'EPERM' }), 'EPERM');
      assert.equal(dbOpenFailureCode({ code: 'ENOENT' }), 'ENOENT');
      assert.equal(dbOpenFailureCode({ code: 'ERR_SQLITE_ERROR', errcode: 14 }), 'SQLITE_CANTOPEN');
      assert.equal(dbOpenFailureCode({ code: 'ERR_SQLITE_ERROR', errcode: 8 }), 'SQLITE_READONLY');
      assert.equal(dbOpenFailureCode({}), 'unknown');
      assert.equal(dbOpenFailureCode(null), 'unknown');

      // --- Part 1b: 分類（合成エラー） ---
      const presentDir = path.join(scratch, 'present');
      await mkdir(presentDir, { recursive: true });
      assert.equal(await classifyDbOpenFailure({ code: 'EACCES' }, presentDir), 'permission');
      assert.equal(await classifyDbOpenFailure({ code: 'EPERM' }, presentDir), 'permission');
      assert.equal(await classifyDbOpenFailure({ code: 'EROFS' }, presentDir), 'permission');
      assert.equal(await classifyDbOpenFailure({ code: 'ENOENT' }, presentDir), 'not-found');
      assert.equal(await classifyDbOpenFailure({ code: 'ENOTDIR' }, presentDir), 'not-found');
      assert.equal(await classifyDbOpenFailure({ code: 'ERR_SQLITE_ERROR', errcode: 8 }, presentDir), 'permission');

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
  const REASON_KEYS = ['load_error_reason_permission', 'load_error_reason_not_found', 'load_error_reason_other'];
  const FIX_KEYS = ['load_error_fix_permission', 'load_error_fix_not_found', 'load_error_fix_other'];
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
  assert.match(ja.resource_list.load_error_fix_permission, /システム設定で/);
  assert.match(ja.resource_list.load_error_fix_permission, /設定でデータフォルダを変えてください/);

  const status = await readFile(path.join(projectRoot, 'src/components/resource-list/ResourceResultStatus.vue'), 'utf8');
  for (const key of [...REASON_KEYS, ...FIX_KEYS]) {
    assert.match(status, new RegExp('resource_list\\.' + key), 'ResultStatus must render resource_list.' + key);
  }
  assert.match(status, /data-load-failure-reason/, 'ResultStatus must expose the reason hook');
  assert.match(status, /data-load-failure-fix/, 'ResultStatus must expose the fix hook');

  console.log('db-open-reason smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
