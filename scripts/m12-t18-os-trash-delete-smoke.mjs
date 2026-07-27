// M12-T18 スモーク: 地図削除の originals 退避先を OS ゴミ箱 (shell.trashItem) へ移行した
// 新契約の分岐網羅 + 独自 trash 撤去の構造 assert。
// タスク設計 `docs/superpowers/specs/2026-07-27-m12-t18-os-trash-migration-design.md` §7.2 準拠。
// m13-t4 と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir)。
// スタブ shell.trashItem は呼び出しを記録し、指示に応じて reject できる (テストハーネス側の
// 既存様式であり、製品コードへの差し替え機構ではない。製品は素の `import { shell } from 'electron'`)。
// シナリオ:
//   Part A: 順序契約 — DB delete 強制失敗時は rethrow / trashItem 呼び出し 0件 / originals 無傷 (AC18-2)
//   Part B: 成功系 — canonical 全 variant + 一意 legacy の絶対パスで trashItem が呼ばれ、
//           tiles/tmbs/512 は従来どおり直接削除される (AC18-1 の呼び出し集合側 / AC18-3)
//   Part C: trashItem 失敗の継続 — reject でも削除全体は完遂し対象は live 残置 + warning (AC18-4)
//   Part D: ambiguous legacy (2件) は trashItem 対象にせず live 残置 + warning (AC18-5)
//   Part E: 構造 assert (撤去の恒久ガード、m12-t30 Part C の確立様式) —
//           MapTrashReconcileService.ts 不在 / reconcileDeletedMapsTrash 参照 0件 /
//           'trash' パス構築 0件 / moveToTrash・rollbackMoves 残存 0件 (AC18-3)
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t18-os-trash-delete-'));
const entryFile = path.join(workDir, 'm12-t18-os-trash-delete-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t18-os-trash-delete-smoke.mjs');

// ---- Part E 補助: ディレクトリを再帰走査して .ts ファイル中の文字列出現を数える ----
async function walkFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.tmp-smoke' || entry.name === 'dist') continue;
      out.push(...(await walkFiles(full, exts)));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

async function countOccurrences(dirs, exts, needle) {
  let count = 0;
  const hits = [];
  for (const dir of dirs) {
    const files = await walkFiles(dir, exts);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (content.includes(needle)) {
        count += 1;
        hits.push(file);
      }
    }
  }
  return { count, hits };
}

