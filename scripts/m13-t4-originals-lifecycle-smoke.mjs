// M13-T4 スモーク: UUID originals lifecycle parity (rename/clone/delete) と startup reconcile。
// m13-t2/t3 と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// MapEditService.save() の rename/clone 分岐、MapDataService.deleteMap()
// (= MapDeleteTrashService.deleteMapWithTrash())、SqliteDataService.migrate() が呼ぶ
// MapTrashReconcileService.reconcileDeletedMapsTrash(db) を behavioral に検証する。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t4-originals-lifecycle-design.md` §5/§7/§8 準拠。
// シナリオ:
//   Part A: rename、canonical 保有 map（変更なしの確認、AC-T4-1）
//   Part B: rename、legacy-only map（basename 追随の既存動作確認、AC-T4-1）
//   Part C: rename、naramachi 型 ambiguous legacy（2件併存）map（§5.1 のシナリオ分析の実証、AC-T4-1）
//   Part D: clone、canonical-only 複製元（AC-T4-2 主要ケース、m13-t2 Part G の既知差異の解消確認）
//   Part E: clone、legacy-only 複製元（AC-T4-2）
//   Part F: clone、原本解決不能な複製元（best-effort skip の確認、AC-T4-2）
//   Part G: delete、canonical+legacy 併存（trash move + live 消失の確認、AC-T4-3）
//   Part H: delete、DB delete 強制失敗 → ロールバック確認（AC-T4-3）
//   Part I: delete、ambiguous legacy（2件併存）→ legacy 2件とも live 残置 + console.warn（AC-T4-3(c)）
//   Part J: reconcile、trash+DB row 存在 → restore（AC-T4-5）
//   Part K: reconcile、trash+DB row 存在+live 既存 → restore せず warning（AC-T4-5）
//   Part L: reconcile、trash+DB row 不在 → 何もしない（AC-T4-5）
//   Part M: delete 成功後の trash 非 purge（複数回の reconcile 実行後も trash 残存、AC-T4-4）
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm13-t4-originals-lifecycle-'));
const entryFile = path.join(workDir, 'm13-t4-originals-lifecycle-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm13-t4-originals-lifecycle-smoke.mjs');

