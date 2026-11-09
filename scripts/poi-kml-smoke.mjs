// KML の取り込み smoke (unit, vite ssr build)。
// 読み取る要素・取り込む形・取り込まない形・ExtendedData・HTML の説明・誤りの報告、
// 事前走査 (scanKmlShape) の構文と予算、悪意ある入力の拒否 (時間と RSS を実測) を検証する。
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { REJECT, PASS, NORMAL, PLACEMARK_ATTACKS, qgisKml, GOOGLE_EARTH_KML } from './lib/poiKmlInputs.mjs';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = path.join(projectRoot, 'tests/fixtures/poi-io');
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-kml-'));

try {
  const entry = path.join(workDir, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiKml.ts'))};`,
      `export { planPoiMerge } from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiMerge.ts'))};`,
    ].join('\n'),
  );
  await build({
    root: projectRoot, logLevel: 'error', configFile: false,
    build: { outDir: path.join(workDir, 'dist'), emptyOutDir: true, ssr: entry, rollupOptions: { output: { entryFileNames: 'bundle.mjs', format: 'es' } } },
    ssr: { noExternal: true },
  });
  const bundlePath = path.join(workDir, 'dist/bundle.mjs');
  const mod = await import(pathToFileURL(bundlePath).href);
  const { parsePoiKml, scanKmlShape, planPoiMerge } = mod;

  // xmldom は node_modules から注入する (src/ は xmldom を import しない)
  const xmldomIndex = createRequire(path.join(projectRoot, 'package.json')).resolve('@xmldom/xmldom');
  const { DOMParser } = createRequire(import.meta.url)(xmldomIndex);
  const noop = { warning() {}, error() {}, fatalError() {} };
  const createDocument = (text) => new DOMParser({ locator: {}, errorHandler: noop }).parseFromString(text, 'text/xml');
  const enc = (s) => new TextEncoder().encode(s);
  const parse = (input, defaultLang = 'ja') => parsePoiKml({ bytes: typeof input === 'string' ? enc(input) : input, defaultLang, createDocument });
  const keys = (r) => r.issues.map((i) => `${i.code}:${i.level}`);
  const codes = (r) => r.issues.map((i) => i.code);
  const NS = 'xmlns="http://www.opengis.net/kml/2.2"';
  const doc = (body, attrs = NS) => `<?xml version="1.0" encoding="UTF-8"?>\n<kml ${attrs}><Document>${body}</Document></kml>`;
  const point = (c) => `<Point><coordinates>${c}</coordinates></Point>`;
  const demoBytes = new Uint8Array(await readFile(path.join(fixtureDir, 'demo.kml')));

  // ---------- §8.4 のデモ D ----------
  {
    const r = parse(demoBytes);
    assert.equal(r.format, 'kml');
    assert.equal(r.encoding, 'utf-8');
    assert.equal(r.fatal, false);
    assert.equal(r.totalRecords, 5);
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].id, 'kml-1');
    assert.deepEqual(r.rows[0].name, { ja: '浅草寺', en: 'Sensoji' });
    assert.deepEqual(r.rows[0].desc, { ja: '本堂\n雷門から徒歩' });
    assert.deepEqual(r.rows[0].coordinates, [139.7967, 35.7148]);
    assert.equal(r.rows[1].id, '');
    assert.deepEqual(r.rows[1].name, { ja: '増上寺' });
    assert.deepEqual(r.rows[1].coordinates, [139.749, 35.6574]);
    assert.deepEqual(keys(r).sort(), [
      'coord-range:error',
      'kml-description-html-flattened:warning',
      'kml-non-point-skipped:warning',
      'kml-non-point-skipped:warning',
    ]);
    const swapped = r.issues.find((i) => i.code === 'coord-range');
    assert.equal(swapped.swapped, true, '経度と緯度の逆の Point は逆の印つき');
    assert.equal(r.issues.find((i) => i.code === 'kml-description-html-flattened').message, '1');
    assert.deepEqual(r.issues.filter((i) => i.code === 'kml-non-point-skipped').map((i) => i.value), ['LineString', 'Polygon']);
    // 行番号は xmldom の locator (Placemark の開始行。ファイルの 4・8・12 行目)
    assert.deepEqual([r.rows[0].line, r.rows[1].line, swapped.line], [4, 8, 12]);
    // 合流 (追記・既存なし) で 2 件
    const plan = planPoiMerge({ existing: [], rows: r.rows, mode: 'append', defaultLang: 'ja' });
    assert.equal(plan.features.length, 2);
    assert.equal(plan.features[1].id, 'p1', 'id の無い Placemark は採番');
    console.log('  case 1 (デモ D: 2 件・警告・逆の印・行番号): PASS');
  }

  // ---------- 名前空間 ----------
  {
    const body = (p) => `<${p}Placemark id="k1"><${p}name>浅草寺</${p}name><${p}description>説明</${p}description><${p}Point><${p}coordinates>139.1,35.1,0</${p}coordinates></${p}Point></${p}Placemark>`;
    const variants = {
      既定の名前空間: doc(body('')),
      'kml: 接頭辞': `<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document>${body('kml:')}</kml:Document></kml:kml>`,
      'KML 2.0 (別の名前空間)': `<kml xmlns="http://earth.google.com/kml/2.0"><Document>${body('')}</Document></kml>`,
      名前空間なし: `<kml><Document>${body('')}</Document></kml>`,
      'gx: 拡張が混じる': `<kml ${NS} xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><name>軌跡</name><gx:Track><gx:coord>139 35 0</gx:coord></gx:Track></Placemark>${body('')}</Document></kml>`,
    };
    const strip = (r) => r.rows.map((x) => ({ id: x.id, name: x.name, desc: x.desc, coordinates: x.coordinates }));
    const base = strip(parse(variants['既定の名前空間']));
    assert.deepEqual(base, [{ id: 'k1', name: { ja: '浅草寺' }, desc: { ja: '説明' }, coordinates: [139.1, 35.1] }]);
    for (const [label, text] of Object.entries(variants)) {
      const r = parse(text);
      assert.deepEqual(strip(r), base, label);
    }
    const gx = parse(variants['gx: 拡張が混じる']);
    assert.deepEqual(gx.issues.map((i) => `${i.code}:${i.value}`), ['kml-non-point-skipped:Track']);
    // どの深さの Placemark でも・Folder の名前は取り込まない
    const deep = parse(doc(`<Folder><name>フォルダ</name><Folder><name>入れ子</name><Placemark><name>深い</name>${point('1,2')}</Placemark></Folder></Folder>`));
    assert.deepEqual(deep.rows.map((x) => x.name), [{ ja: '深い' }]);
    console.log('  case 2 (名前空間・深さ・Folder): PASS');
  }

  // ---------- 取り込む形・取り込まない形 ----------
  {
    const r = parse(doc([
      `<Placemark><name>線</name><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>`,
      `<Placemark><name>環</name><LinearRing><coordinates>1,2 3,4 1,2</coordinates></LinearRing></Placemark>`,
      `<Placemark><name>多重</name><MultiGeometry>${point('1,2')}</MultiGeometry></Placemark>`,
      `<Placemark><name>モデル</name><Model><Location><longitude>1</longitude></Location></Model></Placemark>`,
      `<Placemark><name>ジオメトリなし</name></Placemark>`,
      `<Placemark><name>点</name>${point('139,35')}</Placemark>`,
      `<NetworkLink><name>リンク</name><Link><href>http://example.com/a.kml</href></Link></NetworkLink>`,
      `<GroundOverlay><name>重ね</name></GroundOverlay>`,
      `<Style id="s"><IconStyle><scale>1</scale></IconStyle></Style>`,
    ].join('')));
    assert.deepEqual(r.rows.map((x) => x.name), [{ ja: '点' }], 'MultiGeometry の中の Point は取り込まない');
    assert.equal(r.totalRecords, 6);
    const skipped = r.issues.filter((i) => i.code === 'kml-non-point-skipped');
    assert.deepEqual(skipped.map((i) => i.value), ['LineString', 'LinearRing', 'MultiGeometry', 'Model', 'none']);
    assert.deepEqual(skipped.map((i) => i.message), ['線', '環', '多重', 'モデル', 'ジオメトリなし']);
    assert.ok(skipped.every((i) => i.level === 'warning' && typeof i.row === 'number'));
    assert.deepEqual(codes(r).filter((c) => c !== 'kml-non-point-skipped'), [], 'NetworkLink・GroundOverlay・Style は読まず警告も出さない');
    console.log('  case 3 (取り込まない形・読まない要素): PASS');
  }

  // ---------- coordinates ----------
  {
    const t = (c) => parse(doc(`<Placemark><name>n</name>${point(c)}</Placemark>`));
    assert.deepEqual(t('139.5,35.5').rows[0].coordinates, [139.5, 35.5]);
    assert.deepEqual(t('139.5,35.5,120').rows[0].coordinates, [139.5, 35.5], '高度は捨てる');
    assert.deepEqual(t('\n  139.5,35.5,0\n  ').rows[0].coordinates, [139.5, 35.5], '前後の改行・空白');
    for (const bad of ['139.5,35.5 140.5,36.5', '139.5', 'abc', '', '1,2,3,4', ',']) {
      const r = t(bad);
      assert.deepEqual(r.rows, [], JSON.stringify(bad));
      assert.deepEqual(codes(r), ['kml-bad-coordinates'], JSON.stringify(bad));
      assert.equal(r.issues[0].level, 'error');
    }
    const noCoordinates = parse(doc('<Placemark><name>n</name><Point/></Placemark>'));
    assert.deepEqual(codes(noCoordinates), ['kml-bad-coordinates']);
    // 値の形は CSV と同じ検査 (共有の実装): 形式・範囲・逆の印
    assert.deepEqual(codes(t('1e2,35')), ['coord-format']);
    assert.deepEqual(codes(t('200,35')), ['coord-range']);
    assert.equal(t('35.7,139.8').issues[0].swapped, true);
    console.log('  case 4 (coordinates): PASS');
  }

  // ---------- id・name・description ----------
  {
    const r = parse(doc([
      `<Placemark id="ok-1"><name>\n  浅草寺 \n</name>${point('1,2')}</Placemark>`,
      `<Placemark id="a b"><name>空白の id</name>${point('1,2')}</Placemark>`,
      `<Placemark id="ok-1"><name>重複</name>${point('1,2')}</Placemark>`,
      `<Placemark><name>'=SUM(A1)</name><description>  　\n説明文\n  </description>${point('1,2')}</Placemark>`,
    ].join('')));
    assert.deepEqual(r.rows.map((x) => x.id), ['ok-1', '', '']);
    assert.deepEqual(r.rows[0].name, { ja: '浅草寺' }, '前後の空白・改行を除く');
    assert.deepEqual(r.rows[1].name, { ja: '空白の id' });
    assert.deepEqual(r.rows[2].name, { ja: "'=SUM(A1)" }, '先頭の \' は剥がさない (書き出しの無害化は掛かっていない)');
    assert.deepEqual(r.rows[2].desc, { ja: '説明文' });
    assert.deepEqual(keys(r).sort(), ['file-duplicate-id:error', 'kml-id-ignored:warning']);
    assert.ok(!codes(r).includes('quote-prefix-stripped'));
    assert.equal(r.issues.find((i) => i.code === 'kml-id-ignored').row, 2);
    // 既定言語を変えると name・desc の言語が変わる
    assert.deepEqual(parse(doc(`<Placemark><name>N</name>${point('1,2')}</Placemark>`), 'en').rows[0].name, { en: 'N' });
    console.log('  case 5 (id・name・description の整形): PASS');
  }

  // ---------- description の HTML ----------
  {
    const d = (cdata) => parse(doc(`<Placemark><name>n</name><description><![CDATA[${cdata}]]></description>${point('1,2')}</Placemark>`));
    assert.deepEqual(d('<b>本堂</b><br>雷門から徒歩').rows[0].desc, { ja: '本堂\n雷門から徒歩' });
    assert.deepEqual(d('<p>一</p><p>二</p>').rows[0].desc, { ja: '一\n二' });
    assert.deepEqual(d('<div>甲</div><div>乙</div>').rows[0].desc, { ja: '甲\n乙' });
    assert.deepEqual(d('<br/>a<BR />b').rows[0].desc, { ja: '\na\nb'.trim() });
    assert.deepEqual(d('<script>alert(1)</script><style>p{}</style>本文').rows[0].desc, { ja: '本文' });
    // 説明に入る名前つき文字参照と数値参照は戻す (&nbsp; が見えたまま残らない)
    assert.deepEqual(d('<p>A&nbsp;B &copy; &amp; &lt;x&gt; &quot;q&quot; &#65;&#x42; &yen;</p>').rows[0].desc, { ja: 'A B © & <x> "q" AB ¥' });
    // 平坦化の端の形: 単独の "<"・コメント・宣言・閉じない <script>
    assert.deepEqual(d('a < b <b>x</b>').rows[0].desc, { ja: 'a < b x' });
    assert.deepEqual(d('<!DOCTYPE html><!-- c --><p>x</p>').rows[0].desc, { ja: 'x' });
    assert.deepEqual(d('<script>alert(1)<p>t</p>').rows[0].desc, { ja: 'alert(1)t' });
    assert.deepEqual(d('<SCRIPT type="x">a</SCRIPT >b').rows[0].desc, { ja: 'b' });
    assert.deepEqual(d('1 < 2 > 0').rows[0].desc, { ja: '1 < 2 > 0' }, 'タグの無い説明は直さない');
    const flat = d('<b>x</b>');
    assert.deepEqual(codes(flat), ['kml-description-html-flattened']);
    assert.deepEqual(codes(d('<img src="a.png"><b>x</b>')).sort(), ['kml-description-html-flattened', 'kml-description-image-dropped']);
    assert.equal(d('<img src="a.png">').issues.find((i) => i.code === 'kml-description-image-dropped').row, 1);
    // タグの無い説明は直さない (警告なし)
    assert.deepEqual(codes(d('ただの文')), []);
    // 件数の警告は 1 件にまとめる
    const many = parse(doc(['a', 'b', 'c'].map((n) => `<Placemark><name>${n}</name><description><![CDATA[<b>x</b>]]></description>${point('1,2')}</Placemark>`).join('')));
    assert.deepEqual(many.issues.map((i) => `${i.code}:${i.message}`), ['kml-description-html-flattened:3']);
    // 未定義の実体: 名前などの値に &foo; が残れば警告 (HTML の説明の中身は対象外)
    const undef = parse(doc(`<Placemark><name>A&foo;B &bar;</name><description><![CDATA[<p>&nbsp;&foo;</p>]]></description>${point('1,2')}</Placemark>`));
    assert.deepEqual(undef.rows[0].name, { ja: 'A&foo;B &bar;' });
    assert.deepEqual(undef.issues.filter((i) => i.code === 'kml-undefined-entity').map((i) => i.message), ['1']);
    const htmlOnly = parse(doc(`<Placemark><name>n</name><description><![CDATA[<p>&foo; &nbsp;</p>]]></description>${point('1,2')}</Placemark>`));
    assert.ok(!codes(htmlOnly).includes('kml-undefined-entity'), 'HTML の説明の中身は対象外');
    assert.ok(!codes(parse(doc(`<Placemark><name>AT&amp;T</name>${point('1,2')}</Placemark>`))).includes('kml-undefined-entity'), '定義済みの実体は警告にならない');
    console.log('  case 6 (description の HTML・文字参照・未定義の実体): PASS');
  }

  // ---------- ExtendedData ----------
  {
    const ext = (inner, plain = '') => parse(doc(`<Placemark>${plain}<ExtendedData>${inner}</ExtendedData>${point('1,2')}</Placemark>`));
    const r1 = ext('<Data name="name:en"><value>Sensoji</value></Data><Data name="名称"><value>浅草寺</value></Data><Data name="description"><value>説明</value></Data><Data name="住所"><value>台東区</value></Data><Data name="画像"><value>https://example.com/a.jpg | ./b.png</value></Data>');
    assert.deepEqual(r1.rows[0].name, { en: 'Sensoji', ja: '浅草寺' });
    assert.deepEqual(r1.rows[0].desc, { ja: '説明' });
    assert.deepEqual(r1.rows[0].address, { ja: '台東区' });
    assert.deepEqual(r1.rows[0].image, ['https://example.com/a.jpg', './b.png']);
    assert.deepEqual(r1.issues, []);
    // QGIS 風: SchemaData/SimpleData
    const q = parse(doc(`<Folder><Placemark><name>p</name><ExtendedData><SchemaData schemaUrl="#L"><SimpleData name="desc">説明</SimpleData><SimpleData name="address">住所</SimpleData></SchemaData></ExtendedData>${point('1,2')}</Placemark></Folder>`));
    assert.deepEqual(q.rows[0].desc, { ja: '説明' });
    assert.deepEqual(q.rows[0].address, { ja: '住所' });
    // id・列の別名・NFKC
    const r2 = ext('<Data name="ＩＤ"><value>ext-1</value></Data>');
    assert.equal(r2.rows[0].id, 'ext-1');
    // lat・lng は無視 (警告も出さない)
    const r3 = ext('<Data name="lat"><value>10</value></Data><Data name="経度"><value>20</value></Data>', '<name>n</name>');
    assert.deepEqual(r3.rows[0].coordinates, [1, 2]);
    assert.deepEqual(r3.issues, []);
    // 認識しない名前は警告 ignored-columns (まとめて 1 件・重複なし)
    const r4 = ext('<Data name="foo"><value>1</value></Data><Data name="bar"><value>2</value></Data>', '<name>n</name>');
    const ign = r4.issues.filter((i) => i.code === 'ignored-columns');
    assert.equal(ign.length, 1);
    assert.deepEqual(ign[0].message.split(', ').sort(), ['bar', 'foo']);
    const r5 = parse(doc(['x', 'y'].map((n) => `<Placemark><name>${n}</name><ExtendedData><Data name="foo"><value>1</value></Data></ExtendedData>${point('1,2')}</Placemark>`).join('')));
    assert.equal(r5.issues.filter((i) => i.code === 'ignored-columns').length, 1);
    assert.equal(r5.issues.find((i) => i.code === 'ignored-columns').message, 'foo');
    // ピクセル座標の名前は取り込まず警告
    assert.ok(codes(ext('<Data name="x"><value>1</value></Data>', '<name>n</name>')).includes('pixel-coordinates-ignored'));
    // 素の要素と同じ列が重なれば素の要素を優先し警告
    const c = ext('<Data name="name"><value>拡張</value></Data><Data name="desc"><value>説明</value></Data>', '<name>素</name>');
    assert.deepEqual(c.rows[0].name, { ja: '素' });
    assert.deepEqual(c.rows[0].desc, { ja: '説明' });
    assert.deepEqual(c.issues.map((i) => `${i.code}:${i.level}`), ['kml-extended-data-conflict:warning']);
    // 前後の空白は除く。式の無害化の取り消しはしない
    assert.deepEqual(ext('<Data name="name"><value> \'=a </value></Data>').rows[0].name, { ja: "'=a" });
    console.log('  case 7 (ExtendedData): PASS');
  }

  // ---------- 文字コード・致命的な誤り ----------
  {
    const body = `<Placemark><name>n</name>${point('1,2')}</Placemark>`;
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(doc(body))]);
    assert.equal(parse(withBom).encoding, 'utf-8-bom');
    assert.equal(parse(doc(body)).encoding, 'utf-8');
    assert.equal(parse(withBom).fatal, false);
    for (const bytes of [new Uint8Array([0xff, 0xfe, 0x3c, 0x00]), new Uint8Array([0xfe, 0xff, 0x00, 0x3c]), new Uint8Array([0x3c, 0x6b, 0x6d, 0x6c, 0x3e, 0x93, 0xfa, 0x3c])]) {
      const r = parse(bytes);
      assert.equal(r.fatal, true);
      assert.deepEqual(codes(r), ['encoding-unsupported']);
      assert.equal(r.encoding, null);
    }
    assert.deepEqual(codes(parse(new Uint8Array([0x3c, 0x00, 0x6b]))), ['not-text']);
    // 壊れた XML
    for (const [label, text] of [
      ['閉じていないタグ', '<kml><Placemark><name>x</kml>'],
      ['CDATA なしの HTML', '<kml><Placemark><description><b>x</b><br>y</description></Placemark></kml>'],
      ['値の無い属性', '<kml><Placemark id><name>x</name></Placemark></kml>'],
      ['ルートが複数', '<kml/><kml/>'],
    ]) {
      const r = parse(text);
      assert.equal(r.fatal, true, label);
      assert.deepEqual(codes(r), ['kml-not-xml'], label);
      assert.deepEqual(r.rows, []);
      assert.ok(r.issues[0].message && /^[a-z-]+$/.test(r.issues[0].message), `${label}: 原因は固定の短い語 (${r.issues[0].message})`);
    }
    assert.deepEqual(codes(parse('<kml><Document/></kml>')), ['kml-no-placemarks']);
    assert.equal(parse('<kml><Document/></kml>').fatal, true);
    // DOCTYPE・ENTITY はプロローグだけを見る
    assert.deepEqual(codes(parse('<!DOCTYPE kml [<!ENTITY a "b">]><kml/>')), ['kml-doctype-forbidden']);
    assert.deepEqual(codes(parse('<?xml version="1.0"?><!ENTITY x "y"><kml/>')), ['kml-doctype-forbidden']);
    const cdataDoctype = parse(doc(`<Placemark><name>n</name><description><![CDATA[<!DOCTYPE html><p>x</p>]]></description>${point('1,2')}</Placemark>`));
    assert.equal(cdataDoctype.fatal, false, 'CDATA の中の <!DOCTYPE html> は拒否しない');
    // 上限
    const many = (n) => doc(Array.from({ length: n }, (_, k) => `<Placemark id="p${k}"><name>n</name>${point('1,2')}</Placemark>`).join(''));
    const over = parse(many(20001));
    assert.equal(over.fatal, true);
    assert.deepEqual(codes(over), ['too-many-rows']);
    assert.equal(parse(many(20000)).rows.length, 20000);
    // セルの大きさ
    const bigName = parse(doc(`<Placemark><name>${'あ'.repeat(1024 * 1024 + 1)}</name>${point('1,2')}</Placemark><Placemark><name>ok</name>${point('1,2')}</Placemark>`));
    assert.deepEqual(codes(bigName), ['cell-too-large']);
    assert.equal(bigName.rows.length, 1);
    console.log('  case 8 (文字コード・壊れた XML・DOCTYPE・上限): PASS');
  }

  // ---------- 事前走査 (scanKmlShape) の単体 ----------
  {
    const ok = (text, lim) => scanKmlShape(text, lim);
    assert.equal(ok('<kml><a/></kml>').ok, true);
    assert.equal(ok('﻿<?xml version="1.0"?>\n<kml>\n</kml>\n').ok, true, 'BOM・プロローグ・ルートの後の空白');
    assert.equal(ok('<kml><a x=\'1\' y = "2"/></kml>').ok, true);
    assert.equal(ok(GOOGLE_EARTH_KML).ok, true, 'Google Earth 風');
    assert.equal(ok(qgisKml(2, 3)).ok, true, 'QGIS 風');
    assert.equal(ok('<kml><b>x</b><br>y</kml>').ok, false);
    const code = (text, lim) => { const r = ok(text, lim); return r.ok ? 'ok' : r.code; };
    assert.equal(code('<kml>< </kml>'), 'kml-not-xml');
    assert.equal(code('<kml><a x="<"/></kml>'), 'kml-not-xml');
    assert.equal(code('<kml><!x></kml>'), 'kml-not-xml');
    assert.equal(code('<kml><a x/></kml>'), 'kml-not-xml');
    assert.equal(code('<kml><a x=1/></kml>'), 'kml-not-xml');
    assert.equal(code('<kml><a x="1"y="2"/></kml>'), 'kml-not-xml');
    assert.equal(code('<kml></kml x="1">'), 'kml-not-xml');
    assert.equal(code('<kml/>text'), 'kml-not-xml');
    assert.equal(code('<kml/><![CDATA[x]]>'), 'kml-not-xml');
    assert.equal(code('<kml></kml></kml>'), 'kml-not-xml');
    assert.equal(code(''), 'kml-not-xml');
    assert.equal(code('<kml>'), 'kml-not-xml');
    assert.equal(code('<kml><!-- x</kml>'), 'kml-not-xml');
    assert.equal(code('<!DOCTYPE kml><kml/>'), 'kml-doctype-forbidden');
    assert.equal(code('<kml><![CDATA[<!DOCTYPE x>]]></kml>'), 'ok');
    // 予算 (小さな上限に差し替えて境界を確かめる)
    const lim = { maxElements: 5, maxOtherNodes: 3, maxAttributes: 4, maxTagLength: 40, maxDepth: 3, maxName: 8 };
    assert.equal(code('<a><b/><c/><d/><e/></a>', lim), 'ok');
    assert.equal(code('<a><b/><c/><d/><e/><f/></a>', lim), 'kml-too-large');
    assert.equal(code('<a><!--1--><!--2--><!--3--></a>', lim), 'ok');
    assert.equal(code('<a><!--1--><!--2--><!--3--><!--4--></a>', lim), 'kml-too-large');
    assert.equal(code('<a x="1" y="2" z="3" w="4"/>', lim), 'ok');
    assert.equal(code('<a x="1"/><!-- -->', lim), 'ok', 'ルートの外のコメント 1 つは通る (氾濫は節点の予算で拒否)');
    assert.equal(code('<a><b x="1" y="2"/><c x="1" y="2" z="3"/></a>', lim), 'kml-too-large');
    assert.equal(code('<a><b><c></c></b></a>', lim), 'ok');
    assert.equal(code('<a><b><c><d></d></c></b></a>', lim), 'kml-too-deep');
    assert.equal(code('<a x="' + 'v'.repeat(60) + '"/>', lim), 'kml-not-xml');
    assert.equal(code('</a' + ' '.repeat(60) + '>', lim), 'kml-not-xml');
    assert.equal(code('<abcdefghi/>', lim), 'kml-not-xml');
    // 予算超えの理由 (利用者への案内に使う固定の語)
    assert.equal(ok('<a><b/><c/><d/><e/><f/></a>', lim).detail, 'elements');
    assert.equal(ok('<a><!--1--><!--2--><!--3--><!--4--></a>', lim).detail, 'nodes');
    assert.equal(ok('<a><b x="1" y="2"/><c x="1" y="2" z="3"/></a>', lim).detail, 'attributes');
    console.log('  case 9 (scanKmlShape の構文と予算): PASS');
  }

  // ---------- 属性の多い QGIS 風: 要素数の上限が先に当たる (Minor-3) ----------
  {
    const small = parse(qgisKml(100, 40));
    assert.equal(small.fatal, false);
    assert.equal(small.rows.length, 100);
    assert.equal(small.issues.filter((i) => i.code === 'ignored-columns').length, 1, '属性の列は認識しなければ 1 件にまとめて警告');
    console.log('  case 10 (QGIS 風・属性が多い KML): PASS');
  }

  // ---------- 悪意ある入力・通るべき入力 (時間と RSS を実測) ----------
  {
    const childPath = path.join(projectRoot, 'scripts/lib/poiKmlChild.mjs');
    const run = (kind, index, timeoutMs = 120000) => {
      const p = spawnSync(process.execPath, [childPath, bundlePath, kind, String(index), xmldomIndex], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 });
      assert.equal(p.status, 0, `${kind}[${index}] の子プロセスが失敗または ${timeoutMs / 1000} 秒で打ち切り: ${p.stderr?.slice(0, 300)}`);
      return JSON.parse(p.stdout.trim().split('\n').pop());
    };
    const lines = [];
    REJECT.forEach(([name, , expected], i) => {
      const r = run('reject', i);
      lines.push(`reject  ${String(r.ms).padStart(5)} ms  +${String(r.deltaMb).padStart(4)} MB  ${r.code}  ${name}`);
      assert.equal(r.fatal, true, `${name}: 拒否されない`);
      assert.ok(expected.includes(r.code), `${name}: code ${r.code} (期待 ${expected})`);
      assert.ok(r.ms <= 2000, `${name}: ${r.ms} ms (2 秒以内)`);
      assert.ok(r.deltaMb < 200, `${name}: RSS +${r.deltaMb} MB (200 MB 未満)`);
      if (name.startsWith('QGIS')) assert.equal(r.detail, 'elements', '利用者への案内に使う理由は要素の数');
    });
    PASS.forEach(([name], i) => {
      const r = run('pass', i);
      lines.push(`pass    ${String(r.ms).padStart(5)} ms  +${String(r.deltaMb).padStart(4)} MB  ${r.code ?? '-'}  ${name}`);
      assert.ok(r.code === null || r.code === 'kml-no-placemarks', `${name}: 拒否された (${r.code})`);
      assert.ok(r.ms <= 10000, `${name}: ${r.ms} ms (10 秒以内)`);
      assert.ok(r.deltaMb < 1024, `${name}: RSS +${r.deltaMb} MB (1 GB 未満)`);
    });
    NORMAL.forEach(([name, , count], i) => {
      const r = run('normal', i);
      lines.push(`normal  ${String(r.ms).padStart(5)} ms  +${String(r.deltaMb).padStart(4)} MB  rows=${r.rows}  ${name}`);
      assert.equal(r.fatal, false, name);
      assert.equal(r.rows, count, name);
      assert.ok(r.ms <= 5000, `${name}: ${r.ms} ms (5 秒以内)`);
      assert.ok(r.deltaMb < 1024, `${name}: RSS +${r.deltaMb} MB`);
    });
    // description・ExtendedData の中身を攻める入力: 拒否されても通っても、処理全体が 2 秒以内 (二乗の処理が残っていれば 20 秒で打ち切って落とす)
    PLACEMARK_ATTACKS.forEach(([name], i) => {
      const r = run('attack', i, 20000);
      lines.push(`attack  ${String(r.ms).padStart(5)} ms  +${String(r.deltaMb).padStart(4)} MB  ${r.code ?? '-'}  ${name}`);
      assert.ok(r.ms <= 2000, `${name}: ${r.ms} ms (2 秒以内)`);
      assert.ok(r.deltaMb < 1024, `${name}: RSS +${r.deltaMb} MB (1 GB 未満)`);
    });
    await writeFile(path.join(workDir, 'measurements.txt'), lines.join('\n') + '\n');
    if (process.env.POI_KML_MEASUREMENTS) await writeFile(process.env.POI_KML_MEASUREMENTS, lines.join('\n') + '\n');
    console.log(`  case 11 (悪意ある入力 ${REJECT.length} 種・通る入力 ${PASS.length} 種・description などを攻める入力 ${PLACEMARK_ATTACKS.length} 種・正常 ${NORMAL.length} 種の時間と RSS): PASS`);
  }

  console.log('poi-kml smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