try {
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapDataServicePath = path.join(projectRoot, 'electron/services/MapDataService.ts');
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
      // M12-T18: shell.trashItem スタブ — 呼び出しを記録し、指示に応じて reject する。
      // 成功時はファイルシステムに一切触れない (record-only)。live 消滅の実証は
      // 本物の trashItem を呼ぶ E2E (tests/e2e/m12-t18-os-trash-delete.spec.ts) が担う
      export const shell = {
        trashCalls: [] as string[],
        rejectAll: false,
        async trashItem(p: string): Promise<void> {
          shell.trashCalls.push(p);
          if (shell.rejectAll) throw new Error('stub-trashitem-rejected: ' + p);
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
      const { default: MapDataService } = await import(${JSON.stringify(mapDataServicePath)});
      const { deleteMapWithTrash } = await import(${JSON.stringify(mapDeleteTrashServicePath)});
      // 製品コードと同一モジュール instance のスタブ (alias 'electron' と同じファイルに解決される)
      const { shell } = await import(${JSON.stringify(electronStubFile)});

      function setSaveFolder(dir: string) {
        SettingsService.set('saveFolder', dir);
        return {
          dataDir: dir,
          originalsDir: path.join(dir, 'originals'),
          tilesDir: path.join(dir, 'tiles'),
          thumbsDir: path.join(dir, 'tmbs'),
        };
      }

      async function seedMapFiles(dirs: any, uid: string, exts: string[], legacyNames: string[]) {
        for (const ext of exts) {
          await fs.writeFile(path.join(dirs.originalsDir, uid + '.' + ext), 'canonical-bytes-' + ext);
        }
        for (const name of legacyNames) {
          await fs.writeFile(path.join(dirs.originalsDir, name), 'legacy-bytes-' + name);
        }
        await fs.ensureDir(path.join(dirs.tilesDir, uid, '0'));
        await fs.writeFile(path.join(dirs.tilesDir, uid, '0', '0.jpg'), 'tile-bytes');
        await fs.ensureDir(dirs.thumbsDir);
        await fs.writeFile(path.join(dirs.thumbsDir, uid + '.jpg'), 'thumb-bytes');
        await fs.writeFile(path.join(dirs.thumbsDir, uid + '_512.jpg'), 'thumb-512-bytes');
      }

      async function readWarn(fn: () => Promise<any>): Promise<{ result: any; warnings: string[] }> {
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
        try {
          const result = await fn();
          return { result, warnings };
        } finally {
          console.warn = originalWarn;
        }
      }

      // ============================================================
      // Part A: 順序契約 — DB delete 強制失敗時は rethrow / trashItem 0件 / originals 無傷 (AC18-2)
      // ============================================================
      {
        const dirs = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-a'))});
        await fs.ensureDir(dirs.originalsDir);
        await SqliteDataService.getDb();

        const UID_A = 'a1111111-1111-4111-8111-111111111111';
        const SLUG_A = 'a1-order-contract';
        await SqliteDataService.createMap(SLUG_A, { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_A);
        await seedMapFiles(dirs, UID_A, ['jpg'], [SLUG_A + '.jpg']);

        shell.trashCalls.length = 0;
        const originalDeleteMap = SqliteDataService.deleteMap.bind(SqliteDataService);
        SqliteDataService.deleteMap = async () => { throw new Error('forced-db-delete-failure'); };
        let threw = false;
        try {
          await deleteMapWithTrash(UID_A);
        } catch (e: any) {
          threw = true;
          assert.equal(e.message, 'forced-db-delete-failure');
        } finally {
          SqliteDataService.deleteMap = originalDeleteMap;
        }
        assert.ok(threw, 'DB delete 失敗時は例外が伝播するはず (AC18-2)');
        assert.equal(shell.trashCalls.length, 0, 'DB delete 失敗時は trashItem が一切呼ばれないはず (順序契約, AC18-2): ' + JSON.stringify(shell.trashCalls));
        assert.ok(await SqliteDataService.findMap(UID_A), 'DB delete 失敗時は DB row が残っているはず');
        const canonicalA = path.join(dirs.originalsDir, UID_A + '.jpg');
        const legacyA = path.join(dirs.originalsDir, SLUG_A + '.jpg');
        assert.ok(await fs.pathExists(canonicalA), 'canonical は live に無傷で残るはず (移動ゼロ)');
        assert.equal(await fs.readFile(canonicalA, 'utf8'), 'canonical-bytes-jpg');
        assert.ok(await fs.pathExists(legacyA), 'legacy も live に無傷で残るはず (移動ゼロ)');
        assert.equal(await fs.readFile(legacyA, 'utf8'), 'legacy-bytes-' + SLUG_A + '.jpg');
        assert.ok(await fs.pathExists(path.join(dirs.tilesDir, UID_A)), 'DB delete 失敗時は tiles も削除されないはず');
        assert.ok(await fs.pathExists(path.join(dirs.thumbsDir, UID_A + '.jpg')), 'DB delete 失敗時は thumbnail も削除されないはず');
        assert.ok(!(await fs.pathExists(path.join(dirs.dataDir, 'trash'))), '独自 trash/ ディレクトリは一切生成されないはず (AC18-3)');
        console.log('ok: (Part A) DB delete failure rethrows with zero trashItem calls and originals untouched (AC18-2)');
      }

      // ============================================================
      // Part B: 成功系 — canonical 全 variant + 一意 legacy の絶対パスで trashItem / tiles・tmbs 直接削除 (AC18-1/3)
      // ============================================================
      {
        const dirs = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-b'))});
        await fs.ensureDir(dirs.originalsDir);

        const UID_B = 'b1111111-1111-4111-8111-111111111111';
        const SLUG_B = 'b1-success-set';
        await SqliteDataService.createMap(SLUG_B, { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_B);
        // canonical 2 variant (jpg/png) + 一意 legacy 1件
        await seedMapFiles(dirs, UID_B, ['jpg', 'png'], [SLUG_B + '.jpg']);

        shell.trashCalls.length = 0;
        await MapDataService.deleteMap(UID_B);

        assert.equal(await SqliteDataService.findMap(UID_B), null, 'DB row は削除されているはず');
        const expected = [
          path.join(dirs.originalsDir, UID_B + '.jpg'),
          path.join(dirs.originalsDir, UID_B + '.png'),
          path.join(dirs.originalsDir, SLUG_B + '.jpg'),
        ].sort();
        assert.deepEqual([...shell.trashCalls].sort(), expected,
          'canonical 全 variant + 一意 legacy が trashItem に渡るはず (AC18-1): ' + JSON.stringify(shell.trashCalls));
        for (const p of shell.trashCalls) {
          assert.ok(path.isAbsolute(p), 'trashItem へは絶対パスのみを渡すはず (§4.1 相対パス禁止): ' + p);
        }
        assert.ok(!(await fs.pathExists(path.join(dirs.tilesDir, UID_B))), 'tiles はゴミ箱でなく従来どおり直接削除されるはず (§5.4)');
        assert.ok(!(await fs.pathExists(path.join(dirs.thumbsDir, UID_B + '.jpg'))), 'thumbnail は直接削除されるはず');
        assert.ok(!(await fs.pathExists(path.join(dirs.thumbsDir, UID_B + '_512.jpg'))), '512 thumbnail は直接削除されるはず');
        assert.ok(!(await fs.pathExists(path.join(dirs.dataDir, 'trash'))), '独自 trash/ ディレクトリは生成されないはず (AC18-3)');
        console.log('ok: (Part B) successful delete passes canonical variants + unique legacy to trashItem and removes tiles/tmbs directly (AC18-1/AC18-3)');
      }

      // ============================================================
      // Part C: trashItem 失敗の継続 — reject でも削除完遂・対象 live 残置 + warning (AC18-4)
      // ============================================================
      {
        const dirs = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-c'))});
        await fs.ensureDir(dirs.originalsDir);

        const UID_C = 'c1111111-1111-4111-8111-111111111111';
        const SLUG_C = 'c1-trash-reject';
        await SqliteDataService.createMap(SLUG_C, { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_C);
        await seedMapFiles(dirs, UID_C, ['jpg'], []);

        shell.trashCalls.length = 0;
        shell.rejectAll = true;
        let warnings: string[] = [];
        try {
          ({ warnings } = await readWarn(() => MapDataService.deleteMap(UID_C)));
        } finally {
          shell.rejectAll = false;
        }

        assert.equal(await SqliteDataService.findMap(UID_C), null, 'trashItem 失敗でも DB row は削除されるはず (削除全体は成功, AC18-4)');
        assert.equal(shell.trashCalls.length, 1, 'canonical 1件に対して trashItem が呼ばれた記録があるはず');
        const canonicalC = path.join(dirs.originalsDir, UID_C + '.jpg');
        assert.ok(await fs.pathExists(canonicalC), 'trashItem 失敗した対象は live 残置のままのはず (非破壊, AC18-4)');
        assert.equal(await fs.readFile(canonicalC, 'utf8'), 'canonical-bytes-jpg', '残置ファイルの内容も無傷のはず');
        assert.ok(!(await fs.pathExists(path.join(dirs.tilesDir, UID_C))), 'trashItem 失敗でも tiles 削除は継続されるはず (AC18-4)');
        assert.ok(!(await fs.pathExists(path.join(dirs.thumbsDir, UID_C + '.jpg'))), 'trashItem 失敗でも thumbnail 削除は継続されるはず');
        assert.ok(
          warnings.some((w) => w.includes('OS trash') && w.includes(canonicalC)),
          'trashItem 失敗時は対象パスを含む console.warn が出るはず (AC18-4): ' + JSON.stringify(warnings)
        );
        console.log('ok: (Part C) trashItem rejection is per-file warned, target left live, delete completes (AC18-4)');
      }

      // ============================================================
      // Part D: ambiguous legacy (2件) は trashItem 対象にせず live 残置 + warning (AC18-5)
      // ============================================================
      {
        const dirs = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-d'))});
        await fs.ensureDir(dirs.originalsDir);

        const UID_D = 'd1111111-1111-4111-8111-111111111111';
        const SLUG_D = 'd1-ambiguous-legacy';
        await SqliteDataService.createMap(SLUG_D, { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_D);
        // canonical 1件 + 同 slug の legacy 2件 (ambiguous)
        await seedMapFiles(dirs, UID_D, ['jpg'], [SLUG_D + '.jpg', SLUG_D + '.png']);

        shell.trashCalls.length = 0;
        const { warnings } = await readWarn(() => MapDataService.deleteMap(UID_D));

        assert.equal(await SqliteDataService.findMap(UID_D), null, 'ambiguous legacy があっても DB row は削除されるはず');
        assert.deepEqual(
          shell.trashCalls,
          [path.join(dirs.originalsDir, UID_D + '.jpg')],
          'trashItem 対象は canonical のみのはず (ambiguous legacy は対象外, AC18-5): ' + JSON.stringify(shell.trashCalls)
        );
        assert.ok(await fs.pathExists(path.join(dirs.originalsDir, SLUG_D + '.jpg')), 'ambiguous legacy(jpg) は live 残置のはず (AC18-5)');
        assert.ok(await fs.pathExists(path.join(dirs.originalsDir, SLUG_D + '.png')), 'ambiguous legacy(png) も live 残置のはず');
        assert.ok(
          warnings.some((w) => w.includes('ambiguous legacy') && w.includes('candidates=2') && w.includes(UID_D) && w.includes(SLUG_D)),
          'legacyCandidateCount を含む console.warn が出るはず (AC18-5): ' + JSON.stringify(warnings)
        );
        console.log('ok: (Part D) ambiguous legacy files stay live with a warning; only canonical goes to trashItem (AC18-5)');
      }

      console.log('M12-T18 os-trash delete smoke (Part A-D) passed');
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
          entryFileNames: 'm12-t18-os-trash-delete-smoke.mjs',
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
  process.stdout.write(stdout);

  // ============================================================
  // Part E: 構造 assert (撤去の恒久ガード, AC18-3。m12-t30 Part C の確立様式)
  // ============================================================
  const reconcileServicePath = path.join(projectRoot, 'electron/services/MapTrashReconcileService.ts');
  assert.equal(
    existsSync(reconcileServicePath),
    false,
    'electron/services/MapTrashReconcileService.ts が撤去されていない (起動時 reconcile は m12-t18 で廃止)'
  );

  const productDirs = [path.join(projectRoot, 'electron')];
  for (const needle of ['reconcileDeletedMapsTrash', 'moveToTrash', 'rollbackMoves', "'trash'"]) {
    const { count, hits } = await countOccurrences(productDirs, ['.ts'], needle);
    assert.equal(
      count,
      0,
      `製品コード (electron/) に ${needle} が残存している (独自 trash 機構の残骸, AC18-3): ${JSON.stringify(hits)}`
    );
  }
  console.log('ok: (Part E) MapTrashReconcileService absent; no reconcile/moveToTrash/rollbackMoves/\'trash\' remnants in electron/ (AC18-3)');

  console.log('M12-T18 os-trash delete smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
