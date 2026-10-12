// nov26-m6-t5 (#109・HR-15) smoke: 既存データの画像の内部名を UUID（ベースマップは uid）へ複製で移行する。
// タスク設計 `docs/superpowers/specs/2026-10-11-nov26-m6-t5-task-design.md` v2 §4.2〜§4.4・§7 の 2・§8 AC5〜AC10。
//
//   AC5  冪等: 印がある 2 回目は何も変えない・印を消した再走（F14）・途中で落ちた後の再走（F15）・保存フォルダが空（F20）
//   AC6  壊さない: 旧ファイルが残る・参照が実在を指す・共有（F4・F5）・複製の失敗（F8・F9）・比較と交換（F12）・外を指す（F10・F11）
//   AC7  1.1.0 の解決式で全件が実在
//   AC8  読む側: resourceImageResolver と書き出しが移行の前後で同じ（スプラッシュの名前と og:image のその部分を除く）
//   AC9  移行で書き換えた行の revision と updated_at が前後で同じ
//   AC10 保存の入口の正規化（AppDataService.saveApp・saveUserBaseMap の付け替え F16〜F18）
//   F13  migrate() の呼び順と呼び出しの形（ソーステキスト）／印の定数の置き場（T5-R2-MIN-1）
//
// harness は m19-t2 と同型（vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時 dir）。
// 移行の単体（F1〜F20）は、SqliteDataService.ts の migrate() の DDL を**ソースから切り出して**流した
// 一時の DB で runAssetUuidNamesColdBoot を直接呼ぶ（DDL の写しを持たないので食い違わない）。
// F15 は同じバンドルを子プロセスで `--crash` モードで起動し、__beforeSwap から process.exit(1) で落とす。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t5-migration-'));
const entryFile = path.join(workDir, 'nov26-m6-t5-migration-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'nov26-m6-t5-migration-smoke.mjs');

const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
const migrationPath = path.join(projectRoot, 'electron/services/AssetUuidNamesMigrationService.ts');
const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');
const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
const resolverPath = path.join(projectRoot, 'electron/services/resourceImageResolver.ts');
const thumbnailPathsFile = path.join(projectRoot, 'src/utils/thumbnailPaths.ts');

const MARKER_ID = '2026-10-11-asset-uuid-names-v1';

// ---- ホスト側: ソーステキストの断言（F13・T5-R2-MIN-1）と DDL の切り出し ----------------
const sqliteSrc = await readFile(sqlitePath, 'utf8');
{
  // T5-R2-MIN-1: 印の定数は SqliteDataService.ts の行頭の const（m19-t7 の AC-5(c) が数える形）
  const constLines = sqliteSrc.split('\n').filter((l) => /^const ASSET_UUID_NAMES_V1_ID = /.test(l));
  assert.deepEqual(constLines, [`const ASSET_UUID_NAMES_V1_ID = '${MARKER_ID}';`],
    'T5-R2-MIN-1: 印の定数は SqliteDataService.ts の行頭の const（export しない）');
  // F13: migrate() の中で、取込（runLegacyMigrationIfNeeded）→ 原本の移行（runColdBoot）→ 本移行 の順。
  // 本移行は this. のメソッドでなく try/catch の中のモジュールの関数（m19-t7 AC-5(b) の段に数えない）
  const start = sqliteSrc.indexOf('  private async migrate(db: DatabaseSync)');
  const end = sqliteSrc.indexOf('  private async runLegacyMigrationIfNeeded(');
  assert.ok(start > 0 && end > start, 'F13: migrate() の本体を切り出せる');
  const body = sqliteSrc.slice(start, end);
  const iLegacy = body.indexOf('await this.runLegacyMigrationIfNeeded(db);');
  const iOriginals = body.indexOf('await runColdBoot(db);');
  const callRe = /^ {6}await runAssetUuidNamesColdBoot\(db, this\.folders\.saveFolder, ASSET_UUID_NAMES_V1_ID\);$/m;
  const callMatch = callRe.exec(body);
  assert.ok(iLegacy > 0 && iOriginals > iLegacy, 'F13: 取込 → 原本の移行 の順が保たれている');
  assert.ok(callMatch, 'F13: 本移行はモジュールの関数として 6 字下げ（try の中）で呼ばれ、印の定数を引数で渡す');
  assert.ok(callMatch.index > iOriginals, 'F13/R3-MIN-1: 本移行は原本の移行（runColdBoot）の後');
  const before = body.slice(0, callMatch.index).split('\n').slice(-3).join('\n');
  assert.match(before, /try \{/, 'F13: 本移行の呼び出しは try/catch の中');
  assert.match(body, /nov26-m6-t5 §4\.2『m19-t7 との関係』/, 'F13: 取込の中間段ではないことの注記がある');
  assert.equal(/this\.runAssetUuidNames/.test(body), false, 'F13: this. のメソッドにしない');
  console.log('ok: F13 呼び順（取込 → 原本 → 本移行）・try/catch・印の定数は行頭 const（T5-R2-MIN-1）');
}
const ddl = {};
for (const table of ['schema_migrations', 'apps', 'base_maps']) {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\);`).exec(sqliteSrc);
  assert.ok(m, `DDL: ${table} を SqliteDataService.ts から切り出せる`);
  ddl[table] = `CREATE TABLE IF NOT EXISTS ${table} (${m[1]}\n);`;
}

await writeFile(
  electronStubFile,
  `
    export const app = {
      getPath(name: string) { return ${JSON.stringify(workDir)} + '/' + name; },
      getName() { return 'MaplatEditorSmoke'; },
      getAppPath() { return ${JSON.stringify(projectRoot)}; },
      isPackaged: false,
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const dialog = {
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showSaveDialog(_win: any, _opts: any) {
        return (globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined };
      },
      async showMessageBox() { return { response: 0 }; },
    };
    export const BrowserWindow = class {
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); }, webRequest: { onBeforeRequest: () => {} } } };
    export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
  `,
);
await writeFile(
  electronStoreStubFile,
  `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `,
);

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import fs from 'node:fs/promises';
    import fse from 'fs-extra';
    import { createHash } from 'node:crypto';
    import { execFile } from 'node:child_process';
    import { promisify } from 'node:util';
    import { DatabaseSync } from 'node:sqlite';
    import { Jimp } from 'jimp';
    import AdmZip from 'adm-zip';
    import { runAssetUuidNamesColdBoot } from ${JSON.stringify(migrationPath)};
    import { thumb512PathFor, thumb52PathFor } from ${JSON.stringify(thumbnailPathsFile)};

    const workDir = ${JSON.stringify(workDir)};
    const MARKER_ID = ${JSON.stringify(MARKER_ID)};
    const DDL = ${JSON.stringify(ddl)};
    const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const UUID_SPLASH = new RegExp('^' + UUID + '\\\\.[a-z0-9]{1,5}$');
    const UUID_ICON = new RegExp('^pwa/' + UUID + '\\\\.[a-z0-9]{1,5}$');
    const STAMP = '2026-01-02 03:04:05';

    const exists = (p) => fs.stat(p).then(() => true).catch(() => false);
    const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
    const put = async (dir, rel, content) => {
      const p = nodePath.join(dir, ...rel.split('/'));
      await fs.mkdir(nodePath.dirname(p), { recursive: true });
      await fs.writeFile(p, content ?? Buffer.from('content of ' + rel));
      return p;
    };
    function openDb(dir) {
      const db = new DatabaseSync(nodePath.join(dir, 'maplat.sqlite'));
      db.exec(DDL.schema_migrations); db.exec(DDL.apps); db.exec(DDL.base_maps);
      return db;
    }
    let seq = 0;
    function insertApp(db, uid, data) {
      db.prepare('INSERT INTO apps (uid, slug, data_json, revision, updated_at) VALUES (?, ?, ?, 3, ?)')
        .run(uid, 'app-' + (++seq), JSON.stringify(data), STAMP);
    }
    function insertBase(db, uid, data, scope = 'user') {
      db.prepare('INSERT INTO base_maps (uid, slug, scope, sort_order, data_json, revision, updated_at) VALUES (?, ?, ?, ?, ?, 5, ?)')
        .run(uid, 'bm-' + (++seq), scope, seq, JSON.stringify(data), STAMP);
    }
    const appData = (db, uid) => JSON.parse(db.prepare('SELECT data_json FROM apps WHERE uid = ?').get(uid).data_json);
    const baseData = (db, uid) => JSON.parse(db.prepare('SELECT data_json FROM base_maps WHERE uid = ?').get(uid).data_json);
    const hasMarker = (db) => Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(MARKER_ID));
    const rowsOf = (db) => ({
      apps: db.prepare('SELECT uid, data_json, revision, updated_at FROM apps ORDER BY uid').all().map((r) => ({ ...r })),
      base: db.prepare('SELECT uid, data_json, revision, updated_at FROM base_maps ORDER BY uid').all().map((r) => ({ ...r })),
    });
    async function folderSnapshot(dir) {
      const out = [];
      for (const sub of ['img', 'pwa', 'tmbs']) {
        const root = nodePath.join(dir, sub);
        if (!(await exists(root))) continue;
        for (const name of (await fs.readdir(root)).sort()) {
          const p = nodePath.join(root, name);
          const st = await fs.lstat(p);
          if (st.isSymbolicLink() || !st.isFile()) { out.push(sub + '/' + name + ':link'); continue; }
          out.push(sub + '/' + name + ':' + (await sha(p)));
        }
      }
      return out;
    }
    const outcomeOf = (result, uid, kind) => result.entries.filter((e) => e.uid === uid && e.kind === kind).map((e) => e.outcome);
    // 1.1.0 の解決式（AC7）
    const resolve110 = {
      splash: (dir, v) => nodePath.join(dir, 'img', v),
      iconSource: (dir, v) => nodePath.join(dir, v),
      thumbnail: (dir, v) => nodePath.join(dir, v),
      thumbnail512: (dir, v) => nodePath.join(dir, thumb512PathFor(v)),
    };

    // ===================== F15 の子プロセス（--crash）=====================
    if (process.argv[2] === '--crash') {
      const [, , , dir, crashUid] = process.argv;
      const db = new DatabaseSync(nodePath.join(dir, 'maplat.sqlite'));
      await runAssetUuidNamesColdBoot(db, dir, MARKER_ID, {
        __beforeSwap: (uid) => { if (uid === crashUid) process.exit(1); },
      });
      process.exit(0);
    }

    const A1 = '10000000-0000-4000-8000-000000000001';
    const A2 = '10000000-0000-4000-8000-000000000002';
    const A3 = '10000000-0000-4000-8000-000000000003';
    const A4 = '10000000-0000-4000-8000-000000000004';
    const A5 = '10000000-0000-4000-8000-000000000005';
    const A6 = '10000000-0000-4000-8000-000000000006';
    const A7 = '10000000-0000-4000-8000-000000000007';
    const A8 = '10000000-0000-4000-8000-000000000008';
    const A9 = '10000000-0000-4000-8000-000000000009';
    const A10 = '10000000-0000-4000-8000-000000000010';
    const B1 = '20000000-0000-4000-8000-000000000001';
    const B2 = '20000000-0000-4000-8000-000000000002';
    const B3 = '20000000-0000-4000-8000-000000000003';
    const B4 = '20000000-0000-4000-8000-000000000004';
    const SHARED_UUID = 'e987a508-1234-4abc-8def-0123456789ab.png';

    // ===================== 主の fixture（F1〜F7・F10・F11・F19）=====================
    {
      const dir = nodePath.join(workDir, 'main');
      await fs.mkdir(dir, { recursive: true });
      const outside = nodePath.join(workDir, 'outside');
      await put(outside, 'secret.png');
      await put(workDir, 'outside.png');
      // F1 元のファイル名のスプラッシュ・F2 slug 名の PWA アイコン
      await put(dir, 'img/地図.png'); await put(dir, 'pwa/foo_icon.png');
      // F3 httpSettings.iconSource だけ
      await put(dir, 'pwa/old_http_icon.png');
      // F4 2 つのアプリが img/shared.png を共有・F5 UUID の形の名前を共有
      await put(dir, 'img/shared.png'); await put(dir, 'img/' + SHARED_UUID);
      // F6 slug 名のベースマップ（512px あり）・F7 512px の無い jpg
      await put(dir, 'tmbs/bm-slug.png'); await put(dir, thumb512PathFor('tmbs/bm-slug.png'));
      await put(dir, 'tmbs/bm2.jpg');
      // F11 保存フォルダの外を指す symlink
      await fs.mkdir(nodePath.join(dir, 'img'), { recursive: true });
      await fs.symlink(nodePath.join(outside, 'secret.png'), nodePath.join(dir, 'img', 'link.png'));
      // F19 拡張子
      await put(dir, 'img/地図.JPG'); await put(dir, 'pwa/foo_icon.webp'); await put(dir, 'img/x.verylongext');
      // 同梱の参照（basemap_icons/）は対象外
      const db = openDb(dir);
      insertApp(db, A1, { appName: 'F1F2', appSettings: { splash: '地図.png' }, manifestSettings: { iconSource: 'pwa/foo_icon.png' } });
      insertApp(db, A2, { appName: 'F3', appSettings: {}, httpSettings: { iconSource: 'pwa/old_http_icon.png' } });
      insertApp(db, A3, { appName: 'F4-a', appSettings: { splash: 'shared.png' } });
      insertApp(db, A4, { appName: 'F4-b', appSettings: { splash: 'shared.png' } });
      insertApp(db, A5, { appName: 'F5-a', appSettings: { splash: SHARED_UUID } });
      insertApp(db, A6, { appName: 'F5-b', appSettings: { splash: SHARED_UUID } });
      insertApp(db, A7, { appName: 'F10/F11', appSettings: { splash: '../outside.png' }, manifestSettings: { iconSource: 'img/link.png' } });
      insertApp(db, A8, { appName: 'F19', appSettings: { splash: '地図.JPG' }, manifestSettings: { iconSource: 'pwa/foo_icon.webp' } });
      insertApp(db, A9, { appName: 'F19-unsupported+missing', appSettings: { splash: 'x.verylongext' }, manifestSettings: { iconSource: 'pwa/gone.png' } });
      insertBase(db, B1, { thumbnail: 'tmbs/bm-slug.png' });
      insertBase(db, B2, { thumbnail: 'tmbs/bm2.jpg' });
      insertBase(db, B3, { thumbnail: 'basemap_icons/osm.png' });
      insertBase(db, B4, { thumbnail: 'tmbs/whatever.png' }, 'builtin');

      const before = rowsOf(db);
      const filesBefore = await folderSnapshot(dir);
      const r1 = await runAssetUuidNamesColdBoot(db, dir, MARKER_ID);
      assert.ok(hasMarker(db), 'AC5: 1 回目の後に印がある');

      // --- F1・F2 ---
      const a1 = appData(db, A1);
      assert.match(a1.appSettings.splash, UUID_SPLASH, 'F1: スプラッシュが {uuid}.png');
      assert.ok(a1.appSettings.splash.endsWith('.png'));
      assert.match(a1.manifestSettings.iconSource, UUID_ICON, 'F2: アイコンが pwa/{uuid}.png');
      assert.equal(await sha(nodePath.join(dir, 'img', a1.appSettings.splash)), await sha(nodePath.join(dir, 'img/地図.png')), 'F1: 内容は同じ');
      assert.deepEqual(outcomeOf(r1, A1, 'splash'), ['migrated']);
      assert.deepEqual(outcomeOf(r1, A1, 'iconSource'), ['migrated']);
      // --- F3（読んだキーそのものを書き換え、manifestSettings を生やさない）---
      const a2 = appData(db, A2);
      assert.match(a2.httpSettings.iconSource, UUID_ICON, 'F3: httpSettings.iconSource を書き換える');
      assert.equal(a2.manifestSettings, undefined, 'F3: manifestSettings を生やさない（参照の形を変えない）');
      // --- F4（UUID の形でない共有は全員を複製）---
      const s3 = appData(db, A3).appSettings.splash; const s4 = appData(db, A4).appSettings.splash;
      assert.match(s3, UUID_SPLASH); assert.match(s4, UUID_SPLASH);
      assert.notEqual(s3, s4, 'F4/AC6(c): 共有は参照ごとに別名');
      assert.deepEqual([...outcomeOf(r1, A3, 'splash'), ...outcomeOf(r1, A4, 'splash')], ['shared_split', 'shared_split']);
      // --- F5（UUID の形の共有: uid の昇順で最初はそのまま、それ以外は複製）---
      assert.equal(appData(db, A5).appSettings.splash, SHARED_UUID, 'F5: 最初の参照は UUID の形のまま');
      const s6 = appData(db, A6).appSettings.splash;
      assert.match(s6, UUID_SPLASH); assert.notEqual(s6, SHARED_UUID, 'F5/AC6(c): 2 つ目は新しい UUID へ複製');
      assert.deepEqual(outcomeOf(r1, A5, 'splash'), ['already_uuid']);
      assert.deepEqual(outcomeOf(r1, A6, 'splash'), ['shared_split']);
      // --- F10・F11（外を指す）---
      assert.equal(appData(db, A7).appSettings.splash, '../outside.png', 'F10: 参照は変わらない');
      assert.equal(appData(db, A7).manifestSettings.iconSource, 'img/link.png', 'F11: 参照は変わらない');
      assert.deepEqual(outcomeOf(r1, A7, 'splash'), ['outside_folder'], 'F10/AC6(g)');
      assert.deepEqual(outcomeOf(r1, A7, 'iconSource'), ['outside_folder'], 'F11/AC6(g)');
      // --- F19（拡張子）---
      const a8 = appData(db, A8);
      assert.match(a8.appSettings.splash, new RegExp('^' + UUID + '\\\\.jpg$'), 'F19: 地図.JPG -> {u}.jpg');
      assert.match(a8.manifestSettings.iconSource, new RegExp('^pwa/' + UUID + '\\\\.webp$'), 'F19: foo_icon.webp -> pwa/{u}.webp');
      assert.equal(appData(db, A9).appSettings.splash, 'x.verylongext', 'F19: 合わない拡張子は参照が変わらない');
      assert.deepEqual(outcomeOf(r1, A9, 'splash'), ['unsupported_form']);
      assert.deepEqual(outcomeOf(r1, A9, 'iconSource'), ['source_missing'], '複製元が無いものは飛ばす');
      assert.equal(appData(db, A9).manifestSettings.iconSource, 'pwa/gone.png');
      // --- F6・F7（ベースマップ）---
      assert.equal(baseData(db, B1).thumbnail, thumb52PathFor(B1, 'png'), 'F6: thumbnail は uid 名');
      assert.ok(await exists(nodePath.join(dir, thumb512PathFor(thumb52PathFor(B1, 'png')))), 'F6/AC6(e): 512px も uid 名で在る');
      assert.equal(baseData(db, B2).thumbnail, thumb52PathFor(B2, 'jpg'), 'F7: 拡張子を保って uid 名');
      assert.equal(await exists(nodePath.join(dir, thumb512PathFor(thumb52PathFor(B2, 'jpg')))), false, 'F7: 512px は作らない');
      assert.equal(baseData(db, B3).thumbnail, 'basemap_icons/osm.png', '同梱の参照は対象外');
      assert.equal(baseData(db, B4).thumbnail, 'tmbs/whatever.png', 'ビルトインは対象外');
      assert.equal(r1.entries.some((e) => e.uid === B3 || e.uid === B4), false, '対象外は報告にも出ない');

      // --- AC6(a) 旧ファイルが残る ---
      for (const entry of filesBefore) {
        const rel = entry.slice(0, entry.lastIndexOf(':'));
        assert.ok(await exists(nodePath.join(dir, rel)), 'AC6(a): 旧ファイルが残る: ' + rel);
      }
      // --- AC6(b)・AC7: 書き換えた参照は 1.1.0 の解決式で実在 ---
      for (const uid of [A1, A2, A3, A4, A5, A6, A8]) {
        const d = appData(db, uid);
        if (d.appSettings?.splash) assert.ok(await exists(resolve110.splash(dir, d.appSettings.splash)), 'AC7: splash ' + uid);
        const icon = d.manifestSettings?.iconSource || d.httpSettings?.iconSource;
        if (icon) assert.ok(await exists(resolve110.iconSource(dir, icon)), 'AC7: iconSource ' + uid);
      }
      for (const uid of [B1, B2]) {
        assert.ok(await exists(resolve110.thumbnail(dir, baseData(db, uid).thumbnail)), 'AC7: thumbnail ' + uid);
      }
      assert.ok(await exists(resolve110.thumbnail512(dir, baseData(db, B1).thumbnail)), 'AC7: 512px（B1）');
      // --- AC9: revision と updated_at が同じ ---
      const after = rowsOf(db);
      for (const key of ['apps', 'base']) {
        assert.deepEqual(after[key].map((r) => [r.uid, r.revision, r.updated_at]), before[key].map((r) => [r.uid, r.revision, r.updated_at]),
          'AC9: ' + key + ' の revision と updated_at が前後で同じ');
      }
      // --- 報告 ---
      const report = JSON.parse(await fs.readFile(nodePath.join(dir, 'migration-report-v2.json'), 'utf8'));
      const rep = report.assetUuidNamesMigration;
      assert.ok(rep && typeof rep.lastRunAt === 'string', '報告: assetUuidNamesMigration がある');
      for (const k of ['migrated', 'already_uuid', 'shared_split', 'source_missing', 'outside_folder', 'copy_failed', 'cas_mismatch']) {
        assert.equal(typeof rep.summary[k], 'number', '報告: summary.' + k);
      }
      assert.equal(rep.summary.outside_folder, 2); assert.equal(rep.summary.shared_split, 3);
      assert.deepEqual(report.renamedSlugs, [], '報告: 既存の top-level を保つ（additive）');
      console.log('ok: F1〜F7・F10・F11・F19・AC6(a)(b)(c)(e)(g)・AC7・AC9・報告');

      // --- AC5: 印がある 2 回目は何も変えない ---
      const rowsAfter1 = rowsOf(db); const filesAfter1 = await folderSnapshot(dir);
      const r2 = await runAssetUuidNamesColdBoot(db, dir, MARKER_ID);
      assert.equal(r2.skipped, 'marker', 'AC5: 2 回目は印で飛ばす');
      assert.deepEqual(rowsOf(db), rowsAfter1, 'AC5: 2 回目の前後で DB が同じ');
      assert.deepEqual(await folderSnapshot(dir), filesAfter1, 'AC5: 2 回目の前後でフォルダが同じ');
      // --- F14: 印を消して再走 ---
      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(MARKER_ID);
      const r3 = await runAssetUuidNamesColdBoot(db, dir, MARKER_ID);
      assert.ok(hasMarker(db), 'F14: 再走の後に印が付く');
      for (const e of r1.entries) {
        const again = r3.entries.find((x) => x.uid === e.uid && x.kind === e.kind);
        assert.ok(again, 'F14: 同じ参照が報告に出る ' + e.uid + '/' + e.kind);
        const expected = ['migrated', 'shared_split', 'already_uuid'].includes(e.outcome) ? 'already_uuid' : e.outcome;
        assert.equal(again.outcome, expected, 'F14: ' + e.uid + '/' + e.kind + ' は ' + expected);
      }
      assert.deepEqual(rowsOf(db), rowsAfter1, 'F14/AC6(c): data_json が 1 回目の後と同じ（共有は 2 回目で不変）');
      assert.deepEqual(await folderSnapshot(dir), filesAfter1, 'F14: 新しい複製ができない');
      console.log('ok: AC5 印がある 2 回目は不変・F14 印を消した再走でも不変');
      db.close();
    }

    // ===================== F8・F9（複製の失敗）=====================
    {
      const dir = nodePath.join(workDir, 'fail');
      await fs.mkdir(dir, { recursive: true });
      const db = openDb(dir);
      // F8: 512px の複製だけを失敗させる（new512 の位置に別内容）
      await put(dir, 'tmbs/f8.png'); await put(dir, thumb512PathFor('tmbs/f8.png'));
      const f8new512 = await put(dir, thumb512PathFor(thumb52PathFor(B1, 'png')), Buffer.from('OTHER 512'));
      insertBase(db, B1, { thumbnail: 'tmbs/f8.png' });
      // F9: 52px の複製だけを失敗させる（new52 の位置に別内容。512px は複製できる）
      await put(dir, 'tmbs/f9.png'); await put(dir, thumb512PathFor('tmbs/f9.png'));
      const f9new52 = await put(dir, thumb52PathFor(B2, 'png'), Buffer.from('OTHER 52'));
      insertBase(db, B2, { thumbnail: 'tmbs/f9.png' });
      const r = await runAssetUuidNamesColdBoot(db, dir, MARKER_ID);
      // F8
      assert.equal(baseData(db, B1).thumbnail, 'tmbs/f8.png', 'F8/AC6(d): 参照は変わらない');
      assert.deepEqual(outcomeOf(r, B1, 'thumbnail'), ['copy_failed']);
      assert.equal(await exists(nodePath.join(dir, thumb52PathFor(B1, 'png'))), false, 'F8: 52px の複製は起きない');
      assert.equal((await fs.readFile(f8new512)).toString(), 'OTHER 512', 'F8: 先にあった別内容のファイルに触れない');
      // F9
      assert.equal(baseData(db, B2).thumbnail, 'tmbs/f9.png', 'F9/AC6(d): 参照は変わらない');
      assert.deepEqual(outcomeOf(r, B2, 'thumbnail'), ['copy_failed']);
      assert.equal(await exists(nodePath.join(dir, thumb512PathFor(thumb52PathFor(B2, 'png')))), false, 'F9: この件で作った new512 は消す');
      assert.equal((await fs.readFile(f9new52)).toString(), 'OTHER 52', 'F9: 先に置いた別内容のファイルは残る');
      for (const rel of ['tmbs/f8.png', thumb512PathFor('tmbs/f8.png'), 'tmbs/f9.png', thumb512PathFor('tmbs/f9.png')]) {
        assert.ok(await exists(nodePath.join(dir, rel)), 'F8/F9: 旧ファイルが残る ' + rel);
      }
      console.log('ok: F8・F9 複製の失敗は参照を変えず copy_failed・消すのはこの件で作った new512 だけ（AC6(d)）');
      db.close();
    }

    // ===================== F12（比較と交換）=====================
    {
      const dir = nodePath.join(workDir, 'cas');
      await fs.mkdir(dir, { recursive: true });
      const db = openDb(dir);
      await put(dir, 'img/a.png'); await put(dir, 'img/b.png');
      insertApp(db, A1, { appName: 'before', appSettings: { splash: 'a.png' } });
      insertApp(db, A2, { appName: 'B', appSettings: { splash: 'b.png' } });
      // IR-T5-MIN-1: ベースマップの行でも、複製の後・書き換えの前に thumbnail が変えられたら付け替えない
      await put(dir, 'tmbs/cas-bm.png'); await put(dir, thumb512PathFor('tmbs/cas-bm.png'));
      insertBase(db, B1, { title: 'cas', thumbnail: 'tmbs/cas-bm.png' });
      const r = await runAssetUuidNamesColdBoot(db, dir, MARKER_ID, {
        __beforeSwap: (uid) => {
          if (uid === B1) { const d = baseData(db, B1); d.thumbnail = 'tmbs/changed-by-user.png'; db.prepare('UPDATE base_maps SET data_json = ? WHERE uid = ?').run(JSON.stringify(d), B1); }
          if (uid === A1) { const d = appData(db, A1); d.appName = 'edited'; db.prepare('UPDATE apps SET data_json = ? WHERE uid = ?').run(JSON.stringify(d), A1); }
          if (uid === A2) { const d = appData(db, A2); d.appSettings.splash = 'renamed-by-user.png'; db.prepare('UPDATE apps SET data_json = ? WHERE uid = ?').run(JSON.stringify(d), A2); }
        },
      });
      const a1 = appData(db, A1);
      assert.equal(a1.appName, 'edited', 'F12/AC6(f): 別キーの編集が失われない');
      assert.match(a1.appSettings.splash, UUID_SPLASH, 'F12: 同じキーが旧値のままなら書き換える');
      assert.equal(appData(db, A2).appSettings.splash, 'renamed-by-user.png', 'F12/AC6(f): 同じキーを変えられた行は書き換えない');
      assert.deepEqual(outcomeOf(r, A2, 'splash'), ['cas_mismatch']);
      assert.equal(baseData(db, B1).thumbnail, 'tmbs/changed-by-user.png', 'F12/IR-T5-MIN-1: ベースマップも、thumbnail を変えられた行は書き換えない');
      assert.deepEqual(outcomeOf(r, B1, 'thumbnail'), ['cas_mismatch'], 'F12/IR-T5-MIN-1: ベースマップの cas_mismatch');
      assert.ok(await exists(nodePath.join(dir, 'tmbs/cas-bm.png')), 'F12: 旧ファイルは残る');
      console.log('ok: F12 比較と交換（AC6(f)。アプリとベースマップ）');
      db.close();
    }

    // ===================== F15（途中で落ちて再走）=====================
    {
      const dir = nodePath.join(workDir, 'crash');
      await fs.mkdir(dir, { recursive: true });
      const db = openDb(dir);
      await put(dir, 'img/crash.png');
      await put(dir, 'tmbs/crash-bm.png'); await put(dir, thumb512PathFor('tmbs/crash-bm.png'));
      insertApp(db, A1, { appSettings: { splash: 'crash.png' } });
      insertBase(db, B1, { thumbnail: 'tmbs/crash-bm.png' });
      db.close();
      const run = promisify(execFile);
      const crash = async (uid) => {
        try { await run(process.execPath, [process.argv[1], '--crash', dir, uid], { timeout: 60000 }); return 0; }
        catch (e) { return e.code; }
      };
      // 1 回目: アプリの複製の後・書き換えの前で落ちる
      assert.equal(await crash(A1), 1, 'F15: 子プロセスが落ちる（アプリ）');
      let db2 = new DatabaseSync(nodePath.join(dir, 'maplat.sqlite'));
      assert.equal(hasMarker(db2), false, 'F15: 落ちたら印は付かない');
      assert.equal(appData(db2, A1).appSettings.splash, 'crash.png', 'F15: 参照はまだ旧名');
      const orphan = (await fs.readdir(nodePath.join(dir, 'img'))).filter((n) => UUID_SPLASH.test(n));
      assert.equal(orphan.length, 1, 'F15: 1 回目の複製が 1 つある');
      db2.close();
      // 2 回目: アプリは新しい UUID で複製し直して書き換え、ベースマップの複製の後で落ちる
      assert.equal(await crash(B1), 1, 'F15: 子プロセスが落ちる（ベースマップ）');
      db2 = new DatabaseSync(nodePath.join(dir, 'maplat.sqlite'));
      assert.equal(hasMarker(db2), false);
      const splash2 = appData(db2, A1).appSettings.splash;
      assert.match(splash2, UUID_SPLASH, 'F15: アプリは書き換わった');
      assert.notEqual(splash2, orphan[0], 'F15: 新しい UUID で複製し直す（1 回目の複製は孤児）');
      assert.ok(await exists(nodePath.join(dir, 'img', orphan[0])), 'F15: 1 回目の複製は孤児として残る（失われるものは無い）');
      assert.equal(baseData(db2, B1).thumbnail, 'tmbs/crash-bm.png', 'F15: ベースマップはまだ旧名');
      assert.ok(await exists(nodePath.join(dir, thumb52PathFor(B1, 'png'))), 'F15: ベースマップの複製はある');
      // 3 回目: 通常に走る。ベースマップは EEXIST 同内容で進む
      const r = await runAssetUuidNamesColdBoot(db2, dir, MARKER_ID);
      assert.ok(hasMarker(db2), 'F15: 走り切ったら印が付く');
      assert.equal(baseData(db2, B1).thumbnail, thumb52PathFor(B1, 'png'), 'F15: EEXIST 同内容で進み uid 名になる');
      assert.deepEqual(outcomeOf(r, B1, 'thumbnail'), ['migrated']);
      for (const rel of ['img/crash.png', 'tmbs/crash-bm.png', thumb512PathFor('tmbs/crash-bm.png'), 'img/' + splash2,
        thumb52PathFor(B1, 'png'), thumb512PathFor(thumb52PathFor(B1, 'png'))]) {
        assert.ok(await exists(nodePath.join(dir, rel)), 'F15: 旧ファイル・参照の指し先が実在 ' + rel);
      }
      console.log('ok: F15 途中で落ちた後の再走で失われるものが無い');
      db2.close();
    }

    // ===================== F20（保存フォルダが空）=====================
    {
      const dir = nodePath.join(workDir, 'nofolder');
      await fs.mkdir(dir, { recursive: true });
      const db = openDb(dir);
      insertApp(db, A1, { appSettings: { splash: 'x.png' } });
      const before = rowsOf(db);
      const r = await runAssetUuidNamesColdBoot(db, '', MARKER_ID);
      assert.equal(r.skipped, 'no-save-folder');
      assert.equal(hasMarker(db), false, 'F20: 対象が 1 件以上で保存フォルダが空なら印を付けない');
      assert.deepEqual(rowsOf(db), before, 'F20: 何も変わらない');
      db.prepare('DELETE FROM apps').run();
      await runAssetUuidNamesColdBoot(db, '', MARKER_ID);
      assert.equal(hasMarker(db), true, 'F20: 対象 0 件なら保存フォルダが空でも印を付ける');
      console.log('ok: F20 保存フォルダが空なら印を付けない（対象 0 件なら付ける）');
      db.close();
    }

    // ===================== 実サービス: AC8・AC10・F16〜F18 =====================
    const svcDir = nodePath.join(workDir, 'svc');
    await fs.mkdir(svcDir, { recursive: true });
    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', svcDir);
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
    const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});
    const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
    const { resolveAppListImage } = await import(${JSON.stringify(resolverPath)});
    const db = await SqliteDataService.getDb();
    assert.ok(hasMarker(db), 'migrate(): 空の DB では対象 0 件で印を付ける');
    const fakeWin = { webContents: { send() {} } } as any;
    const png = async (rel, w, h, color) => {
      const p = nodePath.join(svcDir, ...rel.split('/'));
      await fs.mkdir(nodePath.dirname(p), { recursive: true });
      await new Jimp({ width: w, height: h, color }).write(p as any);
    };

    // ---------- AC8: 読む側（resolver・書き出し）が移行の前後で同じ ----------
    {
      await png('img/旧スプラッシュ.png', 64, 48, 0x336699ff);
      await png('pwa/ac8_icon.png', 512, 512, 0x993366ff);
      const doc = {
        appID: 'ac8-app', title: { ja: 'AC8' }, appName: { ja: 'AC8' }, lang: 'ja', sources: [],
        appSettings: { splash: '旧スプラッシュ.png' }, httpSettings: { pwaManifest: false }, manifestSettings: { iconSource: 'pwa/ac8_icon.png' },
      };
      const { uid } = await SqliteDataService.createApp('ac8-app', doc);
      const splashOnly = await SqliteDataService.createApp('ac8-splash-only', { ...doc, appID: 'ac8-splash-only', manifestSettings: {} });
      const exportZip = async (name) => {
        const current = await SqliteDataService.findAppByRef(uid);
        const zipPath = nodePath.join(workDir, name + '.zip');
        (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
        const r = await AppExportService.exportApp(fakeWin, { ...current, appID: 'ac8-app' });
        assert.equal(r.result, 'Success', 'AC8: 書き出しが成功する ' + JSON.stringify(r));
        const entries = new AdmZip(zipPath).getEntries().filter((e) => !e.isDirectory);
        return { splash: current.appSettings.splash, entries: new Map(entries.map((e) => [e.entryName, e.getData()])) };
      };
      const before = await exportZip('ac8-before');
      const listBefore = await resolveAppListImage(await SqliteDataService.findAppByRef(uid));
      const listBeforeSplash = await resolveAppListImage(await SqliteDataService.findAppByRef(splashOnly.uid));
      assert.ok(listBefore && listBeforeSplash, 'AC8: 移行前に一覧の画像が出る');

      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(MARKER_ID);
      await runAssetUuidNamesColdBoot(db, svcDir, MARKER_ID);
      const migrated = await SqliteDataService.findAppByRef(uid);
      assert.match(migrated.appSettings.splash, UUID_SPLASH, 'AC8: 移行で splash が UUID 名');
      assert.match(migrated.manifestSettings.iconSource, UUID_ICON, 'AC8: 移行で iconSource が UUID 名');
      const listAfter = await resolveAppListImage(migrated);
      const listAfterSplash = await resolveAppListImage(await SqliteDataService.findAppByRef(splashOnly.uid));
      assert.ok(listAfter && listAfter.includes(migrated.manifestSettings.iconSource.split('/')[1]), 'AC8: 一覧の画像（アイコン）が新しい名前で出る');
      assert.ok(listAfterSplash && /[0-9a-f-]{36}\\.png/.test(listAfterSplash), 'AC8: 一覧の画像（スプラッシュ）が新しい名前で出る');

      const after = await exportZip('ac8-after');
      // スプラッシュの名前（とそれを含む app JSON の splash・og:image）だけを同じ記号に置いてから比べる
      const norm = (name, splash) => name.split(splash).join('<SPLASH>');
      const canon = (z) => new Map([...z.entries].map(([n, buf]) => {
        const key = norm(n, z.splash);
        const text = /\\.(html|json)$/.test(n) ? Buffer.from(norm(buf.toString('utf8'), z.splash)) : buf;
        return [key, createHash('sha256').update(text).digest('hex')];
      }));
      const cb = canon(before); const ca = canon(after);
      assert.deepEqual([...ca.keys()].sort(), [...cb.keys()].sort(), 'AC8: 書き出し物のエントリの一覧が同じ（スプラッシュの名前を除く）');
      const diff = [...cb.keys()].filter((k) => cb.get(k) !== ca.get(k));
      assert.deepEqual(diff, [], 'AC8: 各エントリの SHA-256 が同じ（スプラッシュの名前と og:image のその部分を除く）');
      console.log('ok: AC8 一覧の画像と書き出し物が移行の前後で同じ（' + cb.size + ' エントリ）');
    }

    // ---------- AC10: アプリの保存の入口の正規化 ----------
    {
      await png('img/保存前.png', 32, 32, 0x112233ff);
      await png('pwa/save_icon.png', 512, 512, 0x445566ff);
      const imgCount = async () => (await fs.readdir(nodePath.join(svcDir, 'img'))).length;
      const pwaCount = async () => (await fs.readdir(nodePath.join(svcDir, 'pwa'))).length;
      const document = {
        appID: 'ac10-app', appName: { ja: 'AC10' }, lang: 'ja', sources: [],
        appSettings: { splash: '保存前.png' }, httpSettings: {}, manifestSettings: { iconSource: 'pwa/save_icon.png' },
      };
      const saved = await AppDataService.saveApp({ document, slug: 'ac10-app' });
      assert.equal(saved.result, 'Success', 'AC10: 保存できる ' + JSON.stringify(saved));
      assert.ok(saved.imageRefs, 'AC10: 戻り値に imageRefs がある');
      assert.match(saved.imageRefs.splash, UUID_SPLASH, 'AC10: imageRefs.splash が UUID 名');
      assert.match(saved.imageRefs.iconSource, UUID_ICON, 'AC10: imageRefs.iconSource が UUID 名');
      const row = await SqliteDataService.findAppByRef(saved.uid);
      assert.equal(row.appSettings.splash, saved.imageRefs.splash, 'AC10: DB の参照が UUID 名');
      assert.equal(row.manifestSettings.iconSource, saved.imageRefs.iconSource);
      assert.ok(await exists(nodePath.join(svcDir, 'img', '保存前.png')), 'AC10: 旧ファイルが残る');
      assert.equal(document.appSettings.splash, '保存前.png', 'AC10: 呼び出し元の文書を書き換えない');
      // 2 回目の保存（画面が imageRefs を反映した文書）で新しい複製が増えない
      const [nImg, nPwa] = [await imgCount(), await pwaCount()];
      const reflected = { ...document, appSettings: { splash: saved.imageRefs.splash }, manifestSettings: { iconSource: saved.imageRefs.iconSource } };
      const again = await AppDataService.saveApp({ document: reflected, uid: saved.uid, slug: 'ac10-app', expectedRevision: saved.revision });
      assert.equal(again.result, 'Success');
      assert.equal(again.imageRefs, undefined, 'AC10: UUID 名の文書では imageRefs を返さない');
      assert.deepEqual([await imgCount(), await pwaCount()], [nImg, nPwa], 'AC10: 2 回目の保存で新しい複製が増えない');
      // 複製元が保存フォルダに無い文書は旧名のまま保存（警告）
      const warns = [];
      const origWarn = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };
      const missing = await AppDataService.saveApp({ document: { ...document, appID: 'ac10-missing', appSettings: { splash: 'elsewhere.png' }, manifestSettings: {} }, slug: 'ac10-missing' });
      console.warn = origWarn;
      assert.equal(missing.result, 'Success');
      assert.equal((await SqliteDataService.findAppByRef(missing.uid)).appSettings.splash, 'elsewhere.png', 'AC10: 複製元が無ければ旧名のまま');
      assert.ok(warns.some((w) => w.includes('elsewhere.png')), 'AC10: 警告が出る');
      console.log('ok: AC10 アプリの保存の入口の正規化（imageRefs・2 回目で複製が増えない・複製元が無ければ旧名）');
    }

    // ---------- AC10: ベースマップの付け替え（F16〜F18・対が無い）----------
    {
      const baseTms = (thumbnail) => ({
        kind: 'tms', lang: 'ja', title: { ja: 'bm' }, label: { ja: 'bm' }, attr: { ja: 'a' }, dataAttr: {},
        license: 'CC BY', dataLicense: 'ODbL', licenseNote: {}, dataLicenseNote: {},
        url: 'https://tiles.example.test/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 18,
        thumbnail, coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null,
      });
      // 旧名で作る（新規作成の relocate を避けるため、作成後に DB を直接旧名へ戻す = 1.1.x の行の再現）
      const seed = async (uid, slug, oldRel) => {
        await SqliteDataService.saveUserBaseMap({ uid, slug, create: true, tms: baseTms('') });
        const d = baseData(db, uid); d.thumbnail = oldRel;
        db.prepare('UPDATE base_maps SET data_json = ? WHERE uid = ?').run(JSON.stringify(d), uid);
      };
      const U16 = '30000000-0000-4000-8000-000000000016';
      const U17 = '30000000-0000-4000-8000-000000000017';
      const U18 = '30000000-0000-4000-8000-000000000018';
      const U19 = '30000000-0000-4000-8000-000000000019';
      // F16: 移行の後（uid 名に移行の複製がある）、旧名を別の内容へ書き換え（K1 の置換）て保存
      await put(svcDir, 'tmbs/f16.png', Buffer.from('ORIGINAL 52'));
      await put(svcDir, thumb512PathFor('tmbs/f16.png'), Buffer.from('ORIGINAL 512'));
      await seed(U16, 'f16-bm', 'tmbs/f16.png');
      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(MARKER_ID);
      await runAssetUuidNamesColdBoot(db, svcDir, MARKER_ID);
      assert.equal(baseData(db, U16).thumbnail, thumb52PathFor(U16, 'png'), 'F16 前提: 移行で uid 名になった');
      await put(svcDir, 'tmbs/f16.png', Buffer.from('REPLACED 52 BY USER'));
      await put(svcDir, thumb512PathFor('tmbs/f16.png'), Buffer.from('REPLACED 512 BY USER'));
      const r16 = await SqliteDataService.saveUserBaseMap({ uid: U16, slug: 'f16-bm', tms: baseTms('tmbs/f16.png') });
      assert.equal(r16.thumbnail, 'tmbs/f16.png', 'F16: 戻り値の thumbnail は旧名のまま');
      assert.equal(baseData(db, U16).thumbnail, 'tmbs/f16.png', 'F16: 保存された thumbnail は旧名のまま');
      assert.equal((await fs.readFile(nodePath.join(svcDir, 'tmbs/f16.png'))).toString(), 'REPLACED 52 BY USER', 'F16: 利用者の新しい画像が残る');
      // F16b（IR-T5-MIN-2）: 移行の後、移行前の下書きで K1 の 512px だけを置換して保存。52px は旧名と uid 名で
      // 同じなので条件 2 は通るが、条件 3（512px の内容の一致）で止まり、利用者の新しい 512px が参照され続ける
      const U20 = '30000000-0000-4000-8000-000000000020';
      await put(svcDir, 'tmbs/f16b.png', Buffer.from('F16B 52'));
      await put(svcDir, thumb512PathFor('tmbs/f16b.png'), Buffer.from('F16B ORIGINAL 512'));
      await seed(U20, 'f16b-bm', 'tmbs/f16b.png');
      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(MARKER_ID);
      await runAssetUuidNamesColdBoot(db, svcDir, MARKER_ID);
      assert.equal(baseData(db, U20).thumbnail, thumb52PathFor(U20, 'png'), 'F16b 前提: 移行で uid 名になった');
      await put(svcDir, thumb512PathFor('tmbs/f16b.png'), Buffer.from('F16B REPLACED 512 BY USER'));
      const r16b = await SqliteDataService.saveUserBaseMap({ uid: U20, slug: 'f16b-bm', tms: baseTms('tmbs/f16b.png') });
      assert.equal(r16b.thumbnail, 'tmbs/f16b.png', 'F16b: 戻り値の thumbnail は旧名のまま（512px の内容が違う）');
      assert.equal(baseData(db, U20).thumbnail, 'tmbs/f16b.png', 'F16b: 保存された thumbnail は旧名のまま');
      assert.equal((await fs.readFile(nodePath.join(svcDir, thumb512PathFor('tmbs/f16b.png')))).toString(), 'F16B REPLACED 512 BY USER',
        'F16b: 利用者の新しい 512px が旧名の位置で参照され続ける');
      // F17: 旧名の 52px だけがあり、uid 名の位置に別内容
      await put(svcDir, 'tmbs/f17.png', Buffer.from('F17 OLD'));
      await put(svcDir, thumb52PathFor(U17, 'png'), Buffer.from('F17 DIFFERENT'));
      await seed(U17, 'f17-bm', 'tmbs/f17.png');
      const r17 = await SqliteDataService.saveUserBaseMap({ uid: U17, slug: 'f17-bm', tms: baseTms('tmbs/f17.png') });
      assert.equal(r17.thumbnail, 'tmbs/f17.png', 'F17: 戻り値は旧名');
      assert.equal(baseData(db, U17).thumbnail, 'tmbs/f17.png', 'F17: 付け替わらない');
      // F18: 旧名と uid 名の 52px と 512px が同じ内容 → 付け替わる
      for (const rel of ['tmbs/f18.png', thumb52PathFor(U18, 'png')]) await put(svcDir, rel, Buffer.from('SAME 52'));
      for (const rel of [thumb512PathFor('tmbs/f18.png'), thumb512PathFor(thumb52PathFor(U18, 'png'))]) await put(svcDir, rel, Buffer.from('SAME 512'));
      await seed(U18, 'f18-bm', 'tmbs/f18.png');
      const r18 = await SqliteDataService.saveUserBaseMap({ uid: U18, slug: 'f18-bm', tms: baseTms('tmbs/f18.png') });
      assert.equal(r18.thumbnail, thumb52PathFor(U18, 'png'), 'F18: 戻り値の thumbnail は付け替えた値');
      assert.equal(baseData(db, U18).thumbnail, thumb52PathFor(U18, 'png'), 'F18: 保存された thumbnail は uid 名');
      // 対が無い: uid 名の 52px が無い
      await put(svcDir, 'tmbs/f19.png', Buffer.from('NO PAIR'));
      await seed(U19, 'f19-bm', 'tmbs/f19.png');
      const r19 = await SqliteDataService.saveUserBaseMap({ uid: U19, slug: 'f19-bm', tms: baseTms('tmbs/f19.png') });
      assert.equal(r19.thumbnail, 'tmbs/f19.png', '対が無い: 戻り値は旧名');
      assert.equal(baseData(db, U19).thumbnail, 'tmbs/f19.png', '対が無い: 付け替わらない');
      console.log('ok: AC10 ベースマップの付け替え（F16・F16b・F17 は旧名のまま・F18 は uid 名・対が無ければ旧名）');
    }

    console.log('nov26-m6-t5 asset uuid migration smoke: ALL PASS');
  `,
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
      external: ['@jsquash/webp', 'pwa-asset-generator'],
      output: { entryFileNames: 'nov26-m6-t5-migration-smoke.mjs', format: 'es' },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 300000,
  maxBuffer: 1024 * 1024 * 16,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
console.log('nov26-m6-t5 asset uuid migration smoke: 静的検査も含め ALL PASS');
