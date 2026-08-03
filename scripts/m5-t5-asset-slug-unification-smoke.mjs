// m5-t5 AC12/AC7: 画像 asset import の採番統一と、地図 slug / POI slug の独立性。
//
// 固定する受け入れ条件:
//   AC12(a) PoiPackageService に独自の候補生成ループが **残っていない**
//   AC12(b) 同名画像を2回取り込むと2件目が base-2 の **まま** = 出力は変わらない
//           （asset は元から "-" 区切りで v1.3 の正本規則と一致していた。
//             変わるのは実装が正本へ寄ることだけである）
//   AC12(c-1) 候補列が上限で止まる — 旧実装は上限を無視して base-101 を作っていた
//   AC12(c-2) 空きが永久に見つからなくても **有限で終わる** — 旧実装は無限ループした
//   AC7       地図 slug と POI ソース slug が独立に解決される。m5-t4b の復元・補償は不変
//
// 【旧実装の壊れ方は2段階である（実測）】
// while に上限が無いため、(1) 通常は上限 100 を超えて base-101… を作り続け、
// 他の全 import 経路と候補列が食い違う。(2) isSlugAvailable が恒偽になる異常時
// （DB 異常など）には例外も進捗も出さずに回り続ける＝ import が固まる。
// (c-1) は assert で、(c-2) はタイムアウトで落ちる ∴ タイムアウトを明示的に短くする。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

