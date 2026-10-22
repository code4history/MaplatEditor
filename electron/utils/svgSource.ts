// SVG を「取り込んでよい画像」として確かめる純関数群（nov26-editor-splash-svg #462）。
//
// なぜ要るか:
//   スプラッシュは今まで `Jimp.read` で「デコードできるか」を確かめてから複製していた。
//   Jimp は SVG を読めないので、SVG を受け付けると**必ず InvalidImage になる**。
//   そこで SVG のときは「XML として読める・ルートが `<svg>`・大きさ（width/height か viewBox）がある」
//   を確かめ、通ったものだけを `{uuid}.svg` で img/ へ複製する（壊れたものは今と同じ InvalidImage）。
//
// なぜ実 XML パーサを足さないか:
//   依存を増やさない（install しない）方針の下で、SVG の受け入れ判定に必要な範囲だけを見る。
//   ここは**厳密な XML の検証ではなく**「壊れた SVG を通さない」ための構文走査である:
//   要素の対応・属性の書式・重複属性・エスケープされていない `&`・コメント/CDATA/PI/DOCTYPE の
//   閉じを確かめる。
//
// 【NOV26-SR-M12-C1-0465 SR-C1-M-1】書き出したサイトには SVG がそのまま置かれ、閲覧者が SVG の
// URL を直接開くとサイトの origin でスクリプトが動く余地がある。字面だけを見る検査では
// 「文字参照で書いた javascript:」「XHTML 名前空間の要素」「DTD の内部実体」がすり抜けるため、
// 値のデコード後の判定・名前空間の解決後の許可リスト・実体の宣言の拒否を足した。
//
// 【NOV26-IM-M12-SVG-HARDEN-0479】レビュー（Major 3・Minor 1）を受けて、字面の取り違えで
// すり抜けられる 4 つの経路を塞いだ: SMIL の属性を名前空間なしの完全一致の名前で引くこと・
// DOCTYPE の内部サブセットをまるごと拒否すること・XML 宣言の encoding を UTF-8 に限ること・
// CSS のエスケープ（`\`）を拒否すること。
//
// 【NOV26-IM-M12-SVG-HARDEN-0480】レビュー（Major 2）を受けて 2 点を直した: 宣言の区切りは
// 引用符を見て決めること（`>` を引用符の中に書いて内部サブセットの `[` を隠せなくする。
// `<!DOCTYPE` はルートより前に 1 回だけ、それ以外の宣言は場所を問わず拒否）と、
// `image`・`feImage` の href／xlink:href に限って埋め込みのラスター画像（PNG/JPEG/GIF/WebP の
// base64）を通すこと（Illustrator・Inkscape は図をこの形で埋め込む）。
//
// electron に依存しない（node の smoke から直接読む）。

export type SvgMarkupCheck = { ok: true } | { ok: false; reason: string };

const INVALID = (reason: string): SvgMarkupCheck => ({ ok: false, reason });

/** 拡張子が svg か（先頭の `.` と大文字小文字は問わない） */
export function isSvgExt(ext: unknown): boolean {
  return typeof ext === 'string' && ext.replace(/^\./, '').trim().toLowerCase() === 'svg';
}

/** XML の名前（名前空間の接頭辞を含んでよい） */
const NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*/;
/** 宣言の中に実体の宣言があるか（内部サブセットは既に拒否しているので、二重の検査として残す） */
const ENTITY_DECLARATION = /<!\s*ENTITY/i;
/** 長さ（単位なし or px。`%` は固有の大きさにならないので大きさとして数えない） */
const LENGTH = /^([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)\s*(?:px)?$/;
const NUMBER = /^[+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?$/;

// 【NOV26-SR-M12-C1-0465 SR-C1-M-1】名前空間の許可リスト。
// スプラッシュは図柄だけでよいので、要素は SVG（と、名前空間を書いていない素の SVG）だけ、
// 属性は名前空間なし・XLink・XML だけを通す。
//
// 【NOV26-IM-M12-SVG-HARDEN-0478】要素は許可リストで見る（SVG 1.1／SVG 2 の図柄・構造・
// グラデーション・フィルタ・テキスト・アニメーションの要素だけ）。script・foreignObject・iframe・
// handler・listener などは入れない。加えて、Inkscape 1.x の既定保存（Inkscape SVG）が通るように、
// 図柄に効かないメタデータの名前空間（inkscape・sodipodi・RDF・Dublin Core・Creative Commons）だけは
// 要素も属性も許す（値は見ない）。子孫の要素・属性の名前空間の判定はそのまま行う。
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
const SODIPODI_NS = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const CC_NS = 'http://creativecommons.org/ns#';

/** 図柄に効かない無害なメタデータの名前空間（Inkscape の既定保存を通すため） */
const METADATA_NAMESPACES = new Set([INKSCAPE_NS, SODIPODI_NS, RDF_NS, DC_NS, CC_NS]);

/** 名前空間に関係なく受け付けない要素（SVG に無いもの・HTML を埋め込むもの） */
const FORBIDDEN_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'frame', 'frameset', 'embed', 'object', 'applet',
  'html', 'head', 'body', 'meta', 'link', 'base', 'form', 'input', 'button', 'textarea',
  'select', 'template', 'noscript', 'marquee',
]);

