// MapLibre のスタイルの判定（5 系で動く／6 系が要る／判定できない）と、版の切り替えの字面のスモーク。
//
//   - 判定の表（src/data/maplibreStyleSupport.json）が、固定の版（PROVIDER_GL_CDN）と参照の sha384 に一致する
//   - judgeMaplibreStyleSupport が境目の表のとおりに返す（1 行 1 assert）
//   - 6 系へ切り替える代入は、確認の関数の中の 1 か所だけ（判定の結果を受ける側は版を書き換えない）
//   - 新しい文言のキーが 11 言語にあり、差し込みの名前の集合が同じ
//   - smoke の結線
//
// ネットワークを使わない。判定の関数と表は vite でバンドルして読む（他のスモークと同じ）。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'maplibre-style-support-'));
const entryPath = path.join(workDir, 'entry.ts');
const outDir = path.join(workDir, 'dist');
const p = (rel) => JSON.stringify(path.join(projectRoot, rel));

// 参照の出どころ（固定。値を変えるのは 6 系の固定を上げるときだけ）
const STYLE_SPEC_V5 = { styleSpec: '23.3.0', integrity: 'sha384-i4ALp3p43KS/8cq/WRAV4fUzqNZb9PKKwQy5Iay+JxEDaN77X4L3HAbUw9OBzGEe' };
const STYLE_SPEC_V6 = { styleSpec: '26.4.4', integrity: 'sha384-NN2fTKguurSXKRCvjlccsB7n9f6aQ3Xz35y+mqNsWiShsGuLUdDzOlswmxfPsh4X' };

const failures = [];
async function check(label, fn) {
  try {
    await fn();
    console.log(`ok: ${label}`);
  } catch (e) {
    failures.push(label);
    console.log(`FAIL: ${label}\n  ${String(e?.message || e).split('\n').join('\n  ')}`);
  }
}

