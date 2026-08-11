// m5-t4b: 地図 ZIP 搬出を app 搬出と同じ POI 契約へ寄せる（タスク設計 v1.1 §5.1・AC1/AC2/AC2b/AC4）。
//
// 固定する受け入れ条件:
//   AC2b  単独形（レイヤ1つを配列に包まず直接置く形）の POI を持つ地図で POI が落ちない
//         → **統一前に落ちることを RED として記録する**
//   AC2   地図 ZIP の maps/<slug>.json が POI をインライン化せず外部参照を出力する
//   AC1   地図 ZIP とアプリ ZIP の POI 参照形が共通 manifest と一致する
//   AC4   地図 JSON は minify のまま（整形は出力プロファイルとして保持）
//
// 【なぜ AC2b が「整理」ではなく「欠陥の是正」なのか】
// AppExportService は m4-t4 で readAppDocumentPois へ寄せられたが、mapDownloadZip.ts:31 には
// `Array.isArray((compiled as any).pois)` の生判定が残っている。∴ 単独形の地図では
// POI が export から**丸ごと落ちる**。実データ maps の3件が該当する。
// m4-t4 のコメント（AppExportService.ts:281-286 相当）がこの是正理由を記録しており、
// 本 smoke はその欠陥が地図 ZIP 側に残っていることを RED として固定してから是正する。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

