// m5-t4b: 地図搬出とアプリ搬出が **単一の実装** を共有すること（タスク設計 v1.1 §5.1・AC1）。
//
// 固定する受け入れ条件:
//   AC1  同一の POI fixture を地図 ZIP／アプリ ZIP の双方で搬出したとき、
//        POI 参照形・pois/*.geojson・依存 assets が共通 manifest と一致する。
//        **かつアプリ ZIP の出力内容が共通化の前後で変わらない**
//
// 【なぜソース assert も置くのか】
// 「両者の出力が一致する」だけでは、同じロジックが2箇所にコピーされていても通る。
// 本タスクの主眼は **単一実装を両者が呼ぶこと**（設計 §5.1）なので、
// 呼び出しがソース上で1本になっていることも固定する。
// これは m11-t3-poi-package smoke が PoiPackageService に対して行っているのと同じ軸4 の手法である。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

// ---------------------------------------------------------------------------
// 軸4: 単一実装を両者が呼んでいることをソースで固定する
// ---------------------------------------------------------------------------
{
  const mapSrc = await readFile(path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'), 'utf8');
  const appSrc = await readFile(path.join(projectRoot, 'electron/services/AppExportService.ts'), 'utf8');
  const resolverSrc = await readFile(path.join(projectRoot, 'electron/services/poiReferenceResolver.ts'), 'utf8');

  assert.match(resolverSrc, /export async function externalizeMapDocumentPois\(/,
    'AC1: 共通 API が poiReferenceResolver に1つだけ定義されていること');
  assert.match(mapSrc, /externalizeMapDocumentPois\(/,
    'AC1: 地図 ZIP 搬出が共通 API を呼ぶこと');
  assert.match(appSrc, /externalizeMapDocumentPois\(/,
    'AC1: アプリ搬出（map JSON 経路）が共通 API を呼ぶこと');

  // 地図 ZIP 側が readAppDocumentPois / externalizePoisArray を **直接** 呼んでいないこと
  // （共通 API の内側だけが呼ぶ形＝二重実装が復活していないこと）
  assert.equal(/readAppDocumentPois\(/.test(mapSrc), false,
    'AC1: 地図 ZIP 搬出が readAppDocumentPois を直接呼ばないこと（共通 API 経由であること）');
  assert.equal(/externalizePoisArray\(/.test(mapSrc), false,
    'AC1: 地図 ZIP 搬出が externalizePoisArray を直接呼ばないこと（共通 API 経由であること）');

  // 旧実装（インライン FC 化）へ戻っていないこと
  assert.equal(/resolvePoisArray\(/.test(mapSrc), false,
    'AC1: 地図 ZIP 搬出が resolvePoisArray（インライン FC 化）へ戻っていないこと');

  // ---- POI 実体の **書き出し** も単一実装であること ----
  // 外部化（参照形の決定）を共通化しても、書き出し（整形・境界検査）が2箇所にあると
  // 同じ dest の同じ実体が経路によって別物になる。実際に地図 ZIP だけ minify・
  // 境界検査なしで書いていた（2026-08-03 人間指摘）
  assert.match(resolverSrc, /export async function writePoiDocuments\(/,
    'AC1: POI 実体の書き出しが poiReferenceResolver に1つだけ定義されていること');
  assert.match(mapSrc, /writePoiDocuments\(/,
    'AC1: 地図 ZIP 搬出が共有の書き出しを呼ぶこと');
  assert.match(appSrc, /writePoiDocuments\(/,
    'AC1: アプリ搬出が共有の書き出しを呼ぶこと');
  // 呼び出し側が自前で直列化・境界検査へ戻っていないこと
  for (const [label, src] of [['地図 ZIP', mapSrc], ['アプリ', appSrc]]) {
    assert.equal(/JSON\.stringify\(doc\.json\)/.test(src), false,
      'AC1: ' + label + ' 搬出が POI 実体を自前で直列化していないこと');
    assert.equal(/escaped the output directory/.test(src), false,
      'AC1: ' + label + ' 搬出が境界検査を自前で持っていないこと（共有側の責務）');
  }
  console.log('ok: AC1 単一実装を両者が呼ぶ（参照形の決定・実体の書き出しの両方）');
}

// ---------------------------------------------------------------------------
// 出力の一致: 同じ POI 入力に対し、共通 API が返す参照形が地図/アプリで同一であること
// ---------------------------------------------------------------------------
async function importResolver() {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4b-parity-'));
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
    export {
      externalizeMapDocumentPois,
      createPoiExternalizationContext,
    } from ${JSON.stringify(path.join(projectRoot, 'electron/services/poiReferenceResolver.ts'))};
  `);
  await build({
    configFile: false, logLevel: 'silent',
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

const { mod, cleanup } = await importResolver();
const { externalizeMapDocumentPois, createPoiExternalizationContext } = mod;

try {
  const fixture = () => ([
    { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [134.69, 34.84] },
      properties: { name: '天守' },
    }]},
    { layer: 'https://example.com/remote.geojson' },
  ]);

  // 地図 ZIP 経路の ctx（搬出1回＝地図1枚）
  const mapJson = { pois: fixture() };
  const mapCtx = createPoiExternalizationContext();
  const mapOut = await externalizeMapDocumentPois(mapJson, mapCtx);

  // アプリ搬出経路の ctx（app + 全 map で共有）— 同じ入力なら同じ参照形になること
  const appJson = { pois: fixture() };
  const appCtx = createPoiExternalizationContext();
  const appOut = await externalizeMapDocumentPois(appJson, appCtx);

  assert.deepEqual(
    mapJson.pois, appJson.pois,
    'AC1: 同じ POI 入力に対して地図/アプリの参照形が一致すること',
  );
  assert.deepEqual(
    mapOut.result.documents.map((d) => d.dest).sort(),
    appOut.result.documents.map((d) => d.dest).sort(),
    'AC1: 生成される pois/*.geojson の dest が一致すること',
  );
  assert.deepEqual(
    mapOut.result.files.map((f) => f.dest).sort(),
    appOut.result.files.map((f) => f.dest).sort(),
    'AC1: 依存 assets の manifest が一致すること',
  );

  // 透過要素も同じ扱いであること
  assert.equal(mapJson.pois[1].layer, 'https://example.com/remote.geojson');
  assert.equal(appJson.pois[1].layer, 'https://example.com/remote.geojson');
  console.log('ok: AC1 地図/アプリの参照形・documents・assets が一致');

  // POI が無い場合は pois キーを触らない（元に無いキーを生やさない）
  {
    const empty = { title: 'no pois' };
    const out = await externalizeMapDocumentPois(empty, createPoiExternalizationContext());
    assert.equal(out.result, null, 'POI 0件では result が null であること');
    assert.equal('pois' in empty, false, 'POI 0件では pois キーを生やさないこと');
    console.log('ok: AC1 POI 0件で pois キーを生やさない');
  }

  console.log('m5-t4b export unification parity smoke: OK');
} finally {
  await cleanup();
}
