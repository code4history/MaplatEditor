// 経緯度の直接入力（西・南・東・北）の検査を、利用範囲を入れる 2 つの場所
// （範囲を決める小窓 EnvelopeEditorModal と、アプリ編集のソースのカード AppSourceEditor）
// で共有するための共通関数。検査の段取りと理由の文言キーをここ 1 か所に置き、
// どちらの呼び出し方も同じふるまいになるようにする（二重の実装にしない）。
//
// 検査の段取り（小窓で定めた順。変えない）:
//   1. 数字でない値（全角の数字・小数点のコンマは半角に寄せて受け付ける）
//   2. 経緯度の範囲の外（経度 ±180 / 緯度 ±90）
//   3. 順序（西は東より小さく、南は北より小さい）
//   4. 4 つそろっているか（全部空は範囲なし。一部空は未完成）
//   5. 存在範囲の内側への切り詰め（重ならないときは未確定のまま理由を出す）
//
// 理由の文言キーとその補語（方角の名前）はここで組み立て、呼び出し側は t() で
// 文言を解決した結果を DiagnosticFeedback scope="field" に出すだけにする。

export type CoordField = "west" | "south" | "east" | "north";

export const COORD_FIELDS: readonly CoordField[] = ["west", "south", "east", "north"];

/** 矩形 [西, 南, 東, 北]。appSourceModel の bbox と同じ並び */
export type Bbox = [number, number, number, number];

/** 入力欄 4 つの文字列 */
export type CoordTexts = Record<CoordField, string>;

/** どの欄も正しくないとは限らない（初期状態） */
export const NO_COORD_INVALID: Record<CoordField, boolean> = {
  west: false,
  south: false,
  east: false,
  north: false,
};

export interface ParsedCoord {
  /** 空欄。数でない値は value: null で区別する */
  blank: boolean;
  value: number | null;
}

/** i18n の解決。呼び出し側が持つ t を渡し、理由の文言をここで組み立てる */
export type TranslateFn = (key: string, params?: Record<string, string>) => string;

/** DiagnosticFeedback の items と同じ形 */
export interface CoordDiagnostic {
  key: string;
  severity: "danger" | "warning";
  message: string;
}

export type CoordOutcome =
  /** 4 つとも空欄 = 範囲なし（「範囲をクリア」と同じ扱い） */
  | { kind: "clear" }
  /** 正しくない値がある。矩形は変えず、理由と欄の印だけを返す */
  | { kind: "invalid"; diagnostics: CoordDiagnostic[]; invalid: Record<CoordField, boolean> }
  /** 反映できる。entered は入れた値、cropped は存在範囲の内側へ切り詰めた値 */
  | { kind: "apply"; entered: Bbox; cropped: Bbox; wasCropped: boolean };

// 数でない文字列は value: null（空欄は blank）で区別する
export function parseCoordInput(raw: string): ParsedCoord {
  // 全角の数字・記号は半角に寄せ、小数点のコンマ（点が無いときだけ）も受け付ける
  let text = raw.normalize("NFKC").trim();
  if (!text.includes(".") && (text.match(/,/g) || []).length === 1) text = text.replace(",", ".");
  if (text === "") return { blank: true, value: null };
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return { blank: false, value: null };
  const value = Number(text);
  return { blank: false, value: Number.isFinite(value) ? value : null };
}

