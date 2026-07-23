// M13-T3 スモーク: slug originals → UUID originals の one-shot migration/report。
// m13-t2 と同じ sandbox 方式 (vite SSR ビルド + electron スタブ + saveFolder=一時dir) で
// OriginalsMigrationService.runColdBoot/runManual と MigrationReportService.mergeAndWriteReport を
// behavioral に検証する。runColdBoot/runManual は db: DatabaseSync を直接受け取る設計
// (§4.1: getDb() 再入禁止) のため、SqliteDataService/getDb() は経由せず node:sqlite の
// DatabaseSync に直接 maps テーブルを作って fixture rows を投入する。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t3-originals-migration-design.md` §5/§7 準拠。
// シナリオ:
//   (B) 7種の MigrationCandidateKind が report entries へ反映される (AC-T3-3)。
//       このうち copyable → migrated のケースで AC-T3-1 (source 不変) / AC-T3-2
//       (temp copy -> fsync -> atomic rename, .m13-tmp 空) も同時に検証する。
//   (C) crash 後の残留 temp cleanup と再実行の正しさ (AC-T3-4)
//   (D) 既存 report フィールド (renamedSlugs/renamedFiles/warnings) の不変性 (AC-T3-5)
//   (E) 並走 run の single-flight 相乗り。rows あり/0件の両方 (AC-T3-6、Major 4 回帰防止)
//   (F) runManual() が mode:'manual' を report に記録する (AC-T3-7)
//   (G) 単一 map の copy 失敗 (source がディレクトリ) が他 map の処理を止めない (AC-T3-8)
//   (H) 進捗通知: copyable >= 1 のときだけ database.migrating_originals が送出される
//       (設計レビュー v2 Minor 2 の実装時吸収 — §5.6 の runInternal への配線確認)
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm13-t3-originals-migration-'));
const entryFile = path.join(workDir, 'm13-t3-originals-migration-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm13-t3-originals-migration-smoke.mjs');