// composeDownloadMapJson は electron 依存を持たない純粋寄りの関数だが、
// storeHandler / poiReferenceResolver を transitive に引くため SSR build で束ねる。
async function importComposer() {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4b-map-export-'));
  const outDir = path.join(workDir, 'dist');
  const entryFile = path.join(workDir, 'entry.ts');
  const electronStub = path.join(workDir, 'electron-stub.ts');
  const storeStub = path.join(workDir, 'electron-store-stub.ts');
  const { writeFile } = await import('node:fs/promises');

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showSaveDialog() { return Promise.resolve({ canceled: true }); } };
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
    export { composeDownloadMapJson } from ${JSON.stringify(path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'))};
    export { readAppDocumentPois } from ${JSON.stringify(path.join(projectRoot, 'src/utils/appPoisFormat.ts'))};
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
  const mod = await import(`${pathToFileURL(path.join(outDir, 'entry.mjs')).href}?t=${Date.now()}`);
  return { mod, cleanup: () => rm(workDir, { recursive: true, force: true }) };
}

const { mod, cleanup } = await importComposer();
const { composeDownloadMapJson, readAppDocumentPois } = mod;

try {
  // 生 FeatureCollection をレイヤ実体として使う（poiUid 登録参照は DB を要するため、
  // 本 smoke は「読み出しの形」だけを対象にする。登録参照の外部化は AC1/AC6 の統合 smoke が担う）
  const layerFc = () => ({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [134.69, 34.84] },
      properties: { name: '姫路城' },
    }],
  });

  // histMap2Store が受け取れる最小の地図オブジェクト
  const mapObject = (pois) => ({
    mapID: 'himeji',
    title: '姫路城',
    attr: 'test',
    lang: 'ja',
    gcps: [],
    edges: [],
    pois,
  });

  // -------------------------------------------------------------------------
  // AC2b【RED の対象】単独形（配列に包まない形）の POI が配列形と同じ扱いを受けること
  //
  // 【欠陥の正確な形】現行実装は `Array.isArray(compiled.pois)` で判定するため、
  // 単独形では if 節に入らず pois が **未処理のまま素通りする**。
  // 「compiled.pois が undefined になる」わけではない — そこは誤解しやすいので明記する。
  //
  // 未処理で素通りすることの実害は2つある:
  //   (1) **登録参照 {poiUid} が解決されないまま配布 ZIP に残る。** これは editor 内部の
  //       参照であり viewer には解決できない ∴ 利用者から見て POI は失われる
  //       （m4-t4 のコメントが app 側について「丸ごと落ちていた」と記録しているのはこの意味）
  //   (2) icon / maplat-asset: の実体が manifest へ集まらず、ZIP に同梱されない
  //
  // 本 smoke は DB を持たないため (1) の {poiUid} 解決は検証できない（統合 smoke の担当）。
  // ここでは **「単独形も配列形と同じく外部化される」という契約そのもの** を固定する。
  // これが成り立てば (1)(2) はどちらも自動的に解消される。
  // -------------------------------------------------------------------------
  {
    const single = layerFc();                       // 配列に包まない = 単独形

    // 前提の裏取り: readAppDocumentPois は単独形を supported として拾う
    const read = readAppDocumentPois({ pois: single });
    assert.equal(read.unsupported, false, '前提: readAppDocumentPois は単独形を supported として拾う');
    assert.equal(read.pois.length, 1, '前提: 単独形は1要素として読める');

    const { compiled } = await composeDownloadMapJson(mapObject(single), []);
    const out = compiled.pois;

    // AC2b の核心: 単独形も **外部参照へ変換される**（配列形と同じ扱い）
    const entries = readAppDocumentPois({ pois: out }).pois;
    assert.equal(entries.length, 1, 'AC2b: 単独形の POI が搬出後も1件あること');
    const entry = entries[0];
    assert.equal(
      typeof entry === 'object' && entry !== null && typeof entry.layer === 'string', true,
      'AC2b: 単独形の POI も外部参照 { layer: "pois/<name>.geojson" } へ変換されること。'
        + '現行は Array.isArray の生判定で **未処理のまま素通り**する（実際: '
        + JSON.stringify(entry).slice(0, 160) + '）',
    );
    assert.match(entry.layer, /^pois\/[^/]+\.geojson$/, 'AC2b: layer が pois/<name>.geojson を指すこと');
    console.log('ok: AC2b 単独形も配列形と同じく外部化される');
  }

  // -------------------------------------------------------------------------
  // AC2: POI をインライン化せず外部参照（pois/*.geojson）を出力すること
  // -------------------------------------------------------------------------
  {
    const { compiled, files } = await composeDownloadMapJson(mapObject([layerFc()]), []);
    const out = compiled.pois;
    assert.ok(Array.isArray(out), 'AC2: 配列で出力されること');
    assert.equal(out.length, 1, 'AC2: 要素数が保存されること');

    const entry = out[0];
    assert.equal(
      typeof entry === 'object' && entry !== null && typeof entry.layer === 'string', true,
      'AC2: 外部参照 { layer: "pois/<name>.geojson" } の形であること（実際: ' + JSON.stringify(entry) + '）',
    );
    assert.match(
      entry.layer, /^pois\/[^/]+\.geojson$/,
      'AC2: layer が pois/<name>.geojson を指すこと（インライン FC ではない）',
    );

    // インライン化されていないこと = FeatureCollection がそのまま埋まっていないこと
    assert.notEqual(entry.type, 'FeatureCollection', 'AC2: インライン FC を埋め込まないこと');

    // 外部実体が manifest に載ること
    assert.ok(files, 'AC2: 依存ファイル manifest が返ること');
    console.log('ok: AC2 POI が外部参照として出力される');
  }

  // -------------------------------------------------------------------------
  // AC2: 順序と要素数の保存（複数層）
  // -------------------------------------------------------------------------
  {
    const a = layerFc();
    const b = { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [135.0, 35.0] }, properties: { name: '二番目' },
    }]};
    const { compiled } = await composeDownloadMapJson(mapObject([a, b]), []);
    const out = compiled.pois;
    assert.equal(out.length, 2, 'AC2: 複数層の要素数が保存されること');
    assert.match(out[0].layer, /^pois\/[^/]+\.geojson$/);
    assert.match(out[1].layer, /^pois\/[^/]+\.geojson$/);
    assert.notEqual(out[0].layer, out[1].layer, 'AC2: 別の層は別の dest を取ること');
    console.log('ok: AC2 複数層の順序・要素数が保存される');
  }

  // -------------------------------------------------------------------------
  // AC2: 透過要素（URL 文字列・未知形）が壊れないこと
  // -------------------------------------------------------------------------
  {
    const { compiled } = await composeDownloadMapJson(
      mapObject(['https://example.com/pois.geojson', layerFc()]), []);
    const out = compiled.pois;
    assert.equal(out.length, 2, 'AC2: 透過要素を含めて要素数が保存されること');
    // URL 文字列は { layer: <元の文字列> } へ包まれる（配列要素位置での誤判定回避。E3）
    const urlEntry = out[0];
    assert.equal(
      typeof urlEntry === 'object' && urlEntry.layer === 'https://example.com/pois.geojson', true,
      'AC2: URL 文字列は { layer: <URL> } へ包まれ、pois/ の実体を持たないこと（実際: '
        + JSON.stringify(urlEntry) + '）',
    );
    console.log('ok: AC2 透過要素が壊れない');
  }

  // -------------------------------------------------------------------------
  // AC4: 地図 JSON の整形は minify のまま（compiled は素の object を返し、
  //      整形は書き出し側のプロファイル。ここでは object 汚染が無いことを確認する）
  // -------------------------------------------------------------------------
  {
    const { compiled } = await composeDownloadMapJson(mapObject([layerFc()]), []);
    for (const k of ['uid', 'slug', 'revision']) {
      assert.equal(k in compiled, false, `AC4: 交換形は内部メタデータ ${k} を含まないこと`);
    }
    console.log('ok: AC4 交換形から内部メタデータが除かれる');
  }

  console.log('m5-t4b map export POI parity smoke: OK');
} finally {
  await cleanup();
}
