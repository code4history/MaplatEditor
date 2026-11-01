// MapLibre のスタイルの判定に使う表（src/data/maplibreStyleSupport.json）を作る。
//
// 2 つの style-spec の参照（v8.json）から、判定に要る表だけを取り出す:
//   - v5: MapLibre GL JS 5 系の固定版（5.6.2）の検証が使う style-spec の参照
//   - v6: MapLibre GL JS 6 系の固定版（6.16.0）の検証が使う style-spec の参照
// 取り出すのは、層の型・層の型ごとの paint／layout のキー・式の演算子・source の型ごとのキー
// （任意のキーを許す `"*"` を持つか）と列挙の値、それに v6 の参照の sdk-support のうち判定に使う行。
//
// 使い方（node の組み込みだけを使う。生成物を手で直さない）:
//   node scripts/generate-maplibre-style-support.mjs \
//     --v5 23.3.0 --v5-integrity sha384-... \
//     --v6 26.4.4 --v6-integrity sha384-... \
//     --maplibre5 5.6.2 --maplibre6 6.16.0
// 取得した参照の sha384 が --*-integrity と違えば、何も書かずに止まる。
//
// 固定の版を上げるとき: 6 系の固定を上げるなら、その版の maplibre-gl が依存する style-spec の版で
// --v6 を取り直す。5 系の固定（5.6.2）は出力を変えないために動かさないので、--v5 は変わらない。
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const outFile = path.join(projectRoot, 'src/data/maplibreStyleSupport.json');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return value;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const specUrl = (version) =>
  `https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-style-spec@${version}/src/reference/v8.json`;

async function fetchReference(version, integrity) {
  const url = specUrl(version);
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const actual = `sha384-${createHash('sha384').update(body).digest('base64')}`;
  if (actual !== integrity) throw new Error(`${url}: sha384 が違う（期待 ${integrity}・実際 ${actual}）`);
  return { url, integrity, bytes: body.length, reference: JSON.parse(body.toString('utf8')) };
}

const SOURCE_TYPES = { vector: 'source_vector', raster: 'source_raster', 'raster-dem': 'source_raster_dem', geojson: 'source_geojson', video: 'source_video', image: 'source_image' };

function extract(ref) {
  const layerTypes = Object.keys(ref.layer.type.values).sort();
  const paint = {};
  const layout = {};
  for (const type of layerTypes) {
    paint[type] = Object.keys(ref[`paint_${type}`] || {}).sort();
    layout[type] = Object.keys(ref[`layout_${type}`] || {}).sort();
  }
  const transitionable = {};
  for (const type of layerTypes) {
    transitionable[type] = Object.entries(ref[`paint_${type}`] || {})
      .filter(([, spec]) => spec && spec.transition === true)
      .map(([key]) => key)
      .sort();
  }
  const operators = [...new Set([
    ...Object.keys(ref.expression_name.values),
    ...Object.keys(ref.filter_operator?.values || {}),
  ])].sort();
  const sources = {};
  for (const [type, name] of Object.entries(SOURCE_TYPES)) {
    const spec = ref[name];
    if (!spec) continue;
    const keys = Object.keys(spec).filter((k) => k !== '*').sort();
    const enums = {};
    for (const key of keys) {
      if (key !== 'type' && spec[key]?.type === 'enum') enums[key] = Object.keys(spec[key].values).sort();
    }
    sources[type] = { keys, wildcard: Object.prototype.hasOwnProperty.call(spec, '*'), enums };
  }
  const light = Object.keys(ref.light || {}).sort();
  const sky = Object.keys(ref.sky || {}).sort();
  return { layerTypes, paint, layout, transitionable, operators, sources, light, sky };
}

