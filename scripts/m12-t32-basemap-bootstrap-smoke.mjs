// m12-t32: 新規データフォルダ起動時のベースマップ重複（electron-store tmsList 誤取り込み）修正
//
// 設計 docs/superpowers/specs/2026-07-28-m12-t32-bootstrap-basemap-duplication-fix-design.md §11 準拠
// m8-t3 パターン（vite build + electron/electron-store スタブ + 動的 import）に従う。
//
// fixture 生成コマンド（レビュー Info-3・設計 §9）:
//   python3 -c "import json;print(json.dumps(json.load(open('$HOME/Library/Application Support/maplat-editor/config.json'))['tmsList'],ensure_ascii=False,indent=2))" \
//     > tests/fixtures/m12-t32-basemap-bootstrap/legacy-tmslist.json
// 本機 config.json の tmsList（267 件・KTGIS 公開カタログ由来・個人情報不含）を忠実に保持。
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t32-'));
const entryFile = path.join(workDir, 'basemap-bootstrap-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'basemap-bootstrap-smoke.mjs');

const fixturePath = path.join(projectRoot, 'tests/fixtures/m12-t32-basemap-bootstrap/legacy-tmslist.json');
const builtinPath = path.join(projectRoot, 'electron/builtin_base_maps.json');
const tmsListPath = path.join(projectRoot, 'electron/tms_list.json');
const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
const mapDataPath = path.join(projectRoot, 'electron/services/MapDataService.ts');
const assetDraftServicePath = path.join(projectRoot, 'electron/services/AssetDraftService.ts');
const draftTilePathsPath = path.join(projectRoot, 'electron/services/draftTilePaths.ts');

try {
  await writeFile(
    electronStubFile,
    `
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          if (name === 'userData') return ${JSON.stringify(path.join(workDir, 'userData'))};
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
      };
      export const shell = {
        trashItem(_path: string) { return Promise.resolve(); },
      };
    `
  );
  // electron-store スタブ: m8-t3 版に get(defaultValue) と delete を追加
  // （Part C で AssetDraftStore が get(key, fallback) / delete(key) を使うため）
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string, defaultValue?: any) {
          return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : defaultValue;
        }
        set(key: string, value: any) { (this.store as any)[key] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
        delete(key: string) { delete (this.store as any)[key]; }
      }
    `
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { access, readFile, mkdir, writeFile as writeFileAsync } from 'node:fs/promises';
      import nodePath from 'node:path';
      import { randomUUID } from 'node:crypto';

      const exists = async (p: string) => access(p).then(() => true, () => false);
      // onRemoved の fs.remove は fire-and-forget（m12-t20 §6.3 契約）のため、
      // envelope は同期的に消えるが staging dir 回収は非同期。poll で待つ。
      const waitForGone = async (p: string, timeoutMs = 2000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (!(await exists(p))) return true;
          await new Promise((r) => setTimeout(r, 20));
        }
        return !(await exists(p));
      };

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapDataService } = await import(${JSON.stringify(mapDataPath)});
      const { default: AssetDraftService } = await import(${JSON.stringify(assetDraftServicePath)});
      const { draftTileRoot } = await import(${JSON.stringify(draftTilePathsPath)});

      const fixture = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, 'utf8'));
      const builtinCatalog = JSON.parse(await readFile(${JSON.stringify(builtinPath)}, 'utf8'));
      const currentTmsList = JSON.parse(await readFile(${JSON.stringify(tmsListPath)}, 'utf8'));
      const builtinCount = builtinCatalog.length;
      const catalogMapIds = new Set(builtinCatalog.map((e: any) => e.mapID));

      async function tableCounts(): Promise<Record<string, number>> {
        const db = await SqliteDataService.getDb();
        const tables = ['maps', 'base_maps', 'apps', 'poi_sources', 'assets'];
        const counts: Record<string, number> = {};
        for (const t of tables) {
          counts[t] = (db.prepare('SELECT COUNT(*) AS c FROM ' + t).get() as any).c;
        }
        return counts;
      }
      function userBaseMaps(list: any[]) { return list.filter((b) => b.scope === 'user'); }
      function builtinBaseMaps(list: any[]) { return list.filter((b) => b.scope === 'builtin'); }

      // ===================== Part A（AC32-1/2/3）: 空フォルダ + 非デフォルト tmsList 実値 =====================
      {
        const emptyFolder = ${JSON.stringify(path.join(workDir, 'part-a-empty'))};
        await mkdir(emptyFolder, { recursive: true });
        SettingsService.set('saveFolder', emptyFolder);
        // electron-store に非デフォルト tmsList を実値として先置き（fileStore 相当）
        // (1) 撤去後は defaults に tmsList が無いため、defaults 経由ではなく store 実値として置く
        SettingsService.set('tmsList', fixture);
        await SqliteDataService.getDb();

        const list = await SqliteDataService.listBaseMaps();
        const users = userBaseMaps(list);
        const builtins = builtinBaseMaps(list);
        assert.equal(users.length, 0, 'Part A: 新規空フォルダでユーザー定義ベースマップ 0 件');
        assert.equal(builtins.length, builtinCount, 'Part A: ビルトインはカタログ件数（動的導出）');

        const counts = await tableCounts();
        assert.equal(counts.maps, 0, 'Part A: maps 0 件');
        assert.equal(counts.apps, 0, 'Part A: apps 0 件');
        assert.equal(counts.poi_sources, 0, 'Part A: poi_sources 0 件');
        assert.equal(counts.assets, 0, 'Part A: assets 0 件');
        assert.equal(counts.base_maps, builtinCount, 'Part A: base_maps = builtin のみ');

        const db = await SqliteDataService.getDb();
        const marker = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get('2026-07-04-sqlite-write-store-legacy-import');
        assert.ok(marker, 'Part A: LEGACY_MIGRATION_ID marker 記録済み');

        // 再オープンで件数不変
        await SqliteDataService.reset();
        await SqliteDataService.getDb();
        const list2 = await SqliteDataService.listBaseMaps();
        assert.equal(userBaseMaps(list2).length, 0, 'Part A: 再オープンで user 0 件不変');
        assert.equal(builtinBaseMaps(list2).length, builtinCount, 'Part A: 再オープンで builtin 不変');

        // 非 vacuous 性: fixture は修正前のコードなら取り込まれていた条件を満たす
        assert.notDeepEqual(
          JSON.stringify(fixture),
          JSON.stringify(currentTmsList),
          'Part A 非 vacuous: fixture は現行デフォルトと JSON 不一致',
        );
        const fixtureMapIds = new Set(fixture.map((e: any) => e.mapID));
        const common = [...fixtureMapIds].filter((id) => catalogMapIds.has(id));
        assert.ok(common.length >= 1, 'Part A 非 vacuous: fixture の mapID が 1 件以上カタログと共通');
        console.log('Part A passed: 新規空フォルダでブートストラップ正常・marker 記録・非 vacuous');
      }

      // ===================== Part B（AC32-4）: 正規レガシー移行 + 非デフォルト tmsList 実値 =====================
      {
        const legacyFolder = ${JSON.stringify(path.join(workDir, 'part-b-legacy'))};
        const settingsDir = nodePath.join(legacyFolder, 'settings');
        await mkdir(settingsDir, { recursive: true });
        // ユーザー独自ベースマップ（カタログに無い mapID）
        await writeFileAsync(
          nodePath.join(settingsDir, 'tmsList.json'),
          JSON.stringify([{ mapID: 'user-legacy-only', title: 'User Legacy', url: 'https://example.test/{z}/{x}/{y}.png' }]),
        );
        // 個別表示設定: カタログ mapID の visibility（ビルトインへ解決されるべき）
        const catalogMapId = builtinCatalog[0].mapID;
        await writeFileAsync(
          nodePath.join(settingsDir, 'tmsList.' + catalogMapId + '.json'),
          JSON.stringify({ [catalogMapId]: true }),
        );

        SettingsService.set('saveFolder', legacyFolder);
        SettingsService.set('tmsList', fixture);
        await SqliteDataService.getDb();

        const list = await SqliteDataService.listBaseMaps();
        const users = userBaseMaps(list);
        assert.equal(users.length, 1, 'Part B: user scope はちょうど 1 件（electron-store 残骸 267 件は取り込まれない）');
        assert.equal(users[0].mapID, 'user-legacy-only', 'Part B: ユーザー独自 mapID が取り込まれる');
        // M5-T10: 残骸混入を **slug の形ではなく登録内容** で判定する。
        // 旧実装は users.filter((b) => b.mapID.endsWith('_2')) を見ていたが、直前2行で
        // users が ['user-legacy-only'] に固定されており **恒真だった**
        // （述語を endsWith('y') へ変異させると落ちることで確認済み。m5-t10 設計 §2）。
        //
        // 残骸がカタログ ID を先取りした場合、押し出されて改名されるのは **builtin 側**である。
        // ∴ builtin の slug が全件カタログ ID と一致することを見る。採番規則が
        // '_2' でも '-2' でも、この検査は同じ強さで働く（Part B-2 が判別力を示す）。
        const renamedBuiltins = builtinBaseMaps(list).filter((b) => !catalogMapIds.has(b.mapID));
        assert.deepEqual(renamedBuiltins.map((b) => b.mapID), [],
          'Part B: builtin は全件カタログ ID のまま（残骸に先取りされて改名されていない）');

        // visibility は map_uid 解決に依存し、本 Part は地図を作らないため全行 warning-skip される
        // （実装レビュー Minor-1 吸収: 恒真 assert を skip 経路の実 assert へ正直化。
        //   カタログ mapID → ビルトイン uid 解決の実検証は smoke:m7-sqlite-write-store が
        //   実マップ + tmsList_mapA.json の gsi_ort_USA10 で担保しており、AC32-4 の
        //   visibility 節の検証手段はそちらが正）
        const db = await SqliteDataService.getDb();
        const visRows = db.prepare('SELECT map_uid, base_map_uid, enabled FROM map_base_map_visibility').all() as any[];
        assert.equal(visRows.length, 0, 'Part B: map 不在のため visibility は全行 warning-skip（挿入 0 件）');
        console.log('Part B passed: 正規レガシー移行で残骸非取込・user 1 件・visibility は skip 経路確認（解決実検証は m7 回帰）');
      }

      // ============ Part B-2（M5-T10）: Part B の残骸検査に判別力があることを示す ============
      // Part B の検査（builtin が全件カタログ ID）は、衝突が起きていない状態では常に通る。
      // **通らない状態を実際に作れること**を示さなければ、恒真アサートを別の恒真アサートへ
      // 置き換えただけになる（m5-t10 設計 §3.4 の PROBE-3 却下と同じ落とし穴）。
      //
      // あわせて、衝突時に生成される slug が **正本の '-' 始まり規則**に従うことを検証する
      // （m5-t10 の規則統一の seed 経路での end-to-end 検証 = AC5）。
      {
        const collideFolder = ${JSON.stringify(path.join(workDir, 'part-b2-collide'))};
        await mkdir(collideFolder, { recursive: true });
        SettingsService.set('saveFolder', collideFolder);
        await SqliteDataService.reset();
        const db2 = await SqliteDataService.getDb();

        // 衝突状態を作る: builtin 'muroran00' の行と registry を消し、その slug を
        // 利用者資産（地図）が先取りしている状態にする（m8-t2 (h) と同じ手法）
        const victim = db2
          .prepare("SELECT uid FROM base_maps WHERE scope = 'builtin' AND slug = 'muroran00'")
          .get() as any;
        assert.ok(victim, 'Part B-2 前提: builtin muroran00 がシードされている');
        db2.prepare('DELETE FROM base_maps WHERE uid = ?').run(victim.uid);
        db2.prepare('DELETE FROM asset_registry WHERE uid = ?').run(victim.uid);
        await SqliteDataService.createMap('muroran00', { title: 'ビルトインIDを先取りした地図' });

        // 再シード
        await SqliteDataService.reset();
        await SqliteDataService.getDb();
        const collidedList = await SqliteDataService.listBaseMaps();
        const collidedRenamed = builtinBaseMaps(collidedList).filter((b) => !catalogMapIds.has(b.mapID));

        // (1) 判別力: Part B と同じ検査がここでは**落ちる**（＝恒真ではない）
        assert.equal(collidedRenamed.length, 1,
          'Part B-2: 先取りされたぶん builtin が1件だけ改名される（Part B の検査に判別力がある）');

        // (2) 規則: 生成部は正本の '-' 始まり（M5-T10）
        assert.equal(collidedRenamed[0].mapID, 'muroran00-2',
          'Part B-2: 衝突時の生成 slug は正本規則 base-2（旧 base_2 ではない）');
        assert.equal(collidedRenamed[0].data.builtinId, 'muroran00',
          'Part B-2: builtinId はカタログ ID を保つ（再シードで同一行に再マッチする）');

        console.log('Part B-2 passed: 残骸検査の判別力を実証 + seed 経路の生成 slug が正本規則');
      }

      // ===================== Part C（AC32-5/8）: フォルダ切替時ドラフト全消去 + 同値ガード =====================
      {
        // ドラフトストアが空であることを前提確認（Part A/B はドラフトを作らない）
        const initialDrafts = AssetDraftService.list();
        assert.equal(initialDrafts.length, 0, 'Part C 前提: ドラフトストア空');

        // フォルダ A: saveUserBaseMap 1 件 + map draft 1 件 + staging dir
        const folderA = ${JSON.stringify(path.join(workDir, 'part-c-a'))};
        const folderB = ${JSON.stringify(path.join(workDir, 'part-c-b'))};
        await mkdir(folderA, { recursive: true });
        await mkdir(folderB, { recursive: true });

        SettingsService.set('saveFolder', folderA);
        await SqliteDataService.getDb();
        const saved = await SqliteDataService.saveUserBaseMap({ slug: 'user-in-a', tms: { mapID: 'user-in-a', title: 'A', url: 'https://a.test/{z}/{x}/{y}.png' } });
        const userAUid = saved.uid;

        // map draft 1 件 + staging dir
        const draftUid = randomUUID();
        const envelope = {
          schemaVersion: 1,
          kind: 'map',
          assetUid: draftUid,
          baseRevision: null,
          updatedAt: '2026-07-28T12:00:00.000Z',
          payload: { mapID: 'draft-map-a', title: 'Draft A' },
        };
        AssetDraftService.put(envelope);
        await mkdir(draftTileRoot, { recursive: true });
        const stagingDir = nodePath.join(draftTileRoot, draftUid);
        await mkdir(nodePath.join(stagingDir, '0', '0'), { recursive: true });
        await writeFileAsync(nodePath.join(stagingDir, '0', '0', '0.png'), 'dummy-tile');

        assert.equal(AssetDraftService.list().length, 1, 'Part C: ドラフト 1 件登録');
        assert.ok(await exists(stagingDir), 'Part C: staging dir 実在');

        // A → B 切替（previousSaveFolder = folderA を渡す）
        const previousA = SettingsService.get('saveFolder');
        SettingsService.set('saveFolder', folderB);
        await MapDataService.switchDataFolder(previousA);

        // B: user 0 件・builtin カタログ件数・ドラフト index 空・staging 回収済み
        const listB = await SqliteDataService.listBaseMaps();
        assert.equal(userBaseMaps(listB).length, 0, 'Part C: B で user 0 件');
        assert.equal(builtinBaseMaps(listB).length, builtinCount, 'Part C: B で builtin カタログ件数');
        assert.equal(AssetDraftService.list().length, 0, 'Part C: 切替後ドラフト index 空（全消去）');
        assert.ok(await waitForGone(stagingDir), 'Part C: staging dir 回収済み（per-draft 経路）');

        // B → A 復帰
        const previousB = SettingsService.get('saveFolder');
        SettingsService.set('saveFolder', folderA);
        await MapDataService.switchDataFolder(previousB);

        // A: 保存済み user 1 件・uid 不変（保存済みは無傷）・ドラフトは消えたまま
        const listA = await SqliteDataService.listBaseMaps();
        const usersA = userBaseMaps(listA);
        assert.equal(usersA.length, 1, 'Part A 復帰: user 1 件不変');
        assert.equal(usersA[0].uid, userAUid, 'Part C 復帰: 保存済み uid 不変');
        assert.equal(AssetDraftService.list().length, 0, 'Part C 復帰: ドラフトは消えたまま（仕様）');

        // 同値 re-set（A→A）ではドラフトが消えない
        const draftUid2 = randomUUID();
        AssetDraftService.put({
          schemaVersion: 1,
          kind: 'map',
          assetUid: draftUid2,
          baseRevision: null,
          updatedAt: '2026-07-28T12:01:00.000Z',
          payload: { mapID: 'draft-map-a2', title: 'Draft A2' },
        });
        assert.equal(AssetDraftService.list().length, 1, 'Part C: 同値ガード前 ドラフト 1 件');
        const sameA = SettingsService.get('saveFolder'); // = folderA
        SettingsService.set('saveFolder', folderA); // 同値 re-set
        await MapDataService.switchDataFolder(sameA);
        assert.equal(AssetDraftService.list().length, 1, 'Part C: 同値 re-set でドラフトは消えない（ガード有効）');

        console.log('Part C passed: 切替時全消去・保存済み無傷・staging 回収・同値ガード');
      }

      console.log('M12-T32 basemap bootstrap smoke passed');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'file-url'],
        output: {
          entryFileNames: 'basemap-bootstrap-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M12-T32 basemap bootstrap smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
