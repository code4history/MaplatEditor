// M4-T4 スモーク: Editor の URLレイヤ・上書きレイヤ読み書き（設計 v1.1）。
// 純関数層（poisLayerStructure / appPoisFormat）を表駆動で検証する。UI は E2E が担う。
//
// Part A: isPoiLayerRef が viewer 正本と同一規則                                  … AC1 の前提
// Part B: poisLayerMode が viewer と同一判定（両引数必須の新契約）                 … AC1
// Part C: readAppDocumentPois の単独形受け入れ                                     … AC6/AC10
// Part D: writeDocumentPois の保存形（単独形維持・配列化・キー削除）               … AC7/AC8
// Part E: 素ラッパーの退化（位置 × 上書き有無の4象限）                             … AC14
// Part F: 保存され得る全形式が viewer 正本の分岐で受容される                       … AC15
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

// 純関数層のみを vite SSR で束ねて読む（他 smoke と同じ作法。extensionless import を解決するため）
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm4-t4-'));
let mods;
try {
  const entryFile = path.join(workDir, 'entry.ts');
  await writeFile(entryFile, `
    export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poisLayerStructure.ts'))};
    export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/appPoisFormat.ts'))};
  `);
  await build({
    configFile: false, logLevel: 'error',
    build: {
      outDir: path.join(workDir, 'dist'), emptyOutDir: true, ssr: true,
      target: 'node20', minify: false,
      rollupOptions: { input: entryFile, output: { entryFileNames: 'entry.mjs', format: 'es' } },
    },
  });
  mods = await import(pathToFileURL(path.join(workDir, 'dist', 'entry.mjs')).href);
} finally {
  // 束ね済みモジュールは読み込み済みなので一時ディレクトリは残さない
}

const {
  isPoiLayerRef,
  isPoiLayerRefAsWhole,
  POI_OVERRIDE_KEYS,
  poisEntryShape,
  poisLayerMode,
  readAppDocumentPois,
  writeDocumentPois,
  acceptDocumentPois,
} = mods;

const FC = (id) => ({ type: 'FeatureCollection', id, features: [] });
const URL_A = 'pois/a.geojson';

// ============================================================
// Part A: isPoiLayerRef（viewer 正本 normalize_pois.ts:36-46 と同一規則）
// ============================================================
{
  assert.deepEqual([...POI_OVERRIDE_KEYS], ['hide', 'title', 'icon', 'selectedIcon'],
    '許可キーは viewer 正本 :23 と同一のはず');
  const cases = [
    [{ layer: URL_A }, true, 'layer が string'],
    [{ layer: URL_A, hide: true }, true, 'layer が string + 上書き'],
    [{ layer: FC('x') }, true, 'layer が FC'],
    [{ layer: 123 }, false, 'layer が非 string/FC'],
    [{}, false, 'layer なし'],
    [FC('x'), false, 'FC 自身はラッパーではない'],
    [{ layer: URL_A, lnglat: [0, 0] }, false, '座標キーを持つものは POI オブジェクト'],
    [{ layer: URL_A, lat: 1 }, false, '座標キー lat'],
    ['url', false, '文字列'],
    [null, false, 'null'],
    [[{ layer: URL_A }], false, '配列'],
  ];
  for (const [input, expected, label] of cases) {
    assert.equal(isPoiLayerRef(input), expected,
      `isPoiLayerRef(${JSON.stringify(input)}) = ${expected} — ${label}`);
  }
  console.log('ok: (A) isPoiLayerRef matches the viewer rule');
}

// ============================================================
// Part B: poisLayerMode（両引数必須・viewer と同一判定）… AC1
// ============================================================
{
  const shapesOf = (entries) => entries.map(poisEntryShape);
  const cases = [
    [[{ layer: URL_A, hide: true }], 'multi', '上書きレイヤ先頭 → 複層（v1.0 は single だった）'],
    [[{ layer: 'a' }, { layer: 'b' }], 'multi', '上書きレイヤ2件 → 複層'],
    [[FC('x'), { layer: 'b' }], 'multi', 'FC 先頭 → 複層（現行どおり）'],
    [[FC('x'), FC('y')], 'multi', 'FC 2件 → 複層（現行どおり）'],
    [['url'], 'indeterminate', '裸 URL 先頭 → 判定不能（現行どおり）'],
    [[{ name: 'p', lat: 1, lng: 2 }], 'single', 'レガシー POI → 単層（現行どおり）'],
    [[], 'empty', '空'],
  ];
  for (const [entries, expected, label] of cases) {
    assert.equal(poisLayerMode(shapesOf(entries), entries), expected,
      `poisLayerMode(${JSON.stringify(entries)}) = ${expected} — ${label}`);
  }
  // 新契約: entries は必須。省略した呼び出しは静かに旧判定へ落ちてはいけない
  assert.throws(() => poisLayerMode(shapesOf([{ layer: URL_A }])),
    '第2引数の省略は許さない（二挙動を作らない — 設計 §5.1）');
  console.log('ok: (B) poisLayerMode matches the viewer and takes both args');
}

