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
