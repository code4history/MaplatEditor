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
// electron に依存しない（node の smoke から直接読む）。

export type SvgMarkupCheck = { ok: true } | { ok: false; reason: string };

const INVALID = (reason: string): SvgMarkupCheck => ({ ok: false, reason });

/** 拡張子が svg か（先頭の `.` と大文字小文字は問わない） */
export function isSvgExt(ext: unknown): boolean {
  return typeof ext === 'string' && ext.replace(/^\./, '').trim().toLowerCase() === 'svg';
}

/** XML の名前（名前空間の接頭辞を含んでよい） */
const NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*/;
/** DOCTYPE の内部サブセットに実体の宣言があるか */
const ENTITY_DECLARATION = /<!\s*ENTITY/i;
/** 長さ（単位なし or px。`%` は固有の大きさにならないので大きさとして数えない） */
const LENGTH = /^([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)\s*(?:px)?$/;
const NUMBER = /^[+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?$/;

// 【NOV26-SR-M12-C1-0465 SR-C1-M-1】名前空間の許可リスト。
// スプラッシュは図柄だけでよいので、要素は SVG（と、名前空間を書いていない素の SVG）だけ、
// 属性は名前空間なし・XLink・XML だけを通す。メタデータ（RDF・DC・sodipodi・i: 等）は図柄に
// 不要なので、確実を期して拒否する。
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** 名前空間に関係なく受け付けない要素（SVG に無いもの・HTML を埋め込むもの） */
const FORBIDDEN_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'frame', 'frameset', 'embed', 'object', 'applet',
  'html', 'head', 'body', 'meta', 'link', 'base', 'form', 'input', 'button', 'textarea',
  'select', 'template', 'noscript', 'marquee',
]);

/** 外部の資源を指せる属性（`data:` を拒否する対象） */
const REFERENCE_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'background', 'cite', 'longdesc']);

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

/** style 属性・`<style>` の中身として受け付けない書き方（デコード済みの値を渡す） */
function styleViolation(css: string): string | null {
  const normalized = normalizeValue(css);
  if (normalized.includes('javascript:')) return 'javascript:';
  if (normalized.includes('vbscript:')) return 'vbscript:';
  if (normalized.includes('expression(')) return 'expression(';
  if (normalized.includes('@import')) return '@import';
  if (normalized.includes('url(')) return 'url(';
  return null;
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
 * 属性が引用符つきで重複が無い・ルートに width+height（px/単位なし）か viewBox がある。
 */
export function checkSvgMarkup(text: string): SvgMarkupCheck {
  if (typeof text !== 'string') return INVALID('not text');
  // BOM は XML で許される
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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
      // 【SR-C1-M-1】内部サブセットの実体の宣言は受け付けない（`&x;` で javascript: を持ち込める）。
      // DOCTYPE そのもの（外部 ID だけ・実体の宣言が無い内部サブセット）は今までどおり通す
      if (ENTITY_DECLARATION.test(source.slice(index, cursor + 1))) return INVALID('entity declaration in DOCTYPE');
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
      const attrLocal = localName(attrName);
      // 【0464 MINOR-2】イベントの属性（onload 等）は受け付けない
      if (/^on/i.test(attrLocal)) return INVALID(`event attribute not allowed: ${attrName}`);
      // XHTML の iframe の中身を差し込む口（SVG には無い）
      if (attrLocal === 'srcdoc') return INVALID(`srcdoc not allowed: ${attrName}`);
      const normalized = normalizeValue(decoded);
      // 【SR-C1-M-1】文字参照・制御文字・空白を挟んだ javascript: / vbscript: も参照しない
      if (/^(?:javascript|vbscript):/.test(normalized)) return INVALID(`script scheme not allowed: ${attrName}`);
      if (REFERENCE_ATTRIBUTES.has(attrLocal) && normalized.startsWith('data:')) {
        return INVALID(`data: not allowed: ${attrName}`);
      }
      // 【SR-C1-M-1】style 属性は url(・expression(・javascript:・@import を受け付けない
      if (attrLocal === 'style') {
        const violation = styleViolation(decoded);
        if (violation !== null) return INVALID(`style not allowed: ${violation} in ${attrName}`);
      }
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
    if (elementNs !== null && elementNs !== SVG_NS) return INVALID(`element namespace not allowed: ${name}`);
    for (const attrName of attributes.keys()) {
      if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) continue;
      const prefix = prefixOf(attrName);
      if (prefix === '') continue;
      const attrNs = resolvePrefix(prefix);
      if (attrNs === undefined) return INVALID(`undeclared namespace prefix: ${attrName}`);
      if (attrNs !== XLINK_NS && attrNs !== XML_NS) return INVALID(`attribute namespace not allowed: ${attrName}`);
    }

    if (rootAttributes === null && localName(name) === 'svg') {
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
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return INVALID('not utf-8');
  }
  return checkSvgMarkup(text);
}
