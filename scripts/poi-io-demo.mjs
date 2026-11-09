// POI の一括入出力のデモ: 入力と出力の対比表 (HTML) を作る。
// 人間が「要望どおりか」を目で見るためのもの。期待値と合わなければ exit 1。
// 期待値は smoke (poi-merge-smoke・poi-import-smoke) と同じ fixtures を読む。
//   A: 追記と上書きの対比    B: 誤りの行の報告    C: 文字コード    E: 書き出しと往復
// 使い方: node scripts/poi-io-demo.mjs --out <出力ディレクトリ>
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = path.join(projectRoot, 'tests/fixtures/poi-io');
const outArg = process.argv.indexOf('--out');
if (outArg < 0 || !process.argv[outArg + 1]) {
  console.error('usage: node scripts/poi-io-demo.mjs --out <dir>');
  process.exit(2);
}
const outDir = path.resolve(process.argv[outArg + 1]);
await mkdir(outDir, { recursive: true });
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-io-demo-'));

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const failures = [];
const expect = (name, fn) => { try { fn(); } catch (e) { failures.push(`${name}: ${e.message.split('\n')[0]}`); } };

try {
  const entry = path.join(workDir, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiMerge.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiImportRows.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiCsvExport.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiTableCodec.ts'))};`,
      `export { normalizePoiSourceCollection, toExportForm } from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiGeoJson.ts'))};`,
    ].join('\n'),
  );
  await build({
    root: projectRoot, logLevel: 'error', configFile: false,
    build: { outDir: path.join(workDir, 'dist'), emptyOutDir: true, ssr: entry, rollupOptions: { output: { entryFileNames: 'bundle.mjs', format: 'es' } } },
    ssr: { noExternal: true },
  });
  const m = await import(pathToFileURL(path.join(workDir, 'dist/bundle.mjs')).href);
  const readText = (name) => readFile(path.join(fixtureDir, name), 'utf8');
  const readBytes = async (name) => new Uint8Array(await readFile(path.join(fixtureDir, name)));
  const readJson = async (name) => JSON.parse(await readText(name));
  const strip = (f) => ({ ...f, properties: Object.fromEntries(Object.entries(f.properties).filter(([k]) => !k.startsWith('_maplat'))) });
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const featureRows = (features) => features.map((f) => {
    const p = f.properties;
    const lang = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' / ') : v ?? '');
    const image = Array.isArray(p.image) ? p.image.map((x) => (typeof x === 'string' ? x : x.src)).join(' | ') : typeof p.image === 'object' && p.image ? p.image.src : p.image ?? '';
    return `<tr><td>${esc(f.id)}</td><td>${esc(lang(p.name))}</td><td>${esc(lang(p.desc))}</td><td>${esc(lang(p.address))}</td><td>${esc(image)}</td><td>${esc(f.geometry.coordinates.slice().reverse().join(', '))}</td></tr>`;
  }).join('');
  const table = (rowsHtml) => `<table><thead><tr><th>id</th><th>name</th><th>desc</th><th>address</th><th>image</th><th>lat, lng</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  const issueTable = (issues) => `<table><thead><tr><th>行</th><th>code</th><th>水準</th><th>備考</th></tr></thead><tbody>${issues.map((i) => `<tr><td>${esc(i.line ?? '')}</td><td>${esc(i.code)}</td><td>${esc(i.level)}</td><td>${esc([i.swapped ? '緯度と経度が逆では' : '', i.message ?? ''].filter(Boolean).join(' '))}</td></tr>`).join('')}</tbody></table>`;
  const cases = [];
  const defaultLang = 'ja';

  // --- A: 追記と上書き ---
  {
    const existing = m.normalizePoiSourceCollection(await readJson('merge-existing.json'), defaultLang).features;
    const csv = await readText('demo-merge.csv');
    const parse = m.parsePoiImportFile({ format: 'csv', bytes: await readBytes('demo-merge.csv'), defaultLang });
    const append = m.planPoiMerge({ existing, rows: parse.rows, mode: 'append', defaultLang });
    const overwrite = m.planPoiMerge({ existing, rows: parse.rows, mode: 'overwrite', defaultLang });
    const expAppend = await readJson('expected-append.json');
    const expOverwrite = await readJson('expected-overwrite.json');
    expect('A 追記', () => assert.deepEqual(plain(append.features.map(strip)), expAppend));
    expect('A 上書き', () => assert.deepEqual(plain(overwrite.features.map(strip)), expOverwrite));
    expect('A 件数', () => { assert.equal(append.features.length, 6); assert.equal(overwrite.features.length, 5); });
    cases.push(`<section data-demo-case="A"><h2>デモ A: 追記と上書きの対比</h2>
      <p>同じ CSV で、件数と既存の POI の運命が違います。上書きでは空のセルは何も消しません（shrine-2 の address は「東京都」のまま）。</p>
      <h3>既存のソース（3 件）</h3>${table(featureRows(existing.map(strip)))}
      <h3>取り込む CSV</h3><pre>${esc(csv)}</pre>
      <div class="cols"><div><h3>追記 → ${append.features.length} 件</h3><p>追加 ${append.summary.added}・名前変更 ${append.summary.renamed}・除く ${append.summary.skippedRows}</p>${table(featureRows(append.features.map(strip)))}${issueTable(append.issues)}</div>
      <div><h3>上書き → ${overwrite.features.length} 件</h3><p>追加 ${overwrite.summary.added}・更新 ${overwrite.summary.updated}・残る既存 ${overwrite.summary.keptExisting}</p>${table(featureRows(overwrite.features.map(strip)))}</div></div></section>`);
  }

  // --- B: 誤りの行 ---
  {
    const bytes = await readBytes('demo-errors.csv');
    const parse = m.parsePoiImportFile({ format: 'csv', bytes, defaultLang });
    const plan = m.planPoiMerge({ existing: [], rows: parse.rows, mode: 'append', defaultLang });
    const all = [...parse.issues, ...plan.issues].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const keys = all.map((i) => `${i.line}:${i.code}:${i.level}`);
    expect('B issue', () => assert.deepEqual(keys, [
      '3:coord-range:error', '4:coordinate-partial:warning', '4:coord-missing:error', '5:file-duplicate-id:error',
      '6:display-id-charset:error', '7:image-dropped:warning', '8:name-required:error',
    ]));
    expect('B 取り込み', () => { assert.equal(plan.features.length, 2); assert.equal(parse.totalRecords - plan.features.length, 5); });
    expect('B 逆の印', () => assert.equal(all.find((i) => i.code === 'coord-range').swapped, true));
    cases.push(`<section data-demo-case="B"><h2>デモ B: 誤りの行の報告</h2>
      <p>取り込まれるのは行 2 と 7 の ${plan.features.length} 件、除かれるのは ${parse.totalRecords - plan.features.length} 件です。</p>
      <pre>${esc(await readText('demo-errors.csv'))}</pre>${issueTable(all)}</section>`);
  }

  // --- C: 文字コード ---
  {
    const rows = [];
    const names = [];
    for (const [file, encoding] of [['names-utf8bom.csv', 'utf-8-bom'], ['names-utf8.csv', 'utf-8'], ['names-sjis.csv', 'shift_jis']]) {
      const parse = m.parsePoiImportFile({ format: 'csv', bytes: await readBytes(file), defaultLang });
      expect(`C ${file}`, () => assert.equal(parse.encoding, encoding));
      names.push(parse.rows[0]?.name?.[defaultLang]);
      rows.push(`<tr><td>${esc(file)}</td><td>${esc(parse.encoding)}</td><td>${esc(parse.rows[0]?.name?.[defaultLang])}</td></tr>`);
    }
    expect('C 同一', () => assert.deepEqual(names, ['日本橋', '日本橋', '日本橋']));
    const mojibake = new TextDecoder('utf-8').decode(await readBytes('names-sjis.csv')).split('\n')[1];
    expect('C 対比', () => assert.ok(mojibake.includes('�')));
    const utf16 = m.parsePoiImportFile({ format: 'csv', bytes: Uint8Array.of(0xff, 0xfe, 0x69, 0x00), defaultLang });
    expect('C UTF-16', () => assert.equal(utf16.issues[0].code, 'encoding-unsupported'));
    cases.push(`<section data-demo-case="C"><h2>デモ C: 文字コード</h2>
      <p>3 つのファイルとも名前は「日本橋」で同じです。違うのは判定された文字コードだけです。</p>
      <table><thead><tr><th>ファイル</th><th>判定</th><th>name</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <p>対比: Shift_JIS のファイルを UTF-8 として読むと置換文字になります → <code>${esc(mojibake)}</code></p>
      <p>UTF-16 の CSV は「未対応」と案内されます（${esc(utf16.issues[0].code)}）。</p></section>`);
  }

  // --- E: 書き出しと往復 ---
  {
    const internal = m.normalizePoiSourceCollection(await readJson('roundtrip-source.json'), defaultLang);
    const exported = m.toExportForm(internal, 'src', { ja: 't' }, { roundCoordinates: true, defaultLang });
    const csv = m.buildPoiCsv(exported);
    const expectedCsv = await readFile(path.join(fixtureDir, 'expected-export.csv'));
    expect('E 書き出し', () => assert.equal(Buffer.compare(Buffer.from(csv.bytes), expectedCsv), 0));
    const csvText = new TextDecoder().decode(csv.bytes.subarray(3));
    const run = (text) => {
      const parse = m.parsePoiImportFile({ format: 'csv', bytes: new TextEncoder().encode(text), defaultLang });
      return m.planPoiMerge({ existing: internal.features, rows: parse.rows, mode: 'overwrite', defaultLang });
    };
    const same = run(csvText);
    expect('E 往復', () => { assert.equal(same.summary.unchanged, 5); assert.equal(same.summary.updated, 0); same.features.forEach((f, i) => assert.equal(f, internal.features[i])); });
    const changed = run(csvText.replace('https://example.com/3.jpg', 'https://example.com/3b.jpg'));
    expect('E 陰性対照', () => { assert.equal(changed.summary.updated, 1); assert.equal(changed.features[2].properties.image, 'https://example.com/3b.jpg'); });
    cases.push(`<section data-demo-case="E"><h2>デモ E: 書き出しと往復</h2>
      <p>CSV に書き出して同じソースへ上書きで取り込むと、<b>更新 ${same.summary.updated}・変更なし ${same.summary.unchanged}</b> です。9 桁の座標・資産の画像・{src, alt}・html・独自の項目は損なわれません。</p>
      <pre>${esc(csvText)}</pre>
      <p>陰性対照: r-3 の URL だけを書き換えた CSV を取り込むと、更新 ${changed.summary.updated}・変更なし ${changed.summary.unchanged}（r-3 の image だけが更新）。</p></section>`);
  }

  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>POI 一括入出力のデモ</title>
<style>body{font:14px/1.6 system-ui,sans-serif;margin:24px;max-width:1200px}table{border-collapse:collapse;margin:6px 0}td,th{border:1px solid #bbb;padding:2px 8px;text-align:left}pre{background:#f4f4f4;padding:8px;overflow:auto}section{margin-bottom:36px}.cols{display:flex;gap:24px;flex-wrap:wrap}h2{border-bottom:2px solid #444}</style></head>
<body><h1>POI 一括入出力のデモ</h1>${cases.join('\n')}</body></html>
`;
  await writeFile(path.join(outDir, 'poi-io-demo.html'), html);
  if (failures.length > 0) {
    console.error('デモの期待値と合いません:\n' + failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
  console.log(`poi-io demo: ${cases.length} cases -> ${path.join(outDir, 'poi-io-demo.html')}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