/**
 * SVG の名前空間（と名前空間なし）で許す要素。図柄・構造・グラデーション・フィルタ・テキスト・
 * アニメーションに必要なものだけで、`script`・`foreignObject`・`iframe` などは入れない。
 * 名前空間の判定は接頭辞を落とした局所名（小文字）で行う。
 */
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'desc', 'title', 'metadata', 'symbol', 'use', 'switch', 'view', 'a',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'image',
  'text', 'tspan', 'textpath', 'style',
  'clippath', 'mask', 'marker', 'pattern',
  'lineargradient', 'radialgradient', 'stop', 'filter',
  'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite', 'feconvolvematrix',
  'fediffuselighting', 'fedisplacementmap', 'fedistantlight', 'fedropshadow', 'feflood',
  'fefunca', 'fefuncb', 'fefuncg', 'fefuncr', 'fegaussianblur', 'feimage', 'femerge',
  'femergenode', 'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting',
  'fespotlight', 'fetile', 'feturbulence',
  'animate', 'animatemotion', 'animatetransform', 'animatecolor', 'set', 'discard', 'mpath',
]);

/** SMIL のアニメーションの要素（実行時に他の属性を書き換えられる） */
const SMIL_ELEMENTS = new Set(['animate', 'animatemotion', 'animatetransform', 'animatecolor', 'set', 'discard']);

/** 外部の資源を指せる属性（`data:` を拒否する対象） */
const REFERENCE_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'background', 'cite', 'longdesc']);

/**
 * 【NOV26-IM-M12-SVG-HARDEN-0480】埋め込みのラスター画像としてだけ通す `data:` の前置き。
 * `image`・`feImage` の href／xlink:href に限り、この前置きの後ろが base64 の文字と空白だけなら通す
 * （Illustrator・Inkscape は図を PNG などの base64 で埋め込む）。`data:image/svg+xml` は通さない。
 */
const EMBEDDED_RASTER_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/gif;base64,',
  'data:image/webp;base64,',
];

/** 埋め込み画像の本体として許す文字（base64 の文字と、行折り返しの空白） */
const EMBEDDED_RASTER_BODY = /^[A-Za-z0-9+/=\s]*$/;

/** 埋め込みのラスター画像を参照できる要素（どれも SVG の名前空間か名前空間なしで通ったもの） */
const EMBEDDED_RASTER_ELEMENTS = new Set(['image', 'feimage']);

/** XML の定義済み実体（これ以外の名前つき実体は受け付けない） */
const PREDEFINED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** 要素名から名前空間の接頭辞を落としたローカル名 */
const localName = (name: string): string => name.slice(name.indexOf(':') + 1).toLowerCase();

/** 要素名の名前空間の接頭辞（無ければ空文字） */
const prefixOf = (name: string): string => (name.includes(':') ? name.slice(0, name.indexOf(':')) : '');

/**
 * 属性値・本文の文字参照と定義済み実体をデコードする。
 * 定義済み 5 つと数値文字参照以外の実体参照（`&name;`）と、裸の `&` は `null`（壊れた XML か実体の持ち込み）。
 */
