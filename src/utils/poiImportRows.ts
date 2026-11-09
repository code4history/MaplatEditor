// POI の一括取り込み: 行の型と CSV の解析。
// 解析は「ファイルを読む・文字コードを判定する・構文を読んで、値の形を検査した行 (PoiImportRow) にする」
// までを担う。既存の POI を知らないので、「新しい POI として必須か」(name・座標) の検査と既存への合流は
// planPoiMerge (poiMerge.ts) の責務。座標は [経度, 緯度] (WGS84・度)。
import { DISPLAY_ID_PATTERN, isDangerousUrlString } from './poiGeoJson';
import { UID_RE } from './poiContentMode';
import { LANG_CODES } from './editorLanguages';
import { decodePoiCsvBytes, parseCsvRecords, unquotePoiCsvFormula, type PoiCsvEncoding } from './poiTableCodec';

export const POI_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const POI_IMPORT_MAX_ROWS = 20000;
export const POI_IMPORT_MAX_CELL_CHARS = 1024 * 1024;

export interface PoiImportRow {
  /** 1 始まりの通し番号 (データ行) */
  row: number;
  /** 物理行 (レコードの開始行。見出しの行 = 1)。取れなければ null */
  line: number | null;
  /** 報告に出す識別 (id → name の順。無ければ '') */
  label: string;
  /** '' = 無し */
  id: string;
  /** lat・lng の両方に値があるときだけ非 null */
  coordinates: [number, number] | null;
  /** 空でない値だけを持つ。キーが無い = その言語 (項目) に値が無い (列が無い、または空セル) */
  name?: Record<string, string>;
  desc?: Record<string, string>;
  address?: Record<string, string>;
  image?: string[];
}

export interface PoiImportIssue {
  level: 'error' | 'warning';
  code: string;
  row?: number;
  line?: number | null;
  column?: string;
  value?: string;
  featureId?: string;
  message?: string;
  swapped?: boolean;
}

export interface PoiImportParseResult {
  format: 'csv' | 'kml';
  encoding: PoiCsvEncoding | null;
  /** 認識した正規の列名 */
  columns: string[];
  /** データ行の総数 */
  totalRecords: number;
  /** 解析が値の形で除かなかった行 (合流に渡す) */
  rows: PoiImportRow[];
  /** 解析が出した issue だけ (合流の issue は含まない) */
  issues: PoiImportIssue[];
  /** true なら rows は空で取り込めない */
  fatal: boolean;
}

export type TextField = 'name' | 'desc' | 'address';
export type ColumnSpec =
  | { kind: 'id' | 'image' | 'lat' | 'lng'; name: string }
  | { kind: 'text'; field: TextField; lang: string; explicitLang: boolean; name: string };

const FIELD_ALIASES = new Map<string, TextField>([
  ['name', 'name'], ['名称', 'name'], ['名前', 'name'],
  ['desc', 'desc'], ['説明', 'desc'], ['description', 'desc'],
  ['address', 'address'], ['住所', 'address'],
]);
const PLAIN_ALIASES = new Map<string, 'id' | 'image' | 'lat' | 'lng'>([
  ['id', 'id'], ['識別子', 'id'], ['表示id', 'id'],
  ['image', 'image'], ['画像', 'image'],
  ['lat', 'lat'], ['latitude', 'lat'], ['緯度', 'lat'],
  ['lng', 'lng'], ['lon', 'lng'], ['long', 'lng'], ['longitude', 'lng'], ['経度', 'lng'],
]);
const PIXEL_COLUMNS = new Set(['x', 'y', 'pixel_x', 'pixel_y']);
const LANG_BY_LOWER = new Map<string, string>(LANG_CODES.map((code) => [code.toLowerCase(), code]));

// 見出しの比較: 前後の空白を除く → NFKC → 小文字
export function normalizeHeader(raw: string): string {
  return raw.replace(/^\ufeff/, '').trim().normalize('NFKC').toLowerCase();
}

export interface ResolvedColumn {
  /** 認識した列。認識しない・取り込まない列は null */
  spec: ColumnSpec | null;
  /** x・y・pixel_x・pixel_y (地図画像上の座標。取り込まず警告) */
  pixel: boolean;
  /** 認識しなかった列の名前 (警告 ignored-columns に出す)。空の名前は無し */
  ignoredName?: string;
}

