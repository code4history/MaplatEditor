// m5-t4b: 地図 ZIP import の補償契約（タスク設計 v1.1 §5.3・AC9/AC10）。
//
// 固定する受け入れ条件:
//   AC9   map 保存失敗時に map 行・tile・通常/512px・poi_sources 行・新規 asset が残らない。
//         slug registry が解放され同じ slug で再 import できる
//   AC10  完全補償時は residue を持たず、残留時は非空の residue を持つ。
//         **poi_sources 補償を失敗させると kind:'poiSource' の residue が申告される**
//
// 【kind:'poiSource' 枝について】CompensationResidue は m5-t4 で union として定義されたが、
// poiSource 枝を **生成する**コードは本タスクの補償配線が初出である。∴ 実際に発火させて
// 固定しないと union の片枝が未検証のまま出荷される（設計レビュー Minor-2）。
//
// 【注入手段】
//   AC9  : saveFolder/tmbs を通常ファイルで塞ぐ → createMap の **後** の fs.move が
//          ENOTDIR で throw する。製品コードにテスト用フックを足さずに実経路を踏む
//   AC10 : poiSourceService.delete を throw させる。これは「依存が失敗したとき
//          DataUploadService がどう振る舞うか」の注入であり、テスト内で補償ロジックを
//          再現しているわけではない（実経路の回避には当たらない）
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4b-comp-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); } };
    export const ipcMain = { handle() {} };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
  `);
  await writeFile(storeStub, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { writeFile as fsWriteFile, rm as fsRm, mkdir as fsMkdir } from 'node:fs/promises';
    import { existsSync } from 'node:fs';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: poiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});

    const fc = (name: string) => ({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [134.69, 34.84] },
        properties: { name } }],
    });

    let seq = 0;
    const buildMapZip = async (slugBase: string) => {
      const slug = slugBase + (++seq);
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: slug, attr: 'test', lang: 'ja', gcps: [], edges: [],
        pois: [{ layer: 'pois/layer.geojson' }],
      })));
      zip.addFile('pois/layer.geojson', Buffer.from(JSON.stringify(fc('layer'))));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB'));
      zip.addFile('tmbs/' + slug + '_512.jpg', Buffer.from('THUMB512'));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE'));
      const p = nodePath.join(workDir, slug + '.zip');
      await fsWriteFile(p, zip.toBuffer());
      return { path: p, slug };
    };

    // (C) 専用: POI 文書を2つ持つ ZIP（1件目を成功させ2件目で失敗させるため）
    const buildTwoPoiZip = async (slugBase: string) => {
      const slug = slugBase + (++seq);
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: slug, attr: 'test', lang: 'ja', gcps: [], edges: [],
        pois: [{ layer: 'pois/layer.geojson' }, { layer: 'pois/layer2.geojson' }],
      })));
      zip.addFile('pois/layer.geojson', Buffer.from(JSON.stringify(fc('layer'))));
      zip.addFile('pois/layer2.geojson', Buffer.from(JSON.stringify(fc('layer2'))));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB'));
      zip.addFile('tmbs/' + slug + '_512.jpg', Buffer.from('THUMB512'));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE'));
      const p = nodePath.join(workDir, slug + '.zip');
      await fsWriteFile(p, zip.toBuffer());
      return { path: p, slug };
    };

    const counts = async () => {
      const db = await SqliteDataService.getDb();
      return {
        sources: (db.prepare('SELECT COUNT(*) AS n FROM poi_sources').get() as any).n,
        maps: (db.prepare('SELECT COUNT(*) AS n FROM maps').get() as any).n,
        assets: (db.prepare('SELECT COUNT(*) AS n FROM assets').get() as any).n,
      };
    };
    const tmbsDir = nodePath.join(dataDir, 'tmbs');

    // -----------------------------------------------------------------------
    // 正常系（対照）: 成功したら residue は付かない
    // -----------------------------------------------------------------------
    {
      const { path: zipPath } = await buildMapZip('ok');
      const result = await dataUploadService.extractZip(zipPath);
      assert.ok(result.mapData, '対照: 正常系は成功すること: ' + JSON.stringify(result).slice(0, 200));
      assert.equal('residue' in result, false, '対照: 成功時に residue が付かないこと');
      console.log('ok: 対照 正常系');
    }

    // -----------------------------------------------------------------------
    // AC9: map 保存後の配置失敗 → 全部巻き戻る。AC10: 完全補償なら residue なし
    //   注入: saveFolder/tmbs を通常ファイルで塞ぐ → createMap の後の fs.move が ENOTDIR
    // -----------------------------------------------------------------------
    {
      const before = await counts();
      const { path: zipPath, slug } = await buildMapZip('fail');

      await fsRm(tmbsDir, { recursive: true, force: true });
      await fsWriteFile(tmbsDir, 'blocker');          // ディレクトリを通常ファイルで塞ぐ

      const result = await dataUploadService.extractZip(zipPath);

      assert.ok(typeof result.err === 'string',
        'AC9: 配置失敗で { err } が返ること: ' + JSON.stringify(result).slice(0, 200));
      assert.equal('residue' in result, false,
        'AC10: 補償がすべて到達したので residue が付かないこと（実際: ' + JSON.stringify(result.residue) + '）');

      const after = await counts();
      assert.equal(after.maps, before.maps, 'AC9: 新規 map 行が残らないこと');
      assert.equal(after.sources, before.sources, 'AC9: 今回作成した poi_sources 行が残らないこと');
      assert.equal(after.assets, before.assets, 'AC9: 今回新規作成した asset が残らないこと');

      // 後片付け（tmbs をディレクトリへ戻す）
      await fsRm(tmbsDir, { force: true });
      await fsMkdir(tmbsDir, { recursive: true });

      // AC9: slug registry が解放され、同じ slug で再 import できる
      const retry = await dataUploadService.extractZip(zipPath);
      assert.ok(retry.mapData,
        'AC9: slug registry が解放され同じ slug で再 import できること（実際: '
          + JSON.stringify(retry).slice(0, 200) + '）');
      assert.equal(retry.mapData.mapID, slug, 'AC9: 同じ slug で取り込めること');
      console.log('ok: AC9 完全ロールバック / AC10 residue なし');
    }

    // -----------------------------------------------------------------------
    // AC10【本題】poi_sources の補償を失敗させる → kind:'poiSource' の residue
    //
    // この枝は m5-t4 では型定義のみで、生成コードは本タスクが初出である。
    // 依存（PoiSourceService.delete）を失敗させ、DataUploadService が握り潰さず
    // 申告することを実際に発火させて固定する。
    // -----------------------------------------------------------------------
    {
      const { path: zipPath } = await buildMapZip('residue');

      const originalDelete = poiSourceService.delete.bind(poiSourceService);
      let deleteCalls = 0;
      (poiSourceService as any).delete = async (_uid: string) => {
        deleteCalls++;
        throw new Error('injected: poi_sources delete failed');
      };
      await fsRm(tmbsDir, { recursive: true, force: true });
      await fsWriteFile(tmbsDir, 'blocker');

      let result: any;
      try {
        result = await dataUploadService.extractZip(zipPath);
      } finally {
        (poiSourceService as any).delete = originalDelete;
        await fsRm(tmbsDir, { force: true });
        await fsMkdir(tmbsDir, { recursive: true });
      }

      assert.ok(deleteCalls > 0, '前提: poi_sources の補償が呼ばれていること');
      assert.ok(typeof result.err === 'string', 'AC10: 失敗として返ること');
      assert.ok(Array.isArray(result.residue),
        'AC10: 残留があるので residue が付くこと（実際: ' + JSON.stringify(result).slice(0, 300) + '）');
      assert.ok(result.residue.length > 0, 'AC10: residue は非空であること');

      const poiResidue = result.residue.filter((r: any) => r.kind === 'poiSource');
      assert.equal(poiResidue.length, 1,
        'AC10: kind:"poiSource" の residue が申告されること（実際: ' + JSON.stringify(result.residue) + '）');
      assert.ok(poiResidue[0].poiSourceUid, 'AC10: どの source が残ったか分かること');
      assert.match(poiResidue[0].dbError, /injected/, 'AC10: 失敗理由が申告に含まれること');

      // 呼び出し側は 'residue' in result で部分ロールバックを判定できる
      assert.equal('residue' in result, true, 'AC10: 部分ロールバックの判定手段が成立すること');

      // 後始末: 残った source を実際に消す（後続への影響を避ける）
      await originalDelete(poiResidue[0].poiSourceUid).catch(() => undefined);
      console.log('ok: AC10 kind:"poiSource" の residue が申告される');
    }

    // -----------------------------------------------------------------------
    // 【実装レビュー Major-1】補償の二次失敗は **対象4つすべて** 申告されねばならない（I-4c）。
    // 従来 residue へ載るのは対象3（poi_sources）と対象4（asset）だけで、
    // 対象1（配置済み tile・サムネイルの削除失敗）と対象2（map 行の削除失敗）は
    // console.warn のみだった ∴ タイル数百 MB の残留や孤児 map 行が
    // 「完全に巻き戻した」（= residue なしの { err }）として申告されていた。
    // -----------------------------------------------------------------------

    // (A) 対象1: 配置済みファイルの削除失敗 → kind:'file'
    {
      const { path: zipPath } = await buildMapZip('resfile');
      // 配置は成功させ、**補償の削除だけ**を失敗させる。
      //
      // 前段は移動先を掃除するため remove(tileToPath) を先に呼ぶ（この時点では未作成）。
      // 補償はその配置済み実体を消す（この時点では存在する）。
      // ∴ **実在するときだけ失敗**させれば、前段を通したまま補償だけを壊せる。
      // 製品コードにテスト用フックは足していない。
      const fsExtra = (await import('fs-extra')).default;
      const originalRemove = fsExtra.remove;
      const tilesRoot = nodePath.join(dataDir, 'tiles');

      let result: any;
      try {
        (fsExtra as any).remove = async (target: string) => {
          if (String(target).startsWith(tilesRoot) && existsSync(String(target))) {
            throw new Error('injected: tile removal failed');
          }
          return originalRemove(target as any);
        };
        // 配置後に失敗させる（tmbs をファイルで塞ぐ → サムネイル移動が ENOTDIR）
        await fsRm(tmbsDir, { recursive: true, force: true });
        await fsWriteFile(tmbsDir, 'blocker');
        result = await dataUploadService.extractZip(zipPath);
      } finally {
        (fsExtra as any).remove = originalRemove;
        await fsRm(tmbsDir, { force: true });
        await fsMkdir(tmbsDir, { recursive: true });
      }

      assert.ok(typeof result.err === 'string', '(A) 失敗として返ること');
      assert.ok(Array.isArray(result.residue),
        '(A) 配置済みファイルの補償失敗が residue に載ること（実際: '
          + JSON.stringify(result).slice(0, 300) + '）');
      const fileResidue = result.residue.filter((r: any) => r.kind === 'file');
      assert.ok(fileResidue.length > 0,
        '(A) kind:"file" の residue が申告されること（実際: ' + JSON.stringify(result.residue) + '）');
      assert.ok(fileResidue[0].path, '(A) どのパスが残ったか分かること');
      assert.match(fileResidue[0].error, /injected/, '(A) 失敗理由が申告に含まれること');
      console.log('ok: Major-1(A) kind:"file" の residue');
    }

    // (B) 対象2: map 行の削除失敗 → kind:'mapRow'
    {
      const { path: zipPath } = await buildMapZip('resmap');
      const originalDeleteMap = SqliteDataService.deleteMap.bind(SqliteDataService);
      let called = 0;
      (SqliteDataService as any).deleteMap = async (_uid: string) => {
        called++;
        throw new Error('injected: map row delete failed');
      };
      await fsRm(tmbsDir, { recursive: true, force: true });
      await fsWriteFile(tmbsDir, 'blocker');

      let result: any;
      try {
        result = await dataUploadService.extractZip(zipPath);
      } finally {
        (SqliteDataService as any).deleteMap = originalDeleteMap;
        await fsRm(tmbsDir, { force: true });
        await fsMkdir(tmbsDir, { recursive: true });
      }

      assert.ok(called > 0, '(B) 前提: map 行の補償が呼ばれていること');
      assert.ok(Array.isArray(result.residue),
        '(B) map 行の補償失敗が residue に載ること（実際: '
          + JSON.stringify(result).slice(0, 300) + '）');
      const mapResidue = result.residue.filter((r: any) => r.kind === 'mapRow');
      assert.equal(mapResidue.length, 1,
        '(B) kind:"mapRow" の residue が申告されること（実際: ' + JSON.stringify(result.residue) + '）');
      assert.ok(mapResidue[0].mapUid, '(B) どの map 行が残ったか分かること');
      assert.match(mapResidue[0].dbError, /injected/, '(B) 失敗理由が申告に含まれること');

      // 後始末: 残った map 行を実際に消す
      const db2 = await SqliteDataService.getDb();
      const row = db2.prepare('SELECT uid FROM maps WHERE uid = ?').get(mapResidue[0].mapUid) as any;
      if (row) await originalDeleteMap(row.uid);
      console.log('ok: Major-1(B) kind:"mapRow" の residue');
    }

    // (C) restore 失敗経路: 内側 compensate の residue が捨てられていないこと
    //     poi_sources の作成を失敗させ、かつ asset 補償も失敗させる
    {
      const { path: zipPath } = await buildTwoPoiZip('resrestore');
      const originalCreate = poiSourceService.createPoiSourceFromManagedDocument
        .bind(poiSourceService);
      const originalDelete2 = poiSourceService.delete.bind(poiSourceService);
      let createCalls = 0;
      (poiSourceService as any).createPoiSourceFromManagedDocument = async (...args: any[]) => {
        createCalls++;
        if (createCalls === 1) return originalCreate(...(args as [any, any]));
        return { result: 'Error', message: 'injected: create failed' };
      };
      // 1件目は成功させ、その巻き戻し（delete）を失敗させる
      (poiSourceService as any).delete = async (_uid: string) => {
        throw new Error('injected: rollback delete failed');
      };

      let result: any;
      try {
        result = await dataUploadService.extractZip(zipPath);
      } finally {
        (poiSourceService as any).createPoiSourceFromManagedDocument = originalCreate;
        (poiSourceService as any).delete = originalDelete2;
      }

      assert.ok(typeof result.err === 'string', '(C) 失敗として返ること');
      assert.ok(Array.isArray(result.residue),
        '(C) restore 失敗経路でも内側の residue が外へ伝わること（実際: '
          + JSON.stringify(result).slice(0, 300) + '）');
      assert.ok(result.residue.some((r: any) => r.kind === 'poiSource'),
        '(C) 巻き戻せなかった poi_sources が申告されること（実際: '
          + JSON.stringify(result.residue) + '）');

      // 後始末
      for (const r of result.residue.filter((x: any) => x.kind === 'poiSource')) {
        await originalDelete2(r.poiSourceUid).catch(() => undefined);
      }
      console.log('ok: Major-1(C) restore 失敗経路の residue が捨てられない');
    }

    console.log('m5-t4b import compensation OK');
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [
      { find: 'electron', replacement: electronStub },
      { find: 'electron-store', replacement: storeStub },
    ]},
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: {
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 180000, maxBuffer: 1024 * 1024 * 8,
  });
  console.log('m5-t4b import compensation smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