function decodeReferences(text: string): string | null {
  let out = '';
  let index = 0;
  for (;;) {
    const amp = text.indexOf('&', index);
    if (amp < 0) return out + text.slice(index);
    out += text.slice(index, amp);
    const semicolon = text.indexOf(';', amp);
    if (semicolon < 0) return null;
    const reference = text.slice(amp + 1, semicolon);
    let code: number | null = null;
    if (/^#[0-9]+$/.test(reference)) code = Number(reference.slice(1));
    else if (/^#x[0-9A-Fa-f]+$/.test(reference)) code = parseInt(reference.slice(2), 16);
    if (code !== null) {
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
      out += String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(PREDEFINED_ENTITIES, reference)) {
      out += PREDEFINED_ENTITIES[reference];
    } else {
      return null;
    }
    index = semicolon + 1;
  }
}

/**
 * 判定用の正規化。制御文字と空白を落として小文字にする
 * （`java&#9;script:` のように挟まれた文字を見逃さないため）。
 */
function normalizeValue(value: string): string {
  // `\p{Cc}` は制御文字（タブ・改行・NUL など）。空白と幅の無い文字も落とす
  return value.replace(/[\p{Cc}\s\u00ad\u200b-\u200f]/gu, '').toLowerCase();
}

/**
 * 【NOV26-IM-M12-SVG-HARDEN-0480】埋め込みのラスター画像として通せる `data:` か（デコード済みの値を渡す）。
 * 前置き（`data:image/png;base64,` など 4 つ）は正規化して比べるので、`data:i&#9;mage/png;base64,` の
 * ように文字を挟んだものも前置きとしては通し（挿入された文字は意味を持たない）、本体は base64 の
 * 文字（大文字小文字と `+` `/` `=` をそのまま）と空白だけを許す。base64 でない `data:` は通さない。
 */
function embeddedRasterAllowed(value: string): boolean {
  const normalized = normalizeValue(value);
  const prefix = EMBEDDED_RASTER_PREFIXES.find(candidate => normalized.startsWith(candidate));
  if (prefix === undefined) return false;
  // 本体は正規化すると小文字になり base64 の大文字小文字が潰れるので、元の値のまま見る
  // （前置きの分だけ「意味のある文字」を読み飛ばした残りが本体）
  let consumed = 0;
  let index = 0;
  for (; index < value.length && consumed < prefix.length; index += 1) {
    const char = value[index];
    if (normalizeValue(char) === '') continue;
    if (char.toLowerCase() !== prefix[consumed]) return false;
    consumed += 1;
  }
  if (consumed < prefix.length) return false;
  return EMBEDDED_RASTER_BODY.test(value.slice(index));
}

/**
 * アニメーションの値（`values` は `;` で分けた各値・`from`・`to`・`by`）に、
 * 属性と同じ scheme の判定をかける（デコード・正規化済みの値を見る）。
 * 【NOV26-IM-M12-SVG-HARDEN-0478】SMIL は属性の値を書き換えるので、
 * 属性そのものを検査するだけでは `values="0;javascript:..."` がすり抜ける。
 */
function animationValueViolation(value: string): string | null {
  const normalized = normalizeValue(value);
  if (/^(?:javascript|vbscript):/.test(normalized)) return 'script scheme';
  if (normalized.startsWith('data:')) return 'data:';
  return null;
}

/**
 * `url(...)` の中身として許す文書内参照。`#` の後は XML の名前の形だけ
 * （引用符と空白を落としてから見る。大文字小文字は正規化で潰れているが、どちらも許す形なので影響しない）。
 */
const DOCUMENT_REFERENCE = /^#[A-Za-z_][\w.:-]*$/;

/**
 * CSS の中の `url(...)` をすべて見て、**文書内の参照（`url(#id)`）だけ**を許す。
 * 【NOV26-IM-M12-SVG-HARDEN-0474】Illustrator は `<style>` の `.st0{fill:url(#SVGID_1_);}` で
 * グラデーションを参照するのが普通なので、`url(` の一律の拒否は取りやめた。外の資源
 * （http・data・相対パス）・空・関数の入れ子・CSS のエスケープ（`\23 ` など）は今までどおり拒否する。
 * 引数は正規化済み（空白と制御文字を落として小文字にしたもの）の CSS。
 */
function urlViolation(normalized: string): string | null {
  let index = 0;
  for (;;) {
    const start = normalized.indexOf('url(', index);
    if (start < 0) return null;
    // 対応する `)` まで数える（`url(var(--x))` のような入れ子も中身ごと見る）
    let depth = 1;
    let cursor = start + 4;
    for (; cursor < normalized.length; cursor += 1) {
      if (normalized[cursor] === '(') depth += 1;
      else if (normalized[cursor] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (cursor >= normalized.length) return 'url( is not closed';
    const target = normalized.slice(start + 4, cursor).replace(/["']/g, '');
    if (!DOCUMENT_REFERENCE.test(target)) return 'url( is not a document reference';
    index = cursor + 1;
  }
}

/** style 属性・`<style>` の中身として受け付けない書き方（デコード済みの値を渡す） */
function styleViolation(css: string): string | null {
  const normalized = normalizeValue(css);
  // 【NOV26-IM-M12-SVG-HARDEN-0479】CSS のエスケープ（`\`）は受け付けない。`@\69 mport`・`\75 rl(` の
  // ように、字面の一致で見ている `@import`・`url(` を書かずに同じ意味にできるため。
  // デコード（文字参照）の後の中身で見るので、`&#92;` で書いたものも同じように落ちる
  if (normalized.includes('\\')) return 'CSS escape';
  if (normalized.includes('javascript:')) return 'javascript:';
  if (normalized.includes('vbscript:')) return 'vbscript:';
  if (normalized.includes('expression(')) return 'expression(';
  if (normalized.includes('@import')) return '@import';
  // 【NOV26-IM-M12-SVG-HARDEN-0474】url( は一律には拒否しない（文書内参照だけを許す）
  const url = urlViolation(normalized);
  if (url !== null) return url;
  return null;
}

/**
 * XML 宣言（`<?xml` と `?>` の間）の encoding を返す。宣言に encoding が無ければ `null`。
 * 値は前後の空白を落として小文字にする（大文字小文字と前後の空白は問わない）。
 * 引用符で囲まれていない値は XML の宣言として不正なので、正規化せずそのまま返す
 * （`checkSvgMarkup` 側で `UTF-8` 以外として拒否される）。
 */
function xmlDeclarationEncoding(declaration: string): string | null {
  const match = /(?:^|\s)encoding\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(declaration);
  if (match === null) return null;
  if (match[3] !== undefined) return match[3];
  return (match[1] ?? match[2] ?? '').trim().toLowerCase();
}

/** 名前空間の文脈（接頭辞 → URI と既定の名前空間） */
type NamespaceScope = { prefixes: Map<string, string>; defaultNs: string | null };

/** `viewBox="minX minY width height"` が使える形か（width/height が正） */
function validViewBox(value: string): boolean {
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return false;
  if (!parts.every(part => NUMBER.test(part))) return false;
  return Number(parts[2]) > 0 && Number(parts[3]) > 0;
}

/** ルートの属性から「大きさがある」と言えるか */
function hasSize(attributes: Map<string, string>): boolean {
  const viewBox = attributes.get('viewBox');
  if (viewBox !== undefined && validViewBox(viewBox)) return true;
  const width = attributes.get('width');
  const height = attributes.get('height');
  if (width === undefined || height === undefined) return false;
  const w = LENGTH.exec(width.trim());
  const h = LENGTH.exec(height.trim());
  if (!w || !h) return false;
  return Number(w[1]) > 0 && Number(h[1]) > 0;
}

/**
 * SVG のテキストを確かめる。
 * 通る条件: 先頭以外に要素が無い・ルートが `svg`（接頭辞つき可）・要素が対応している・
 * 属性が引用符つきで重複が無い・ルートに width+height（px/単位なし）か viewBox がある・
 * DOCTYPE に内部サブセットが無い・XML 宣言の encoding が `UTF-8`（か未指定）・BOM が UTF-8 のもの 1 つ。
 */
export function checkSvgMarkup(text: string): SvgMarkupCheck {
  if (typeof text !== 'string') return INVALID('not text');
  // 【NOV26-IM-M12-SVG-HARDEN-0479】BOM は UTF-8 のもの（デコード後の U+FEFF）だけを 1 つ許す。
  // UTF-16 の BOM（FE FF・FF FE）は、読み違えると符号の並びが変わるので拒否する
  // （U+FFFE は UTF-16 の BOM を逆の符号で読んだもの）
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (source.charCodeAt(0) === 0xfeff || source.charCodeAt(0) === 0xfffe) {
    return INVALID('byte order mark not allowed');
  }
  if (source.trim().length === 0) return INVALID('empty');

  const stack: string[] = [];
  /** 要素ごとの名前空間の文脈（stack と同じ深さ） */
  const nsStack: NamespaceScope[] = [];
  /** 開いている `<style>` の中身（閉じたときに検査する） */
  const openStyles: { depth: number; text: string }[] = [];
  let rootName: string | null = null;
  let rootAttributes: Map<string, string> | null = null;
  let index = 0;
  let rootClosed = false;
  /** 【NOV26-IM-M12-SVG-HARDEN-0480】DOCTYPE は 1 回だけ通す */
  let sawDoctype = false;

  const skipWhitespace = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };

  /** 開いている `<style>` に本文を足す（CDATA・テキストノードの両方） */
  const collectStyleText = (chunk: string) => {
    const style = openStyles[openStyles.length - 1];
    if (style !== undefined && style.depth === stack.length) style.text += chunk;
  };

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    const textEnd = lt < 0 ? source.length : lt;
    const chunk = source.slice(index, textEnd);
    // 【SR-C1-M-1】定義済み 5 つと数値文字参照以外の実体参照（`&name;`）と裸の `&` は受け付けない
    const decodedChunk = decodeReferences(chunk);
    if (decodedChunk === null) return INVALID('unescaped & or undeclared entity');
    collectStyleText(decodedChunk);
    if (lt < 0) {
      index = source.length;
      break;
    }
    index = lt;

    // コメント
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end < 0) return INVALID('unterminated comment');
      index = end + 3;
      continue;
    }
    // CDATA（要素の中だけ）
    if (source.startsWith('<![CDATA[', index)) {
      if (stack.length === 0) return INVALID('cdata outside root');
      const end = source.indexOf(']]>', index + 9);
      if (end < 0) return INVALID('unterminated cdata');
      // `<style>` の中身は CDATA に書かれることが多い（中身も style として検査する）
      collectStyleText(source.slice(index + 9, end));
      index = end + 3;
      continue;
    }
    // 処理命令（`<?xml ... ?>` など）
    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index + 2);
      if (end < 0) return INVALID('unterminated processing instruction');
      // 【NOV26-IM-M12-SVG-HARDEN-0478】通すのは文書の先頭の XML 宣言だけ。
      // `<?xml-stylesheet ...?>` は後ろに続く要素の解釈（XSLT の適用など）を変えられるので拒否する
      const target = (source.slice(index + 2, end).match(/^[^\s?>]*/) ?? [''])[0];
      if (index !== 0 || !/^xml(?:\s|$)/.test(source.slice(index + 2, end))) {
        return INVALID(`processing instruction not allowed: ${target}`);
      }
      // 【NOV26-IM-M12-SVG-HARDEN-0479】宣言の encoding は書かないか `UTF-8` だけを許す。
      // バイト列は UTF-8 としてしか読まないので、他の encoding を名乗る文書は解釈が割れる
      // （ISO-2022-JP・Shift_JIS・UTF-16・`utf8` の綴り違いなど）
      const declaredEncoding = xmlDeclarationEncoding(source.slice(index + 5, end));
      if (declaredEncoding !== null && declaredEncoding !== 'utf-8') {
        return INVALID(`encoding not allowed: ${declaredEncoding}`);
      }
      index = end + 2;
      continue;
    }
    // 宣言（`<!` で始まるもの。コメントと CDATA は上で処理済み）
    // 【NOV26-IM-M12-SVG-HARDEN-0480】区切りは引用符を見て決める。以前は `<!` の後を引用符を見ずに
    // 最初の `>` で区切っていたため、`<!DOCTYPE svg SYSTEM "x>" [<!ATTLIST svg onload CDATA "..">]>`
    // のように `>` を引用符の中に書くと、内部サブセットの `[` を見ないまま素通りできた。
    // 通すのはルートより前の `<!DOCTYPE` 1 回だけで、`<!ATTLIST`・`<!ELEMENT`・`<!NOTATION`・
    // `<!ENTITY` などの宣言は、内部サブセットでなくてもルートの外でも、場所を問わず拒否する
    if (source.startsWith('<!', index)) {
      const head = (/^<![A-Za-z]*/.exec(source.slice(index)) ?? ['<!'])[0];
      const keyword = head.slice(2).toLowerCase();
      if (keyword !== 'doctype') return INVALID(`declaration not allowed: <!${keyword || ''}`);
      if (rootName !== null) return INVALID('DOCTYPE after root');
      if (sawDoctype) return INVALID('multiple DOCTYPE');
      sawDoctype = true;
      // 引用符（`"` と `'`）の中の `>` `[` は見ない。閉じない引用符は宣言が閉じないものとして拒否する
      let quote: string | null = null;
      let internalSubset = false;
      let end = -1;
      for (let cursor = index + 2; cursor < source.length; cursor += 1) {
        const char = source[cursor];
        if (quote !== null) {
          if (char === quote) quote = null;
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === '[') {
          internalSubset = true;
        } else if (char === '>') {
          end = cursor;
          break;
        }
      }
      if (end < 0) return INVALID('unterminated declaration');
      // 内部サブセット（`[ ... ]`）はまるごと拒否する。実体の宣言だけでなく ATTLIST の既定値
      // （`<!ATTLIST svg onload CDATA "x">`）でも、この検査が見ていない属性を補えるため。
      // 外部 ID だけの DOCTYPE（今までどおり）は通す
      if (internalSubset) return INVALID('internal subset in DOCTYPE');
      // 【SR-C1-M-1】念のため、実体の宣言そのものも拒否する（`&x;` で javascript: を持ち込める）
      if (ENTITY_DECLARATION.test(source.slice(index, end + 1))) return INVALID('entity declaration in DOCTYPE');
      index = end + 1;
      continue;
    }
    // 終了タグ
    if (source.startsWith('</', index)) {
      index += 2;
      skipWhitespace();
      const match = NAME.exec(source.slice(index));
      if (!match) return INVALID('bad end tag');
      const name = match[0];
      index += name.length;
      skipWhitespace();
      if (source[index] !== '>') return INVALID('bad end tag');
      index += 1;
      const open = stack.pop();
      if (open === undefined || open !== name) return INVALID(`mismatched </${name}>`);
      nsStack.pop();
      // `<style>` を閉じたところで中身を検査する
      const style = openStyles[openStyles.length - 1];
      if (style !== undefined && style.depth - 1 === stack.length) {
        openStyles.pop();
        const violation = styleViolation(style.text);
        if (violation !== null) return INVALID(`style content not allowed: ${violation}`);
      }
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    // 開始タグ
    index += 1;
    const nameMatch = NAME.exec(source.slice(index));
    if (!nameMatch) return INVALID('bad start tag');
    const name = nameMatch[0];
    // 【NOV26-IR-EDITOR-SPLASH-SVG-0464 MINOR-2】書き出したサイトで SVG を直接開くと、中の script がサイトと
    // 同じ origin で動く。スプラッシュは図柄だけでよいので、script と HTML を埋め込む要素は受け付けない
    // （【NOV26-SR-M12-C1-0465 SR-C1-M-1】名前空間に関係なく、SVG に無い要素と HTML を埋め込む要素まで塞ぐ）
    if (FORBIDDEN_ELEMENTS.has(localName(name))) return INVALID(`element not allowed: ${name}`);
    index += name.length;
    if (rootName === null) rootName = name;
    else if (rootClosed) return INVALID('multiple roots');

    const attributes = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      skipWhitespace();
      if (index >= source.length) return INVALID(`unterminated <${name}>`);
      if (source.startsWith('/>', index)) {
        index += 2;
        if (stack.length === 0) rootClosed = true;
        selfClosing = true;
        break;
      }
      if (source[index] === '>') {
        index += 1;
        break;
      }
      const attr = NAME.exec(source.slice(index));
      if (!attr) return INVALID(`bad attribute in <${name}>`);
      const attrName = attr[0];
      index += attrName.length;
      skipWhitespace();
      if (source[index] !== '=') return INVALID(`attribute without value: ${attrName}`);
      index += 1;
      skipWhitespace();
      const quote = source[index];
      if (quote !== '"' && quote !== "'") return INVALID(`unquoted attribute: ${attrName}`);
      index += 1;
      const valueEnd = source.indexOf(quote, index);
      if (valueEnd < 0) return INVALID(`unterminated attribute: ${attrName}`);
      const value = source.slice(index, valueEnd);
      if (value.includes('<')) return INVALID(`'<' in attribute: ${attrName}`);
      index = valueEnd + 1;
      if (attributes.has(attrName)) return INVALID(`duplicate attribute: ${attrName}`);

      // 【SR-C1-M-1】値は数値文字参照と定義済み 5 実体をデコードしてから判定する
      const decoded = decodeReferences(value);
      if (decoded === null) return INVALID(`unescaped & or undeclared entity in attribute: ${attrName}`);
      attributes.set(attrName, decoded);
    }

    // 【SR-C1-M-1】名前空間を解けるだけ解いてから、要素・属性の属する名前空間を許可リストで見る
    const parentScope = nsStack[nsStack.length - 1];
    const scope: NamespaceScope = {
      prefixes: new Map(parentScope ? parentScope.prefixes : []),
      defaultNs: parentScope ? parentScope.defaultNs : null,
    };
    for (const [attrName, attrValue] of attributes) {
      if (attrName === 'xmlns') scope.defaultNs = attrValue.trim() || null;
      else if (attrName.startsWith('xmlns:')) scope.prefixes.set(attrName.slice(6), attrValue.trim());
    }
    const resolvePrefix = (prefix: string): string | null | undefined => {
      if (prefix === 'xml') return XML_NS;
      if (prefix === 'xmlns') return undefined;
      const uri = scope.prefixes.get(prefix);
      return uri === undefined ? undefined : uri;
    };
    // 接頭辞の無い要素は既定の名前空間（宣言が無ければ「名前空間なし」= 素の SVG として扱う）
    const elementNs = prefixOf(name) === '' ? scope.defaultNs : resolvePrefix(prefixOf(name));
    if (elementNs === undefined) return INVALID(`undeclared namespace prefix: ${name}`);
    // 【NOV26-IM-M12-SVG-HARDEN-0478】メタデータの名前空間の要素だけは別扱い（図柄に効かない）。
    // それ以外は SVG（と名前空間なし）だけで、さらに許可リストの要素だけを通す
    const elementIsMetadata = elementNs !== null && METADATA_NAMESPACES.has(elementNs);
    if (elementNs !== null && elementNs !== SVG_NS && !elementIsMetadata) {
      return INVALID(`element namespace not allowed: ${name}`);
    }
    if (!elementIsMetadata && !ALLOWED_ELEMENTS.has(localName(name))) {
      return INVALID(`element not allowed: ${name}`);
    }

    for (const [attrName, attrValue] of attributes) {
      if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) continue;
      const prefix = prefixOf(attrName);
      const attrNs = prefix === '' ? null : resolvePrefix(prefix);
      if (attrNs === undefined) return INVALID(`undeclared namespace prefix: ${attrName}`);
      if (attrNs !== null && attrNs !== XLINK_NS && attrNs !== XML_NS && !METADATA_NAMESPACES.has(attrNs)) {
        return INVALID(`attribute namespace not allowed: ${attrName}`);
      }
      // 【NOV26-IM-M12-SVG-HARDEN-0478】メタデータの名前空間の属性は図柄に効かないので値を見ない
      if (attrNs !== null && METADATA_NAMESPACES.has(attrNs)) continue;

      const attrLocal = localName(attrName);
      // 【0464 MINOR-2】イベントの属性（onload 等）は受け付けない
      if (/^on/i.test(attrLocal)) return INVALID(`event attribute not allowed: ${attrName}`);
      // XHTML の iframe の中身を差し込む口（SVG には無い）
      if (attrLocal === 'srcdoc') return INVALID(`srcdoc not allowed: ${attrName}`);
      const normalized = normalizeValue(attrValue);
      // 【SR-C1-M-1】文字参照・制御文字・空白を挟んだ javascript: / vbscript: も参照しない
      if (/^(?:javascript|vbscript):/.test(normalized)) return INVALID(`script scheme not allowed: ${attrName}`);
      if (REFERENCE_ATTRIBUTES.has(attrLocal) && normalized.startsWith('data:')) {
        // 【NOV26-IM-M12-SVG-HARDEN-0480】埋め込みのラスター画像だけは、`image`・`feImage` の
        // href／xlink:href に限って通す（Illustrator・Inkscape の埋め込み画像がこの形）。
        // 他の要素（`a`・`use` 等）の `data:` と `data:image/svg+xml` は今までどおり拒否する
        const embeddedRaster = EMBEDDED_RASTER_ELEMENTS.has(localName(name))
          && attrLocal === 'href'
          && (attrNs === null || attrNs === XLINK_NS)
          && embeddedRasterAllowed(attrValue);
        if (!embeddedRaster) return INVALID(`data: not allowed: ${attrName}`);
      }
      // 【SR-C1-M-1】style 属性は expression(・javascript:・@import を受け付けない。
      // 【NOV26-IM-M12-SVG-HARDEN-0474】url( は文書内参照（`url(#id)`）だけを許す（イラレのグラデーション参照）
      if (attrLocal === 'style') {
        const violation = styleViolation(attrValue);
        if (violation !== null) return INVALID(`style not allowed: ${violation} in ${attrName}`);
      }
    }

    // 【NOV26-IM-M12-SVG-HARDEN-0478】SMIL のアニメーションは実行時に属性を書き換えられる。
    // attributeName が参照・style・イベントを指すものは拒否し、値にも scheme の判定をかける。
    if (SMIL_ELEMENTS.has(localName(name))) {
      // 【NOV26-IM-M12-SVG-HARDEN-0479】SMIL の属性は**名前空間なしの属性だけ**を完全一致の名前で引く。
      // 接頭辞を落とした局所名で最初の値を返していたため、`inkscape:attributeName="x"` を本物より前に
      // 置くと本物の `attributeName="href"` を見落とせた。同じ局所名の属性が名前空間違いで
      // 複数ある要素は、どれが本物か決められないので拒否する（正しい XML でも同じ名前は重ならない）
      const byLocal = new Map<string, number>();
      for (const attrName of attributes.keys()) {
        if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) continue;
        const local = localName(attrName);
        byLocal.set(local, (byLocal.get(local) ?? 0) + 1);
      }
      for (const [local, count] of byLocal) {
        if (count > 1) return INVALID(`ambiguous attribute in animation: ${local}`);
      }
      // xlink:href は接頭辞の綴りではなく名前空間で引く（接頭辞は任意）
      const xlinkHref = (): string | undefined => {
        for (const attrName of attributes.keys()) {
          if (prefixOf(attrName) === '' || localName(attrName) !== 'href') continue;
          if (resolvePrefix(prefixOf(attrName)) === XLINK_NS) return attributes.get(attrName);
        }
        return undefined;
      };
      const targetAttribute = attributes.get('attributeName');
      if (targetAttribute !== undefined) {
        // デコード後の値を接頭辞なしの局所名・小文字にしてから見る（`xlink:href` → `href`）
        const target = localName(targetAttribute.trim());
        if (
          target.startsWith('href') || target.startsWith('style') || target.startsWith('on')
          || REFERENCE_ATTRIBUTES.has(target)
        ) {
          return INVALID(`attributeName not allowed: ${targetAttribute}`);
        }
      }
      const animatedValues = attributes.get('values');
      if (animatedValues !== undefined) {
        // `values` は `;` で分けた各値をそれぞれ見る（`0;javascript:...` をすり抜けさせない）
        for (const part of animatedValues.split(';')) {
          const violation = animationValueViolation(part);
          if (violation !== null) return INVALID(`animation value not allowed: ${violation}`);
        }
      }
      // from・to・by と、アニメーションの対象を指す href（`mpath` の xlink:href を含む）
      const animatedAttributes: [string, string | undefined][] = [
        ['from', attributes.get('from')],
        ['to', attributes.get('to')],
        ['by', attributes.get('by')],
        ['href', attributes.get('href')],
        ['xlink:href', xlinkHref()],
      ];
      for (const [, value] of animatedAttributes) {
        if (value === undefined) continue;
        const violation = animationValueViolation(value);
        if (violation !== null) return INVALID(`animation value not allowed: ${violation}`);
      }
    }

    // ルートは SVG（または名前空間を書いていない素の SVG）の `svg` だけ
    if (rootAttributes === null && localName(name) === 'svg' && (elementNs === null || elementNs === SVG_NS)) {
      rootAttributes = attributes;
    }

    if (selfClosing) continue;
    stack.push(name);
    nsStack.push(scope);
    if (localName(name) === 'style') openStyles.push({ depth: stack.length, text: '' });
  }

  if (rootName === null) return INVALID('no root element');
  if (!rootClosed || stack.length > 0) return INVALID('unclosed element');
  if (localName(rootName) !== 'svg') return INVALID('root is not svg');
  if (!rootAttributes || !hasSize(rootAttributes)) return INVALID('no size');
  return { ok: true };
}

/** ファイルのバイト列を UTF-8 として読み、SVG として確かめる（文字コードが壊れていれば不可） */
export function checkSvgBytes(bytes: Uint8Array): SvgMarkupCheck {
  // 【NOV26-IM-M12-SVG-HARDEN-0479】UTF-16 の BOM（FE FF・FF FE）で始まるものは受け付けない
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) {
    return INVALID('utf-16 byte order mark');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return INVALID('not utf-8');
  }
  return checkSvgMarkup(text);
}
