// POI の表形式 (CSV) の符号化の部品。RFC 4180 の書き出しと、式の無害化 (CSV インジェクション対策)。
// 純関数のみ (renderer・main の双方から使える)。

export const CSV_BOM: Uint8Array = Uint8Array.of(0xef, 0xbb, 0xbf);

// 先頭が (0 個以上の ' に続く) 式の記号のセルは、表計算ソフトが式として評価しうる。
// 書き出しでは先頭に ' を 1 つ足す。取り込みは「1 個以上の ' に続く式の記号」の先頭の ' を 1 つ剥がす。
// 2 つの判定は排他的 (剥がす側が真なら足す側も真) なので、足して剥がすと元に戻る (全単射)。
const FORMULA_PREFIX_RE = /^'*[=+\-@\t\r]/;
const QUOTED_FORMULA_RE = /^'+[=+\-@\t\r]/;

export function quotePoiCsvFormula(value: string): string {
  return FORMULA_PREFIX_RE.test(value) ? `'${value}` : value;
}

export function unquotePoiCsvFormula(value: string): string {
  return QUOTED_FORMULA_RE.test(value) ? value.slice(1) : value;
}

// 区切り・引用符・改行、または先頭／末尾の空白を含むセルは "…" で囲む (中の " は "")。
function encodeCell(cell: string): string {
  const needsQuote = /[",\r\n]/.test(cell) || /^\s/.test(cell) || /\s$/.test(cell);
  return needsQuote ? `"${cell.replace(/"/g, '""')}"` : cell;
}

// 行の配列 → CSV 本文。区切り `,`・改行 CRLF (末尾にも 1 つ)。
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(encodeCell).join(',') + '\r\n').join('');
}

// 行の配列 → UTF-8・BOM つきのバイト列 (Excel が BOM で UTF-8 と認識する)。
export function encodeCsvDocument(rows: readonly (readonly string[])[]): Uint8Array {
  const body = new TextEncoder().encode(serializeCsv(rows));
  const out = new Uint8Array(CSV_BOM.length + body.length);
  out.set(CSV_BOM, 0);
  out.set(body, CSV_BOM.length);
  return out;
}

// ---------------------------------------------------------------------------
// 読み取り (取り込み)
// ---------------------------------------------------------------------------

export type PoiCsvEncoding = 'utf-8' | 'utf-8-bom' | 'shift_jis';

export type PoiCsvDecodeResult =
  | { ok: true; text: string; encoding: PoiCsvEncoding }
  | { ok: false; code: 'encoding-unsupported' | 'not-text' };

// UTF-8 だけを読む文字コードの判定 (KML 用)。BOM の有無を問わない。UTF-16 は対象外、NUL を含めばバイナリ。
// Shift_JIS には落とさない (XML の宣言と食い違う読み方をしない)。
export function decodePoiUtf8Bytes(
  bytes: Uint8Array,
): { ok: true; text: string; encoding: 'utf-8' | 'utf-8-bom' } | { ok: false; code: 'encoding-unsupported' | 'not-text' } {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return { ok: false, code: 'encoding-unsupported' };
  }
  if (bytes.includes(0)) return { ok: false, code: 'not-text' };
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(hasBom ? bytes.subarray(3) : bytes);
    return { ok: true, text, encoding: hasBom ? 'utf-8-bom' : 'utf-8' };
  } catch {
    return { ok: false, code: 'encoding-unsupported' };
  }
}

// 文字コードの判定。UTF-8 (BOM の有無を問わない) を先に試し、読めなければ Shift_JIS (Windows-31J。
// Excel の CSV の既定)。UTF-16 は 12 月の対象外。NUL を含めばバイナリ。
// Shift_JIS のバイト列が偶然 UTF-8 として読めることは日本語の文章では実質起きない。
export function decodePoiCsvBytes(bytes: Uint8Array): PoiCsvDecodeResult {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return { ok: false, code: 'encoding-unsupported' };
  }
  if (bytes.includes(0)) return { ok: false, code: 'not-text' };
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
    return { ok: true, text, encoding: hasBom ? 'utf-8-bom' : 'utf-8' };
  } catch {
    if (hasBom) return { ok: false, code: 'encoding-unsupported' };
  }
  try {
    const text = new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
    return { ok: true, text, encoding: 'shift_jis' };
  } catch {
    return { ok: false, code: 'encoding-unsupported' };
  }
}

export interface PoiCsvRecord {
  cells: string[];
  /** レコードの開始行 (物理行・1 始まり。見出しの行 = 1) */
  line: number;
}

export type PoiCsvReadResult =
  | { ok: true; records: PoiCsvRecord[] }
  | { ok: false; code: 'csv-unterminated-quote'; line: number };

// RFC 4180 の読み取り。区切り `,`・改行は CRLF／LF／CR。引用符の中の改行はセルの一部。
// 空行は飛ばす。セルの数の検査はしない (短い行・長い行はそのまま返す)。
export function parseCsvRecords(text: string): PoiCsvReadResult {
  const records: PoiCsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let fieldStart = true;
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  const n = text.length;

  const endRecord = (): void => {
    if (cells.length === 0 && cell === '' && !quoted) return; // 空行
    cells.push(cell);
    records.push({ cells, line: recordLine });
    cells = [];
  };

  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else { inQuotes = false; }
      } else if (c === '\r') {
        cell += text[i + 1] === '\n' ? '\r\n' : '\r';
        if (text[i + 1] === '\n') i += 1;
        line += 1;
      } else {
        if (c === '\n') line += 1;
        cell += c;
      }
      continue;
    }
    if (c === '"' && fieldStart) {
      inQuotes = true;
      quoted = true;
      fieldStart = false;
      quoteLine = line;
    } else if (c === ',') {
      cells.push(cell);
      cell = '';
      quoted = false;
      fieldStart = true;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      cell = '';
      quoted = false;
      fieldStart = true;
      line += 1;
      recordLine = line;
    } else {
      cell += c;
      fieldStart = false;
    }
  }
  if (inQuotes) return { ok: false, code: 'csv-unterminated-quote', line: quoteLine };
  if (cell !== '' || cells.length > 0 || quoted) endRecord();
  return { ok: true, records };
}
