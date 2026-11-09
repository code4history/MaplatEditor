// KML の事前走査の試験に使う入力の一覧 (poi-kml-smoke.mjs とその子プロセスが共有する)。
// reject: DOM を作る前に拒否されるべき入力 (期待する code)。pass: 事前走査を通るべき入力。
const MB = 1024 * 1024;
const fill = (unit, bytes) => unit.repeat(Math.max(1, Math.floor(bytes / unit.length)));
const wrap = (body) => '<kml><a>' + body + '</a></kml>';
const rep = (unit, count) => unit.repeat(count);

const placemark = (k, pretty) => {
  const nl = pretty ? '\n\t\t' : '';
  return `${nl}<Placemark id="p${k}">${nl}<name>n${k}</name>${nl}<description><![CDATA[<b>x</b><br>y]]></description>${nl}<styleUrl>#s</styleUrl>${nl}<ExtendedData>${nl}`
    + [1, 2, 3, 4, 5].map((d) => `<Data name="d${d}"><value>${d}</value></Data>`).join(nl)
    + `${nl}</ExtendedData>${nl}<Point><coordinates>139,35</coordinates></Point>${nl}</Placemark>`;
};

// My Maps 風の正常な KML (Placemark n 件。約 17 要素/件)
export const myMapsKml = (n, pretty) => '﻿<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">\n'
  + '<Document>\n<!-- generated -->'
  + Array.from({ length: n }, (_, k) => placemark(k, pretty)).join('')
  + '\n</Document>\n</kml>\n';

// QGIS 風: 属性ごとに SimpleData の 1 要素を出す (属性 attrs 個)
export const qgisKml = (n, attrs) => '<?xml version="1.0" encoding="utf-8" ?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document><Folder><name>L</name>\n'
  + '<Schema name="L" id="L">' + Array.from({ length: attrs }, (_, a) => `<SimpleField name="a${a}" type="string"></SimpleField>`).join('') + '</Schema>\n'
  + Array.from({ length: n }, (_, k) => `<Placemark><name>p${k}</name><ExtendedData><SchemaData schemaUrl="#L">`
    + Array.from({ length: attrs }, (_, a) => `<SimpleData name="a${a}">v</SimpleData>`).join('')
    + '</SchemaData></ExtendedData><Point><coordinates>139.1,35.1</coordinates></Point></Placemark>\n').join('')
  + '</Folder></Document></kml>\n';

export const GOOGLE_EARTH_KML = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2">\n'
  + '<kml:Document >\n\t<!-- <Placemark> を含むコメント -->\n'
  + '\t<Placemark id="a"><name >x</name><description><![CDATA[<!DOCTYPE html><img src="a.png"><p>t</p>]]></description>'
  + '<gx:Track><gx:coord>139 35 0</gx:coord></gx:Track><Point><coordinates>\n139.1,35.1,0\n</coordinates></Point></Placemark>\n'
  + '</kml:Document>\n</kml>\n';

const manyNamespaces = () => {
  let s = '<kml>';
  for (let d = 0; d < 62; d++) s += `<a${d} ` + Array.from({ length: 1000 }, (_, k) => `xmlns:p${d}_${k}="u${k}"`).join(' ') + '>';
  for (let d = 61; d >= 0; d--) s += `</a${d}>`;
  return s + '</kml>';
};