// 列の名前 (CSV の見出し・KML の ExtendedData の名前) を列の定義に解決する。別名表・NFKC・言語つきの列
// (name:en・zh-TW など) の照合を担う唯一の実装。CSV と KML が共有する (二重実装を作らない)。
export function resolveColumnSpec(raw: string, defaultLang: string): ResolvedColumn {
  const norm = normalizeHeader(raw);
  if (PIXEL_COLUMNS.has(norm)) return { spec: null, pixel: true };
  const plain = PLAIN_ALIASES.get(norm);
  if (plain) return { spec: { kind: plain, name: plain }, pixel: false };
  const field = FIELD_ALIASES.get(norm);
  if (field) return { spec: { kind: 'text', field, lang: defaultLang, explicitLang: false, name: field }, pixel: false };
  const colon = norm.indexOf(':');
  const langField = colon > 0 ? FIELD_ALIASES.get(norm.slice(0, colon).trim()) : undefined;
  const lang = colon > 0 ? LANG_BY_LOWER.get(norm.slice(colon + 1).trim()) : undefined;
  if (langField && lang) {
    return { spec: { kind: 'text', field: langField, lang, explicitLang: true, name: `${langField}:${lang}` }, pixel: false };
  }
  return { spec: null, pixel: false, ...(norm !== '' ? { ignoredName: raw.replace(/^\ufeff/, '').trim() } : {}) };
}

// 列の同一性 (重複の検出に使う)
export function columnKey(spec: ColumnSpec): string {
  return spec.kind === 'text' ? `${spec.field}:${spec.lang}` : spec.kind;
}

// 列の定義の組み立て (CSV 以外の入力が、別名表を使わずに既知の列を指すためのもの)
export const ID_COLUMN: ColumnSpec = { kind: 'id', name: 'id' };
export const LAT_COLUMN: ColumnSpec = { kind: 'lat', name: 'lat' };
export const LNG_COLUMN: ColumnSpec = { kind: 'lng', name: 'lng' };
export function textColumn(field: TextField, lang: string): ColumnSpec {
  return { kind: 'text', field, lang, explicitLang: false, name: field };
}
export function isCoordinateColumn(spec: ColumnSpec): boolean {
  return spec.kind === 'lat' || spec.kind === 'lng';
}

function fatalResult(
  encoding: PoiCsvEncoding | null,
  issues: PoiImportIssue[],
  totalRecords = 0,
  columns: string[] = [],
): PoiImportParseResult {
  return { format: 'csv', encoding, columns, totalRecords, rows: [], issues, fatal: true };
}

const normalizeNewlines = (s: string): string => s.replace(/\r\n?/g, '\n');

