// KML の取り込み: 事前走査 (scanKmlShape) と、Placemark (Point) から PoiImportRow への写し。
// DOM を使わない純関数 (web-safe)。DOM は createDocument を引数で受け取る。xmldom を import するのは
// main の PoiTableIoService だけで、この層は renderer のバンドルにも入りうるので import しない。
// 列の名前の解決 (別名表・正規化・言語つきの列) と行の値の検査 (座標・画像・id) は poiImportRows の
// 共有の実装を呼ぶ。ここには持たない。
import { DISPLAY_ID_PATTERN } from './poiGeoJson';
import { decodePoiUtf8Bytes } from './poiTableCodec';
import {
  ID_COLUMN,
  LAT_COLUMN,
  LNG_COLUMN,
  POI_IMPORT_MAX_ROWS,
  columnKey,
  isCoordinateColumn,
  mapCellsToImportRow,
  resolveColumnSpec,
  textColumn,
  type MappedCell,
  type PoiImportIssue,
  type PoiImportParseResult,
  type PoiImportRow,
} from './poiImportRows';

// ---------------------------------------------------------------------------
// 事前走査
// ---------------------------------------------------------------------------
// xmldom 0.8.15 は、閉じないネスト・迷い込んだ '<'・最上位の複数要素・コメント/PI/CDATA の氾濫・
// 値の無い属性の氾濫などで、長時間止まったり多くのメモリを使う。そこで DOM を作る前に、文字列に対する
// 1 回の線形の走査で「XML として不正な入力」と「節点・属性が予算を超える入力」を拒否する。
// (外部実体の対策ではない。実害のある脅威は大きな入力で main が止まること)

export interface KmlScanLimits {
  maxElements: number;
  maxOtherNodes: number;
  maxAttributes: number;
  maxTagLength: number;
  maxDepth: number;
  maxName: number;
}

export const KML_LIMITS: KmlScanLimits = {
  maxElements: 400000, // 開始タグ
  maxOtherNodes: 200000, // コメント・PI・CDATA 節
  maxAttributes: 500000, // 全属性の合計
  maxTagLength: 65536, // 1 つのタグ ('<' から '>' まで。開始タグ・終了タグとも)
  maxDepth: 64,
  maxName: 256,
};

export type KmlScanResult =
  | { ok: true; elements: number; others: number; attrs: number }
  | {
      ok: false;
      code: 'kml-not-xml' | 'kml-too-large' | 'kml-too-deep' | 'kml-doctype-forbidden';
      /** 利用者への案内に使う固定の短い語 (入力の内容は載せない) */
      detail?: string;
    };

const isNameStart = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58 || c >= 128;
const isNameChar = (c: number): boolean => isNameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46;
const isWs = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;

