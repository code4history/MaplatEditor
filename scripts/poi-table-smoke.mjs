// POI の CSV・JSON 書き出し smoke (unit, vite ssr build)
// 符号化の部品 (RFC 4180 の書き出し・式の無害化の全単射)、CSV の書き出し、JSON の書き出し、
// 往復、書き出しの IPC 本体 (形式の検査・保存先の扱い) を検証する。
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = path.join(projectRoot, 'tests/fixtures/poi-io');
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-table-'));
const outDir = path.join(workDir, 'dist');

try {
  // 書き出し側の部品を 1 つの ESM にまとめる (node 組み込みだけを外部にする)
  const entry = path.join(workDir, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiTableCodec.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiCsvExport.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'electron/services/PoiTableIoService.ts'))};`,
      `export { normalizePoiSourceCollection, toExportForm } from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiGeoJson.ts'))};`,
    ].join('\n'),
  );
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      ssr: entry,
      rollupOptions: { output: { entryFileNames: 'bundle.mjs', format: 'es' } },
    },
    ssr: { noExternal: true },
  });
  const mod = await import(pathToFileURL(path.join(outDir, 'bundle.mjs')).href);
  const {
    quotePoiCsvFormula, unquotePoiCsvFormula, serializeCsv, encodeCsvDocument, CSV_BOM,
    buildPoiCsv, buildPoiJson, formatPoiExport, exportPoiTable, isPoiExportFormat,
    normalizePoiSourceCollection, toExportForm,
    decodePoiCsvBytes, parseCsvRecords,
  } = mod;

  // 保存済みソースの書き出し形 (PoiSourceService.exportForm と同じ経路) を作る
  const exportFormOf = (json, slug = 'src') => {
    const fc = normalizePoiSourceCollection({ type: 'FeatureCollection', ...json }, json.lang ?? 'ja');
    return toExportForm(fc, slug, { ja: 'テスト' }, { roundCoordinates: true, defaultLang: fc.lang });
  };
  const source = JSON.parse(await readFile(path.join(fixtureDir, 'roundtrip-source.json'), 'utf8'));
  const fcExport = exportFormOf(source);

  // --- 1: 式の無害化 ---
  {
    const samples = [
      '=1+1', '+1', '-5 度', '@SUM(A1)', '\tx', '\rx', "'=1", "''=1", "'''-x", "'", "''", 'abc', '', ' =1',
      'a=1', "'a", '山王神社', '-', '=', "'\t",
    ];
    for (const s of samples) assert.equal(unquotePoiCsvFormula(quotePoiCsvFormula(s)), s, `全単射: ${JSON.stringify(s)}`);
    assert.equal(quotePoiCsvFormula('=1+1'), "'=1+1");
    assert.equal(quotePoiCsvFormula('-5 度'), "'-5 度");
    assert.equal(quotePoiCsvFormula("'=1"), "''=1");
    assert.equal(quotePoiCsvFormula('abc'), 'abc');
    assert.equal(quotePoiCsvFormula("'abc"), "'abc");
    assert.ok(samples.length >= 12);
    // 乱数 1,000 本 (記号に偏らせる)
    const alphabet = ["'", '=', '+', '-', '@', '\t', '\r', 'a', 'あ', ' ', ',', '"', '\n', '0'];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 1000; i++) {
      const len = Math.floor(rnd() * 8);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      assert.equal(unquotePoiCsvFormula(quotePoiCsvFormula(s)), s, `乱数: ${JSON.stringify(s)}`);
    }
    // 変異: 全単射を壊した対 (剥がす数が違う) では上の検査が落ちる
    const brokenUnquote = (s) => s.replace(/^'+(?=[=+\-@\t\r])/, '');
    const bijects = (q, u) => samples.every((s) => u(q(s)) === s);
    assert.equal(bijects(quotePoiCsvFormula, unquotePoiCsvFormula), true);
    assert.equal(bijects(quotePoiCsvFormula, brokenUnquote), false, '変異 (全部剥がす) を検出できない');
    assert.equal(bijects((s) => s, unquotePoiCsvFormula), false, '変異 (無害化しない) を検出できない');
    console.log('  case 1 (式の無害化の全単射): PASS');
  }

  // --- 2: RFC 4180 の書き出し ---
  {
    assert.equal(serializeCsv([['a', 'b'], ['1', '2']]), 'a,b\r\n1,2\r\n');
    assert.equal(serializeCsv([['a,b', 'c"d', 'e\nf', 'g\rh', 'i']]), '"a,b","c""d","e\nf","g\rh",i\r\n');
    assert.equal(serializeCsv([[' x', 'y ', 'z']]), '" x","y ",z\r\n');
    assert.equal(serializeCsv([['', 'x']]), ',x\r\n');
    const bytes = encodeCsvDocument([['あ']]);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.deepEqual([...CSV_BOM], [0xef, 0xbb, 0xbf]);
    assert.equal(Buffer.from(bytes.subarray(3)).toString('utf8'), 'あ\r\n');
    console.log('  case 2 (RFC 4180 の書き出し・BOM・CRLF): PASS');
  }

  // --- 3: CSV の書き出し (期待値は設計の全文を写した fixture) ---
  {
    const out = buildPoiCsv(fcExport);
    const expected = await readFile(path.join(fixtureDir, 'expected-export.csv'));
    assert.equal(Buffer.compare(Buffer.from(out.bytes), expected), 0, 'expected-export.csv と一致しない');
    assert.deepEqual([...out.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.deepEqual(out.omitted, {
      html: 1, url: 0, directgo: 0, icon: 0, selectedIcon: 0,
      otherProperties: 1, imageAssetRefs: 1, imageUnrepresentable: 0, iconAssetRefs: 0,
    });
    // r-2 の資産 UUID は CSV に出ない
    assert.ok(!Buffer.from(out.bytes).toString('utf8').includes('550e8400'));
    console.log('  case 3 (CSV の書き出しがバイト単位で一致): PASS');
  }

  // --- 4: 列の並び・言語つきの列 ---
  {
    const fc = exportFormOf({
      lang: 'ja',
      features: [
        { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [-139.5, -35.5] },
          properties: { name: { ja: 'あ', ko: '아', de: 'A' }, desc: { ja: 'せつ', fr: 'd' }, address: { es: 'dir' } } },
        { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [0.0000001, 0] },
          properties: { name: 'び' } },
      ],
    });
    const text = Buffer.from(buildPoiCsv(fc).bytes).toString('utf8').slice(1);
    const lines = text.split('\r\n');
    // 対応言語の定義順 (ja en de fr es ko …)、既定言語を除く。持つ言語だけ
    assert.equal(lines[0], 'id,name,name:de,name:ko,desc,desc:fr,address,address:es,image,lat,lng');
    assert.equal(lines[1], 'a,あ,A,아,せつ,d,,dir,,-35.5,-139.5');
    // lat・lng は無害化しない (負の数に ' を付けない)。指数表記にしない
    assert.equal(lines[2], 'b,び,,,,,,,,0,0.0000001');
    // 言語つきの列は既定言語が en のソースでも既定言語を除く
    const fcEn = exportFormOf({ lang: 'en', features: [
      { type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: { en: 'E', ja: 'J' } } },
    ] });
    const l0 = Buffer.from(buildPoiCsv(fcEn).bytes).toString('utf8').slice(1).split('\r\n');
    assert.equal(l0[0], 'id,name,name:ja,desc,address,image,lat,lng');
    assert.equal(l0[1], 'x,E,J,,,,2,1');
    console.log('  case 4 (列の並び・言語つきの列・座標): PASS');
  }

  // --- 5: image の扱いと省かれた項目 ---
  {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const mk = (id, props) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: id, ...props } });
    const fc = exportFormOf({ lang: 'ja', features: [
      mk('i1', { image: ['https://a/1.jpg', { src: './rel.png', alt: 'x' }] }),
      mk('i2', { image: 'https://a/b|c.jpg' }),
      mk('i3', { image: [uuid, uuid.toUpperCase()] }),
      mk('i4', { image: 'javascript:alert(1)' }),
      mk('i5', { icon: uuid, selectedIcon: { src: 'https://a/i.png' } }),
      mk('i6', { directgo: 'https://example.com/', url: 'https://example.com/u', memo: 1 }),
      mk('i7', { image: '=cmd' }),
    ] });
    const out = buildPoiCsv(fc);
    const lines = Buffer.from(out.bytes).toString('utf8').slice(1).split('\r\n');
    const imageCell = (n) => lines[n].split(',')[4];
    assert.equal(imageCell(1), 'https://a/1.jpg|./rel.png');
    assert.equal(imageCell(2), '', '| を含む URL は書かない');
    assert.equal(imageCell(3), '', '資産の UUID は書かない (大文字も)');
    assert.equal(imageCell(4), '', 'javascript: は書かない');
    assert.equal(imageCell(7), "'=cmd", '式の記号で始まる相対 URL は無害化する');
    assert.equal(out.omitted.imageAssetRefs, 1);
    assert.equal(out.omitted.imageUnrepresentable, 2);
    assert.equal(out.omitted.iconAssetRefs, 1);
    assert.equal(out.omitted.icon, 1);
    assert.equal(out.omitted.selectedIcon, 1);
    assert.equal(out.omitted.directgo, 1);
    assert.equal(out.omitted.url, 1);
    assert.equal(out.omitted.otherProperties, 1);
    console.log('  case 5 (image の扱い): PASS');
  }

  // --- 6: JSON の書き出し ---
  {
    const out = buildPoiJson(fcExport);
    const text = Buffer.from(out.bytes).toString('utf8');
    assert.notEqual(text.charCodeAt(0), 0xfeff, 'JSON に BOM を付けない');
    assert.ok(text.endsWith('}\n]\n'));
    assert.ok(text.startsWith('[\n  {\n    "id": "r-1"'));
    const expected = JSON.parse(await readFile(path.join(fixtureDir, 'expected-export.json'), 'utf8'));
    assert.deepEqual(JSON.parse(text), expected);
    assert.ok(!text.includes('_maplat'));
    assert.equal(out.omitted.imageAssetRefs, 1);
    assert.equal(out.omitted.iconAssetRefs, 0);
    // 往復: 既存の取り込み経路で読み戻せる (元と同じ lang を渡す)
    const back = normalizePoiSourceCollection(JSON.parse(text), 'ja');
    assert.equal(back.features.length, 5);
    assert.deepEqual(back.features.map((f) => f.id), ['r-1', 'r-2', 'r-3', 'r-4', 'r-5']);
    assert.deepEqual(back.features[0].geometry.coordinates, [139.1234568, 35.1234568]);
    const stripped = (f) => Object.fromEntries(Object.entries(f.properties).filter(([k]) => !k.startsWith('_maplat')));
    assert.deepEqual(stripped(back.features[0]), { name: { ja: '一', en: 'One' }, desc: { ja: '説明' }, image: 'https://example.com/1.jpg' });
    assert.deepEqual(stripped(back.features[1]).image, ['550e8400-e29b-41d4-a716-446655440000', 'https://example.com/2.jpg']);
    assert.deepEqual(stripped(back.features[2]).image, { src: 'https://example.com/3.jpg', alt: '三の写真' });
    assert.equal(stripped(back.features[3]).memo, 'm');
    assert.deepEqual(stripped(back.features[3]).html, { ja: '<p>x</p>' });
    console.log('  case 6 (JSON の書き出し・往復): PASS');
  }

  // --- 7: 書き出しの本体 (形式の検査・保存先は選択の返値だけ) ---
  {
    assert.equal(isPoiExportFormat('csv'), true);
    assert.equal(isPoiExportFormat('json'), true);
    for (const bad of ['xml', 'CSV', '', null, undefined, 1, {}]) assert.equal(isPoiExportFormat(bad), false);
    const written = [];
    const base = {
      uid: 'u1',
      loadFc: async () => fcExport,
      pickSavePath: async (s) => { written.push(['pick', s]); return path.join(workDir, `saved.${s.extension}`); },
    };
    const bad = await exportPoiTable({ ...base, format: 'xml' });
    assert.equal(bad.result, 'Error');
    assert.equal(written.length, 0, '不正な形式では保存ダイアログも開かない');
    const none = await exportPoiTable({ ...base, format: 'csv', loadFc: async () => null });
    assert.equal(none.result, 'Error');
    const cancel = await exportPoiTable({ ...base, format: 'csv', pickSavePath: async () => null });
    assert.deepEqual(cancel, { result: 'Canceled' });
    const ok = await exportPoiTable({ ...base, format: 'csv' });
    assert.equal(ok.result, 'Success');
    assert.equal(ok.filePath, path.join(workDir, 'saved.csv'));
    assert.equal(written[0][1].fileName, 'src.csv');
    assert.equal(Buffer.compare(await readFile(ok.filePath), await readFile(path.join(fixtureDir, 'expected-export.csv'))), 0);
    const okJson = await exportPoiTable({ ...base, format: 'json' });
    assert.equal(okJson.result, 'Success');
    assert.equal(written[1][1].fileName, 'src.json');
    assert.ok((await readFile(okJson.filePath, 'utf8')).startsWith('[\n'));
    const ioErr = await exportPoiTable({ ...base, format: 'csv', pickSavePath: async () => path.join(workDir, 'no-such-dir', 'x.csv') });
    assert.equal(ioErr.result, 'Error');
    assert.equal(typeof formatPoiExport, 'function');
    console.log('  case 7 (書き出しの本体): PASS');
  }

  // --- 8: 文字コードの判定 (復号) ---
  {
    const enc = (s) => new TextEncoder().encode(s);
    const bom = Uint8Array.of(0xef, 0xbb, 0xbf);
    const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
    const bomUtf8 = decodePoiCsvBytes(cat(bom, enc('id,name\r\nあ,日本橋')));
    assert.deepEqual(bomUtf8, { ok: true, text: 'id,name\r\nあ,日本橋', encoding: 'utf-8-bom' });
    const utf8 = decodePoiCsvBytes(enc('id,name\r\nあ,日本橋'));
    assert.deepEqual(utf8, { ok: true, text: 'id,name\r\nあ,日本橋', encoding: 'utf-8' });
    // Shift_JIS (Windows-31J): 日本橋 = 93FA 967B 8B91
    const sjis = decodePoiCsvBytes(cat(enc('j-1,'), Uint8Array.of(0x93, 0xfa, 0x96, 0x7b, 0x8b, 0x91)));
    assert.deepEqual(sjis, { ok: true, text: 'j-1,日本橋', encoding: 'shift_jis' });
    // 実ファイル (fixture) の 3 形式は同じ名前になる
    for (const [file, encoding] of [['names-utf8bom.csv', 'utf-8-bom'], ['names-utf8.csv', 'utf-8'], ['names-sjis.csv', 'shift_jis']]) {
      const got = decodePoiCsvBytes(new Uint8Array(await readFile(path.join(fixtureDir, file))));
      assert.equal(got.ok, true, file);
      assert.equal(got.encoding, encoding, file);
      assert.ok(got.text.includes('j-1,日本橋,35.6840,139.7745'), file);
      assert.ok(!got.text.startsWith('\ufeff'), file + ' の BOM を除く');
    }
    // UTF-16 は 12 月の対象外。NUL を含むが not-text ではなく encoding-unsupported
    assert.deepEqual(decodePoiCsvBytes(Uint8Array.of(0xff, 0xfe, 0x69, 0x00, 0x64, 0x00)), { ok: false, code: 'encoding-unsupported' });
    assert.deepEqual(decodePoiCsvBytes(Uint8Array.of(0xfe, 0xff, 0x00, 0x69, 0x00, 0x64)), { ok: false, code: 'encoding-unsupported' });
    // NUL を含めばバイナリ
    assert.deepEqual(decodePoiCsvBytes(enc('a,b\u0000c')), { ok: false, code: 'not-text' });
    assert.deepEqual(decodePoiCsvBytes(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00)), { ok: false, code: 'not-text' });
    // UTF-8 としても Shift_JIS としても読めない
    assert.deepEqual(decodePoiCsvBytes(Uint8Array.of(0xfd, 0xfe, 0xff, 0x41)), { ok: false, code: 'encoding-unsupported' });
    // 対比: Shift_JIS を UTF-8 として読むと置換文字になる (判定が UTF-8 を先に試す理由)
    assert.ok(new TextDecoder('utf-8').decode(Uint8Array.of(0x93, 0xfa, 0x96, 0x7b)).includes('\ufffd'));
    // 空のファイルは空の UTF-8
    assert.deepEqual(decodePoiCsvBytes(new Uint8Array(0)), { ok: true, text: '', encoding: 'utf-8' });
    console.log('  case 8 (文字コードの判定): PASS');
  }

  // --- 9: RFC 4180 の読み取り ---
  {
    const cells = (r) => r.records.map((x) => x.cells);
    const lines = (r) => r.records.map((x) => x.line);
    const ok = (text) => { const r = parseCsvRecords(text); assert.equal(r.ok, true, text); return r; };
    assert.deepEqual(cells(ok('a,b\r\n1,2\r\n')), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(cells(ok('a,b\n1,2')), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(cells(ok('a,b\r1,2\r')), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(cells(ok('a\r\nb\nc\rd')), [['a'], ['b'], ['c'], ['d']]);
    // 引用・"" ・セル内改行・区切り
    assert.deepEqual(cells(ok('"a,b","c""d","e\nf","g\r\nh",i\r\n')), [['a,b', 'c"d', 'e\nf', 'g\r\nh', 'i']]);
    assert.deepEqual(cells(ok('"",x,""\r\n')), [['', 'x', '']]);
    // 空行は飛ばす。行番号は物理行 (1 始まり・レコードの開始行)
    const r1 = ok('h1,h2\r\n\r\n1,2\r\n"x\ny",z\r\n3,4\r\n');
    assert.deepEqual(cells(r1), [['h1', 'h2'], ['1', '2'], ['x\ny', 'z'], ['3', '4']]);
    assert.deepEqual(lines(r1), [1, 3, 4, 6]);
    // 短い行・長い行はそのまま返す (検査は解析の側)
    assert.deepEqual(cells(ok('a,b,c\r\n1\r\n1,2,3,4\r\n')), [['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']]);
    // 末尾の空セルを保つ
    assert.deepEqual(cells(ok('a,b,\r\n,,\r\n')), [['a', 'b', ''], ['', '', '']]);
    // 引用符の中ではない位置の " は文字として残す
    assert.deepEqual(cells(ok('a"b,c\r\n')), [['a"b', 'c']]);
    // 閉じていない引用符
    const bad = parseCsvRecords('a,b\r\n1,"2\r\n3,4\r\n');
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'csv-unterminated-quote');
    assert.equal(bad.line, 2);
    // 空の文字列
    assert.deepEqual(ok('').records, []);
    assert.deepEqual(ok('\r\n\r\n').records, []);
    console.log('  case 9 (RFC 4180 の読み取り): PASS');
  }

  // --- 10: parse(encode(x)) の往復 ---
  {
    const rows = [
      ['id', 'name', 'desc'],
      ['a', 'x,y', 'q"uote'],
      ['b', 'line1\nline2', ' 前後 '],
      ['c', 'cr\rhere', 'crlf\r\nhere'],
      ['', 'e', ''],
      ['\u{1F600}', '日本語', '\t'],
    ];
    const back = parseCsvRecords(serializeCsv(rows));
    assert.equal(back.ok, true);
    assert.deepEqual(back.records.map((x) => x.cells), rows);
    // 乱数 300 本 (空行になる 1 セルだけの空の行を避ける)
    const alphabet = ['a', 'あ', ',', '"', '\n', '\r', ' ', '\t', "'", '=', '0'];
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 300; i++) {
      const width = 2 + Math.floor(rnd() * 3);
      const table = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => Array.from({ length: width }, () => {
        let t = '';
        for (let j = Math.floor(rnd() * 6); j > 0; j--) t += alphabet[Math.floor(rnd() * alphabet.length)];
        return t;
      }));
      const got = parseCsvRecords(serializeCsv(table));
      assert.equal(got.ok, true);
      assert.deepEqual(got.records.map((x) => x.cells), table, JSON.stringify(table));
    }
    // 書き出し (BOM つき) -> 復号 -> 読み取り
    const decoded = decodePoiCsvBytes(encodeCsvDocument(rows));
    assert.equal(decoded.encoding, 'utf-8-bom');
    assert.deepEqual(parseCsvRecords(decoded.text).records.map((x) => x.cells), rows);
    console.log('  case 10 (parse(encode(x)) の往復): PASS');
  }

  console.log('poi-table smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