// sdk-support の行の名前 → 判定での種類。ここに無い名前で、js が 5 系の固定版より新しい行があれば止まる
// （参照の構造が前提と違う＝判定の規則を決め直す必要がある）。
const ROW_KIND = new Map([
  ['basic functionality', 'basic'],
  ['data-driven styling', 'data-driven'],
  ['`unit` property', 'unit'],
  ['omit to use local fonts', 'omit-glyphs'],
  // source の encoding は行の名前が値（mvt・mlt）なので、呼び出し側が 'encoding-value' に置き換え、値を value に持つ
  ['encoding-value', 'encoding-value'],
]);
// js が版でない（URL）ので、どの js の版でも同じ扱いになる行。判定に使わない
const IGNORED_ROWS = new Set(['local fonts', 'negative values', 'SDF fill pattern colorization']);

function rowKind(row) {
  if (ROW_KIND.has(row)) return ROW_KIND.get(row);
  if (row.includes('global-state')) return 'global-state';
  return null;
}

function cmp(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function requirements(ref, maplibre5) {
  const out = [];
  const add = (scope, type, key, row, js, value) => {
    if (typeof js !== 'string' || !VERSION.test(js)) return; // URL・wontfix・supported・無い は数えない
    if (cmp(js, maplibre5) <= 0) return;
    if (IGNORED_ROWS.has(row)) return;
    const kind = rowKind(row);
    if (!kind) throw new Error(`判定の規則の無い sdk-support の行: ${scope}.${type ?? ''}.${key} "${row}" js=${js}`);
    out.push({ scope, ...(type ? { type } : {}), key, kind, ...(value ? { value } : {}), js });
  };
  const rows = (scope, type, key, spec) => {
    for (const [row, support] of Object.entries(spec?.['sdk-support'] || {})) {
      if (scope === 'source' && key === 'encoding') add(scope, type, key, 'encoding-value', support?.js, row);
      else add(scope, type, key, row, support?.js);
    }
  };
  for (const [key, spec] of Object.entries(ref.$root)) rows('root', null, key, spec);
  for (const type of Object.keys(ref.layer.type.values)) {
    for (const [key, spec] of Object.entries(ref[`paint_${type}`] || {})) rows('paint', type, key, spec);
    for (const [key, spec] of Object.entries(ref[`layout_${type}`] || {})) rows('layout', type, key, spec);
  }
  for (const [type, name] of Object.entries(SOURCE_TYPES)) {
    for (const [key, spec] of Object.entries(ref[name] || {})) if (key !== '*') rows('source', type, key, spec);
  }
  for (const [key, spec] of Object.entries(ref.expression_name.values)) rows('operator', null, key, spec);
  for (const [key, spec] of Object.entries(ref.light || {})) rows('light', null, key, spec);
  for (const [key, spec] of Object.entries(ref.sky || {})) rows('sky', null, key, spec);
  return out;
}

const v5Version = arg('v5');
const v6Version = arg('v6');
const maplibre5 = arg('maplibre5');
const maplibre6 = arg('maplibre6');
for (const v of [v5Version, v6Version, maplibre5, maplibre6]) {
  if (!VERSION.test(v)) { console.error(`版の形が違う: ${v}`); process.exit(2); }
}
const v5 = await fetchReference(v5Version, arg('v5-integrity'));
const v6 = await fetchReference(v6Version, arg('v6-integrity'));

const table = {
  generatedBy: 'scripts/generate-maplibre-style-support.mjs',
  maplibre5,
  maplibre6,
  sources: {
    v5: { styleSpec: v5Version, url: v5.url, bytes: v5.bytes, integrity: v5.integrity },
    v6: { styleSpec: v6Version, url: v6.url, bytes: v6.bytes, integrity: v6.integrity },
  },
  v5: extract(v5.reference),
  v6: extract(v6.reference),
  requirements: requirements(v6.reference, maplibre5),
};

await writeFile(outFile, `${JSON.stringify(table, null, 1)}\n`);
console.log(`wrote ${path.relative(projectRoot, outFile)}: requirements=${table.requirements.length}`);
