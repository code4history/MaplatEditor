// m5-t4b: 地図 ZIP import の POI 復元（タスク設計 v1.1 §5.2・AC6/AC6b/AC6c/AC7）。
//
// 固定する受け入れ条件:
//   AC6   逆変換契約 — (a) 順序と要素数の保存 / (b) 重複参照で正本化1回・同じ poiUid /
//         (c) 上書き属性が wrapper に保たれる / (d) 単独形は配列へ復元 / (e) 透過
//   AC6b  E2（上書きなし）→ { poiUid } / E5（wrapper 由来）→ { poiUid, …上書き }。
//         **上書きの有無が入れ替わらない**
//   AC6c  { poiUid } は配列要素位置にのみ置かれる（readAppDocumentPois で unsupported:false）
//   AC7   欠損 entry は Error / 余剰 entry は warning で import しない
//
// 【逆変換の入口は map JSON の pois 配列である】
// ZIP のファイル一覧を起点にしてはならない。ファイル一覧は実体の供給元にすぎず、
// 順序・上書き属性・重複参照・透過要素の情報は **すべて map JSON の pois にしかない**。
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
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4b-import-'));
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
    import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { readAppDocumentPois, writeDocumentPois } = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/appPoisFormat.ts'))});

    const fc = (name: string) => ({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [134.69, 34.84] },
        properties: { name },
      }],
    });

    // 地図 ZIP を組む。pois は **map JSON が正本**で、ZIP の pois/ は実体の供給元。
    let seq = 0;
    const buildMapZip = (pois: unknown, docs: Record<string, unknown>, opts: any = {}) => {
      const slug = opts.slug || ('himeji' + (++seq));
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: slug, attr: 'test', lang: 'ja', gcps: [], edges: [], pois,
      })));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB'));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE'));
      for (const [dest, json] of Object.entries(docs)) {
        zip.addFile(dest, Buffer.from(JSON.stringify(json)));
      }
      const p = nodePath.join(workDir, slug + '.zip');
      return fsWriteFile(p, zip.toBuffer()).then(() => ({ path: p, slug }));
    };

    const poiSourceCount = async () => {
      const db = await SqliteDataService.getDb();
      return (db.prepare('SELECT COUNT(*) AS n FROM poi_sources').get() as any).n as number;
    };

    // -----------------------------------------------------------------------
    // AC6 (a)(c)(e) + AC6b + AC6c: 順序保存 / 上書き保持 / 透過 / 位置
    // -----------------------------------------------------------------------
    {
      const pois = [
        { layer: 'pois/alpha.geojson' },                          // E2: 上書きなし
        { layer: 'pois/beta.geojson', hide: true, title: 'β層' },  // E5: 上書きあり
        { layer: 'https://example.com/remote.geojson' },           // E3: 透過（実体なし）
        fc('inline'),                                             // 枯渇 fallback: 透過
      ];
      const { path: zipPath } = await buildMapZip(pois, {
        'pois/alpha.geojson': fc('alpha'),
        'pois/beta.geojson': fc('beta'),
      });

      const result = await dataUploadService.extractZip(zipPath);
      assert.ok(result.mapData, 'import が成功すること（実際: ' + JSON.stringify(result).slice(0, 300) + '）');

      const out = readAppDocumentPois(result.mapData).pois;

      // (a) 順序と要素数
      assert.equal(out.length, 4, 'AC6(a): 要素数が保存されること');

      // (e) 透過: URL と インライン FC はそのまま
      assert.equal((out[2] as any).layer, 'https://example.com/remote.geojson', 'AC6(e): URL は透過');
      assert.equal((out[3] as any).type, 'FeatureCollection', 'AC6(e): インライン FC は透過');

      // AC6b: E2 は { poiUid } のみ、E5 は { poiUid, …上書き }
      const a = out[0] as any, b = out[1] as any;
      assert.ok(a.poiUid, 'AC6: 管理下 entry は poiUid へ復元されること（実際: ' + JSON.stringify(a) + '）');
      assert.equal('layer' in a, false, 'AC6: layer は残らないこと');
      assert.equal('hide' in a, false, 'AC6b: E2（上書きなし）に上書きが生えないこと');
      assert.equal('title' in a, false, 'AC6b: E2 に title が生えないこと');

      assert.ok(b.poiUid, 'AC6: 2件目も poiUid へ復元されること');
      assert.equal(b.hide, true, 'AC6(c)/AC6b: E5 の上書き hide が wrapper に保たれること');
      assert.equal(b.title, 'β層', 'AC6(c)/AC6b: E5 の上書き title が保たれること');
      assert.notEqual(a.poiUid, b.poiUid, 'AC6: 別 dest は別 source になること');

      // 上書きが FC 側へ焼き込まれていないこと
      const db = await SqliteDataService.getDb();
      const row = db.prepare('SELECT data_json FROM poi_sources WHERE uid = ?').get(b.poiUid) as any;
      const stored = JSON.parse(row.data_json);
      assert.equal('hide' in stored, false, 'AC6(c): 上書きが FC へ焼き込まれないこと');

      // AC6c: { poiUid } は配列要素位置にあり、読み書きの関所を通っても壊れない
      const read = readAppDocumentPois(result.mapData);
      assert.equal(read.unsupported, false, 'AC6c: 復元後の pois が unsupported にならないこと');
      const target: any = {};
      writeDocumentPois(target, read.pois, result.mapData.pois);
      const back = readAppDocumentPois(target).pois;
      assert.equal(back.length, 4, 'AC6c: writeDocumentPois を経ても要素数が保たれること');
      assert.ok((back[0] as any).poiUid, 'AC6c: { poiUid } が undefined へ退化しないこと');
      console.log('ok: AC6 (a)(c)(e) / AC6b / AC6c');
    }

    // -----------------------------------------------------------------------
    // AC6 (b): 重複参照 — 2 entry が同じ dest を指すと正本化は1回・同じ poiUid
    // -----------------------------------------------------------------------
    {
      const before = await poiSourceCount();
      const { path: zipPath } = await buildMapZip([
        { layer: 'pois/shared.geojson' },
        { layer: 'pois/shared.geojson', hide: true },
      ], { 'pois/shared.geojson': fc('shared') });

      const result = await dataUploadService.extractZip(zipPath);
      assert.ok(result.mapData, '重複参照の import が成功すること: ' + JSON.stringify(result).slice(0, 200));
      const out = readAppDocumentPois(result.mapData).pois as any[];
      assert.equal(out.length, 2, 'AC6(b): 要素数が保存されること');
      assert.equal(out[0].poiUid, out[1].poiUid, 'AC6(b): 同じ dest を指す2 entry が同じ poiUid を共有すること');
      assert.equal(out[0].hide, undefined, 'AC6(b): 1件目に上書きが生えないこと');
      assert.equal(out[1].hide, true, 'AC6(b): 2件目の上書きは保たれること');
      assert.equal(await poiSourceCount(), before + 1, 'AC6(b): 正本化は dest ごとに1回であること');
      console.log('ok: AC6 (b) 重複参照');
    }

    // -----------------------------------------------------------------------
    // AC6 (d): 単独形は **配列へ復元**する（単独形へ戻さない）
    //
    // 【fixture の注意】単独形位置では **素ラッパー（上書きキーを持たない {layer:…}）は
    // 受理されない**。viewer の isPoiLayerRefAsWhole が非配列位置でだけ上書きキーの存在を
    // 追加要求するためで、appPoisFormat はこれに合わせて素ラッパーを unsupported に倒す
    // （＝生値温存・read-only）。∴ 上書きキーを持つ単独形を fixture にする。
    //
    // なお **搬出側は常に配列を書く**ため、当リポジトリの exporter が単独形の地図 ZIP を
    // 生む経路は無い。本ケースは手組み ZIP・他実装由来の入力に対する契約である。
    // -----------------------------------------------------------------------
    {
      const { path: zipPath } = await buildMapZip(
        { layer: 'pois/solo.geojson', hide: true },  // 配列に包まない = 単独形（上書きキーあり）
        { 'pois/solo.geojson': fc('solo') },
      );
      const result = await dataUploadService.extractZip(zipPath);
      assert.ok(result.mapData, '単独形の import が成功すること: ' + JSON.stringify(result).slice(0, 200));
      assert.equal(
        Array.isArray(result.mapData.pois), true,
        'AC6(d): 単独形は **配列へ** 復元されること（搬出時点で配列へ正規化済みのため戻す余地がない）',
      );
      assert.equal(result.mapData.pois.length, 1, 'AC6(d): 1要素配列であること');
      assert.ok(result.mapData.pois[0].poiUid, 'AC6(d): poiUid へ復元されること');
      assert.equal(result.mapData.pois[0].hide, true, 'AC6(d): 単独形の上書きも保たれること');
      console.log('ok: AC6 (d) 単独形は配列へ復元');
    }

    // -----------------------------------------------------------------------
    // AC7: 欠損 entry は Error（黙って落とさない）
    // -----------------------------------------------------------------------
    {
      const before = await poiSourceCount();
      const { path: zipPath } = await buildMapZip(
        [{ layer: 'pois/ghost.geojson' }],
        {},                                          // 実体を入れない
      );
      const result = await dataUploadService.extractZip(zipPath);
      assert.ok(
        typeof result.err === 'string',
        'AC7: 参照先が ZIP に無い場合は Error になること（実際: ' + JSON.stringify(result).slice(0, 200) + '）',
      );
      assert.match(result.err, /ghost\\.geojson/, 'AC7: どの dest が欠損したか分かること');
      assert.equal(await poiSourceCount(), before, 'AC7: 失敗時に poi_sources 行が残らないこと');
      console.log('ok: AC7 欠損 entry は Error');
    }

    // -----------------------------------------------------------------------
    // AC7: 余剰 entry は warning で import しない（成功はする）
    // -----------------------------------------------------------------------
    {
      const before = await poiSourceCount();
      const { path: zipPath } = await buildMapZip(
        [{ layer: 'pois/used.geojson' }],
        { 'pois/used.geojson': fc('used'), 'pois/unused.geojson': fc('unused') },
      );
      const result = await dataUploadService.extractZip(zipPath);
      assert.ok(result.mapData, 'AC7: 余剰 entry があっても import は成功すること: ' + JSON.stringify(result).slice(0, 200));
      assert.equal(
        await poiSourceCount(), before + 1,
        'AC7: 参照されない entry は import されないこと（source は1件だけ増える）',
      );
      console.log('ok: AC7 余剰 entry は import しない');
    }

    console.log('m5-t4b import poi restore OK');
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
  console.log('m5-t4b import poi restore smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
