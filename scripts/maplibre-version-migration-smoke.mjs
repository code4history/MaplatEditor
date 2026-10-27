// アプリの MapLibre GL JS の版（文書の最上位の maplibreMajorVersion）の移行と保存の入口のスモーク。
//
//   起動時の一回限りの移行（runMaplibreVersionColdBoot）:
//     - 最上位に値の無い行にだけ 5 を足す。httpSettings・http の有無と中身は変えない
//     - 既に 5・6 の行と、不正な値（"6"・7）の行は変えない（不正な値は保存の入口で直す）
//     - revision・updated_at を変えない。印を付ける。2 回目は何もしない。途中で落ちたら印を付けず、次で走り直す
//     - httpSettings の無い旧い行で、移行の前後で画面と main の読み方が同じ
//   保存の入口（SqliteDataService の normalizeAppDocument）:
//     - saveApp・createApp・upsertApp のどれで保存しても最上位に 5 が書かれる。不正な値は 5、6 は 6 のまま
//     - httpSettings には足さない
//   ソースの字面: 印の定数は SqliteDataService.ts の行頭の const、migrate() は画像の内部名の移行の後に try の中で呼ぶ、
//   画面は読み方の関数（readAppHttpSettings）を使う
//
// harness は他の移行のスモークと同じ（vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時 dir）。
// 移行の単体は、SqliteDataService.ts の migrate() の DDL をソースから切り出して流した一時の DB で直接呼ぶ。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'maplibre-version-migration-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'maplibre-version-migration-smoke.mjs');
const p = (rel) => JSON.stringify(path.join(projectRoot, rel));

const MARKER_ID = '2026-12-maplibre-version-v1';
const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log(`ok: ${label}`); }
  catch (e) { failures.push(label); console.log(`FAIL: ${label}\n  ${String(e?.message || e).split('\n').join('\n  ')}`); }
};

