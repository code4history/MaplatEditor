// m5-t4: 地図 ZIP import 用の POI source 作成契約（タスク設計 v1.7 §6.2.5）。
//
// 固定する受け入れ条件:
//   AC16  POI source 作成契約
//         (a) dest 単位で1回だけ createSource が走る（同一 dest を指す2 entry で source は1つ）
//         (b) slug が pois/<name>.geojson の <name> を種に既存の POI import slug 解決を通り、
//             衝突時は base2 等へ解決される
//         (c) title が properties.title → レイヤキー → <name> の順にフォールバックし空にならない
//         (d) createSource が非 Success を返したら呼び出し側が import 全体を失敗にできる
//
// 【責務境界】正本化した FC を読むのは PoiPackageService.importManagedPoiDocuments、
// poi_sources 行を作るのは PoiSourceService。名前もそれを語るものにする
// （importManagedPoiDocument**s** との単複1文字差を避け createPoiSourceFromManagedDocument）。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4-managed-source-'));
const entryFile = path.join(workDir, 'managed-source-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'managed-source-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sourceServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');

  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await writeFile(electronStubFile, `
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
    export const BrowserWindow = class { static getAllWindows() { return []; } };
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

    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
    const { default: poiSourceService } = await import(${JSON.stringify(sourceServicePath)});

    const fc = (extra: Record<string, unknown> = {}) => ({
      type: 'FeatureCollection',
      ...extra,
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [134.7, 34.8] },
        properties: { name: 'p' },
      }],
    });

    const rowOf = async (uid: string) => {
      const db = await SqliteDataService.getDb();
      return db.prepare('SELECT uid, slug, title_json, mode FROM poi_sources WHERE uid = ?').get(uid) as any;
    };
    const countSources = async () => {
      const db = await SqliteDataService.getDb();
      return (db.prepare('SELECT COUNT(*) AS n FROM poi_sources').get() as any).n as number;
    };

    // -----------------------------------------------------------------------
    // AC16 (b)(c): slug は <name> を種に解決 / title は空にならない / mode は local
    // -----------------------------------------------------------------------
    {
      const r = await poiSourceService.createPoiSourceFromManagedDocument(
        fc(), { dest: 'pois/himeji.geojson' },
      );
      assert.equal(r.result, 'Success', 'AC16: 作成が Success であること: ' + JSON.stringify(r));
      assert.equal(r.slug, 'himeji', 'AC16(b): slug は dest の <name> を種にすること');
      const row = await rowOf(r.uid);
      assert.equal(row.mode, 'local', 'AC16: mode は local（ZIP 同梱の実体を取り込むため）');
      const title = JSON.parse(row.title_json);
      assert.ok(Object.values(title).some((v: any) => String(v).length > 0),
        'AC16(c): title が空にならないこと: ' + row.title_json);
      console.log('ok: AC16 (b)(c) slug/title/mode');
    }

    // -----------------------------------------------------------------------
    // AC16 (b): slug 衝突は既存の POI import slug 解決で base2 等へ。
    //   **既存 source は一切変更されない**（設計 §6.2.5c: 再利用しない・触らない）
    // -----------------------------------------------------------------------
    {
      const before = await rowOf((await (async () => {
        const db = await SqliteDataService.getDb();
        return (db.prepare("SELECT uid FROM poi_sources WHERE slug = 'himeji'").get() as any).uid;
      })()));

      const r = await poiSourceService.createPoiSourceFromManagedDocument(
        fc(), { dest: 'pois/himeji.geojson' },
      );
      assert.equal(r.result, 'Success', 'AC16(b): 衝突しても新規作成が成功すること');
      assert.notEqual(r.slug, 'himeji', 'AC16(b): 別 slug を取ること');
      assert.match(r.slug, /^himeji\\d+$/, 'AC16(b): base2 形式で解決されること（実際: ' + r.slug + '）');

      const after = await rowOf(before.uid);
      assert.deepEqual(after, before, 'AC16(b)/§6.2.5c: 既存 source は一切変更されないこと');
      console.log('ok: AC16 (b) 衝突解決と既存 source の不変');
    }

    // -----------------------------------------------------------------------
    // AC16 (c): title のフォールバック順 — properties.title → レイヤキー → <name>
    // -----------------------------------------------------------------------
    {
      const withTitle = await poiSourceService.createPoiSourceFromManagedDocument(
        fc({ properties: { title: '姫路城POI' } }), { dest: 'pois/castle.geojson' },
      );
      assert.equal(withTitle.result, 'Success');
      const t1 = JSON.parse((await rowOf(withTitle.uid)).title_json);
      assert.ok(Object.values(t1).includes('姫路城POI'),
        'AC16(c): properties.title を最優先すること: ' + JSON.stringify(t1));

      const fallback = await poiSourceService.createPoiSourceFromManagedDocument(
        fc(), { dest: 'pois/no-title-here.geojson' },
      );
      assert.equal(fallback.result, 'Success');
      const t2 = JSON.parse((await rowOf(fallback.uid)).title_json);
      assert.ok(Object.values(t2).includes('no-title-here'),
        'AC16(c): 最終フォールバックは dest の <name> であること: ' + JSON.stringify(t2));
      console.log('ok: AC16 (c) title フォールバック');
    }

    // -----------------------------------------------------------------------
    // AC16 (d): 不正な FC は非 Success を返し、**poi_sources 行を作らない**
    //   （呼び出し側が import 全体を失敗にできる）
    // -----------------------------------------------------------------------
    {
      const before = await countSources();
      const bad = await poiSourceService.createPoiSourceFromManagedDocument(
        { type: 'FeatureCollection', features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          properties: {},
        }] },
        { dest: 'pois/line.geojson' },
      );
      assert.notEqual(bad.result, 'Success',
        'AC16(d): Point 以外を含む FC は非 Success であること: ' + JSON.stringify(bad));
      assert.equal(await countSources(), before,
        'AC16(d): 非 Success 時に poi_sources 行が残らないこと（補償対象が一意に決まる根拠）');
      console.log('ok: AC16 (d) 非 Success では行を作らない');
    }

    // -----------------------------------------------------------------------
    // AC16 (a): 責務境界 — 本 API は **呼び出しごとに1行**作る。
    //   dest 単位で1回に畳むのは呼び出し側（Map<dest, poiUid>）の責務であり、
    //   本 API がそれを内部で持つと import を跨いだ状態を抱えてしまう。
    // -----------------------------------------------------------------------
    {
      const before = await countSources();
      const a = await poiSourceService.createPoiSourceFromManagedDocument(fc(), { dest: 'pois/dup.geojson' });
      const b = await poiSourceService.createPoiSourceFromManagedDocument(fc(), { dest: 'pois/dup.geojson' });
      assert.equal(a.result, 'Success');
      assert.equal(b.result, 'Success');
      assert.notEqual(a.uid, b.uid, 'AC16(a): 本 API 自体は重複排除しない（呼び出し側の責務）');
      assert.equal(await countSources(), before + 2);
      console.log('ok: AC16 (a) 重複排除は呼び出し側の責務');
    }

    console.log('m5-t4 managed poi source OK');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'managed-source-smoke.mjs', format: 'es' },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });

  console.log('m5-t4 managed poi source smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