// [名前, 入力を作る関数, 期待する code (複数可)]
export const REJECT = [
  ['(a) 閉じない <a> 20 MiB', () => '<kml>' + fill('<a>', 20 * MB), ['kml-too-deep']],
  ['(b) 閉じない <b x="1"> 20 MiB', () => '<kml>' + fill('<b x="1">', 20 * MB), ['kml-too-deep']],
  ['(c) 深さ 65', () => '<a>'.repeat(65) + '</a>'.repeat(65), ['kml-too-deep']],
  ['(d) 要素 400,001 個', () => wrap(rep('<b/>', 399999)), ['kml-too-large']],
  ['(e) 迷い込んだ "< " 20 MiB', () => wrap(fill('< ', 20 * MB)), ['kml-not-xml']],
  ['(e) 迷い込んだ "< " 1.9 MiB', () => wrap(fill('< ', 1.9 * MB)), ['kml-not-xml']],
  ['(f) "<a" を並べて最後に ">" 0.5 MiB', () => wrap(fill('<a', 0.5 * MB) + '>'), ['kml-not-xml']],
  ['(f) "<a" を並べて最後に ">" 20 MiB', () => wrap(fill('<a', 20 * MB) + '>'), ['kml-not-xml']],
  ['(g) "<1" 20 MiB', () => wrap(fill('<1', 20 * MB)), ['kml-not-xml']],
  ['(h) 属性値の引用符の中に "<" 20 MiB', () => wrap('<b x="' + fill('<', 20 * MB) + '"/>'), ['kml-not-xml']],
  ['(i) "<a<a<a…" 20 MiB', () => wrap(fill('<a', 20 * MB)), ['kml-not-xml']],
  ['(j) "<!x" 20 MiB', () => wrap(fill('<!x', 20 * MB)), ['kml-not-xml']],
  ['(k) CDATA の閉じ忘れ 20 MiB', () => wrap('<![CDATA[' + fill('x', 20 * MB)), ['kml-not-xml']],
  ['(k) PI の閉じ忘れ 20 MiB', () => wrap('<?x ' + fill('x', 20 * MB)), ['kml-not-xml']],
  ['(k) コメントの閉じ忘れ 20 MiB', () => wrap('<!--' + fill('x', 20 * MB)), ['kml-not-xml']],
  ['(l) 20 MiB の長さの要素名', () => wrap('<' + fill('a', 20 * MB) + '/>'), ['kml-not-xml']],
  ['(m) <b/> を最上位に 25,000', () => rep('<b/>', 25000), ['kml-not-xml']],
  ['(m) <b/> を最上位に 100,000', () => rep('<b/>', 100000), ['kml-not-xml']],
  ['(m) <b/> を最上位に 499,000', () => rep('<b/>', 499000), ['kml-not-xml']],
  ['(m) <kml/><kml/>', () => '<kml/><kml/>', ['kml-not-xml']],
  ['(m) ルートの後に空白以外のテキスト 20 MiB', () => '<kml/>' + fill('x', 20 * MB), ['kml-not-xml']],
  ['(m) ルートの外のコメント 20 MiB', () => '<kml/>' + fill('<!---->', 20 * MB), ['kml-not-xml', 'kml-too-large']],
  ['(n) a<!----> 20 MiB', () => wrap(fill('a<!---->', 20 * MB)), ['kml-too-large']],
  ['(n) <?x?> 20 MiB', () => wrap(fill('<?x?>', 20 * MB)), ['kml-too-large']],
  ['(n) <!----> 20 MiB', () => wrap(fill('<!---->', 20 * MB)), ['kml-too-large']],
  ['(n) a<![CDATA[b]]> 20 MiB', () => wrap(fill('a<![CDATA[b]]>', 20 * MB)), ['kml-too-large']],
  ['(o) 値の無い属性 8 MiB', () => wrap('<b ' + fill('x ', 8 * MB) + '/>'), ['kml-not-xml']],
  ['(o) 値の無い属性 20 MiB', () => wrap('<b ' + fill('x ', 20 * MB) + '/>'), ['kml-not-xml']],
  ['(o) 引用符なしの属性値', () => wrap('<b ' + fill('a=1 ', 2 * MB) + '/>'), ['kml-not-xml']],
  ['(o) 同名の属性 700,000 個', () => wrap(rep('<b ' + rep('a="1" ', 10000) + '/>', 70)), ['kml-too-large']],
  ['(p) 64 KiB を超えるタグ', () => wrap('<b x="' + fill('a', 70000) + '"/>'), ['kml-not-xml']],
  ['QGIS 風 10,000 件 × 属性 40 (要素数の上限が先に当たる)', () => qgisKml(10000, 40), ['kml-too-large']],
  ['(q) 終了タグ "</a" + 空白 8 MiB + ">"', () => '<kml><a></a' + ' '.repeat(8 * MB) + '></kml>', ['kml-not-xml']],
];

export const PASS = [
  ['コメント内の < 20 MiB', () => wrap('<!--' + fill('<', 20 * MB) + '-->')],
  ['本文 &amp; 20 MiB', () => wrap(fill('&amp;', 20 * MB))],
  ['本文テキスト 20 MiB', () => wrap(fill('x', 20 * MB))],
  ['属性値 &amp; を詰めた 64 KiB 未満のタグ × 320', () => wrap(rep('<b x="' + rep('&amp;', 12000) + '"/>', 320))],
  ['64 KiB 未満の長い属性値のタグ × 340', () => wrap(rep('<b x="' + fill('a', 60000) + '"/>', 340))],
  ['コメント 199,999 個（テキストと交互）', () => wrap(rep('a<!---->', 199999))],
  ['CDATA 199,999 個（テキストと交互）', () => wrap(rep('a<![CDATA[b]]>', 199999))],
  ['PI 199,999 個', () => wrap(rep('<?x?>', 199999))],
  ['同名の属性 490,000 個', () => wrap(rep('<b ' + rep('a="1" ', 10000) + '/>', 49))],
  ['異なる属性 498,000 個（タグごとに 6,000 個）', () => wrap(Array.from({ length: 83 }, () => '<b ' + Array.from({ length: 6000 }, (_, k) => `a${k}="1"`).join(' ') + '/>').join(''))],
  ['深さ 62 に各 1,000 個の xmlns 宣言', manyNamespaces],
  ['深さ 62 の開閉を繰り返した約 396,000 要素', () => '<kml>' + rep('<a>'.repeat(62) + '</a>'.repeat(62), 6387) + '</kml>'],
  ['a<b/> × 398,000', () => wrap(rep('a<b/>', 398000))],
  ['平坦な 398,000 要素', () => wrap(rep('<b/>', 398000))],
  ['子ごとに xmlns を再宣言した 395,000 要素', () => wrap(rep('<c xmlns:p="u"/>', 395000))],
  ['終了タグの空白 60 KiB（上限直下）', () => '<kml><a></a' + ' '.repeat(60000) + '></kml>'],
  ['未定義の実体 &foo; 20 MiB', () => wrap(fill('&foo;', 20 * MB))],
];

// 正常な KML (取り込みの処理全体の時間と行数を確かめる)
export const NORMAL = [
  ['My Maps 風 20,000 件（整形なし・340,002 要素）', () => myMapsKml(20000, false), 20000],
  ['My Maps 風 20,000 件（タブ字下げ・BOM つき）', () => myMapsKml(20000, true), 20000],
];