// ---- ホスト側: ソースの字面と DDL の切り出し ----
const sqliteSrc = await readFile(path.join(projectRoot, 'electron/services/SqliteDataService.ts'), 'utf8');
await check('字面: 印の定数は SqliteDataService.ts の行頭の const', () => {
  const constLines = sqliteSrc.split('\n').filter((l) => /^const MAPLIBRE_VERSION_V1_ID = /.test(l));
  assert.deepEqual(constLines, [`const MAPLIBRE_VERSION_V1_ID = '${MARKER_ID}';`]);
});
await check('字面: migrate() は画像の内部名の移行の後に、try の中で移行を呼ぶ', () => {
  const start = sqliteSrc.indexOf('  private async migrate(db: DatabaseSync)');
  const end = sqliteSrc.indexOf('  private async runLegacyMigrationIfNeeded(');
  assert.ok(start > 0 && end > start);
  const body = sqliteSrc.slice(start, end);
  const iAsset = body.indexOf('await runAssetUuidNamesColdBoot(db, this.folders.saveFolder, ASSET_UUID_NAMES_V1_ID);');
  const m = /^ {6}await runMaplibreVersionColdBoot\(db, MAPLIBRE_VERSION_V1_ID\);$/m.exec(body);
  assert.ok(iAsset > 0, '画像の内部名の移行の呼び出しが無い');
  assert.ok(m, 'runMaplibreVersionColdBoot(db, MAPLIBRE_VERSION_V1_ID) の呼び出しが無い');
  assert.ok(m.index > iAsset, '画像の内部名の移行の後でない');
  assert.match(body.slice(0, m.index).split('\n').slice(-3).join('\n'), /try \{/, 'try の中でない');
});
await check('字面: 画面は旧い行の読み方を readAppHttpSettings で行う', async () => {
  const app = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
  assert.match(app, /import \{[^}]*\breadAppHttpSettings\b[^}]*\} from "\.\.\/utils\/appHttpSettings"/);
  assert.match(app, /normalized\.httpSettings = readAppHttpSettings\(value\);/);
  assert.equal(/value\.httpSettings \|\| value\.http \|\| value/.test(app), false, '画面に読み方の写しが残っている');
  assert.match(app, /normalized\.maplibreMajorVersion = value\.maplibreMajorVersion === 6 \? 6 : 5;/);
});
const ddl = {};
for (const table of ['schema_migrations', 'apps']) {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\);`).exec(sqliteSrc);
  assert.ok(m, `DDL: ${table}`);
  ddl[table] = `CREATE TABLE IF NOT EXISTS ${table} (${m[1]}\n);`;
}

try {
  await writeFile(electronStubFile, `
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
      async showSaveDialog() { return { canceled: true, filePath: undefined }; },
      async showMessageBox() { return { response: 0 }; },
    };
    export const BrowserWindow = class {
      constructor() { throw new Error('BrowserWindow is not available in the smoke sandbox'); }
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); }, webRequest: { onBeforeRequest: () => {} } } };
    export const shell = { trashItem() { return Promise.resolve(); } };
  `);
  await writeFile(electronStoreStubFile, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `);
  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import fs from 'node:fs/promises';
    import { DatabaseSync } from 'node:sqlite';
    const workDir = ${JSON.stringify(workDir)};
    const MARKER_ID = ${JSON.stringify(MARKER_ID)};
    const DDL = ${JSON.stringify(ddl)};
    const STAMP = '2026-01-02 03:04:05';
    const failures: string[] = [];
    const check = async (label: string, fn: () => any) => {
      try { await fn(); console.log('ok: ' + label); }
      catch (e: any) { failures.push(label); console.log('FAIL: ' + label + '\\n  ' + String(e && e.message || e).split('\\n').join('\\n  ')); }
    };

    let migration: any = null;
    let httpSettingsMod: any = null;
    try { migration = await import(${p('electron/services/MaplibreVersionMigrationService.ts')}); }
    catch (e: any) { failures.push('import migration'); console.log('FAIL: 移行のモジュールが無い: ' + String(e && e.message || e).split('\\n')[0]); }
    try { httpSettingsMod = await import(${p('src/utils/appHttpSettings.ts')}); }
    catch (e: any) { failures.push('import appHttpSettings'); console.log('FAIL: 画面の読み方の関数が無い: ' + String(e && e.message || e).split('\\n')[0]); }

    let seq = 0;
    function openDb(name: string) {
      const db = new DatabaseSync(nodePath.join(workDir, name + '.sqlite'));
      db.exec(DDL.schema_migrations); db.exec(DDL.apps);
      return db;
    }
    function insertApp(db: any, uid: string, data: any) {
      db.prepare('INSERT INTO apps (uid, slug, data_json, revision, updated_at) VALUES (?, ?, ?, 3, ?)')
        .run(uid, 'app-' + (++seq), JSON.stringify(data), STAMP);
    }
    const rows = (db: any) => db.prepare('SELECT uid, data_json, revision, updated_at FROM apps ORDER BY uid').all().map((r: any) => ({ ...r }));
    const dataOf = (db: any, uid: string) => JSON.parse(db.prepare('SELECT data_json FROM apps WHERE uid = ?').get(uid).data_json);
    const hasMarker = (db: any) => Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(MARKER_ID));

    // 移行の対象の行
    const ROWS: Record<string, any> = {
      i: { title: { ja: 'i' }, httpSettings: { pwaManifest: true, mapboxToken: 'tok-i' }, sources: [] },
      ii: { title: { ja: 'ii' }, pwaManifest: false, mapboxToken: 'tok-legacy', sources: [] },
      iii: { title: { ja: 'iii' }, http: { pwaManifest: false, overlay: false, mapboxToken: 'tok-http' }, sources: [] },
      iv5: { title: { ja: 'iv5' }, httpSettings: {}, maplibreMajorVersion: 5 },
      iv6: { title: { ja: 'iv6' }, httpSettings: {}, maplibreMajorVersion: 6 },
      vStr: { title: { ja: 'vStr' }, httpSettings: {}, maplibreMajorVersion: '6' },
      v7: { title: { ja: 'v7' }, httpSettings: {}, maplibreMajorVersion: 7 },
    };
    const UID = (k: string) => '00000000-0000-4000-8000-' + String(Object.keys(ROWS).indexOf(k) + 1).padStart(12, '0');

    if (migration) {
      const { runMaplibreVersionColdBoot } = migration;
      const db = openDb('main');
      for (const [k, data] of Object.entries(ROWS)) insertApp(db, UID(k), data);
      const before = rows(db);
      const result = await runMaplibreVersionColdBoot(db, MARKER_ID);

      await check('移行: 値の無い行（i・ii・iii）にだけ最上位に 5 を足す', () => {
        for (const k of ['i', 'ii', 'iii']) {
          assert.deepEqual(dataOf(db, UID(k)), { ...ROWS[k], maplibreMajorVersion: 5 }, k);
        }
        assert.equal(result.written, 3, JSON.stringify(result));
      });
      await check('移行: httpSettings・http の有無と中身を変えない', () => {
        assert.equal('httpSettings' in dataOf(db, UID('ii')), false, 'ii に httpSettings を作った');
        assert.equal('httpSettings' in dataOf(db, UID('iii')), false, 'iii に httpSettings を作った');
        assert.deepEqual(dataOf(db, UID('iii')).http, ROWS.iii.http);
        assert.deepEqual(dataOf(db, UID('i')).httpSettings, ROWS.i.httpSettings);
      });
      await check('移行: 既に 5・6 の行と不正な値（"6"・7）の行は変えない', () => {
        for (const k of ['iv5', 'iv6', 'vStr', 'v7']) assert.deepEqual(dataOf(db, UID(k)), ROWS[k], k);
      });
      await check('移行: revision と updated_at を変えない', () => {
        const after = rows(db);
        assert.deepEqual(after.map((r: any) => [r.uid, r.revision, r.updated_at]), before.map((r: any) => [r.uid, r.revision, r.updated_at]));
      });
      await check('移行: 印を付け、2 回目は何も変えない（冪等）', async () => {
        assert.equal(hasMarker(db), true);
        const snap = rows(db);
        const again = await runMaplibreVersionColdBoot(db, MARKER_ID);
        assert.equal(again.skipped, 'marker');
        assert.deepEqual(rows(db), snap);
      });
      await check('移行: 途中で落ちたら印を付けず、次の起動で走り直す', async () => {
        const db2 = openDb('crash');
        for (const k of ['i', 'ii', 'iii']) insertApp(db2, UID(k), ROWS[k]);
        let calls = 0;
        await assert.rejects(() => runMaplibreVersionColdBoot(db2, MARKER_ID, { __beforeWrite: () => { if (++calls === 2) throw new Error('crash'); } }));
        assert.equal(hasMarker(db2), false, '落ちたのに印が付いた');
        const r = await runMaplibreVersionColdBoot(db2, MARKER_ID);
        assert.equal(hasMarker(db2), true);
        for (const k of ['i', 'ii', 'iii']) assert.equal(dataOf(db2, UID(k)).maplibreMajorVersion, 5, k);
        assert.equal(r.written, 2, '1 件目は前の走りで書かれ、残りの 2 件だけを書く');
        db2.close();
      });
      if (httpSettingsMod) {
        await check('移行: ii・iii の画面の読み方（readAppHttpSettings）が前後で同じで、旧い値が読まれる', () => {
          for (const k of ['ii', 'iii']) {
            const beforeRead = httpSettingsMod.readAppHttpSettings(ROWS[k]);
            const afterRead = httpSettingsMod.readAppHttpSettings(dataOf(db, UID(k)));
            assert.deepEqual(afterRead, beforeRead, k);
          }
          const ii = httpSettingsMod.readAppHttpSettings(dataOf(db, UID('ii')));
          assert.equal(ii.pwaManifest, false);
          assert.equal(ii.mapboxToken, 'tok-legacy');
          const iii = httpSettingsMod.readAppHttpSettings(dataOf(db, UID('iii')));
          assert.equal(iii.overlay, false);
          assert.equal(iii.mapboxToken, 'tok-http');
        });
      }
      db.close();
    }

    // ===================== 実サービス =====================
    const svcDir = nodePath.join(workDir, 'svc');
    await fs.mkdir(svcDir, { recursive: true });
    const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
    SettingsService.set('saveFolder', svcDir);
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${p('electron/services/SqliteDataService.ts')});
    const { default: AppDataService } = await import(${p('electron/services/AppDataService.ts')});
    const { default: AppExportService } = await import(${p('electron/services/AppExportService.ts')});
    const { default: AppPreviewService } = await import(${p('electron/services/AppPreviewService.ts')});
    const sdb = await SqliteDataService.getDb();
    await check('migrate(): 空の DB でも起動の段で印が付く', () => assert.equal(hasMarker(sdb), true));

    await check('移行: ii・iii の main の読み方（書き出しの index.html・プレビューの viewerOption）が前後で同じ', async () => {
      for (const k of ['ii', 'iii']) {
        const after = { ...ROWS[k], maplibreMajorVersion: 5 };
        const exp = (doc: any) => (AppExportService as any).renderIndexHtml(doc, 'app-' + k, {}, true, [], undefined, undefined, undefined);
        assert.equal(exp(after), exp(ROWS[k]), k + ': 書き出しの index.html');
        const prev = (doc: any) => JSON.stringify((AppPreviewService as any).createViewerOption('tok-' + k, doc, true));
        assert.equal(prev(after), prev(ROWS[k]), k + ': プレビューの viewerOption');
      }
    });

    const base = (extra: any = {}) => ({ appID: 'x', title: { ja: 'x' }, lang: 'ja', sources: [], pois: [], httpSettings: { pwaManifest: false }, appSettings: {}, manifestSettings: {}, ...extra });
    const stored = async (uid: string) => {
      const row = sdb.prepare('SELECT data_json FROM apps WHERE uid = ?').get(uid) as any;
      return JSON.parse(row.data_json);
    };
    await check('保存の入口: saveApp で値の無い文書を保存すると最上位に 5 が書かれ、httpSettings には足さない', async () => {
      const r = await AppDataService.saveApp({ document: base({ appID: 'save-none' }), slug: 'save-none' });
      assert.equal(r.result, 'Success', JSON.stringify(r));
      const doc = await stored(r.uid);
      assert.equal(doc.maplibreMajorVersion, 5);
      assert.deepEqual(doc.httpSettings, { pwaManifest: false });
    });
    await check('保存の入口: createApp を直接呼んでも 5、不正な値（"6"・7・null）は 5、6 は 6 のまま', async () => {
      const cases: Array<[any, number]> = [[undefined, 5], ['6', 5], [7, 5], [null, 5], [5, 5], [6, 6]];
      let n = 0;
      for (const [value, expected] of cases) {
        const doc = base({ appID: 'create-' + (++n) });
        if (value !== undefined) doc.maplibreMajorVersion = value;
        const { uid } = await SqliteDataService.createApp('create-' + n, doc);
        assert.equal((await stored(uid)).maplibreMajorVersion, expected, JSON.stringify(value));
      }
    });
    await check('保存の入口: upsertApp でも補完され、6 は 6 のまま', async () => {
      const { uid } = await SqliteDataService.createApp('upsert-1', base({ appID: 'upsert-1', maplibreMajorVersion: 6 }));
      const { revision } = await SqliteDataService.upsertApp(uid, 'upsert-1', base({ appID: 'upsert-1' }), 1);
      assert.equal((await stored(uid)).maplibreMajorVersion, 5);
      await SqliteDataService.upsertApp(uid, 'upsert-1', base({ appID: 'upsert-1', maplibreMajorVersion: 6 }), revision);
      assert.equal((await stored(uid)).maplibreMajorVersion, 6);
    });

    if (failures.length) {
      console.log('maplibre-version-migration smoke FAILED: ' + failures.length + ' check(s): ' + failures.join(' / '));
      process.exit(1);
    }
    console.log('maplibre-version-migration smoke (bundle) passed');
    process.exit(0);
  `);

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
        external: ['@jsquash/webp', 'pwa-asset-generator', 'jimp', 'adm-zip', '@maplat/tin', '@maplat/transform'],
        output: { entryFileNames: 'maplibre-version-migration-smoke.mjs', format: 'es' },
      },
    },
  });
  const r = spawnSync(process.execPath, [bundledFile], { cwd: projectRoot, stdio: 'inherit', timeout: 300000 });
  if (r.status !== 0) failures.push('bundle checks');
} catch (e) {
  failures.push('build');
  console.log(`FAIL: バンドルできない: ${String(e?.message || e).split('\n')[0]}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`maplibre-version-migration smoke FAILED: ${failures.join(' / ')}`);
  process.exit(1);
}
console.log('maplibre-version-migration smoke passed');