export function scanKmlShape(text: string, lim: KmlScanLimits = KML_LIMITS): KmlScanResult {
  const n = text.length;
  const bad = (code: 'kml-not-xml' | 'kml-too-large' | 'kml-too-deep' | 'kml-doctype-forbidden', detail?: string): KmlScanResult =>
    ({ ok: false, code, ...(detail ? { detail } : {}) });
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let depth = 0;
  let elements = 0;
  let others = 0;
  let attrs = 0;
  let inProlog = true;
  let rootClosed = false;

  while (i < n) {
    const lt = text.indexOf('<', i);
    const end = lt < 0 ? n : lt;
    if (depth === 0) {
      // ルートの外のテキストは空白だけ
      for (let k = i; k < end; k++) if (!isWs(text.charCodeAt(k))) return bad('kml-not-xml', 'outside-root');
    }
    if (lt < 0) break;
    if (lt + 1 >= n) return bad('kml-not-xml', 'stray-lt');
    const c1 = text.charCodeAt(lt + 1);

    if (c1 === 33) {
      // '<!'
      if (text.startsWith('<!--', lt)) {
        if (++others > lim.maxOtherNodes) return bad('kml-too-large', 'nodes');
        const e = text.indexOf('-->', lt + 4);
        if (e < 0) return bad('kml-not-xml', 'unclosed');
        i = e + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        if (depth === 0) return bad('kml-not-xml', 'outside-root');
        if (++others > lim.maxOtherNodes) return bad('kml-too-large', 'nodes');
        const e = text.indexOf(']]>', lt + 9);
        if (e < 0) return bad('kml-not-xml', 'unclosed');
        i = e + 3;
        continue;
      }
      if (inProlog && /^<!(DOCTYPE|ENTITY)/i.test(text.slice(lt, lt + 10))) return bad('kml-doctype-forbidden');
      return bad('kml-not-xml', 'declaration');
    }
    if (c1 === 63) {
      // '<?'
      if (++others > lim.maxOtherNodes) return bad('kml-too-large', 'nodes');
      const e = text.indexOf('?>', lt + 2);
      if (e < 0) return bad('kml-not-xml', 'unclosed');
      i = e + 2;
      continue;
    }

    const closing = c1 === 47;
    let j = lt + (closing ? 2 : 1);
    if (j >= n || !isNameStart(text.charCodeAt(j))) return bad('kml-not-xml', 'stray-lt');
    const nameStart = j;
    while (j < n && isNameChar(text.charCodeAt(j))) j++;
    if (j - nameStart > lim.maxName) return bad('kml-not-xml', 'long-name');
    const limitEnd = Math.min(n, lt + lim.maxTagLength);
    let selfClosing = false;

    if (closing) {
      while (j < limitEnd && isWs(text.charCodeAt(j))) j++;
      if (j >= limitEnd) return bad('kml-not-xml', 'tag-too-long');
      if (text.charCodeAt(j) !== 62) return bad('kml-not-xml', 'end-tag');
    } else {
      // 属性: 空白 名前 空白* = 空白* ("…"|'…') を繰り返し、'/>' か '>' で終わる
      for (;;) {
        if (j >= limitEnd) return bad('kml-not-xml', limitEnd - lt >= lim.maxTagLength ? 'tag-too-long' : 'unclosed');
        let c = text.charCodeAt(j);
        const hadWs = isWs(c);
        while (j < limitEnd && isWs(text.charCodeAt(j))) j++;
        c = text.charCodeAt(j);
        if (c === 62) break;
        if (c === 47) {
          if (text.charCodeAt(j + 1) !== 62) return bad('kml-not-xml', 'attribute');
          selfClosing = true;
          j++;
          break;
        }
        if (!hadWs || !isNameStart(c)) return bad('kml-not-xml', 'attribute');
        const attrStart = j;
        while (j < limitEnd && isNameChar(text.charCodeAt(j))) j++;
        if (j - attrStart > lim.maxName) return bad('kml-not-xml', 'long-name');
        while (j < limitEnd && isWs(text.charCodeAt(j))) j++;
        if (text.charCodeAt(j) !== 61) return bad('kml-not-xml', 'attribute');
        j++;
        while (j < limitEnd && isWs(text.charCodeAt(j))) j++;
        const quote = text.charCodeAt(j);
        if (quote !== 34 && quote !== 39) return bad('kml-not-xml', 'attribute');
        j++;
        for (; j < limitEnd; j++) {
          const v = text.charCodeAt(j);
          if (v === quote) break;
          if (v === 60) return bad('kml-not-xml', 'attribute-lt');
        }
        if (j >= limitEnd) return bad('kml-not-xml', limitEnd - lt >= lim.maxTagLength ? 'tag-too-long' : 'unclosed');
        j++;
        if (++attrs > lim.maxAttributes) return bad('kml-too-large', 'attributes');
      }
    }

    if (closing) {
      depth--;
    } else {
      if (rootClosed) return bad('kml-not-xml', 'multiple-roots');
      inProlog = false;
      elements++;
      if (!selfClosing) depth++;
      else if (depth === 0) rootClosed = true;
    }
    if (elements > lim.maxElements) return bad('kml-too-large', 'elements');
    if (depth > lim.maxDepth) return bad('kml-too-deep');
    if (depth < 0) return bad('kml-not-xml', 'unbalanced');
    if (closing && depth === 0) rootClosed = true;
    i = j + 1;
  }
  if (depth !== 0 || !rootClosed) return bad('kml-not-xml', 'unbalanced');
  return { ok: true, elements, others, attrs };
}

// ---------------------------------------------------------------------------
// DOM の最小の形 (xmldom の Document / Element のうち読むものだけ)
// ---------------------------------------------------------------------------
export interface KmlNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  textContent: string | null;
  childNodes: ArrayLike<KmlNode>;
  getAttribute?: (name: string) => string | null;
  /** xmldom の locator が付ける開始行 (1 始まり) */
  lineNumber?: number;
}
export interface KmlDocument {
  documentElement: KmlNode | null;
}

const ELEMENT_NODE = 1;
const GEOMETRY_NAMES = new Set(['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiGeometry', 'Track', 'MultiTrack', 'Model']);
const UNDEFINED_ENTITY = /&[A-Za-z_][\w.-]*;/;

function nameOf(node: KmlNode): string {
  if (node.localName) return node.localName;
  const colon = node.nodeName.indexOf(':');
  return colon >= 0 ? node.nodeName.slice(colon + 1) : node.nodeName;
}