// ============================================================
// Part C: readAppDocumentPois の単独形受け入れ … AC6/AC10
// ============================================================
{
  const cases = [
    [{ pois: [FC('x')] }, { pois: [FC('x')], unsupported: false }, '配列（現行どおり）'],
    [{ pois: URL_A }, { pois: [URL_A], unsupported: false }, 'URL 文字列の単独形'],
    [{ pois: { layer: URL_A, hide: true } }, { pois: [{ layer: URL_A, hide: true }], unsupported: false }, '上書きレイヤの単独形'],
    [{ pois: FC('solo') }, { pois: [FC('solo')], unsupported: false }, 'FC の単独形'],
    [{}, { pois: [], unsupported: false }, '未設定'],
    [{ pois: null }, { pois: [], unsupported: false }, 'null'],
    // 残る unsupported（現行どおり生値温存）
    [{ pois: '' }, { pois: [], unsupported: true }, '空文字'],
    [{ pois: { main: [], id1: [] } }, { pois: [], unsupported: true }, 'レイヤ名キー object'],
    [{ pois: 42 }, { pois: [], unsupported: true }, '数値'],
    [{ pois: '["a"]' }, { pois: [], unsupported: true }, 'JSON 文字列化された配列（sp-0006 の NG 側）'],
  ];
  for (const [input, expected, label] of cases) {
    assert.deepEqual(readAppDocumentPois(input), expected, `readAppDocumentPois — ${label}`);
  }
  console.log('ok: (C) readAppDocumentPois accepts single-layer forms');
}

// ============================================================
// Part D: writeDocumentPois の保存形 … AC7/AC8
// ============================================================
{
  const write = (previous, next) => {
    const target = previous === undefined ? {} : { pois: previous };
    writeDocumentPois(target, next, previous);
    return 'pois' in target ? { pois: target.pois } : {};
  };
  // 単独形 → 1件のまま = 単独形を維持（配列化しない）
  assert.deepEqual(write(URL_A, [URL_A]), { pois: URL_A }, '単独形 URL は単独形のまま');
  assert.deepEqual(write(FC('solo'), [FC('solo')]), { pois: FC('solo') }, '単独形 FC は単独形のまま');
  assert.deepEqual(write({ layer: URL_A, hide: true }, [{ layer: URL_A, hide: true }]),
    { pois: { layer: URL_A, hide: true } }, '上書き付きラッパーの単独形は維持');
  // 単独形 → 0件 = キー削除
  assert.deepEqual(write(URL_A, []), {}, '単独形 → 0件は pois キーを削除');
  // 単独形 → 2件 = 配列化（利用者操作による形式変更）
  assert.deepEqual(write(URL_A, [URL_A, FC('added')]), { pois: [URL_A, FC('added')] },
    '単独形 → 2件で配列化し、元の要素が残る（AC8）');
  // 配列 → 現行どおり
  assert.deepEqual(write([FC('x')], [FC('x')]), { pois: [FC('x')] }, '配列は配列のまま');
  assert.deepEqual(write([FC('x')], []), {}, '配列 → 0件は pois キーを削除');
  assert.deepEqual(write(undefined, [URL_A]), { pois: [URL_A] }, '元が未設定なら配列で作る');
  console.log('ok: (D) writeDocumentPois keeps the single-layer form');
}