export function coordRange(field: CoordField): [number, number] {
  return field === "west" || field === "east" ? [-180, 180] : [-90, 90];
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function bboxEquals(a: Bbox, b: Bbox): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

// 範囲外の判定。経度は ±180、緯度は ±90（数字でない欄は対象にしない）
export function outOfRangeFields(parsed: Record<CoordField, ParsedCoord>): CoordField[] {
  const result: CoordField[] = [];
  for (const field of COORD_FIELDS) {
    const input = parsed[field];
    if (input.blank || input.value === null) continue;
    const [min, max] = coordRange(field);
    if (input.value < min || input.value > max) result.push(field);
  }
  return result;
}

// 順序の判定。西は東より小さく、南は北より小さいこと。
// すでに正しくない欄（数字でない・範囲外）は順序の判定から外す
export function orderViolations(
  parsed: Record<CoordField, ParsedCoord>,
  invalid: Record<CoordField, boolean> = NO_COORD_INVALID,
): Array<{ low: CoordField; high: CoordField }> {
  const usable = (field: CoordField): boolean =>
    !parsed[field].blank && parsed[field].value !== null && !invalid[field];
  const violations: Array<{ low: CoordField; high: CoordField }> = [];
  if (usable("west") && usable("east") && parsed.west.value! >= parsed.east.value!) {
    violations.push({ low: "west", high: "east" });
  }
  if (usable("south") && usable("north") && parsed.south.value! >= parsed.north.value!) {
    violations.push({ low: "south", high: "north" });
  }
  return violations;
}

// 4 つが揃っているかの判定。空欄の欄を返す（空欄が 0 つ = 揃っている）
export function missingFields(parsed: Record<CoordField, ParsedCoord>): CoordField[] {
  return COORD_FIELDS.filter((field) => parsed[field].blank);
}

// 存在範囲の内側へ頂点をクロップ。重ならない場合は null（未選択のまま）
export function cropToCoverage(bbox: Bbox, coverage: Bbox | null): Bbox | null {
  if (!coverage) return bbox;
  const west = Math.max(bbox[0], coverage[0]);
  const south = Math.max(bbox[1], coverage[1]);
  const east = Math.min(bbox[2], coverage[2]);
  const north = Math.min(bbox[3], coverage[3]);
  if (west >= east || south >= north) return null;
  return [round6(west), round6(south), round6(east), round6(north)];
}

// 4 欄の文字列を検査して、小窓と同じ段取りで結果を返す
export function evaluateCoordInputs(
  texts: CoordTexts,
  coverage: Bbox | null,
  t: TranslateFn,
): CoordOutcome {
  const parsed: Record<CoordField, ParsedCoord> = {
    west: parseCoordInput(texts.west),
    south: parseCoordInput(texts.south),
    east: parseCoordInput(texts.east),
    north: parseCoordInput(texts.north),
  };
  // エラー文では方角の正式名を使う（欄の見出しは言語によって 1 文字の略号のため）
  const name = (field: CoordField): string => t(`appedit.envelope_${field}_name`);
  const invalid: Record<CoordField, boolean> = { ...NO_COORD_INVALID };
  const diagnostics: CoordDiagnostic[] = [];

  // 1. 数字でない値
  const badNumbers: CoordField[] = [];
  for (const field of COORD_FIELDS) {
    const input = parsed[field];
    if (input.blank || input.value !== null) continue;
    badNumbers.push(field);
    invalid[field] = true;
  }
  for (const field of badNumbers) {
    diagnostics.push({
      key: `number-${field}`,
      severity: "danger",
      message: t("appedit.envelope_coord_error_number", { name: name(field) }),
    });
  }

  // 2. 経緯度の範囲の外
  const outOfRange = outOfRangeFields(parsed);
  for (const field of outOfRange) invalid[field] = true;
  if (outOfRange.length) {
    diagnostics.push({ key: "coord-range", severity: "danger", message: t("poisource.errors.coord_range") });
  }

  // 3. 順序
  for (const { low, high } of orderViolations(parsed, invalid)) {
    invalid[low] = true;
    invalid[high] = true;
    diagnostics.push({
      key: `order-${low}-${high}`,
      severity: "danger",
      message: low === "west"
        ? t("appedit.envelope_coord_error_west_east", { west: name("west"), east: name("east") })
        : t("appedit.envelope_coord_error_south_north", { south: name("south"), north: name("north") }),
    });
  }

  // 正しくない値があるときは反映せずに理由だけ出す
  if (diagnostics.length) return { kind: "invalid", diagnostics, invalid };

  // 4. 4 つそろっているか
  const missing = missingFields(parsed);
  if (missing.length === COORD_FIELDS.length) return { kind: "clear" };
  if (missing.length) {
    for (const field of missing) invalid[field] = true;
    return {
      kind: "invalid",
      diagnostics: [{
        key: "incomplete",
        severity: "danger",
        message: t("appedit.envelope_coord_error_incomplete"),
      }],
      invalid,
    };
  }

  const entered: Bbox = [
    round6(parsed.west.value!),
    round6(parsed.south.value!),
    round6(parsed.east.value!),
    round6(parsed.north.value!),
  ];

  // 5. 存在範囲の内側へ切り詰める。重ならないときは未確定のまま理由を出す
  const cropped = cropToCoverage(entered, coverage);
  if (!cropped) {
    return {
      kind: "invalid",
      diagnostics: [{
        key: "no-overlap",
        severity: "danger",
        message: t("appedit.envelope_coord_no_overlap"),
      }],
      invalid,
    };
  }
  return { kind: "apply", entered, cropped, wasCropped: !bboxEquals(cropped, entered) };
}