// ---- AC12(a): 独自の候補生成ループが残っていない（ソース assert）----
// 挙動だけでは「同じ規則を別実装で書いた」場合を検出できない。
const packageSrc = await readFile(path.join(projectRoot, 'electron/services/PoiPackageService.ts'), 'utf8');
assert.equal(/while\s*\(\s*!\s*\(?\s*await\s+SqliteDataService\.isSlugAvailable/.test(packageSrc), false,
  'AC12(a): availableAssetSlug の独自 while ループが残っていないこと');
assert.equal(/\$\{base\}-\$\{suffix/.test(packageSrc), false,
  'AC12(a): 独自の候補文字列組み立てが残っていないこと');
assert.match(packageSrc, /resolveImportSlug/,
  'AC12(a): 共有 API を呼んでいること');
console.log('ok AC12(a): 独自の候補生成ループが残っていない');

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t5-asset-slug-'));
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
    export const shell = { trashItem() { return Promise.resolve(); } };
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
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { default: poiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
    const { slugCandidate, SEQUENCE_MAX_INDEX } = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/slugSequence.ts'))});

    // 1x1 の **有効な** PNG を2種（赤 / 青）。
    // 2件目はバイトが違わないと sameStoredBytes で既存 asset に畳まれ採番が起きない。
    // かといって末尾にバイトを足すと PNG として壊れ、画像デコードで弾かれる
    // ∴ 色違いの正しい PNG を2つ用意する。
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64');
    const PNG2 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
      'base64');

    const fcWithIcon = (name: string, imgRef: string) => ({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [135, 35] },
        // icon は **properties 配下**である（rewritePoiMediaReferences が見る位置）。
        // feature 直下に置くと解決対象にならず asset が1件も作られない
        properties: { name, icon: imgRef },
      }],
    });

    const makeMapZipWithImage = (slug: string, imgName: string, bytes: Buffer) => {
      const zip = new AdmZip();
      // POI の dest は **地図 slug と別名**にする。同名にすると slug のグローバル一意
      // (ADR-0007) により地図側が base-2 へ回り、AC12 の焦点（画像 slug）がぼやける。
      // その同名ケース自体は AC7 の末尾で独立に固定する。
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: slug, attr: 'test', lang: 'ja', gcps: [], edges: [],
        pois: [{ layer: 'pois/' + slug + '-layer.geojson' }],
      })));
      zip.addFile('pois/' + slug + '-layer.geojson',
        Buffer.from(JSON.stringify(fcWithIcon(slug, 'imgs/' + imgName + '.png'))));
      zip.addFile('imgs/' + imgName + '.png', bytes);
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('T'));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('X'));
      const p = nodePath.join(workDir, slug + '-' + Math.random().toString(36).slice(2) + '.zip');
      zip.writeZip(p);
      return p;
    };

    const assetSlugs = async () => {
      const db = await SqliteDataService.getDb();
      return (db.prepare("SELECT slug FROM asset_registry WHERE kind = 'asset' ORDER BY slug").all() as any[])
        .map((r) => r.slug);
    };

    // =====================================================================
    // AC12(b): 同名画像の2件目が base-2 の **まま**（出力不変）
    // =====================================================================
    {
      const IMG = 'shared-pic';
      const r1 = await dataUploadService.extractZip(makeMapZipWithImage('asset-a', IMG, PNG));
      assert.ok(r1.mapData, 'AC12(b): 1件目の取込が成功すること: ' + JSON.stringify(r1).slice(0, 200));

      const r2 = await dataUploadService.extractZip(makeMapZipWithImage('asset-b', IMG, PNG2));
      assert.ok(r2.mapData, 'AC12(b): 2件目の取込が成功すること: ' + JSON.stringify(r2).slice(0, 200));

      const slugs = await assetSlugs();
      assert.deepEqual(slugs, [IMG, slugCandidate(IMG, 2)],
        'AC12(b): asset slug が base / base-2 になること（旧実装と **同じ出力**。'
          + '変わるのは実装が正本へ寄ることだけ）実際: ' + JSON.stringify(slugs));
      // 明示: 正本規則がハイフン区切りなので、旧 base-2 と一致する
      assert.equal(slugCandidate(IMG, 2), IMG + '-2',
        'AC12(b): 正本の2番目の候補がハイフン区切りであること');
      console.log('ok AC12(b): 同名画像の2件目が base-2 のまま（出力は変わらない）');
    }

    // =====================================================================
    // AC12(c): 候補枯渇が **有限で終わる**（旧実装は無限ループ）
    // =====================================================================
    {
      const FULL = 'full-img';
      // base 〜 base-100 を **実際に埋める**。候補名は正本から生成する
      for (let n = 1; n <= SEQUENCE_MAX_INDEX; n++) {
        const s = slugCandidate(FULL, n);
        await SqliteDataService.createMap(s, { mapID: s, title: s, gcps: [], edges: [] });
      }
      const before = await assetSlugs();

      // 旧実装ならここで無限ループする（例外も進捗も出ない）
      const result = await dataUploadService.extractZip(makeMapZipWithImage('asset-c', FULL, PNG2));

      assert.ok(result.err,
        'AC12(c-1): 候補が上限まで埋まったら失敗として返ること。'
          + '旧実装は上限を無視して base-101 を作り、他の import 経路と候補列が食い違っていた'
          + '（実際: ' + JSON.stringify(result).slice(0, 300) + '）');
      assert.equal(result.mapData, undefined, 'AC12(c-1): 地図は作られない');
      // 新しい失敗契約を作らない: 既存の throw 経路（message そのまま）へ載る
      assert.notEqual(result.err, 'Exist',
        'AC12(c-1): asset 枯渇は地図 slug の Exist とは別物として返ること');

      const after = await assetSlugs();
      assert.deepEqual(after, before,
        'AC12(c-1): 失敗時に asset が残らないこと（m5-t4b の補償が働く）実際: ' + JSON.stringify(after));
      // 上限を超えた候補が作られていないことを名指しで固定する
      assert.equal(after.includes(FULL + '-101'), false,
        'AC12(c-1): 上限を超えた候補（base-101）を作らないこと');
      console.log('ok AC12(c-1): 候補列が上限で止まり、補償も働く');
    }

    // =====================================================================
    // AC12(c-2): 空きが永久に見つからなくても **有限で終わる**（無限ループ防止）
    // =====================================================================
    {
      // isSlugAvailable が恒偽になる状況（DB 異常等）。旧実装はここで
      // 例外も進捗も出さずに回り続け、import が固まった。
      const original = SqliteDataService.isSlugAvailable.bind(SqliteDataService);
      SqliteDataService.isSlugAvailable = async () => false;
      try {
        const started = Date.now();
        const result = await dataUploadService.extractZip(
          makeMapZipWithImage('asset-d', 'never-free', PNG));
        const elapsed = Date.now() - started;
        assert.ok(result.err,
          'AC12(c-2): 空きが永久に無くても失敗として返ること（実際: '
            + JSON.stringify(result).slice(0, 200) + '）');
        assert.ok(elapsed < 10000,
          'AC12(c-2): 有限時間で終わること（実際: ' + elapsed + 'ms）');
      } finally {
        SqliteDataService.isSlugAvailable = original;
      }
      console.log('ok AC12(c-2): 恒偽でも有限で終わる（無限ループしない）');
    }

    // =====================================================================
    // AC7: 地図 slug と POI ソース slug が独立に解決される
    // =====================================================================
    {
      // POI ソース側だけを先に埋める。地図 slug は空いている
      //   → 地図は素の slug、POI は base-2 になるはず（引きずられない）
      const NAME = 'indep';
      const fc = { type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [135, 35] }, properties: { name: 'x' } },
      ]};
      const geojsonPath = nodePath.join(workDir, NAME + '.geojson');
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(geojsonPath, JSON.stringify(fc));
      const pre = await poiSourceService.importFile({ slug: NAME, title: { ja: NAME }, filePath: geojsonPath });
      assert.equal(pre.result, 'Success', 'AC7: 先行 POI ソースの作成');
      assert.equal(pre.slug, NAME, 'AC7: 先行 POI ソースは素の slug');

      // 地図 ZIP: 地図 slug は別名、同梱 POI の dest は pois/indep.geojson（＝衝突する）
      const zip = new AdmZip();
      zip.addFile('maps/mapx.json', Buffer.from(JSON.stringify({
        mapID: 'mapx', title: 'mapx', attr: 'test', lang: 'ja', gcps: [], edges: [],
        pois: [{ layer: 'pois/' + NAME + '.geojson' }],
      })));
      zip.addFile('pois/' + NAME + '.geojson', Buffer.from(JSON.stringify(fc)));
      zip.addFile('tmbs/mapx.jpg', Buffer.from('T'));
      zip.addFile('tiles/mapx/0/0/0.jpg', Buffer.from('X'));
      const zipPath = nodePath.join(workDir, 'indep.zip');
      zip.writeZip(zipPath);

      const r = await dataUploadService.extractZip(zipPath);
      assert.ok(r.mapData, 'AC7: 取込が成功すること: ' + JSON.stringify(r).slice(0, 200));
      assert.equal(r.mapData.mapID, 'mapx',
        'AC7: 地図 slug は空いている ∴ 素のまま。POI 側の衝突に引きずられない（実際: '
          + r.mapData.mapID + '）');

      const db = await SqliteDataService.getDb();
      const poiSlug = (db.prepare('SELECT slug FROM poi_sources WHERE uid = ?')
        .get(r.mapData.pois[0].poiUid) as any).slug;
      assert.equal(poiSlug, slugCandidate(NAME, 2),
        'AC7: POI ソース側だけが base-2 へ解決されること（実際: ' + poiSlug + '）');

      // m5-t4b の復元契約が不変であること
      assert.equal(r.mapData.pois.length, 1, 'AC7: pois の要素数が保存される');
      assert.ok(r.mapData.pois[0].poiUid, 'AC7: 管理下 POI として復元される');
      console.log('ok AC7: 地図 slug と POI slug が独立に解決され、m5-t4b の復元契約も不変');
    }

    // =====================================================================
    // AC7(b): **同一 import の中で**地図 slug と POI slug が競合する場合
    // =====================================================================
    {
      // 地図 slug と同梱 POI の dest 名が同じ ZIP（搬出では起こり得ないが、
      // 取込は信頼できない入力である ∴ 挙動が定義されていなければならない）。
      //
      // slug は種別を跨いで一意（ADR-0007）で、POI 復元は createMap より **前** に走る
      // （m5-t4b: 復元失敗時に map 行を残さないため）。∴ POI が素の名前を取り、
      // 地図が base-2 へ回る。
      //
      // 【この順序が実装の正しさを決める】
      // 地図 slug の解決を復元より前に置くと、解決結果が復元によって古くなり、
      // createMap が **自分自身の import に負けて** Exist になる。
      // 解決は書込の直前でなければならない。
      const SAME = 'samename';
      const fc2 = { type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [135, 35] }, properties: { name: 'y' } },
      ]};
      const zip = new AdmZip();
      zip.addFile('maps/' + SAME + '.json', Buffer.from(JSON.stringify({
        mapID: SAME, title: SAME, attr: 'test', lang: 'ja', gcps: [], edges: [],
        pois: [{ layer: 'pois/' + SAME + '.geojson' }],
      })));
      zip.addFile('pois/' + SAME + '.geojson', Buffer.from(JSON.stringify(fc2)));
      zip.addFile('tmbs/' + SAME + '.jpg', Buffer.from('T'));
      zip.addFile('tiles/' + SAME + '/0/0/0.jpg', Buffer.from('X'));
      const zipPath = nodePath.join(workDir, SAME + '.zip');
      zip.writeZip(zipPath);

      const r = await dataUploadService.extractZip(zipPath);
      assert.ok(r.mapData,
        'AC7(b): 地図 slug と POI dest が同名でも取り込めること（自分自身の import に'
          + '負けて Exist になってはならない）実際: ' + JSON.stringify(r).slice(0, 300));

      const db = await SqliteDataService.getDb();
      const poiSlug = (db.prepare('SELECT slug FROM poi_sources WHERE uid = ?')
        .get(r.mapData.pois[0].poiUid) as any).slug;
      assert.equal(poiSlug, SAME, 'AC7(b): 先に走る POI 復元が素の名前を取る');
      assert.equal(r.mapData.mapID, slugCandidate(SAME, 2),
        'AC7(b): 地図は次の候補へ回る（実際: ' + r.mapData.mapID + '）');
      console.log('ok AC7(b): 同一 import 内の競合が定義どおり解決される（解決は書込の直前）');
    }

    console.log('m5-t5 asset slug unification OK');
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

  // AC12(c): 旧実装は無限ループする ∴ タイムアウトを **明示的に短く**する。
  // 全ケースを合わせても通常は数秒で終わる。60s を超えるのは事実上ハングである。
  const { stdout } = await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 60000, maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  console.log('m5-t5 asset slug unification smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