// 数値の読み方: 前後の空白を除き、全角の数字・小数点・マイナスは半角へ。形は ^[+-]?\d+(\.\d+)?$ に限る
function readCoordinate(cell: string): number | null {
  const text = cell.trim().normalize('NFKC').replace(/−/g, '-');
  return /^[+-]?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

export interface MappedCell {
  spec: ColumnSpec;
  value: string;
}

export interface MappedRow {
  /** 値の形の誤りが無かった行。誤りがあれば null */
  row: PoiImportRow | null;
  issues: PoiImportIssue[];
  /** 式の無害化 (先頭の ') を外したセルの数 */
  strippedCount: number;
}

// 行への写し (CSV の 1 行・KML の 1 Placemark で共有する唯一の実装)。
// 列の定義つきの値を受け取り、値の形を検査して PoiImportRow にする (座標・swapped・画像・表示 ID・
// 重複・セルの大きさ・警告)。stripQuotePrefix は CSV だけ真 (自分の書き出しの往復のための規則)。
export function mapCellsToImportRow(args: {
  entries: readonly MappedCell[];
  rowNo: number;
  line: number | null;
  seenIds: Set<string>;
  stripQuotePrefix: boolean;
  /** 認識しない列のセル (取り込まないが、セルの大きさの上限だけは検査する) */
  otherValues?: readonly string[];
}): MappedRow {
  const { entries, rowNo, line, seenIds, stripQuotePrefix, otherValues } = args;
  const issues: PoiImportIssue[] = [];
  const fail = (code: string, extra: Partial<PoiImportIssue> = {}): void => {
    issues.push({ level: 'error', code, row: rowNo, line, ...extra });
  };
  let strippedCount = 0;

  if (entries.some((e) => e.value.length > POI_IMPORT_MAX_CELL_CHARS) || (otherValues?.some((v) => v.length > POI_IMPORT_MAX_CELL_CHARS) ?? false)) {
    fail('cell-too-large');
    return { row: null, issues, strippedCount };
  }

  let id = '';
  const text: Record<TextField, Record<string, string>> = { name: {}, desc: {}, address: {} };
  let imageCell = '';
  let latCell = '';
  let lngCell = '';
  for (const { spec, value: raw } of entries) {
    if (spec.kind === 'lat') { latCell = raw; continue; }
    if (spec.kind === 'lng') { lngCell = raw; continue; }
    const unquoted = stripQuotePrefix ? unquotePoiCsvFormula(raw) : raw;
    if (unquoted !== raw) strippedCount += 1;
    if (spec.kind === 'id') id = unquoted;
    else if (spec.kind === 'image') imageCell = unquoted;
    else if (spec.kind === 'text') {
      const value = normalizeNewlines(unquoted);
      // name は空白だけを値と見なさない。desc・address は空白だけでも値
      const present = spec.field === 'name' ? value.trim() !== '' : value !== '';
      if (present) text[spec.field][spec.lang] = value;
    }
  }

  if (id !== '' && !DISPLAY_ID_PATTERN.test(id)) fail('display-id-charset', { column: 'id', value: id, featureId: id });

  // 座標: 値のあるセルは形を検査する。片方だけなら警告で、座標は無いものとして扱う
  let coordinates: [number, number] | null = null;
  const latHas = latCell.trim() !== '';
  const lngHas = lngCell.trim() !== '';
  const lat = latHas ? readCoordinate(latCell) : null;
  const lng = lngHas ? readCoordinate(lngCell) : null;
  if (latHas && lat === null) fail('coord-format', { column: 'lat', value: latCell });
  if (lngHas && lng === null) fail('coord-format', { column: 'lng', value: lngCell });
  if (lat !== null && lng !== null) {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      const swapped = Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lng) <= 90;
      fail('coord-range', { value: `${latCell.trim()}, ${lngCell.trim()}`, ...(swapped ? { swapped: true } : {}) });
    } else {
      coordinates = [lng, lat];
    }
  } else if (latHas !== lngHas && !issues.some((i) => i.code === 'coord-format')) {
    issues.push({ level: 'warning', code: 'coordinate-partial', row: rowNo, line, column: latHas ? 'lng' : 'lat' });
  }

  // 画像: | 区切り。要素ごとに前後の空白を除き、空は捨て、http(s)・相対以外 (資産の UUID を含む) は捨てて警告
  const kept: string[] = [];
  let dropped = false;
  if (imageCell !== '') {
    for (const part of imageCell.split('|')) {
      const url = part.trim();
      if (url === '') continue;
      if (UID_RE.test(url) || isDangerousUrlString(url)) dropped = true;
      else kept.push(url);
    }
  }
  if (dropped) issues.push({ level: 'warning', code: 'image-dropped', row: rowNo, line, column: 'image' });

  if (!issues.some((i) => i.level === 'error') && id !== '') {
    if (seenIds.has(id)) fail('file-duplicate-id', { column: 'id', value: id, featureId: id });
    else seenIds.add(id);
  }
  const withId = issues.map((i) => (id !== '' && i.featureId === undefined ? { ...i, featureId: id } : i));
  if (withId.some((i) => i.level === 'error')) return { row: null, issues: withId, strippedCount };

  const firstName = Object.values(text.name)[0] ?? '';
  const row: PoiImportRow = { row: rowNo, line, label: id || firstName, id, coordinates };
  if (Object.keys(text.name).length > 0) row.name = text.name;
  if (Object.keys(text.desc).length > 0) row.desc = text.desc;
  if (Object.keys(text.address).length > 0) row.address = text.address;
  if (kept.length > 0) row.image = kept;
  return { row, issues: withId, strippedCount };
}

