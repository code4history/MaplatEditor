// M13-T2 スモーク: UUID originals resolver と canonical save/read path 導入。
// m9/m10 系と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir) で
// MapOriginalImageService / MapMutationQueue / MapEditService.save() / WmtsGeneratorService.generate()
// を behavioral に検証する。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t2-originals-resolver-design.md` §5/§8 準拠。
// シナリオ:
//   (A) normalizeOriginalExt: 優先順位/trim/大小文字/allowed set の全分岐 (AC-T2-3)
//   (B) resolveRuntimeOriginal: canonical extHint優先探索(実装レビューv1 Major 1)、
//       legacy 0/1/2+件、extHint disambiguation (AC-T2-2)
//   (C) classifyMigrationCandidate: 7種の判定結果 (T3 が消費する純関数の契約固定)
//   (D) MapMutationQueue: run()/runMany() の直列化と、前段 reject が後続をブロックしないこと
//   (E) MapEditService.save(): tmpCheck 分岐の canonical(uid キー)書込みと未対応拡張子reject (AC-T2-1)
//   (F) MapEditService.save(): 同一 uid への2回同時発火が直列に完了すること (AC-T2-4)
//   (G) 既知差異(レビュー v1 Minor 7): T2 適用後の canonical-only map を clone すると原本複写が
//       silent にスキップされる(T4 で解消予定)
//   (H) WmtsGeneratorService.generate(): canonical-first / legacy fallback / 解決不能時のerr (AC-T2-2)
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm13-t2-originals-resolver-'));
const entryFile = path.join(workDir, 'm13-t2-originals-resolver-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm13-t2-originals-resolver-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');
  const wmtsGeneratorPath = path.join(projectRoot, 'electron/services/WmtsGeneratorService.ts');
  const mapOriginalImagePath = path.join(projectRoot, 'electron/services/MapOriginalImageService.ts');
  const mapMutationQueuePath = path.join(projectRoot, 'electron/services/MapMutationQueue.ts');

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
      import { Jimp } from 'jimp';
      // @ts-ignore
      import Tin from '@maplat/tin';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      const { default: WmtsGeneratorService } = await import(${JSON.stringify(wmtsGeneratorPath)});
      const { default: MapMutationQueue } = await import(${JSON.stringify(mapMutationQueuePath)});
      const {
        normalizeOriginalExt,
        resolveRuntimeOriginal,
        classifyMigrationCandidate,
      } = await import(${JSON.stringify(mapOriginalImagePath)});
      await SqliteDataService.getDb();

      const originalsDir = path.join(${JSON.stringify(dataDir)}, 'originals');
      await fs.ensureDir(originalsDir);

      // ============================================================
      // (A) normalizeOriginalExt: 優先順位/trim/大小文字/allowed set (AC-T2-3)
      // ============================================================
      assert.equal(normalizeOriginalExt('jpg', 'png'), 'jpg', 'imageExtension が最優先');
      assert.equal(normalizeOriginalExt(undefined, 'png'), 'png', 'imageExtension 未指定なら imageExtention');
      assert.equal(normalizeOriginalExt(undefined, undefined), 'jpg', '両方未指定なら既定 jpg');
      assert.equal(normalizeOriginalExt(null, null), 'jpg', '両方 null でも既定 jpg');
      assert.equal(normalizeOriginalExt('PNG', undefined), 'png', '大文字は小文字化される');
      assert.equal(normalizeOriginalExt('  jpeg  ', undefined), 'jpeg', '前後空白は trim される');
      assert.equal(normalizeOriginalExt('tiff', 'png'), null, 'allowed set 外は候補がそこで確定し null (次候補へフォールバックしない)');
      assert.equal(normalizeOriginalExt('  ', 'png'), 'png', 'whitespace-only な imageExtension は次候補へフォールバックする(レビューv1 Minor 4)');
      assert.equal(normalizeOriginalExt('  ', '  '), 'jpg', '両方 whitespace-only なら既定 jpg へフォールバックする(Minor 4)');
      assert.equal(normalizeOriginalExt('', ''), 'jpg', '両方空文字でも既定 jpg');
      console.log('ok: (A) normalizeOriginalExt covers priority/trim/case/allowed-set branches');

      // ============================================================
      // (B) resolveRuntimeOriginal: canonical-first / legacy fallback (AC-T2-2)
      // ============================================================
      const UID_B1 = 'b1111111-1111-4111-8111-111111111111';
      // (B-1) canonical が allowed set の優先順位 (jpg -> jpeg -> png) で見つかる
      await fs.writeFile(path.join(originalsDir, UID_B1 + '.png'), 'png-bytes');
      await fs.writeFile(path.join(originalsDir, UID_B1 + '.jpg'), 'jpg-bytes');
      const b1 = await resolveRuntimeOriginal(UID_B1, 'b1-slug', undefined);
      assert.equal(b1?.source, 'canonical', 'canonical が優先される');
      assert.equal(b1?.ext, 'jpg', 'jpg -> jpeg -> png の順で先に見つかった jpg が採用される');
      console.log('ok: (B-1) resolveRuntimeOriginal: canonical-first (jpg priority)');

      // (B-2) canonical 不在、legacy 0件 -> null (missing)
      const UID_B2 = 'b2222222-2222-4222-8222-222222222222';
      const b2 = await resolveRuntimeOriginal(UID_B2, 'b2-slug-missing', undefined);
      assert.equal(b2, null, 'canonical/legacy とも無ければ null');
      console.log('ok: (B-2) resolveRuntimeOriginal: missing -> null');

      // (B-3) canonical 不在、legacy 1件 -> success
      const UID_B3 = 'b3333333-3333-4333-8333-333333333333';
      await fs.writeFile(path.join(originalsDir, 'b3-slug-unique.png'), 'legacy-png');
      const b3 = await resolveRuntimeOriginal(UID_B3, 'b3-slug-unique', undefined);
      assert.equal(b3?.source, 'legacy', 'legacy 1件は成功する');
      assert.equal(b3?.ext, 'png');
      console.log('ok: (B-3) resolveRuntimeOriginal: unique legacy fallback');

      // (B-4) canonical 不在、legacy 2件 (異なるext)、extHint 無し -> ambiguous(naramachi 相当)
      const UID_B4 = 'b4444444-4444-4444-8444-444444444444';
      await fs.writeFile(path.join(originalsDir, 'naramachi-like.jpg'), 'legacy-jpg-old');
      await fs.writeFile(path.join(originalsDir, 'naramachi-like.png'), 'legacy-png-new');
      const b4 = await resolveRuntimeOriginal(UID_B4, 'naramachi-like', undefined);
      assert.equal(b4, null, 'extHint 無しでは複数 legacy 候補は ambiguous');
      console.log('ok: (B-4) resolveRuntimeOriginal: ambiguous legacy without extHint (naramachi scenario)');

      // (B-5) 同じ2件に対し extHint='png' でちょうど1件確定 -> success (Minor 2 の肯定側)
      const b5 = await resolveRuntimeOriginal(UID_B4, 'naramachi-like', 'png');
      assert.equal(b5?.source, 'legacy');
      assert.equal(b5?.ext, 'png', 'extHint が一致する1件だけに絞り込まれる');
      assert.equal(b5?.path, path.join(originalsDir, 'naramachi-like.png'));
      console.log('ok: (B-5) resolveRuntimeOriginal: extHint disambiguates ambiguous legacy (naramachi fix)');

      // (B-6) extHint がどの候補にも一致しない -> 厳格な件数判定(2件)へフォールバック -> ambiguous
      const b6 = await resolveRuntimeOriginal(UID_B4, 'naramachi-like', 'jpeg');
      assert.equal(b6, null, 'extHint 不一致 (0件) は候補集合の件数判定にフォールバックし、2件なので ambiguous');
      console.log('ok: (B-6) resolveRuntimeOriginal: non-matching extHint falls back to strict count rule');

      // (B-7) 同一 slug・同一正規化ext の物理ファイルが2件 (ファイル名の末尾空白で衝突させ、
      // OSのcase-folding挙動に依存せず「同一extの複数物理ファイル」を作る) -> extHint が
      // その ext に一致していても ambiguous (レビュー v1 Minor 2 の否定側)
      const UID_B7 = 'b7777777-7777-4777-8777-777777777777';
      await fs.writeFile(path.join(originalsDir, 'b7-slug.jpg'), 'variant-1');
      await fs.writeFile(path.join(originalsDir, 'b7-slug.jpg '), 'variant-2'); // 末尾に半角スペース = 別ファイル
      const b7 = await resolveRuntimeOriginal(UID_B7, 'b7-slug', 'jpg');
      assert.equal(b7, null, '同一 ext の複数物理ファイルは extHint があっても ambiguous (Minor 2)');
      console.log('ok: (B-7) resolveRuntimeOriginal: same-ext multiple physical files stay ambiguous even with extHint');

      // (B-8) canonical variant 2件 (stale + current) + extHint -> extHint 優先で正しい方を返す
      // (実装レビュー v1 Major 1 の再現シナリオ: 既存地図の画像を形式変更して再アップロードすると
      // uid.<旧ext> が残置され canonical variant が2件になる。DB の imageExtension は新ext に
      // 更新されるため、canonical 探索は固定順(jpg優先)ではなく extHint 優先で新ext を
      // 返さなければならない。マイルストーン §4.3 point 1-2 準拠)
      const UID_B8 = 'b8888888-8888-4888-8888-888888888888';
      await fs.writeFile(path.join(originalsDir, UID_B8 + '.jpg'), 'stale-jpg-bytes');
      await fs.writeFile(path.join(originalsDir, UID_B8 + '.png'), 'current-png-bytes');
      const b8 = await resolveRuntimeOriginal(UID_B8, 'b8-slug', 'png');
      assert.equal(b8?.source, 'canonical', 'canonical variant が複数でも canonical で解決されるはず');
      assert.equal(b8?.ext, 'png', 'extHint=png のとき、固定順(jpg優先)ではなく extHint 優先で png が返るはず(実装レビューv1 Major 1)');
      assert.equal(b8?.path, path.join(originalsDir, UID_B8 + '.png'));
      console.log('ok: (B-8) resolveRuntimeOriginal: canonical extHint takes priority over fixed jpg->jpeg->png order (review v1 Major 1 fix)');

      // (B-9) canonical variant 2件、extHint 無し -> 従来どおり固定順(jpg優先)のまま(回帰確認)
      const UID_B9 = 'b9999999-9999-4999-8999-999999999999';
      await fs.writeFile(path.join(originalsDir, UID_B9 + '.png'), 'png-bytes');
      await fs.writeFile(path.join(originalsDir, UID_B9 + '.jpg'), 'jpg-bytes');
      const b9 = await resolveRuntimeOriginal(UID_B9, 'b9-slug', undefined);
      assert.equal(b9?.ext, 'jpg', 'extHint 無しでは既存どおり jpg->jpeg->png の固定順が維持される(B-1と同じ契約、レビューv1指摘のとおり無影響)');
      console.log('ok: (B-9) resolveRuntimeOriginal: canonical fixed-order unaffected when extHint is absent (no regression, review v1 confirmed)');

      // ============================================================
      // (C) classifyMigrationCandidate: 7種の判定結果 (マイルストーン §4.5.4 判定表)
      // ============================================================
      // (C-1) skip_unsupported_extension
      const c1 = await classifyMigrationCandidate('c1111111-1111-4111-8111-111111111111', 'c1-slug', 'tiff');
      assert.equal(c1.kind, 'skip_unsupported_extension');
      console.log('ok: (C-1) classifyMigrationCandidate: skip_unsupported_extension');

      // (C-2) copyable: legacy 1件、canonical 不在
      const UID_C2 = 'c2222222-2222-4222-8222-222222222222';
      await fs.writeFile(path.join(originalsDir, 'c2-slug.jpg'), 'c2-legacy-bytes');
      const c2 = await classifyMigrationCandidate(UID_C2, 'c2-slug', 'jpg');
      assert.equal(c2.kind, 'copyable');
      assert.equal(c2.sourcePath, path.join(originalsDir, 'c2-slug.jpg'));
      assert.equal(c2.targetPath, path.join(originalsDir, UID_C2 + '.jpg'));
      console.log('ok: (C-2) classifyMigrationCandidate: copyable');

      // (C-3) already_migrated: exact target 既存 + legacy source と同内容
      const UID_C3 = 'c3333333-3333-4333-8333-333333333333';
      await fs.writeFile(path.join(originalsDir, 'c3-slug.jpg'), 'same-bytes');
      await fs.writeFile(path.join(originalsDir, UID_C3 + '.jpg'), 'same-bytes');
      const c3 = await classifyMigrationCandidate(UID_C3, 'c3-slug', 'jpg');
      assert.equal(c3.kind, 'already_migrated');
      console.log('ok: (C-3) classifyMigrationCandidate: already_migrated');

      // (C-4) skip_target_conflict: exact target 既存 + legacy source と異内容
      const UID_C4 = 'c4444444-4444-4444-8444-444444444444';
      await fs.writeFile(path.join(originalsDir, 'c4-slug.jpg'), 'source-bytes');
      await fs.writeFile(path.join(originalsDir, UID_C4 + '.jpg'), 'different-target-bytes');
      const c4 = await classifyMigrationCandidate(UID_C4, 'c4-slug', 'jpg');
      assert.equal(c4.kind, 'skip_target_conflict');
      console.log('ok: (C-4) classifyMigrationCandidate: skip_target_conflict');

      // (C-5) skip_canonical_variant_exists: exact target 不在 + 別ext の canonical variant あり
      const UID_C5 = 'c5555555-5555-4555-8555-555555555555';
      await fs.writeFile(path.join(originalsDir, UID_C5 + '.png'), 'variant-bytes');
      const c5 = await classifyMigrationCandidate(UID_C5, 'c5-slug-nofile', 'jpg');
      assert.equal(c5.kind, 'skip_canonical_variant_exists');
      console.log('ok: (C-5) classifyMigrationCandidate: skip_canonical_variant_exists');

      // (C-6) skip_ambiguous_legacy: legacy 候補2件以上、canonical target/variant 不在
      const UID_C6 = 'c6666666-6666-4666-8666-666666666666';
      await fs.writeFile(path.join(originalsDir, 'c6-slug.jpg'), 'a');
      await fs.writeFile(path.join(originalsDir, 'c6-slug.png'), 'b');
      const c6 = await classifyMigrationCandidate(UID_C6, 'c6-slug', 'jpg');
      assert.equal(c6.kind, 'skip_ambiguous_legacy');
      console.log('ok: (C-6) classifyMigrationCandidate: skip_ambiguous_legacy');

      // (C-7) skip_source_missing: legacy 0件、canonical target/variant 不在
      const c7 = await classifyMigrationCandidate('c7777777-7777-4777-8777-777777777777', 'c7-slug-nothing', 'jpg');
      assert.equal(c7.kind, 'skip_source_missing');
      console.log('ok: (C-7) classifyMigrationCandidate: skip_source_missing');

      // ============================================================
      // (D) MapMutationQueue: run()/runMany() の直列化と reject 非伝播 (AC-T2-4)
      // ============================================================
      const dOrder = [];
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const [dResA, dResB] = await Promise.all([
        MapMutationQueue.run('d-uid', 'test', async () => {
          dOrder.push('start-A');
          await sleep(40);
          dOrder.push('end-A');
          return 'A';
        }),
        MapMutationQueue.run('d-uid', 'test', async () => {
          dOrder.push('start-B');
          await sleep(1);
          dOrder.push('end-B');
          return 'B';
        }),
      ]);
      assert.deepEqual(dOrder, ['start-A', 'end-A', 'start-B', 'end-B'], '同一 uid への run() は物理的に重ねて発火しても直列に実行される: ' + JSON.stringify(dOrder));
      assert.equal(dResA, 'A');
      assert.equal(dResB, 'B');
      console.log('ok: (D-1) MapMutationQueue.run() serializes same-uid mutations under physical overlap');

      // 前段が reject しても、後続 (同一uid) はブロックされず実行される
      let rejected = false;
      try {
        await MapMutationQueue.run('d-uid-2', 'test', async () => { throw new Error('boom'); });
      } catch { rejected = true; }
      assert.ok(rejected, '前段の reject はそのまま呼び出し元に伝播する');
      const afterFailure = await MapMutationQueue.run('d-uid-2', 'test', async () => 'recovered');
      assert.equal(afterFailure, 'recovered', '前段の reject は後続の同一uid mutationをブロックしない');
      console.log('ok: (D-2) MapMutationQueue.run() does not let a rejected mutation poison the queue tail');

      // runMany(): 関与する全 uid の既存キューを待ってから実行し、完了後は全 uid のキューが更新される
      const dManyOrder = [];
      await MapMutationQueue.run('d-many-1', 'test', async () => {
        dManyOrder.push('solo-1-start');
        await sleep(30);
        dManyOrder.push('solo-1-end');
      });
      const manyPromise = MapMutationQueue.runMany(['d-many-1', 'd-many-2'], 'test', async () => {
        dManyOrder.push('many-start');
        await sleep(1);
        dManyOrder.push('many-end');
        return 'many-result';
      });
      const soloOnUid2 = MapMutationQueue.run('d-many-2', 'test', async () => {
        dManyOrder.push('solo-2-start');
        dManyOrder.push('solo-2-end');
      });
      await Promise.all([manyPromise, soloOnUid2]);
      assert.ok(
        dManyOrder.indexOf('many-start') > dManyOrder.indexOf('solo-1-end'),
        'runMany は関与 uid (d-many-1) の既存キュー完了を待ってから実行される: ' + JSON.stringify(dManyOrder)
      );
      assert.ok(
        dManyOrder.indexOf('solo-2-start') > dManyOrder.indexOf('many-end'),
        'runMany 完了後は関与した全 uid (d-many-2 含む) のキューが更新される: ' + JSON.stringify(dManyOrder)
      );
      console.log('ok: (D-3) MapMutationQueue.runMany() serializes across all involved uids');

      // ============================================================
      // (E) MapEditService.save(): tmpCheck 分岐の canonical 書込み (AC-T2-1)
      // ============================================================
      const tmpFolder = SettingsService.get('tmpFolder');
      const tmpTileFolder = path.join(tmpFolder, 'tiles');

      async function prepareTmpUpload(ext) {
        await fs.remove(tmpTileFolder);
        await fs.ensureDir(tmpTileFolder);
        await fs.writeFile(path.join(tmpTileFolder, 'original.' + ext), 'uploaded-original-bytes');
        await fs.writeFile(path.join(tmpTileFolder, 'thumbnail.jpg'), 'thumb-bytes');
        await fs.writeFile(path.join(tmpTileFolder, 'thumbnail_512.jpg'), 'thumb512-bytes');
      }

      const fileUrlModule = await import('file-url');
      const fileUrl = fileUrlModule.default;
      const tmpUrl = fileUrl(tmpTileFolder);

      const UID_E1 = 'e1111111-1111-4111-8111-111111111111';
      await prepareTmpUpload('png');
      const saveE1 = await MapEditService.save({
        mapObject: {
          mapID: 'e1-new-upload',
          imageExtension: 'PNG',
          url_: tmpUrl,
          gcps: [], edges: [], sub_maps: [],
        },
        tins: [],
        slug: 'e1-new-upload',
        uid: UID_E1,
        create: true,
      });
      assert.equal(saveE1.result, 'Success', 'tmpCheck 新規保存は Success のはず: ' + JSON.stringify(saveE1));
      assert.equal(saveE1.uid, UID_E1);
      const canonicalE1 = path.join(originalsDir, UID_E1 + '.png');
      assert.ok(await fs.pathExists(canonicalE1), 'canonical(uidキー) の originals ファイルが作られるはず: ' + canonicalE1);
      const legacyE1 = path.join(originalsDir, 'e1-new-upload.png');
      assert.ok(!(await fs.pathExists(legacyE1)), '新規アップロードでは legacy(slugキー) の originals ファイルは作られないはず');
      console.log('ok: (E-1) MapEditService.save(): tmpCheck writes canonical originals/<uid>.<ext> only');

      // 未対応拡張子は DB write 前に reject される (AC-T2-3)
      const UID_E2 = 'e2222222-2222-4222-8222-222222222222';
      await prepareTmpUpload('tiff');
      const saveE2 = await MapEditService.save({
        mapObject: {
          mapID: 'e2-unsupported-ext',
          imageExtension: 'tiff',
          url_: fileUrl(tmpTileFolder),
          gcps: [], edges: [], sub_maps: [],
        },
        tins: [],
        slug: 'e2-unsupported-ext',
        uid: UID_E2,
        create: true,
      });
      assert.equal(saveE2.result, 'Error');
      assert.equal(saveE2.errorKey, 'mapedit.originals.unsupported_extension');
      const dbRowE2 = await SqliteDataService.findMapByRef('e2-unsupported-ext');
      assert.equal(dbRowE2, null, '未対応拡張子は DB write に到達する前に reject されるはず(DBに行が作られない)');
      console.log('ok: (E-2) MapEditService.save(): unsupported extension rejects before any DB write');

      // ============================================================
      // (F) MapEditService.save(): 同一 uid への2回同時発火が直列に完了する (AC-T2-4)
      // ============================================================
      const UID_F1 = 'f1111111-1111-4111-8111-111111111111';
      const createdF1 = await MapEditService.save({
        mapObject: { mapID: 'f1-concurrent-save', gcps: [], edges: [], sub_maps: [] },
        tins: [],
        slug: 'f1-concurrent-save',
        uid: UID_F1,
        create: true,
      });
      assert.equal(createdF1.result, 'Success');

      const originalUpsertMap = SqliteDataService.upsertMap.bind(SqliteDataService);
      const fOrder = [];
      let fCallIndex = 0;
      SqliteDataService.upsertMap = async (...args) => {
        const idx = fCallIndex++;
        fOrder.push('start-' + idx);
        if (idx === 0) await sleep(60); // 先着呼び出しだけ人為的に遅延させ、物理的な重なりを作る
        try {
          return await originalUpsertMap(...args);
        } finally {
          // 直列化されていれば2回目は楽観ロック不一致(RevisionConflictError)で reject し得るが、
          // 呼び出し境界(=queueによる直列化の証跡)としては reject でも end を記録する
          fOrder.push('end-' + idx);
        }
      };
      try {
        const [saveF1a, saveF1b] = await Promise.all([
          MapEditService.save({
            mapObject: { mapID: 'f1-concurrent-save', gcps: [], edges: [], sub_maps: [] },
            tins: [],
            slug: 'f1-concurrent-save',
            uid: UID_F1,
            expectedRevision: 1,
          }),
          MapEditService.save({
            mapObject: { mapID: 'f1-concurrent-save', gcps: [], edges: [], sub_maps: [] },
            tins: [],
            slug: 'f1-concurrent-save',
            uid: UID_F1,
            expectedRevision: 1,
          }),
        ]);
        assert.deepEqual(
          fOrder, ['start-0', 'end-0', 'start-1', 'end-1'],
          '同一 uid への2回同時 save() は SqliteDataService.upsertMap への到達順で直列化されるはず (queue が無ければ [start-0,start-1,end-0,end-1] のような重なりになる): ' + JSON.stringify(fOrder)
        );
        // 直列化されている以上、2回目は 1回目が確定した revision に対する楽観ロック不一致になる
        const results = [saveF1a, saveF1b];
        const successCount = results.filter((r) => r.result === 'Success').length;
        const conflictCount = results.filter((r) => 'error' in r && r.error === 'revision-conflict').length;
        assert.equal(successCount, 1, '同時発火のうち1回だけ成功するはず(直列化により2回目はrevision不一致): ' + JSON.stringify(results));
        assert.equal(conflictCount, 1, 'もう1回は revision-conflict になるはず: ' + JSON.stringify(results));
      } finally {
        SqliteDataService.upsertMap = originalUpsertMap;
      }
      console.log('ok: (F) MapEditService.save(): concurrent same-uid saves are serialized (physical overlap, not sequential await)');

      // ============================================================
      // (G) 既知差異(レビュー v1 Minor 7): canonical-only map の clone は原本複写が silent skip
      // ============================================================
      const UID_G_SRC = 'aaaaaaaa-1111-4111-8111-111111111111';
      await prepareTmpUpload('jpg');
      const saveGSrc = await MapEditService.save({
        mapObject: {
          mapID: 'g-clone-source', imageExtension: 'jpg', url_: fileUrl(tmpTileFolder),
          gcps: [], edges: [], sub_maps: [],
        },
        tins: [],
        slug: 'g-clone-source',
        uid: UID_G_SRC,
        create: true,
      });
      assert.equal(saveGSrc.result, 'Success');
      assert.ok(await fs.pathExists(path.join(originalsDir, UID_G_SRC + '.jpg')), 'clone元は canonical のみを持つ');
      assert.ok(!(await fs.pathExists(path.join(originalsDir, 'g-clone-source.jpg'))), 'clone元は legacy(slugキー) を持たない');

      const UID_G_DEST = 'aaaaaaaa-2222-4222-8222-222222222222';
      const saveGDest = await MapEditService.save({
        mapObject: { mapID: 'g-clone-dest', imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] },
        tins: [],
        slug: 'g-clone-dest',
        uid: UID_G_DEST,
        copyFromUid: UID_G_SRC,
        create: true,
      });
      assert.equal(saveGDest.result, 'Success', 'clone の save 自体は成功する(tiles/tmbsは複製される)');
      const cloneDestOriginal = path.join(originalsDir, 'g-clone-dest.jpg');
      assert.ok(
        !(await fs.pathExists(cloneDestOriginal)),
        '既知差異(Minor 7): T2 適用後の canonical-only map を clone すると、copySourceUid 分岐は legacy slug パスしか見ないため原本複写が silent にスキップされる(T4=AC-T4-2 で解消予定)'
      );
      console.log('ok: (G) MapEditService.save(): documents the T2/T4 interim clone-skips-original known gap (review v1 Minor 7)');

      // ============================================================
      // (H) WmtsGeneratorService.generate(): canonical-first / legacy fallback / unresolved (AC-T2-2)
      // ============================================================
      // m12-t1-hotfix-1-search-thumbnails.spec.ts 等の既存 e2e と同じ実測済み gcps フィクスチャを
      // 再利用する (400x300、3点、非退化な三角形)。
      const wmtsGcps = [
        [[0, 0], [15550000, 4160000]],
        [[400, 0], [15560000, 4160000]],
        [[400, 300], [15560000, 4150000]],
      ];
      const tin = new Tin({ useV2Algorithm: true });
      tin.setWh([400, 300]);
      tin.setStrictMode('strict');
      tin.setVertexMode('plain');
      tin.setPoints(wmtsGcps);
      tin.setEdges([]);
      await tin.updateTinAsync();
      const wmtsCompiled = tin.getCompiled();

      const testImage = new Jimp({ width: 400, height: 300, color: 0xff0000ff });
      const imageBuffer = await testImage.getBuffer('image/jpeg');

      const UID_H1 = 'h1111111-1111-4111-8111-111111111111';
      await fs.writeFile(path.join(originalsDir, UID_H1 + '.jpg'), imageBuffer);
      const genH1 = await WmtsGeneratorService.generate(
        undefined, UID_H1, 'h1-slug', 400, 300, wmtsCompiled, 'jpg', 'hash-h1'
      );
      assert.equal(genH1.err, undefined, 'canonical originals から解決できれば err は無いはず: ' + JSON.stringify(genH1.err));
      assert.equal(genH1.hash, 'hash-h1');
      console.log('ok: (H-1) WmtsGeneratorService.generate(): resolves canonical originals/<uid>.<ext>');

      const UID_H2 = 'h2222222-2222-4222-8222-222222222222';
      await fs.writeFile(path.join(originalsDir, 'h2-legacy-slug.jpg'), imageBuffer);
      const genH2 = await WmtsGeneratorService.generate(
        undefined, UID_H2, 'h2-legacy-slug', 400, 300, wmtsCompiled, 'jpg', 'hash-h2'
      );
      assert.equal(genH2.err, undefined, 'canonical 不在でも一意な legacy へ fallback できれば err は無いはず: ' + JSON.stringify(genH2.err));
      console.log('ok: (H-2) WmtsGeneratorService.generate(): falls back to unique legacy originals/<slug>.<ext>');

      const UID_H3 = 'h3333333-3333-4333-8333-333333333333';
      const genH3 = await WmtsGeneratorService.generate(
        undefined, UID_H3, 'h3-nothing-here', 400, 300, wmtsCompiled, 'jpg', 'hash-h3'
      );
      assert.ok(genH3.err, 'canonical/legacy とも解決できなければ err が返るはず');
      assert.ok(
        String(genH3.err.message).startsWith('originals.unresolved'),
        'レビュー v1 Minor 6: 仮の strict_error 流用ではなく専用の診断識別子 originals.unresolved を使うはず: ' + genH3.err.message
      );
      console.log('ok: (H-3) WmtsGeneratorService.generate(): unresolved originals returns originals.unresolved diagnostic err');

      console.log('M13-T2 originals resolver smoke passed');
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
          entryFileNames: 'm13-t2-originals-resolver-smoke.mjs',
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
  console.log('M13-T2 originals resolver smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