function elementChildren(node: KmlNode): KmlNode[] {
  const out: KmlNode[] = [];
  for (let k = 0; k < node.childNodes.length; k++) {
    const child = node.childNodes[k];
    if (child.nodeType === ELEMENT_NODE) out.push(child);
  }
  return out;
}

function childElement(node: KmlNode, localName: string): KmlNode | null {
  for (const child of elementChildren(node)) if (nameOf(child) === localName) return child;
  return null;
}

// 文書内のすべての Placemark (どの深さでも。文書の順)
function collectPlacemarks(root: KmlNode): KmlNode[] {
  const out: KmlNode[] = [];
  const stack: KmlNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as KmlNode;
    if (nameOf(node) === 'Placemark') {
      out.push(node);
      continue;
    }
    const kids = elementChildren(node);
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return out;
}

// ExtendedData の (名前, 値) の組。<Data name><value> と <SimpleData name> (SchemaData の中を含む)
function extendedPairs(placemark: KmlNode): { name: string; value: string }[] {
  const pairs: { name: string; value: string }[] = [];
  const stack: KmlNode[] = [];
  for (const child of elementChildren(placemark)) if (nameOf(child) === 'ExtendedData') stack.push(child);
  while (stack.length > 0) {
    const node = stack.shift() as KmlNode;
    for (const child of elementChildren(node)) {
      const kind = nameOf(child);
      const name = child.getAttribute?.('name') ?? '';
      if (kind === 'Data' && name !== '') {
        const value = childElement(child, 'value');
        pairs.push({ name, value: (value?.textContent ?? '').trim() });
      } else if (kind === 'SimpleData' && name !== '') {
        pairs.push({ name, value: (child.textContent ?? '').trim() });
      } else {
        stack.push(child);
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// description の HTML を文字列に直す
// ---------------------------------------------------------------------------
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', copy: '©', reg: '®',
  trade: '™', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', times: '×', yen: '¥', euro: '€',
  middot: '·', bull: '•', deg: '°', plusmn: '±',
};
const HTML_TAG = /<\/?[A-Za-z][^>]*>/;

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z]+));/g, (whole, dec, hex, name) => {
    if (name) return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// <br>・</p>・</div> を改行にし、残りのタグを除き、文字参照を戻す。<script>・<style> は中身ごと除く
function flattenHtml(html: string): { text: string; hadImage: boolean } {
  const hadImage = /<img[\s/>]/i.test(html);
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return { text: decodeEntities(text).trim(), hadImage };
}

// 経度,緯度[,高度] を 1 組だけ読む。形が違えば null (高度は捨てる)
function splitPointCoordinates(text: string): { lng: string; lat: string } | null {
  const t = text.trim();
  if (t === '' || /\s/.test(t)) return null;
  const parts = t.split(',');
  if (parts.length < 2 || parts.length > 3 || parts[0] === '' || parts[1] === '') return null;
  return { lng: parts[0], lat: parts[1] };
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------
function fatalKml(
  encoding: 'utf-8' | 'utf-8-bom' | null,
  issues: PoiImportIssue[],
  totalRecords = 0,
): PoiImportParseResult {
  return { format: 'kml', encoding, columns: [], totalRecords, rows: [], issues, fatal: true };
}

export function parsePoiKml(args: {
  bytes: Uint8Array;
  defaultLang: string;
  createDocument: (text: string) => KmlDocument;
}): PoiImportParseResult {
  const { bytes, defaultLang, createDocument } = args;
  const decoded = decodePoiUtf8Bytes(bytes);
  if (!decoded.ok) return fatalKml(null, [{ level: 'error', code: decoded.code }]);
  const encoding = decoded.encoding;

  const shape = scanKmlShape(decoded.text);
  if (!shape.ok) {
    return fatalKml(encoding, [{ level: 'error', code: shape.code, ...(shape.detail ? { message: shape.detail } : {}) }]);
  }
  let document: KmlDocument;
  try {
    document = createDocument(decoded.text);
  } catch {
    return fatalKml(encoding, [{ level: 'error', code: 'kml-not-xml', message: 'parse-failed' }]);
  }
  const root = document.documentElement;
  const placemarks = root ? collectPlacemarks(root) : [];
  if (placemarks.length === 0) return fatalKml(encoding, [{ level: 'error', code: 'kml-no-placemarks' }]);
  if (placemarks.length > POI_IMPORT_MAX_ROWS) {
    return fatalKml(encoding, [{ level: 'error', code: 'too-many-rows', value: String(placemarks.length) }], placemarks.length);
  }

  const rows: PoiImportRow[] = [];
  const rowIssues: PoiImportIssue[] = [];
  const seenIds = new Set<string>();
  const usedColumns = new Set<string>();
  const ignoredNames = new Set<string>();
  let pixelIgnored = false;
  let flattenedCount = 0;
  let undefinedEntityCount = 0;

  placemarks.forEach((placemark, index) => {
    const rowNo = index + 1;
    const line = typeof placemark.lineNumber === 'number' ? placemark.lineNumber : null;
    const warn = (code: string, extra: Partial<PoiImportIssue> = {}): void => {
      rowIssues.push({ level: 'warning', code, row: rowNo, line, ...extra });
    };
    const nameText = (childElement(placemark, 'name')?.textContent ?? '').trim();

    // 取り込む形は直下の Point だけ。それ以外のジオメトリ・ジオメトリの無い Placemark は警告して飛ばす
    const geometries = elementChildren(placemark).filter((child) => GEOMETRY_NAMES.has(nameOf(child)));
    const pointElement = geometries.find((child) => nameOf(child) === 'Point');
    if (!pointElement) {
      warn('kml-non-point-skipped', { value: geometries.length > 0 ? nameOf(geometries[0]) : 'none', message: nameText });
      return;
    }
    const coordinates = splitPointCoordinates(childElement(pointElement, 'coordinates')?.textContent ?? '');
    if (!coordinates) {
      rowIssues.push({ level: 'error', code: 'kml-bad-coordinates', row: rowNo, line });
      return;
    }

    const entries: MappedCell[] = [];
    const present = new Set<string>();
    const add = (cell: MappedCell): void => {
      entries.push(cell);
      present.add(columnKey(cell.spec));
      usedColumns.add(cell.spec.name);
    };

    const idAttr = placemark.getAttribute?.('id') ?? '';
    if (idAttr !== '') {
      if (DISPLAY_ID_PATTERN.test(idAttr)) add({ spec: ID_COLUMN, value: idAttr });
      else warn('kml-id-ignored', { column: 'id', value: idAttr });
    }
    const checkEntity = (value: string): void => {
      if (UNDEFINED_ENTITY.test(value)) undefinedEntityCount += 1;
    };
    if (nameText !== '') {
      add({ spec: textColumn('name', defaultLang), value: nameText });
      checkEntity(nameText);
    }
    const descriptionRaw = childElement(placemark, 'description')?.textContent ?? '';
    if (descriptionRaw.trim() !== '') {
      let value = descriptionRaw.trim();
      if (HTML_TAG.test(value)) {
        const flat = flattenHtml(value);
        value = flat.text;
        flattenedCount += 1;
        if (flat.hadImage) warn('kml-description-image-dropped');
      }
      if (value !== '') add({ spec: textColumn('desc', defaultLang), value });
    }

    // ExtendedData: CSV と同じ列として扱う (座標の列は無視)。素の要素と重なれば素の要素を優先
    let conflicted = false;
    for (const pair of extendedPairs(placemark)) {
      const resolved = resolveColumnSpec(pair.name, defaultLang);
      if (resolved.pixel) { pixelIgnored = true; continue; }
      if (!resolved.spec) {
        if (resolved.ignoredName !== undefined) ignoredNames.add(resolved.ignoredName);
        continue;
      }
      if (isCoordinateColumn(resolved.spec)) continue;
      if (present.has(columnKey(resolved.spec))) { conflicted = true; continue; }
      add({ spec: resolved.spec, value: pair.value });
      checkEntity(pair.value);
    }
    if (conflicted) warn('kml-extended-data-conflict');

    entries.push({ spec: LAT_COLUMN, value: coordinates.lat }, { spec: LNG_COLUMN, value: coordinates.lng });
    const mapped = mapCellsToImportRow({ entries, rowNo, line, seenIds, stripQuotePrefix: false });
    rowIssues.push(...mapped.issues);
    if (mapped.row) rows.push(mapped.row);
  });

  const issues: PoiImportIssue[] = [];
  if (ignoredNames.size > 0) {
    const names = [...ignoredNames].join(', ');
    issues.push({ level: 'warning', code: 'ignored-columns', column: names, value: names, message: names });
  }
  if (pixelIgnored) issues.push({ level: 'warning', code: 'pixel-coordinates-ignored' });
  issues.push(...rowIssues);
  if (flattenedCount > 0) issues.push({ level: 'warning', code: 'kml-description-html-flattened', message: String(flattenedCount) });
  if (undefinedEntityCount > 0) issues.push({ level: 'warning', code: 'kml-undefined-entity', message: String(undefinedEntityCount) });
  return { format: 'kml', encoding, columns: [...usedColumns], totalRecords: placemarks.length, rows, issues, fatal: false };
}
