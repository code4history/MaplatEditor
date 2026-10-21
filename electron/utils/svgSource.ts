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
//   閉じを確かめる。セキュリティ上の扱い（`<img>` では script も外部参照も動かない）は表示側の責務。
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
/** 事前定義の実体参照・文字参照だけを許す（`&foo` のような裸の `&` は壊れた XML） */
const ENTITY = /^&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#x[0-9A-Fa-f]+);/;
/** 長さ（単位なし or px。`%` は固有の大きさにならないので大きさとして数えない） */
const LENGTH = /^([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)\s*(?:px)?$/;
const NUMBER = /^[+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?$/;

/** 要素名から名前空間の接頭辞を落としたローカル名 */
const localName = (name: string): string => name.slice(name.indexOf(':') + 1).toLowerCase();

/**
 * テキスト部分にエスケープされていない `&` が無いか。
 * （要素の外のテキストと、CDATA 以外のテキストノードにだけ効く）
 */
function textIsClean(text: string): boolean {
  let index = text.indexOf('&');
  while (index >= 0) {
    const rest = text.slice(index);
    if (!ENTITY.test(rest)) return false;
    index = text.indexOf('&', index + 1);
  }
  return true;
}

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
 * 属性が引用符つきで重複が無い・ルートに width+height（px/単位なし）か viewBox がある。
 */
export function checkSvgMarkup(text: string): SvgMarkupCheck {
  if (typeof text !== 'string') return INVALID('not text');
  // BOM は XML で許される
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (source.trim().length === 0) return INVALID('empty');

  const stack: string[] = [];
  let rootName: string | null = null;
  let rootAttributes: Map<string, string> | null = null;
  let index = 0;
  let rootClosed = false;

  const skipWhitespace = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    const textEnd = lt < 0 ? source.length : lt;
    const chunk = source.slice(index, textEnd);
    if (!textIsClean(chunk)) return INVALID('unescaped &');
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
      index = end + 3;
      continue;
    }
    // 処理命令（`<?xml ... ?>` など）
    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index + 2);
      if (end < 0) return INVALID('unterminated processing instruction');
      index = end + 2;
      continue;
    }
    // DOCTYPE（ルートより前だけ。`[ ... ]` の入れ子を許す）
    if (source.startsWith('<!', index)) {
      if (rootName !== null) return INVALID('declaration after root');
      let depth = 0;
      let cursor = index + 2;
      for (; cursor < source.length; cursor += 1) {
        const ch = source[cursor];
        if (ch === '[') depth += 1;
        else if (ch === ']') depth -= 1;
        else if (ch === '>' && depth <= 0) break;
      }
      if (cursor >= source.length) return INVALID('unterminated declaration');
      index = cursor + 1;
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
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    // 開始タグ
    index += 1;
    const nameMatch = NAME.exec(source.slice(index));
    if (!nameMatch) return INVALID('bad start tag');
    const name = nameMatch[0];
    // 【NOV26-IR-EDITOR-SPLASH-SVG-0464 MINOR-2】書き出したサイトで SVG を直接開くと、中の script がサイトと
    // 同じ origin で動く。スプラッシュは図柄だけでよいので、script と HTML を埋め込む foreignObject は受け付けない
    if (/^(script|foreignobject)$/i.test(localName(name))) return INVALID(`element not allowed: ${name}`);
    index += name.length;
    if (rootName === null) rootName = name;
    else if (rootClosed) return INVALID('multiple roots');

    const attributes = new Map<string, string>();
    for (;;) {
      skipWhitespace();
      if (index >= source.length) return INVALID(`unterminated <${name}>`);
      if (source.startsWith('/>', index)) {
        index += 2;
        if (stack.length === 0) rootClosed = true;
        break;
      }
      if (source[index] === '>') {
        index += 1;
        stack.push(name);
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
      if (!textIsClean(value)) return INVALID(`unescaped & in attribute: ${attrName}`);
      index = valueEnd + 1;
      if (attributes.has(attrName)) return INVALID(`duplicate attribute: ${attrName}`);
      // 【0464 MINOR-2】イベントの属性（onload 等）と javascript: の参照は受け付けない
      if (/^on/i.test(localName(attrName))) return INVALID(`event attribute not allowed: ${attrName}`);
      if (/^\s*javascript:/i.test(value)) return INVALID(`javascript: not allowed: ${attrName}`);
      attributes.set(attrName, value);
    }

    if (rootAttributes === null && localName(name) === 'svg') {
      rootAttributes = attributes;
    }
  }

  if (rootName === null) return INVALID('no root element');
  if (!rootClosed || stack.length > 0) return INVALID('unclosed element');
  if (localName(rootName) !== 'svg') return INVALID('root is not svg');
  if (!rootAttributes || !hasSize(rootAttributes)) return INVALID('no size');
  return { ok: true };
}

/** ファイルのバイト列を UTF-8 として読み、SVG として確かめる（文字コードが壊れていれば不可） */
export function checkSvgBytes(bytes: Uint8Array): SvgMarkupCheck {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return INVALID('not utf-8');
  }
  return checkSvgMarkup(text);
}