let mod = null;
try {
  await writeFile(
    entryPath,
    `
export * from ${p('src/utils/maplibreStyleSupport.ts')};
export { default as TABLE } from ${p('src/data/maplibreStyleSupport.json')};
export { PROVIDER_GL_CDN } from ${p('electron/services/providerGlCdn.ts')};
`,
  );
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      ssr: entryPath,
      target: 'node22',
      rollupOptions: { output: { entryFileNames: 'entry.mjs', format: 'es' } },
    },
  });
  mod = await import(pathToFileURL(path.join(outDir, 'entry.mjs')).href);
} catch (e) {
  failures.push('bundle');
  console.log(`FAIL: 判定の関数と表を読めない（src/utils/maplibreStyleSupport.ts・src/data/maplibreStyleSupport.json）\n  ${String(e?.message || e).split('\n')[0]}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

const readJson = async (rel) => JSON.parse(await readFile(path.join(projectRoot, rel), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

if (mod) {
  const { judgeMaplibreStyleSupport: judge, TABLE, PROVIDER_GL_CDN } = mod;

  await check('表: 固定の版が PROVIDER_GL_CDN と一致し、参照の出どころの sha384 が固定の値', () => {
    assert.equal(TABLE.maplibre5, PROVIDER_GL_CDN.maplibre5.version);
    assert.equal(TABLE.maplibre6, PROVIDER_GL_CDN.maplibre6.version);
    assert.equal(TABLE.sources.v5.styleSpec, STYLE_SPEC_V5.styleSpec);
    assert.equal(TABLE.sources.v5.integrity, STYLE_SPEC_V5.integrity);
    assert.equal(TABLE.sources.v6.styleSpec, STYLE_SPEC_V6.styleSpec);
    assert.equal(TABLE.sources.v6.integrity, STYLE_SPEC_V6.integrity);
    assert.equal(TABLE.generatedBy, 'scripts/generate-maplibre-style-support.mjs');
  });

  // ---------------- 境目の表 ----------------
  const fixture = await readJson('tests/e2e/fixtures/provider-gl/line-layer-opacity-style.json');
  const osmBright = await readJson('tests/e2e/fixtures/provider-gl/osm-bright-style.json');
  const plain = (() => { const s = clone(fixture); delete s.layers[2].paint['line-layer-opacity']; return s; })();
  const withLayer = (layer, extra = {}) => ({ ...clone(plain), ...extra, layers: [...clone(plain).layers, layer] });
  const vectorSource = { type: 'vector', tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'] };
  const withSource = (src) => ({ ...clone(plain), sources: { ...clone(plain).sources, v: src } });
  const line = (paint = {}, layout = {}) => ({ id: 'l', type: 'line', source: 'west', paint, layout });
  const symbolWithText = { id: 's', type: 'symbol', source: 'west', layout: { 'text-field': 'x' } };

  const expectResult = (label, style, result, reasonCheck) =>
    check(`境目: ${label} → ${result}`, () => {
      const r = judge(style);
      assert.equal(r.result, result, JSON.stringify(r));
      if (reasonCheck) reasonCheck(r.reasons);
    });
  const has = (pred, msg) => (reasons) => assert.ok(reasons.some(pred), `${msg}: ${JSON.stringify(reasons)}`);

  // v5-ok
  await expectResult('6 系の機能を使わない style（fixture から line-layer-opacity を除いたもの）', plain, 'v5-ok');
  await expectResult('osm-bright の写し', osmBright, 'v5-ok');
  await expectResult('line-dasharray をズームだけの式で書いたもの', withLayer(line({ 'line-dasharray': ['step', ['zoom'], ['literal', [2, 1]], 14, ['literal', [1, 1]]] })), 'v5-ok');
  await expectResult('stops だけの旧式の関数', withLayer(line({ 'line-dasharray': { stops: [[10, [2, 1]], [14, [1, 1]]] } })), 'v5-ok');
  await expectResult('最上位の font-faces だけを足したもの', { ...clone(plain), 'font-faces': { Noto: 'https://fonts.example.test/noto.ttf' } }, 'v5-ok');
  await expectResult('js が URL の行（fill-extrusion-height の負の値）', withLayer({ id: 'x', type: 'fill-extrusion', source: 'west', paint: { 'fill-extrusion-height': -10 } }), 'v5-ok');
  await expectResult('vector の source の encoding: "mvt"（5.6.2 の検証は任意のキーを許す）', withSource({ ...vectorSource, encoding: 'mvt' }), 'v5-ok');
  await expectResult('vector の source の知らないキー（"*" を持つ型）', withSource({ ...vectorSource, 'x-custom': 1 }), 'v5-ok');
  await expectResult('line-dasharray の global-state（js 5.6.0 で 5.6.2 以下）', withLayer(line({ 'line-dasharray': ['global-state', 'dash'] })), 'v5-ok');
  await expectResult('paint の遷移のキー（line-opacity-transition）', withLayer(line({ 'line-opacity-transition': { duration: 300 } })), 'v5-ok');

  // needs-v6
  await expectResult('line-layer-opacity の fixture', fixture, 'needs-v6',
    has((r) => r.kind === 'unknown-to-5' && r.layer === 2 && r.layerId === 'west-line' && r.key === 'paint.line-layer-opacity', '層の番号とキーが理由'));
  await expectResult('fill-layer-opacity', withLayer({ id: 'f', type: 'fill', source: 'west', paint: { 'fill-layer-opacity': 0.5 } }), 'needs-v6',
    has((r) => r.key === 'paint.fill-layer-opacity', 'fill-layer-opacity'));
  await expectResult('raster の resampling', withLayer({ id: 'r', type: 'raster', source: 'west', paint: { resampling: 'nearest' } }), 'needs-v6',
    has((r) => r.key === 'paint.resampling', 'resampling'));
  for (const op of ['join', 'split', 'semiliteral']) {
    const expr = op === 'semiliteral' ? ['semiliteral', 'x'] : op === 'join' ? ['join', ['literal', ['a', 'b']], '-'] : ['split', 'a-b', '-'];
    await expectResult(`演算子 ${op}`, withLayer({ id: 's', type: 'symbol', source: 'west', layout: { 'text-field': ['to-string', expr] } }, { glyphs: 'https://g.example.test/{fontstack}/{range}.pbf' }), 'needs-v6',
      has((r) => r.kind === 'unknown-to-5' && r.operator === op, `演算子 ${op}`));
  }
  await expectResult('vector の source の encoding: "mlt"（js 5.12.0）', withSource({ ...vectorSource, encoding: 'mlt' }), 'needs-v6',
    has((r) => r.kind === 'needs-js' && r.source === 'v' && r.key === 'encoding' && r.requires === '5.12.0', 'mlt は 5.12.0'));
  await expectResult('get を含む line-dasharray（data-driven・5.8.0）', withLayer(line({ 'line-dasharray': ['case', ['has', 'dash'], ['literal', [2, 1]], ['literal', [1, 0]]] })), 'needs-v6',
    has((r) => r.kind === 'needs-js' && r.key === 'paint.line-dasharray' && r.requires === '5.8.0', 'data-driven の line-dasharray'));
  await expectResult('property を持つ旧式の関数の line-dasharray', withLayer(line({ 'line-dasharray': { property: 'k', type: 'categorical', stops: [['a', [1, 1]]] } })), 'needs-v6',
    has((r) => r.requires === '5.8.0', '旧式の関数の data-driven'));
  await expectResult('global-state を使う line-cap（5.7.0）', withLayer(line({}, { 'line-cap': ['global-state', 'cap'] })), 'needs-v6',
    has((r) => r.kind === 'needs-js' && r.key === 'layout.line-cap' && r.requires === '5.7.0', 'global-state の line-cap'));
  await expectResult('number-format の unit（5.20.0）', withLayer({ id: 's', type: 'symbol', source: 'west', layout: { 'text-field': ['number-format', 3, { unit: 'kilometer' }] } }, { glyphs: 'https://g.example.test/{fontstack}/{range}.pbf' }), 'needs-v6',
    has((r) => r.kind === 'needs-js' && r.operator === 'number-format' && r.requires === '5.20.0', 'unit'));
  await expectResult('glyphs が無く text-field のある style（5.11.0）', withLayer(symbolWithText), 'needs-v6',
    has((r) => r.kind === 'needs-js' && r.key === 'glyphs' && r.requires === '5.11.0', 'glyphs の省略'));
  await expectResult('symbol-height-anchor（5.6.2 が知らない layout のキー）', withLayer({ ...symbolWithText, layout: { 'symbol-height-anchor': 'top' } }, { glyphs: 'https://g.example.test/{fontstack}/{range}.pbf' }), 'needs-v6',
    has((r) => r.key === 'layout.symbol-height-anchor', 'symbol-height-anchor'));

  // unknown
  await expectResult('26.4.4 も知らない paint のキー', withLayer(line({ 'line-sparkle': 1 })), 'unknown',
    has((r) => r.kind === 'unknown-to-6' && r.key === 'paint.line-sparkle', '知らない paint のキー'));
  await expectResult('26.4.4 も知らない層の型', withLayer({ id: 'z', type: 'sparkle', source: 'west' }), 'unknown',
    has((r) => r.kind === 'unknown-to-6' && r.key === 'type', '知らない層の型'));
  await expectResult('geojson の source の知らないキー（"*" を持たない型）', withSource({ type: 'geojson', data: { type: 'FeatureCollection', features: [] }, sparkle: 1 }), 'unknown',
    has((r) => r.kind === 'unknown-to-6' && r.source === 'v' && r.key === 'sparkle', '知らない source のキー'));
  await expectResult('26.4.4 も知らない source の型', withSource({ type: 'sparkle' }), 'unknown');
  // Object.prototype の名前を型として引いても例外にならず、知らない型として「判定できない」
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    await expectResult(`source の type が "${type}"（Object.prototype の名前）`, withSource(JSON.parse(`{"type": ${JSON.stringify(type)}}`)), 'unknown',
      has((r) => r.kind === 'unknown-to-6' && r.source === 'v' && r.key === 'type', '知らない source の型'));
  }
  await expectResult('層の型が "constructor"', withLayer({ id: 'z', type: 'constructor', source: 'west' }), 'unknown',
    has((r) => r.kind === 'unknown-to-6' && r.key === 'type', '知らない層の型'));
  await expectResult('paint のキーが "constructor"・"__proto__"', withLayer(JSON.parse('{"id":"l","type":"line","source":"west","paint":{"constructor":1,"__proto__":2}}')), 'unknown',
    has((r) => r.kind === 'unknown-to-6' && r.key === 'paint.constructor', '知らない paint のキー'));
  await expectResult('vector の source のキーが "constructor"（"*" を持つ型）', withSource(JSON.parse('{"type":"vector","tiles":["https://t.example.test/{z}/{x}/{y}.pbf"],"constructor":1}')), 'v5-ok');
  // 式が極端に深い入れ子でも例外にならず、「判定できない」（判定の途中で止めた）
  {
    let deep = ['get', 'x'];
    for (let i = 0; i < 200000; i++) deep = ['to-string', deep];
    await expectResult('式が 20 万段の入れ子', withLayer(line({ 'line-width': deep })), 'unknown',
      has((r) => r.kind === 'check-failed', '判定の途中で止めた'));
    let deepObj = {};
    for (let i = 0; i < 200000; i++) deepObj = { a: deepObj };
    await expectResult('値のオブジェクトが 20 万段の入れ子', withLayer(line({ 'line-width': deepObj })), 'unknown',
      has((r) => r.kind === 'check-failed', '判定の途中で止めた'));
  }
  await expectResult('encoding の列挙に無い値', withSource({ ...vectorSource, encoding: 'pbf2' }), 'unknown',
    has((r) => r.kind === 'unknown-to-6' && r.key === 'encoding', '列挙に無い encoding'));
  await expectResult('version: 7', { ...clone(plain), version: 7 }, 'unknown', has((r) => r.kind === 'not-v8', 'not-v8'));
  await expectResult('JSON のオブジェクトでない', 'not a style', 'unknown', has((r) => r.kind === 'invalid-json', 'invalid-json'));
  await expectResult('needs-v6 と unknown の両方 → unknown を優先し、needs-v6 の項目も並べる', withLayer(line({ 'line-sparkle': 1, 'line-layer-opacity': 0.5 })), 'unknown', (reasons) => {
    assert.ok(reasons.some((r) => r.kind === 'unknown-to-6'));
    assert.ok(reasons.some((r) => r.kind === 'unknown-to-5'));
  });
  await check('境目: 補いの要る版が 6 系の固定版より新しい行 → unknown', () => {
    const table = clone(TABLE);
    table.requirements.push({ scope: 'paint', type: 'line', key: 'line-width', kind: 'basic', js: '99.0.0' });
    const r = judge(withLayer(line({ 'line-width': 2 })), table);
    assert.equal(r.result, 'unknown', JSON.stringify(r));
    assert.ok(r.reasons.some((x) => x.kind === 'needs-js' && x.requires === '99.0.0'));
  });
  await check('境目: style の本文から来る名前は /^[A-Za-z0-9_.:-]{1,64}$/ に合わなければ伏せる', () => {
    const style = withLayer({ id: 'bad id <script>', type: 'line', source: 'west', paint: { 'line-layer-opacity': 1 } });
    const r = judge(style);
    const reason = r.reasons.find((x) => x.key === 'paint.line-layer-opacity');
    assert.equal(reason.layerId, '…');
    const r2 = judge(withLayer(line({ ['x'.repeat(80)]: 1 })));
    assert.ok(r2.reasons.some((x) => x.key === 'paint.…'), JSON.stringify(r2.reasons));
  });
}

// ---------------- 字面: 6 系へ切り替える代入は確認の関数の中だけ ----------------
async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else if (/\.(ts|vue|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}
// 版に 6 を書く字面: 代入（=）・オブジェクトのキー（:。展開や Object.assign の引数もこの形）・角括弧の代入。
// 比べる式（=== 6）・型（5 | 6）・既定の 5 には当たらない
const SIX_WRITES = [
  /\bmaplibreMajorVersion["'`]?\s*[:=]\s*6\b/g,
  /\[\s*["'`]maplibreMajorVersion["'`]\s*\]\s*=\s*6\b/g,
];
function sixWrites(text) {
  const out = [];
  for (const re of SIX_WRITES) for (const m of text.matchAll(re)) out.push(m.index);
  return out.sort((a, b) => a - b);
}
await check('字面の検査の自己検査: 6 を書く 5 通りの形を拾い、比べる式・型・既定の 5 を拾わない', () => {
  for (const line of [
    'appData.value.maplibreMajorVersion = 6;',
    'appData.value = { ...appData.value, maplibreMajorVersion: 6 };',
    '(appData.value as any)["maplibreMajorVersion"] = 6;',
    "Object.assign(appData.value, { maplibreMajorVersion: 6 });",
    'const doc = { "maplibreMajorVersion": 6 };',
  ]) assert.equal(sixWrites(line).length, 1, line);
  for (const line of [
    'if (appData.value.maplibreMajorVersion === 6) return;',
    ':checked="appData.maplibreMajorVersion === 6"',
    'maplibreMajorVersion: 5 | 6;',
    'maplibreMajorVersion: 5,',
    'normalized.maplibreMajorVersion = value.maplibreMajorVersion === 6 ? 6 : 5;',
  ]) assert.equal(sixWrites(line).length, 0, line);
});
await check('字面: src/ で maplibreMajorVersion に 6 を書くのは AppEdit.vue の confirmSwitchToMaplibre6 の中の 1 か所だけ', async () => {
  const hits = [];
  for (const file of await listFiles(path.join(projectRoot, 'src'))) {
    const text = await readFile(file, 'utf8');
    for (const index of sixWrites(text)) hits.push({ file: path.relative(projectRoot, file), index, text });
  }
  assert.equal(hits.length, 1, JSON.stringify(hits.map((h) => h.file)));
  assert.equal(hits[0].file, 'src/views/AppEdit.vue');
  const start = hits[0].text.indexOf('async function confirmSwitchToMaplibre6(');
  assert.ok(start >= 0, '確認の関数 confirmSwitchToMaplibre6 が無い');
  const end = hits[0].text.indexOf('\n}\n', start);
  assert.ok(hits[0].index > start && hits[0].index < end, '代入が確認の関数の外にある');
  const body = hits[0].text.slice(start, end);
  assert.ok(body.indexOf('showMessageBox') >= 0 && body.indexOf('showMessageBox') < hits[0].index - start, '代入が確認の窓より前にある');
});
await check('字面: 判定の結果を受ける側は版を書き換えない・ラジオに v-model を結ばない', async () => {
  const judgeSrc = await readFile(path.join(projectRoot, 'src/utils/maplibreStyleSupport.ts'), 'utf8');
  assert.equal(/maplibreMajorVersion/.test(judgeSrc), false, '判定の関数が版に触れている');
  const app = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
  const start = app.indexOf('async function refreshMaplibreStyleChecks(');
  assert.ok(start >= 0, '判定の結果を扱う関数 refreshMaplibreStyleChecks が無い');
  const body = app.slice(start, app.indexOf('\n}\n', start));
  assert.equal(/maplibreMajorVersion\s*=/.test(body), false, '判定の結果を扱う関数が版を書き換えている');
  assert.equal(/v-model(\.\w+)?="appData\.maplibreMajorVersion"/.test(app), false, 'ラジオに v-model で版を結んでいる');
  assert.match(app, /data-testid="app-maplibre-version-5"/);
  assert.match(app, /data-testid="app-maplibre-version-6"/);
});

// ---------------- 文言: 11 言語・差し込みの名前 ----------------
const NEW_KEYS = [
  'appedit.maplibre_version', 'appedit.maplibre_version_5', 'appedit.maplibre_version_6', 'appedit.maplibre_version_note',
  'appedit.maplibre_version_switch_6', 'appedit.maplibre_version_6_confirm_message', 'appedit.maplibre_version_6_confirm_detail',
  'appedit.maplibre_version_6_confirm_ok', 'appedit.maplibre_version_6_confirm_cancel', 'appedit.maplibre_version_warning',
  'appedit.maplibre_version_warning_unknown', 'appedit.maplibre_export_warning_message', 'appedit.maplibre_export_warning_detail',
  'appedit.maplibre_export_warning_continue', 'appedit.maplibre_export_warning_cancel',
  'basemap.style_gl_check_v5_ok', 'basemap.style_gl_check_needs_v6', 'basemap.style_gl_check_unknown', 'basemap.style_gl_check_run',
  'basemap.style_gl_check_running',
  'basemap.style_gl_check_reason_network', 'basemap.style_gl_check_reason_http-status', 'basemap.style_gl_check_reason_too-large',
  'basemap.style_gl_check_reason_unsupported-scheme', 'basemap.style_gl_check_reason_invalid-json',
  'basemap.style_gl_check_reason_not-v8', 'basemap.style_gl_check_reason_invalid-argument',
  'basemap.style_gl_check_reason_check-failed',
];
await check('文言: 新しいキーが 11 言語にあり、差し込み（{{…}}）の名前の集合が同じ', async () => {
  const langs = (await readdir(path.join(projectRoot, 'public/locales'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.equal(langs.length, 11, langs.join(','));
  const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)), obj);
  const names = (v) => [...String(v).matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');
  const ref = await readJson('public/locales/en/translation.json');
  for (const lang of langs) {
    const tr = await readJson(`public/locales/${lang}/translation.json`);
    for (const key of NEW_KEYS) {
      const value = get(tr, key);
      assert.equal(typeof value, 'string', `${lang}: ${key} が無い`);
      assert.notEqual(value.trim(), '', `${lang}: ${key} が空`);
      assert.equal(names(value), names(get(ref, key)), `${lang}: ${key} の差し込みの名前が en と違う`);
    }
  }
  const en = await readJson('public/locales/en/translation.json');
  assert.equal(names(get(en, 'appedit.maplibre_version_warning')), 'name,reasons');
  assert.equal(names(get(en, 'basemap.style_gl_check_needs_v6')), 'reasons');
});

await check('結線: package.json に smoke:maplibre-style-support と smoke:maplibre-version-migration がある', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.scripts['smoke:maplibre-style-support'], 'node scripts/maplibre-style-support-smoke.mjs');
  assert.equal(pkg.scripts['smoke:maplibre-version-migration'], 'node scripts/maplibre-version-migration-smoke.mjs');
});

if (failures.length) {
  console.log(`maplibre-style-support smoke FAILED: ${failures.length} check(s): ${failures.join(' / ')}`);
  process.exit(1);
}
console.log('maplibre-style-support smoke passed');