try {
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');
  const mapDataServicePath = path.join(projectRoot, 'electron/services/MapDataService.ts');
  const mapDeleteTrashServicePath = path.join(projectRoot, 'electron/services/MapDeleteTrashService.ts');
  const mapTrashReconcileServicePath = path.join(projectRoot, 'electron/services/MapTrashReconcileService.ts');

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
      const { default: MapDataService } = await import(${JSON.stringify(mapDataServicePath)});
      const { deleteMapWithTrash } = await import(${JSON.stringify(mapDeleteTrashServicePath)});
      const { reconcileDeletedMapsTrash } = await import(${JSON.stringify(mapTrashReconcileServicePath)});

      function setSaveFolder(dir: string) {
        SettingsService.set('saveFolder', dir);
        return { dataDir: dir, originalsDir: path.join(dir, 'originals') };
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
      // Part A: rename、canonical 保有 map（変更なしの確認、AC-T4-1）
      // ============================================================
      {
        const { dataDir, originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-a'))});
        await fs.ensureDir(originalsDir);
        await SqliteDataService.getDb();

        const UID_A1 = 'a1111111-1111-4111-8111-111111111111';
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveA1Create = await MapEditService.save({
          mapObject: {
            mapID: 'a1-canonical-map', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder),
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'a1-canonical-map',
          uid: UID_A1,
          create: true,
        });
        assert.equal(saveA1Create.result, 'Success');
        const canonicalA1 = path.join(originalsDir, UID_A1 + '.jpg');
        assert.ok(await fs.pathExists(canonicalA1), 'canonical が作られているはず');
        const canonicalA1BytesBefore = await fs.readFile(canonicalA1);

        const saveA1Rename = await MapEditService.save({
          mapObject: { mapID: 'a1-renamed', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'a1-renamed',
          uid: UID_A1,
        });
        assert.equal(saveA1Rename.result, 'Success', 'rename は成功するはず: ' + JSON.stringify(saveA1Rename));
        assert.ok(await fs.pathExists(canonicalA1), 'canonical original file name は rename で変わらないはず (AC-T4-1)');
        const canonicalA1BytesAfter = await fs.readFile(canonicalA1);
        assert.ok(canonicalA1BytesBefore.equals(canonicalA1BytesAfter), 'canonical の内容も不変のはず');
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, 'a1-renamed.jpg'))),
          'rename で legacy(新slugキー) の originals ファイルが新規に作られてはいけない'
        );
        console.log('ok: (Part A) rename leaves canonical original untouched (AC-T4-1)');
      }

      // ============================================================
      // Part B: rename、legacy-only map（basename 追随の既存動作確認、AC-T4-1）
      // ============================================================
      {
        const { originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-b'))});
        await fs.ensureDir(originalsDir);

        const UID_B1 = 'b1111111-1111-4111-8111-111111111111';
        await SqliteDataService.createMap('b1-legacy-map', { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_B1);
        await fs.writeFile(path.join(originalsDir, 'b1-legacy-map.jpg'), 'legacy-bytes-b1');

        const saveB1Rename = await MapEditService.save({
          mapObject: { mapID: 'b1-renamed', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'b1-renamed',
          uid: UID_B1,
        });
        assert.equal(saveB1Rename.result, 'Success');
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, 'b1-legacy-map.jpg'))),
          '旧 slug 名の legacy ファイルは無くなっているはず(basename 追随)'
        );
        const renamedLegacy = path.join(originalsDir, 'b1-renamed.jpg');
        assert.ok(await fs.pathExists(renamedLegacy), '新 slug 名の legacy ファイルが存在するはず');
        assert.equal((await fs.readFile(renamedLegacy, 'utf8')), 'legacy-bytes-b1', '内容は不変のはず');
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, UID_B1 + '.jpg'))),
          'legacy-only map の rename で canonical(uid キー) は作られないはず'
        );
        console.log('ok: (Part B) rename follows legacy basename to new slug (existing behavior, AC-T4-1)');
      }

      // ============================================================
      // Part C: rename、naramachi 型 ambiguous legacy（2件併存）map（AC-T4-1）
      // ============================================================
      {
        const { originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-c'))});
        await fs.ensureDir(originalsDir);

        const UID_C1 = 'c1111111-1111-4111-8111-111111111111';
        await SqliteDataService.createMap('c1-ambiguous-map', { imageExtension: 'png', gcps: [], edges: [], sub_maps: [] }, UID_C1);
        await fs.writeFile(path.join(originalsDir, 'c1-ambiguous-map.jpg'), 'legacy-jpg-bytes-c1');
        await fs.writeFile(path.join(originalsDir, 'c1-ambiguous-map.png'), 'legacy-png-bytes-c1');

        // naramachi のように DB imageExtension = 'png'(新しい方)を mapObject に渡して rename する
        const saveC1Rename = await MapEditService.save({
          mapObject: { mapID: 'c1-renamed', imageExtension: 'png', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'c1-renamed',
          uid: UID_C1,
        });
        assert.equal(saveC1Rename.result, 'Success', 'ambiguous legacy を持つ map の rename もクラッシュせず成功するはず');

        assert.ok(
          await fs.pathExists(path.join(originalsDir, 'c1-renamed.png')),
          'DB imageExtension(png) と一致する1拡張子だけが新 slug 名へ追随するはず'
        );
        assert.equal(
          await fs.readFile(path.join(originalsDir, 'c1-renamed.png'), 'utf8'),
          'legacy-png-bytes-c1'
        );
        assert.ok(
          await fs.pathExists(path.join(originalsDir, 'c1-ambiguous-map.jpg')),
          'DB imageExtension と一致しないもう1拡張子(jpg)は旧 slug 名のまま残置されるはず(既存動作)'
        );
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, 'c1-renamed.jpg'))),
          'jpg は新 slug 名へは追随しないはず'
        );
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, 'c1-ambiguous-map.png'))),
          '追随した png は旧 slug 名では消えているはず'
        );
        console.log('ok: (Part C) naramachi-style ambiguous legacy rename does not crash; only the DB-imageExtension-matching file follows (AC-T4-1)');
      }

      // ============================================================
      // Part D: clone、canonical-only 複製元（AC-T4-2 主要ケース）
      // ============================================================
      {
        const { originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-d'))});
        await fs.ensureDir(originalsDir);

        const UID_D_SRC = 'd1111111-1111-4111-8111-111111111111';
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveDSrc = await MapEditService.save({
          mapObject: {
            mapID: 'd1-clone-src', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder),
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'd1-clone-src',
          uid: UID_D_SRC,
          create: true,
        });
        assert.equal(saveDSrc.result, 'Success');
        const srcCanonical = path.join(originalsDir, UID_D_SRC + '.jpg');
        assert.ok(await fs.pathExists(srcCanonical));
        assert.ok(!(await fs.pathExists(path.join(originalsDir, 'd1-clone-src.jpg'))), '複製元は legacy を持たないはず');

        const UID_D_DEST = 'd2222222-2222-4222-8222-222222222222';
        const saveDDest = await MapEditService.save({
          mapObject: { mapID: 'd1-clone-dest', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'd1-clone-dest',
          uid: UID_D_DEST,
          copyFromUid: UID_D_SRC,
          create: true,
        });
        assert.equal(saveDDest.result, 'Success');
        const destCanonical = path.join(originalsDir, UID_D_DEST + '.jpg');
        assert.ok(await fs.pathExists(destCanonical), 'clone 先の canonical(uidキー) が作られるはず (AC-T4-2)');
        assert.equal(
          await fs.readFile(destCanonical, 'utf8'),
          await fs.readFile(srcCanonical, 'utf8'),
          '複製先 canonical の内容は複製元 canonical と同一のはず'
        );
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, 'd1-clone-dest.jpg'))),
          'clone 先には legacy(slugキー) の originals ファイルは作られないはず(m13-t2 Part G の既知差異の解消)'
        );
        console.log('ok: (Part D) clone from canonical-only source copies resolved original to dest canonical (AC-T4-2)');
      }

      // ============================================================
      // Part E: clone、legacy-only 複製元（AC-T4-2）
      // ============================================================
      {
        const { originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-e'))});
        await fs.ensureDir(originalsDir);

        const UID_E_SRC = 'e1111111-1111-4111-8111-111111111111';
        await SqliteDataService.createMap('e1-clone-src-legacy', { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_E_SRC);
        await fs.writeFile(path.join(originalsDir, 'e1-clone-src-legacy.jpg'), 'legacy-src-bytes-e1');

        const UID_E_DEST = 'e2222222-2222-4222-8222-222222222222';
        const saveEDest = await MapEditService.save({
          mapObject: { mapID: 'e1-clone-dest-legacy', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'e1-clone-dest-legacy',
          uid: UID_E_DEST,
          copyFromUid: UID_E_SRC,
          create: true,
        });
        assert.equal(saveEDest.result, 'Success');
        const destCanonical = path.join(originalsDir, UID_E_DEST + '.jpg');
        assert.ok(await fs.pathExists(destCanonical), 'legacy-only 複製元でも複製先 canonical が作られるはず (AC-T4-2)');
        assert.equal(await fs.readFile(destCanonical, 'utf8'), 'legacy-src-bytes-e1');
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, 'e1-clone-dest-legacy.jpg'))),
          'clone 先には legacy(slugキー) は作られないはず'
        );
        assert.ok(
          await fs.pathExists(path.join(originalsDir, 'e1-clone-src-legacy.jpg')),
          '複製元の legacy ファイルは非破壊のまま残るはず'
        );
        assert.equal(
          await fs.readFile(path.join(originalsDir, 'e1-clone-src-legacy.jpg'), 'utf8'),
          'legacy-src-bytes-e1',
          '複製元の内容も不変のはず'
        );
        console.log('ok: (Part E) clone from legacy-only source copies resolved original to dest canonical, source untouched (AC-T4-2)');
      }

      // ============================================================
      // Part F: clone、原本解決不能な複製元（best-effort skip の確認、AC-T4-2）
      // ============================================================
      {
        const { originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-f'))});
        await fs.ensureDir(originalsDir);

        const UID_F_SRC = 'f1111111-1111-4111-8111-111111111111';
        await SqliteDataService.createMap('f1-clone-src-missing', { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_F_SRC);
        // 複製元には canonical も legacy も一切存在しない

        const UID_F_DEST = 'f2222222-2222-4222-8222-222222222222';
        const { result: saveFDest, warnings } = await readWarn(() => MapEditService.save({
          mapObject: { mapID: 'f1-clone-dest-missing', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
          tins: [],
          slug: 'f1-clone-dest-missing',
          uid: UID_F_DEST,
          copyFromUid: UID_F_SRC,
          create: true,
        }));
        assert.equal(saveFDest.result, 'Success', '原本が解決不能でも clone 自体は成功するはず (best-effort, milestone §4.7.2)');
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, UID_F_DEST + '.jpg'))),
          '原本が解決不能なら複製先 canonical は作られないはず'
        );
        assert.ok(
          warnings.some((w) => w.includes('source original unresolved')),
          '原本解決不能時は console.warn で記録されるはず: ' + JSON.stringify(warnings)
        );
        console.log('ok: (Part F) clone from unresolvable source succeeds (tiles/tmbs only) with a warning, no original copy (AC-T4-2)');
      }

      // ============================================================
      // Part G: delete、canonical+legacy 併存（trash move + live 消失の確認、AC-T4-3）
      // ============================================================
      let trashRootG = '';
      {
        const { dataDir, originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-g'))});
        await fs.ensureDir(originalsDir);

        const UID_G1 = '60111111-1111-4111-8111-111111111111';
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveG1 = await MapEditService.save({
          mapObject: {
            mapID: 'g1-delete-map', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder),
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'g1-delete-map',
          uid: UID_G1,
          create: true,
        });
        assert.equal(saveG1.result, 'Success');
        // T2 以前からの legacy 併存を模す(canonical と legacy が両方存在するケース)
        await fs.writeFile(path.join(originalsDir, 'g1-delete-map.jpg'), 'legacy-bytes-g1');
        const tileDir = path.join(dataDir, 'tiles', UID_G1);
        const thumbFile = path.join(dataDir, 'tmbs', UID_G1 + '.jpg');
        assert.ok(await fs.pathExists(tileDir), 'tiles ディレクトリが存在する前提');
        assert.ok(await fs.pathExists(thumbFile), 'thumbnail が存在する前提');

        await MapDataService.deleteMap(UID_G1);

        assert.equal(await SqliteDataService.findMap(UID_G1), null, 'DB row は削除されているはず');
        assert.ok(!(await fs.pathExists(path.join(originalsDir, UID_G1 + '.jpg'))), 'live canonical は消えているはず');
        assert.ok(!(await fs.pathExists(path.join(originalsDir, 'g1-delete-map.jpg'))), 'live legacy は消えているはず');
        assert.ok(!(await fs.pathExists(tileDir)), 'tiles ディレクトリは削除されるはず');
        assert.ok(!(await fs.pathExists(thumbFile)), 'thumbnail は削除されるはず');

        const trashUidRoot = path.join(dataDir, 'trash', 'maps', UID_G1);
        const opDirs = await fs.readdir(trashUidRoot);
        assert.equal(opDirs.length, 1, 'operationId ディレクトリが1件作られるはず');
        trashRootG = path.join(trashUidRoot, opDirs[0]);
        const trashedCanonical = path.join(trashRootG, 'originals', UID_G1 + '.jpg');
        const trashedLegacy = path.join(trashRootG, 'legacy', 'g1-delete-map.jpg');
        assert.ok(await fs.pathExists(trashedCanonical), 'canonical が trash へ move されているはず');
        assert.equal(await fs.readFile(trashedCanonical, 'utf8'), 'uploaded-original-bytes-jpg');
        assert.ok(await fs.pathExists(trashedLegacy), 'legacy が trash へ move されているはず');
        assert.equal(await fs.readFile(trashedLegacy, 'utf8'), 'legacy-bytes-g1');
        console.log('ok: (Part G) delete moves canonical+legacy to trash and removes them from live (AC-T4-3)');
      }

      // ============================================================
      // Part H: delete、DB delete 強制失敗 → ロールバック確認（AC-T4-3）
      // ============================================================
      {
        const { dataDir, originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-h'))});
        await fs.ensureDir(originalsDir);

        const UID_H1 = '70111111-1111-4111-8111-111111111111';
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveH1 = await MapEditService.save({
          mapObject: {
            mapID: 'h1-delete-fail-map', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder),
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'h1-delete-fail-map',
          uid: UID_H1,
          create: true,
        });
        assert.equal(saveH1.result, 'Success');
        await fs.writeFile(path.join(originalsDir, 'h1-delete-fail-map.jpg'), 'legacy-bytes-h1');

        const originalDeleteMap = SqliteDataService.deleteMap.bind(SqliteDataService);
        SqliteDataService.deleteMap = async () => { throw new Error('forced-db-delete-failure'); };
        let threw = false;
        try {
          await deleteMapWithTrash(UID_H1);
        } catch (e: any) {
          threw = true;
          assert.equal(e.message, 'forced-db-delete-failure');
        } finally {
          SqliteDataService.deleteMap = originalDeleteMap;
        }
        assert.ok(threw, 'DB delete 失敗時は例外が伝播するはず');

        assert.ok(await SqliteDataService.findMap(UID_H1), 'DB delete 失敗時は DB row が残っているはず');
        const canonicalH1 = path.join(originalsDir, UID_H1 + '.jpg');
        const legacyH1 = path.join(originalsDir, 'h1-delete-fail-map.jpg');
        assert.ok(await fs.pathExists(canonicalH1), 'canonical は live へロールバックされているはず');
        assert.equal(await fs.readFile(canonicalH1, 'utf8'), 'uploaded-original-bytes-jpg');
        assert.ok(await fs.pathExists(legacyH1), 'legacy も live へロールバックされているはず');
        assert.equal(await fs.readFile(legacyH1, 'utf8'), 'legacy-bytes-h1');
        const trashUidRoot = path.join(dataDir, 'trash', 'maps', UID_H1);
        const opDirs = await fs.readdir(trashUidRoot).catch(() => []);
        for (const opDir of opDirs) {
          const remaining = [
            ...(await fs.readdir(path.join(trashUidRoot, opDir, 'originals')).catch(() => [])),
            ...(await fs.readdir(path.join(trashUidRoot, opDir, 'legacy')).catch(() => [])),
          ];
          assert.deepEqual(remaining, [], 'ロールバック後は trash に何も残っていないはず: ' + opDir);
        }
        console.log('ok: (Part H) DB delete failure rolls back trash moves and rethrows (AC-T4-3)');
      }

      // ============================================================
      // Part I: delete、ambiguous legacy（2件併存）→ legacy 2件とも live 残置 + console.warn
      // (review v6 Info 3 / AC-T4-3(c) / レビュー v1 Major 2)
      // ============================================================
      {
        const { dataDir, originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-i'))});
        await fs.ensureDir(originalsDir);

        const UID_I1 = '80111111-1111-4111-8111-111111111111';
        const tmpTileFolder = await prepareTmpUpload('jpg');
        const saveI1 = await MapEditService.save({
          mapObject: {
            mapID: 'i1-ambiguous-delete', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder),
            gcps: [], edges: [], sub_maps: [],
          },
          tins: [],
          slug: 'i1-ambiguous-delete',
          uid: UID_I1,
          create: true,
        });
        assert.equal(saveI1.result, 'Success');
        await fs.writeFile(path.join(originalsDir, 'i1-ambiguous-delete.jpg'), 'legacy-jpg-i1');
        await fs.writeFile(path.join(originalsDir, 'i1-ambiguous-delete.png'), 'legacy-png-i1');

        const { warnings } = await readWarn(() => MapDataService.deleteMap(UID_I1));

        assert.equal(await SqliteDataService.findMap(UID_I1), null, 'ambiguous legacy があっても DB row は削除されるはず');
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, UID_I1 + '.jpg'))),
          'canonical は ambiguous legacy と無関係に trash へ move されるはず'
        );
        assert.ok(
          await fs.pathExists(path.join(originalsDir, 'i1-ambiguous-delete.jpg')),
          'ambiguous legacy(jpg) は move されず live に残置されるはず (review v6 Info 3)'
        );
        assert.ok(
          await fs.pathExists(path.join(originalsDir, 'i1-ambiguous-delete.png')),
          'ambiguous legacy(png) も move されず live に残置されるはず'
        );
        assert.ok(
          warnings.some((w) => w.includes('ambiguous legacy') && w.includes('candidates=2') && w.includes(UID_I1) && w.includes('i1-ambiguous-delete')),
          'legacyCandidateCount を含む console.warn が出るはず (AC-T4-3(c)): ' + JSON.stringify(warnings)
        );
        console.log('ok: (Part I) delete with ambiguous legacy leaves both legacy files live and warns with legacyCandidateCount (AC-T4-3(c))');
      }

      // ============================================================
      // Part J: reconcile、trash+DB row 存在 → restore（AC-T4-5）
      // ============================================================
      {
        const { dataDir, originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-j'))});
        await fs.ensureDir(originalsDir);

        const UID_J1 = 'j1111111-1111-4111-8111-111111111111';
        await SqliteDataService.createMap('j1-reconcile-map', { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_J1);

        const trashDir = path.join(dataDir, 'trash', 'maps', UID_J1, 'op-j1', 'originals');
        await fs.ensureDir(trashDir);
        await fs.writeFile(path.join(trashDir, UID_J1 + '.jpg'), 'trash-content-j1');

        const db = await SqliteDataService.getDb();
        await reconcileDeletedMapsTrash(db);

        const livePath = path.join(originalsDir, UID_J1 + '.jpg');
        assert.ok(await fs.pathExists(livePath), 'trash+DB row 存在の明白なケースは live へ restore されるはず (AC-T4-5)');
        assert.equal(await fs.readFile(livePath, 'utf8'), 'trash-content-j1');
        assert.ok(!(await fs.pathExists(path.join(trashDir, UID_J1 + '.jpg'))), 'restore 後は trash から無くなっているはず(move)');
        console.log('ok: (Part J) reconcile restores files when trash exists and DB row still exists (AC-T4-5)');
      }

      // ============================================================
      // Part K: reconcile、trash+DB row 存在+live 既存 → restore せず warning（AC-T4-5）
      // ============================================================
      {
        const { dataDir, originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-k'))});
        await fs.ensureDir(originalsDir);

        const UID_K1 = 'k1111111-1111-4111-8111-111111111111';
        await SqliteDataService.createMap('k1-reconcile-conflict', { imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }, UID_K1);

        const trashDir = path.join(dataDir, 'trash', 'maps', UID_K1, 'op-k1', 'originals');
        await fs.ensureDir(trashDir);
        await fs.writeFile(path.join(trashDir, UID_K1 + '.jpg'), 'trash-content-k1');

        const livePath = path.join(originalsDir, UID_K1 + '.jpg');
        await fs.writeFile(livePath, 'live-existing-k1');

        const db = await SqliteDataService.getDb();
        const { warnings } = await readWarn(() => reconcileDeletedMapsTrash(db));

        assert.equal(await fs.readFile(livePath, 'utf8'), 'live-existing-k1', 'live に既存ファイルがある場合は上書きされないはず (AC-T4-5)');
        assert.ok(await fs.pathExists(path.join(trashDir, UID_K1 + '.jpg')), 'restore しなかった trash ファイルはそのまま残るはず');
        assert.equal(await fs.readFile(path.join(trashDir, UID_K1 + '.jpg'), 'utf8'), 'trash-content-k1');
        assert.ok(
          warnings.some((w) => w.includes('live path already exists')),
          'live 既存時は console.warn が出るはず: ' + JSON.stringify(warnings)
        );
        console.log('ok: (Part K) reconcile does not overwrite an existing live file and warns instead (AC-T4-5)');
      }

      // ============================================================
      // Part L: reconcile、trash+DB row 不在 → 何もしない（AC-T4-5）
      // ============================================================
      {
        const { dataDir, originalsDir } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-l'))});
        await fs.ensureDir(originalsDir);

        const UID_L1 = 'l1111111-1111-4111-8111-111111111111';
        // 意図的に DB row を作らない(削除が正しく完了済みの状態を模す)
        const trashDir = path.join(dataDir, 'trash', 'maps', UID_L1, 'op-l1', 'originals');
        await fs.ensureDir(trashDir);
        await fs.writeFile(path.join(trashDir, UID_L1 + '.jpg'), 'trash-content-l1');

        const db = await SqliteDataService.getDb();
        await reconcileDeletedMapsTrash(db);

        assert.ok(
          await fs.pathExists(path.join(trashDir, UID_L1 + '.jpg')),
          'DB row 不在(削除完了済み)なら trash はそのまま保持されるはず (AC-T4-5)'
        );
        assert.ok(
          !(await fs.pathExists(path.join(originalsDir, UID_L1 + '.jpg'))),
          'DB row 不在なら live へ何も復元されないはず'
        );
        console.log('ok: (Part L) reconcile is a no-op when trash exists but no DB row exists (deletion already complete, AC-T4-5)');
      }

      // ============================================================
      // Part M: delete 成功後の trash 非 purge（複数回の reconcile 実行後も trash 残存、AC-T4-4）
      // ============================================================
      {
        assert.ok(trashRootG, 'Part G の trash パスが記録されているはず');
        const { dataDir: dataDirG } = setSaveFolder(${JSON.stringify(path.join(workDir, 'data-part-g'))});
        const db = await SqliteDataService.getDb();

        const trashedCanonical = (await fs.readdir(path.join(trashRootG, 'originals')))[0];
        const trashedCanonicalPath = path.join(trashRootG, 'originals', trashedCanonical);
        const bytesBefore = await fs.readFile(trashedCanonicalPath, 'utf8');

        // 複数回の reconcile 実行(アプリ再起動相当を模す)を経ても trash は変化しない
        for (let i = 0; i < 3; i++) {
          await reconcileDeletedMapsTrash(db);
        }

        assert.ok(await fs.pathExists(trashedCanonicalPath), 'delete 成功後の trash は自動 purge されないはず (AC-T4-4)');
        assert.equal(await fs.readFile(trashedCanonicalPath, 'utf8'), bytesBefore, 'trash の内容も不変のはず');
        console.log('ok: (Part M) trash from a completed delete survives repeated reconcile calls (no auto-purge, AC-T4-4)');
      }

      console.log('M13-T4 originals lifecycle smoke passed');
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
          entryFileNames: 'm13-t4-originals-lifecycle-smoke.mjs',
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
  console.log('M13-T4 originals lifecycle smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