try {
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const originalsMigrationPath = path.join(projectRoot, 'electron/services/OriginalsMigrationService.ts');

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
      export const session = {
        defaultSession: {
          clearStorageData() { return Promise.resolve(); },
        },
      };
      globalThis.__appProgressEvents = [];
      const fakeWindow = {
        webContents: {
          send(channel: string, payload: any) {
            globalThis.__appProgressEvents.push({ channel, payload });
          },
        },
      };
      export const BrowserWindow = {
        getAllWindows() { return [fakeWindow]; },
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
      import { DatabaseSync } from 'node:sqlite';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      const { runColdBoot, runManual } = await import(${JSON.stringify(originalsMigrationPath)});

      function makeMapsDb(rows) {
        const db = new DatabaseSync(':memory:');
        db.exec('CREATE TABLE maps (uid TEXT PRIMARY KEY, slug TEXT NOT NULL, data_json TEXT NOT NULL)');
        const stmt = db.prepare('INSERT INTO maps (uid, slug, data_json) VALUES (?, ?, ?)');
        for (const row of rows) stmt.run(row.uid, row.slug, row.data_json);
        return db;
      }

      async function readReport(dataDir) {
        return JSON.parse(await fs.readFile(path.join(dataDir, 'migration-report-v2.json'), 'utf8'));
      }

      // ============================================================
      // (B) 7種の MigrationCandidateKind が report entries へ反映される (AC-T3-3)。
      // copyable -> migrated のケースで AC-T3-1 (source不変) / AC-T3-2 (temp/atomic rename) も検証する。
      // ============================================================
      {
        const dataDir = ${JSON.stringify(path.join(workDir, 'data-outcomes'))};
        const originalsDir = path.join(dataDir, 'originals');
        await fs.ensureDir(originalsDir);
        SettingsService.set('saveFolder', dataDir);

        // already_migrated: legacy source と exact target が同内容
        await fs.writeFile(path.join(originalsDir, 'already-slug.jpg'), 'same-bytes-already');
        await fs.writeFile(path.join(originalsDir, 'uid-already.jpg'), 'same-bytes-already');

        // skip_target_conflict: legacy source と exact target が異内容
        await fs.writeFile(path.join(originalsDir, 'conflict-slug.jpg'), 'source-bytes');
        await fs.writeFile(path.join(originalsDir, 'uid-conflict.jpg'), 'different-target-bytes');

        // skip_canonical_variant_exists: legacy source無し、別ext canonical variant あり
        await fs.writeFile(path.join(originalsDir, 'uid-variant.png'), 'variant-bytes');

        // skip_ambiguous_legacy: legacy候補2件
        await fs.writeFile(path.join(originalsDir, 'ambiguous-slug.jpg'), 'amb-a');
        await fs.writeFile(path.join(originalsDir, 'ambiguous-slug.png'), 'amb-b');

        // skip_unsupported_extension: imageExtensionがallowed set外 (ファイル不要)
        // skip_source_missing: legacy無し、canonical無し (ファイル不要)

        // copyable -> migrated: legacy source 1件のみ
        await fs.writeFile(path.join(originalsDir, 'copyable-slug.jpg'), 'copyable-source-bytes');

        const rows = [
          { uid: 'uid-already', slug: 'already-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
          { uid: 'uid-conflict', slug: 'conflict-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
          { uid: 'uid-variant', slug: 'variant-slug-nofile', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
          { uid: 'uid-ambiguous', slug: 'ambiguous-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
          { uid: 'uid-unsupported', slug: 'unsupported-slug', data_json: JSON.stringify({ imageExtension: 'tiff' }) },
          { uid: 'uid-missing', slug: 'missing-slug-nothing', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
          { uid: 'uid-copyable', slug: 'copyable-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ];
        const db = makeMapsDb(rows);
        const result = await runColdBoot(db);

        const byUid = Object.fromEntries(result.entries.map((e) => [e.uid, e]));
        assert.equal(byUid['uid-already'].outcome, 'already_migrated');
        assert.equal(byUid['uid-conflict'].outcome, 'skip_target_conflict');
        assert.equal(byUid['uid-variant'].outcome, 'skip_canonical_variant_exists');
        assert.equal(byUid['uid-ambiguous'].outcome, 'skip_ambiguous_legacy');
        assert.equal(byUid['uid-unsupported'].outcome, 'skip_unsupported_extension');
        assert.equal(byUid['uid-missing'].outcome, 'skip_source_missing');
        assert.equal(byUid['uid-copyable'].outcome, 'migrated');
        assert.equal(result.summary['already_migrated'], 1);
        assert.equal(result.summary['skip_target_conflict'], 1);
        assert.equal(result.summary['skip_canonical_variant_exists'], 1);
        assert.equal(result.summary['skip_ambiguous_legacy'], 1);
        assert.equal(result.summary['skip_unsupported_extension'], 1);
        assert.equal(result.summary['skip_source_missing'], 1);
        assert.equal(result.summary['migrated'], 1);
        console.log('ok: (B) all 7 MigrationCandidateKind outcomes reflected in report entries/summary (AC-T3-3)');

        // AC-T3-1: source は1byteも変更されない
        const sourceAfter = await fs.readFile(path.join(originalsDir, 'copyable-slug.jpg'), 'utf8');
        assert.equal(sourceAfter, 'copyable-source-bytes', 'source は migration 後も不変のはず (AC-T3-1)');
        // AC-T3-2: target が source と同内容で作られ、.m13-tmp が空になっている
        const targetAfter = await fs.readFile(path.join(originalsDir, 'uid-copyable.jpg'), 'utf8');
        assert.equal(targetAfter, 'copyable-source-bytes', 'target は source と同内容のはず (AC-T3-2)');
        const tmpEntries = await fs.readdir(path.join(originalsDir, '.m13-tmp')).catch(() => []);
        assert.deepEqual(tmpEntries, [], '.m13-tmp は migration 後に空であるはず (AC-T3-2)');
        console.log('ok: (B-copyable) AC-T3-1 (source unchanged) / AC-T3-2 (atomic copy, .m13-tmp clean)');

        // report ファイルにも originalsUuidMigration が書かれている
        const report = await readReport(dataDir);
        assert.ok(report.originalsUuidMigration);
        assert.equal(report.originalsUuidMigration.mode, 'startup');
        assert.equal(report.originalsUuidMigration.summary.migrated, 1);
        console.log('ok: (B-report) migration-report-v2.json に originalsUuidMigration が additive に書かれる');
      }

      // ============================================================
      // (C) crash 後の残留 temp cleanup と再実行の正しさ (AC-T3-4)
      // ============================================================
      {
        const dataDir = ${JSON.stringify(path.join(workDir, 'data-crash'))};
        const originalsDir = path.join(dataDir, 'originals');
        const tmpRoot = path.join(originalsDir, '.m13-tmp');
        await fs.ensureDir(tmpRoot);
        SettingsService.set('saveFolder', dataDir);

        // 前回 crash の残留 temp を事前配置
        const staleTemp = path.join(tmpRoot, 'stale-leftover.jpg.m13tmp');
        await fs.writeFile(staleTemp, 'stale-crash-residue');
        // .m13tmp で終わらない無関係ファイルは cleanup 対象外(除去されないはず)
        const unrelatedFile = path.join(tmpRoot, 'not-a-temp-file.txt');
        await fs.writeFile(unrelatedFile, 'unrelated');

        await fs.writeFile(path.join(originalsDir, 'crash-slug.jpg'), 'crash-source-bytes');
        const rows = [
          { uid: 'uid-crash', slug: 'crash-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ];
        const db = makeMapsDb(rows);
        const result = await runColdBoot(db);

        assert.equal(result.entries[0].outcome, 'migrated', 'crash後の再実行でも正規の migration 結果が得られるはず');
        assert.ok(!(await fs.pathExists(staleTemp)), '残留 *.m13tmp は cleanup で削除されるはず (AC-T3-4)');
        assert.ok(await fs.pathExists(unrelatedFile), '*.m13tmp で終わらないファイルは cleanup 対象外のはず');
        assert.ok(await fs.pathExists(path.join(originalsDir, 'uid-crash.jpg')), '正規の migration は cleanup と両立するはず');
        console.log('ok: (C) stale *.m13tmp cleanup does not interfere with correct migration (AC-T3-4)');
      }

      // ============================================================
      // (D) 既存 report フィールド (renamedSlugs/renamedFiles/warnings) の不変性 (AC-T3-5)
      // ============================================================
      {
        const dataDir = ${JSON.stringify(path.join(workDir, 'data-report-preserve'))};
        const originalsDir = path.join(dataDir, 'originals');
        await fs.ensureDir(originalsDir);
        SettingsService.set('saveFolder', dataDir);

        const legacyReport = {
          renamedSlugs: [{ kind: 'map', from: 'old-slug', to: 'new-slug' }],
          renamedFiles: [{ from: 'tiles/old-slug', to: 'tiles/some-uid' }],
          warnings: ['pre-existing warning'],
        };
        await fs.writeJson(path.join(dataDir, 'migration-report-v2.json'), legacyReport, { spaces: 2 });

        const rows = [
          { uid: 'uid-nochange', slug: 'nochange-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ];
        const db = makeMapsDb(rows);
        await runColdBoot(db);

        const reportAfter = await readReport(dataDir);
        assert.deepEqual(reportAfter.renamedSlugs, legacyReport.renamedSlugs, 'renamedSlugs は不変のはず (AC-T3-5)');
        assert.deepEqual(reportAfter.renamedFiles, legacyReport.renamedFiles, 'renamedFiles は不変のはず (AC-T3-5)');
        assert.deepEqual(reportAfter.warnings, legacyReport.warnings, 'warnings は不変のはず (AC-T3-5、T3はwarningsへ積まない §5.5)');
        assert.ok(reportAfter.originalsUuidMigration, 'originalsUuidMigration は additive に追加されるはず');
        console.log('ok: (D) legacy report fields (renamedSlugs/renamedFiles/warnings) untouched by additive merge (AC-T3-5)');
      }

      // ============================================================
      // (E) 並走 run の single-flight 相乗り (AC-T3-6、Major 4 回帰防止で0件パスも検証)
      // ============================================================
      {
        const dataDir = ${JSON.stringify(path.join(workDir, 'data-singleflight'))};
        const originalsDir = path.join(dataDir, 'originals');
        await fs.ensureDir(originalsDir);
        SettingsService.set('saveFolder', dataDir);

        await fs.writeFile(path.join(originalsDir, 'sf-slug.jpg'), 'sf-source-bytes');
        const rows = [
          { uid: 'uid-sf', slug: 'sf-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ];
        const dbA = makeMapsDb(rows);
        const [resultA, resultB] = await Promise.all([runColdBoot(dbA), runColdBoot(dbA)]);
        assert.equal(resultA, resultB, '並走 runColdBoot は同一の in-flight 結果に相乗りするはず (AC-T3-6)');
        console.log('ok: (E-1) concurrent runColdBoot calls with rows share the same in-flight result');

        // 0件パスも single-flight を経由する (Major 4 回帰防止)
        const dataDirEmpty = ${JSON.stringify(path.join(workDir, 'data-singleflight-empty'))};
        await fs.ensureDir(dataDirEmpty);
        SettingsService.set('saveFolder', dataDirEmpty);
        const dbEmpty = makeMapsDb([]);
        const [emptyA, emptyB] = await Promise.all([runColdBoot(dbEmpty), runColdBoot(dbEmpty)]);
        assert.equal(emptyA, emptyB, '0件の並走 runColdBoot も同一の in-flight 結果に相乗りするはず (Major 4 回帰防止)');
        assert.deepEqual(emptyA.entries, [], '0件パスは entries 空で返るはず');
        console.log('ok: (E-2) concurrent runColdBoot calls with zero rows also share the same in-flight result (Major 4 regression guard)');
      }

      // ============================================================
      // (F) runManual() が mode:'manual' を report に記録する (AC-T3-7)
      // ============================================================
      {
        const dataDir = ${JSON.stringify(path.join(workDir, 'data-manual-mode'))};
        const originalsDir = path.join(dataDir, 'originals');
        await fs.ensureDir(originalsDir);
        SettingsService.set('saveFolder', dataDir);

        await fs.writeFile(path.join(originalsDir, 'manual-slug.jpg'), 'manual-source-bytes');
        const rows = [
          { uid: 'uid-manual', slug: 'manual-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ];
        const db = makeMapsDb(rows);
        const result = await runManual(db);
        assert.equal(result.mode, 'manual');
        const report = await readReport(dataDir);
        assert.equal(report.originalsUuidMigration.mode, 'manual', 'report にも mode:manual が記録されるはず (AC-T3-7)');
        console.log('ok: (F) runManual() records mode:manual in both return value and report (AC-T3-7)');
      }

      // ============================================================
      // (G) 単一 map の copy 失敗が他 map の処理を止めない (AC-T3-8)
      // ============================================================
      {
        const dataDir = ${JSON.stringify(path.join(workDir, 'data-per-map-failure'))};
        const originalsDir = path.join(dataDir, 'originals');
        await fs.ensureDir(originalsDir);
        SettingsService.set('saveFolder', dataDir);

        // 意図的な copy 失敗 fixture: classify は basename+ext 一致のみで判定し内容を読まないため、
        // legacy source を「ディレクトリ」にしても copyable と分類される。実際の
        // fs.copyFile(directory, ...) はEISDIRで失敗するため、決定的に copy_failed を再現できる
        // (書き込み不可権限ディレクトリ方式は originals/ 配下が全 map で共有され per-map 分離できない
        // ため、per-map の isolation を検証するにはこちらがより確実)
        await fs.ensureDir(path.join(originalsDir, 'dirsource-slug.jpg'));
        await fs.writeFile(path.join(originalsDir, 'ok-slug.jpg'), 'ok-source-bytes');

        const rows = [
          { uid: 'uid-dirsource', slug: 'dirsource-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
          { uid: 'uid-ok', slug: 'ok-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
          { uid: 'uid-missing2', slug: 'missing2-slug-nothing', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ];
        const db = makeMapsDb(rows);
        // 例外が伝播しないこと
        const result = await runColdBoot(db);

        const byUid = Object.fromEntries(result.entries.map((e) => [e.uid, e]));
        assert.equal(byUid['uid-dirsource'].outcome, 'copy_failed', '失敗した map は copy_failed として記録されるはず (AC-T3-8)');
        assert.ok(byUid['uid-dirsource'].detail && byUid['uid-dirsource'].detail.length > 0, 'copy_failed entry は detail にエラーメッセージを含むはず');
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, 'uid-dirsource.jpg'))),
          'copy 失敗時は target が作られないはず'
        );
        assert.equal(byUid['uid-ok'].outcome, 'migrated', '他 map は正常に migrated として処理が継続するはず (AC-T3-8)');
        assert.equal(byUid['uid-missing2'].outcome, 'skip_source_missing', '他 map は正常に skip_* として処理が継続するはず (AC-T3-8)');
        assert.ok(await fs.pathExists(path.join(originalsDir, 'uid-ok.jpg')), '正常な map の migration 自体は完遂するはず');
        console.log('ok: (G) single map copy failure (copy_failed outcome) does not block other maps or throw (AC-T3-8)');
      }

      // ============================================================
      // (H) 進捗通知: copyable >= 1 のときだけ database.migrating_originals が送出される
      // (設計レビュー v2 Minor 2 の実装時吸収)
      // ============================================================
      {
        // (H-1) copyable 0件 -> 送出されない
        globalThis.__appProgressEvents.length = 0;
        const dataDirNone = ${JSON.stringify(path.join(workDir, 'data-progress-none'))};
        await fs.ensureDir(dataDirNone);
        SettingsService.set('saveFolder', dataDirNone);
        const dbNone = makeMapsDb([
          { uid: 'uid-progress-missing', slug: 'progress-missing-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ]);
        await runColdBoot(dbNone);
        assert.ok(
          !globalThis.__appProgressEvents.some((e) => e.channel === 'app:taskProgress' && e.payload.text === 'database.migrating_originals'),
          'copyable 0件のときは database.migrating_originals を送出しないはず'
        );
        console.log('ok: (H-1) no database.migrating_originals progress event when there are zero copyable maps');

        // (H-2) copyable 1件以上 -> 送出される
        globalThis.__appProgressEvents.length = 0;
        const dataDirSome = ${JSON.stringify(path.join(workDir, 'data-progress-some'))};
        const originalsDirSome = path.join(dataDirSome, 'originals');
        await fs.ensureDir(originalsDirSome);
        SettingsService.set('saveFolder', dataDirSome);
        await fs.writeFile(path.join(originalsDirSome, 'progress-slug.jpg'), 'progress-source-bytes');
        const dbSome = makeMapsDb([
          { uid: 'uid-progress-copyable', slug: 'progress-slug', data_json: JSON.stringify({ imageExtension: 'jpg' }) },
        ]);
        await runColdBoot(dbSome);
        assert.ok(
          globalThis.__appProgressEvents.some((e) => e.channel === 'app:taskProgress' && e.payload.text === 'database.migrating_originals'),
          'copyable 1件以上のときは database.migrating_originals を送出するはず'
        );
        console.log('ok: (H-2) database.migrating_originals progress event sent when at least one copyable map exists');
      }

      console.log('M13-T3 originals migration smoke passed');
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
          entryFileNames: 'm13-t3-originals-migration-smoke.mjs',
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
  console.log('M13-T3 originals migration smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