export function parsePoiImportFile(args: { format: 'csv'; bytes: Uint8Array; defaultLang: string }): PoiImportParseResult {
  return parsePoiImportCsv(args.bytes, args.defaultLang);
}

function parsePoiImportCsv(bytes: Uint8Array, defaultLang: string): PoiImportParseResult {
  const decoded = decodePoiCsvBytes(bytes);
  if (!decoded.ok) return fatalResult(null, [{ level: 'error', code: decoded.code }]);
  const encoding = decoded.encoding;

  const read = parseCsvRecords(decoded.text);
  if (!read.ok) return fatalResult(encoding, [{ level: 'error', code: read.code, line: read.line }]);
  const records = read.records;
  if (records.length === 0) return fatalResult(encoding, [{ level: 'error', code: 'missing-columns' }]);

  // --- 見出し ---
  const headerCells = records[0].cells;
  const specs: (ColumnSpec | null)[] = [];
  const keyOwners = new Map<string, number>();
  const ignored: string[] = [];
  let pixelIgnored = false;
  let duplicate = false;
  for (const raw of headerCells) {
    const resolved = resolveColumnSpec(raw, defaultLang);
    if (resolved.pixel) pixelIgnored = true;
    if (resolved.ignoredName !== undefined) ignored.push(resolved.ignoredName);
    const spec = resolved.spec;
    if (spec) {
      const key = columnKey(spec);
      if (keyOwners.has(key)) duplicate = true;
      keyOwners.set(key, 1);
    }
    specs.push(spec);
  }
  const columns = specs.filter((s): s is ColumnSpec => s !== null).map((s) => s.name);
  const hasKind = (kind: string): boolean => specs.some((s) => s?.kind === kind);

  const headerIssues: PoiImportIssue[] = [];
  const fatalIssues: PoiImportIssue[] = [];
  if (duplicate) fatalIssues.push({ level: 'error', code: 'duplicate-column', line: records[0].line });
  const hasLat = hasKind('lat');
  const hasLng = hasKind('lng');
  if (hasLat !== hasLng) fatalIssues.push({ level: 'error', code: 'incomplete-coordinate-columns', line: records[0].line });
  else if (!hasLat && !hasKind('id')) fatalIssues.push({ level: 'error', code: 'missing-columns', line: records[0].line });
  if (fatalIssues.length > 0) return fatalResult(encoding, fatalIssues, records.length - 1, columns);

  const dataRecords = records.slice(1);
  if (dataRecords.length > POI_IMPORT_MAX_ROWS) {
    return fatalResult(encoding, [{ level: 'error', code: 'too-many-rows', value: String(dataRecords.length) }], dataRecords.length, columns);
  }
  if (ignored.length > 0) {
    headerIssues.push({ level: 'warning', code: 'ignored-columns', column: ignored.join(', '), value: ignored.join(', '), message: ignored.join(', ') });
  }
  if (pixelIgnored) headerIssues.push({ level: 'warning', code: 'pixel-coordinates-ignored' });

  // --- データ行 ---
  const rowIssues: PoiImportIssue[] = [];
  const rows: PoiImportRow[] = [];
  const seenIds = new Set<string>();
  let strippedCount = 0;

  dataRecords.forEach((record, index) => {
    const rowNo = index + 1;
    const line = record.line;
    if (record.cells.length !== headerCells.length) {
      rowIssues.push({ level: 'error', code: 'column-count', row: rowNo, line, value: `${record.cells.length}/${headerCells.length}` });
      return;
    }
    const entries: MappedCell[] = [];
    const otherValues: string[] = [];
    specs.forEach((spec, col) => {
      if (spec) entries.push({ spec, value: record.cells[col] });
      else otherValues.push(record.cells[col]);
    });
    const mapped = mapCellsToImportRow({ entries, rowNo, line, seenIds, stripQuotePrefix: true, otherValues });
    strippedCount += mapped.strippedCount;
    rowIssues.push(...mapped.issues);
    if (mapped.row) rows.push(mapped.row);
  });

  const issues = [...headerIssues, ...rowIssues];
  if (strippedCount > 0) issues.push({ level: 'warning', code: 'quote-prefix-stripped', message: String(strippedCount) });
  return { format: 'csv', encoding, columns, totalRecords: dataRecords.length, rows, issues, fatal: false };
}