// ============================================================
// Part E: 素ラッパーの退化（位置 × 上書き有無の4象限）… AC14
// ============================================================
{
  const write = (previous, next) => {
    const target = { pois: previous };
    writeDocumentPois(target, next, previous);
    return target.pois;
  };
  // 単独形 × 上書きなし → 素の値へ退化（viewer の isPoiLayerRefAsWhole が上書きを要求するため）
  assert.deepEqual(write(URL_A, [{ layer: URL_A }]), URL_A,
    '単独形 × 素ラッパー → 裸 URL へ退化');
  assert.deepEqual(write(FC('solo'), [{ layer: FC('solo') }]), FC('solo'),
    '単独形 × 素ラッパー(FC) → FC へ退化');
  // 単独形 × 上書きあり → ラッパーを保つ
  assert.deepEqual(write(URL_A, [{ layer: URL_A, hide: true }]), { layer: URL_A, hide: true },
    '単独形 × 上書き付き → ラッパーを保つ');
  // 配列要素 × 上書きなし → ラッパーのまま（裸へ戻さない）
  assert.deepEqual(write([URL_A, FC('b')], [{ layer: URL_A }, FC('b')]), [{ layer: URL_A }, FC('b')],
    '配列要素 × 素ラッパー → ラッパーのまま（要素位置では裸 URL が誤判定されるため）');
  // 配列 × 上書きあり → 配列のまま（1件でも単独形へ畳まない）
  assert.deepEqual(write([URL_A], [{ layer: URL_A, hide: true }]), [{ layer: URL_A, hide: true }],
    '元が配列なら1件でも配列のまま（単独形へ畳まない）');
  console.log('ok: (E) bare wrappers degrade only in the single-layer position');
}

// ============================================================
// Part F: 保存され得る全形式が viewer 正本の分岐で受容される … AC15
// ============================================================
{
  // viewer 正本 normalize_pois.ts と同一の受容条件を再現して判定する
  const isPlainObject = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
  const isFc = (x) => isPlainObject(x) && x.type === 'FeatureCollection';
  const acceptedAsWhole = (pois) => {
    if (Array.isArray(pois)) return true;                       // 配列分岐
    if (typeof pois === 'string') return true;                  // nodesLoader
    if (isFc(pois)) return true;                                // 単一 FC 分岐
    if (isPoiLayerRef(pois) && POI_OVERRIDE_KEYS.some((k) => pois[k] !== undefined)) return true; // isPoiLayerRefAsWhole
    return false;                                               // else = レイヤ名キー object 扱い（壊れる）
  };
  const savable = [
    [URL_A, true, '単独形 裸 URL'],
    [FC('solo'), true, '単独形 FC'],
    [{ layer: URL_A, hide: true }, true, '単独形 上書き付きラッパー'],
    [[{ layer: URL_A }], true, '配列 素ラッパー'],
    [[{ layer: URL_A, hide: true }], true, '配列 上書き付きラッパー'],
    [[FC('x')], true, '配列 FC'],
    [[{ poiUid: '11111111-1111-4111-8111-111111111111' }], true, '配列 参照'],
    [[{ name: 'p', lat: 1, lng: 2 }], true, '配列 レガシー POI'],
    // 退化させないと壊れる形（Editor はこれを保存してはいけない）
    [{ layer: URL_A }, false, '単独形 素ラッパー — viewer で壊れる ∴ 保存禁止'],
  ];
  for (const [pois, ok, label] of savable) {
    assert.equal(acceptedAsWhole(pois), ok, `viewer 受容: ${label}`);
  }
  console.log('ok: (F) every savable form is accepted by the viewer');
}

// ============================================================
// Part G: acceptDocumentPois が単独形を配列へ書き換えない … 設計 §5.3（sp-0006）
// ============================================================
{
  const accept = (pois) => {
    const target = {};
    acceptDocumentPois(target, pois === undefined ? {} : { pois });
    return 'pois' in target ? target.pois : '<キーなし>';
  };
  assert.equal(accept(URL_A), URL_A,
    '単独形 URL は読み込みで配列化されない（read.pois の表示用写像を代入してはいけない）');
  assert.deepEqual(accept(FC('solo')), FC('solo'), '単独形 FC も生値のまま');
  assert.deepEqual(accept({ layer: URL_A, hide: true }), { layer: URL_A, hide: true },
    '単独形ラッパーも生値のまま');
  assert.deepEqual(accept([FC('x')]), [FC('x')], '配列は従来どおり');
  assert.equal(accept({ main: [] }).main.length, 0, 'unsupported も生値温存（t1 の約束）');
  assert.equal(accept(undefined), '<キーなし>', '未設定はキーを作らない');
  console.log('ok: (G) acceptDocumentPois never rewrites the single-layer form');
}

await rm(workDir, { recursive: true, force: true });
console.log('m4-t4 editor layer ref smoke passed');
