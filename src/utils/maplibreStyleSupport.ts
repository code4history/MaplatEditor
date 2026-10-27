// MapLibre のスタイル（style JSON）が、MapLibre GL JS の 5 系の固定版（5.6.2）で動くかを判定する純関数。
//
// 結果は 3 通り:
//   v5-ok    5 系で動く（5.6.2 の検証が知らないものを使わず、5.6.2 の js が実装していないものも使わない）
//   needs-v6 6 系が要る（5.6.2 の検証が知らないもの〔6 系の固定版の検証は知っている〕を使う、または
//            5.6.2 より新しく 6 系の固定版以下の js が要るものを使う）
//   unknown  判定できない（JSON でない・version が 8 でない・6 系の固定版の検証も知らないものを使う・
//            6 系の固定版より新しい js が要る・取得の失敗〔取得は呼び出し側〕）
// needs-v6 と unknown の両方に当たるときは unknown を優先し、needs-v6 の項目も理由に並べる。
//
// 根拠（2 本）:
//   1. 柱: 5.6.2 が依存する style-spec の参照（表の v5）が知らないか。5.6.2 の検証は、層の未知の paint／layout の
//      キー・未知の層の型・未知の演算子・"*" を持たない source の型の未知のキーを拒み、style 全体が使えなくなる
//      （元の不具合: line-layer-opacity）。最上位の未知のキーは拒まない（実測）ので数えない
//   2. 補い: 6 系の固定版の参照（表の v6）の sdk-support のうち、5.6.2 の検証は通るが 5.6.2 の js が実装していない
//      行（表の requirements。生成のスクリプトが「使う行」だけを取り出してある）
//
// 判定は style の書き方だけを見るもので、描画の保証ではない。style の外の資源（sprite・glyphs・タイル）は見ない。
// 先頭が参照に無い文字列の配列は値（例 text-font の ["Noto Sans"]）として扱う ∴ 両方の参照に無い演算子は検出できない。
//
// この関数はアプリの版の値に触れない（判定の結果で版を変えるのは、利用者が確認の窓を通したときだけ）。
import TABLE from "../data/maplibreStyleSupport.json";

export type MaplibreStyleSupportTable = typeof TABLE;
export type MaplibreStyleResult = "v5-ok" | "needs-v6" | "unknown";

/** 理由の種類（固定の語彙）。取得の失敗の種類は IPC の側（判定の前）で使う */
export type MaplibreStyleReasonKind =
  | "unknown-to-5"
  | "needs-js"
  | "unknown-to-6"
  | "network"
  | "http-status"
  | "too-large"
  | "unsupported-scheme"
  | "invalid-json"
  | "not-v8"
  | "invalid-argument";

export interface MaplibreStyleReason {
  kind: MaplibreStyleReasonKind;
  /** 層の番号（layers[i]） */
  layer?: number;
  /** 層の ID（style の本文から来るので、形の合わないものは "…"） */
  layerId?: string;
  /** source の ID（同上） */
  source?: string;
  /** キーの名前（`paint.line-layer-opacity`・`layout.line-cap`・`type`・`encoding`・`glyphs` など） */
  key?: string;
  /** 式の演算子の名前 */
  operator?: string;
  /** 要る js の版（needs-js のとき） */
  requires?: string;
}

export interface MaplibreStyleSupportResult {
  result: MaplibreStyleResult;
  reasons: MaplibreStyleReason[];
}

export const MAPLIBRE_STYLE_SUPPORT_TABLE: MaplibreStyleSupportTable = TABLE;

const SAFE_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
/** style の本文から来る名前（層の ID・source の ID・未知のキーの名前）を返すときは、形の合わないものを伏せる */
export function safeStyleName(value: unknown): string {
  return typeof value === "string" && SAFE_NAME.test(value) ? value : "…";
}

function cmp(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// 値が地物のデータを読む式（data-driven）の演算子
const DATA_OPERATORS = new Set(["get", "has", "properties", "feature-state", "id", "geometry-type", "accumulated"]);

type Requirement = MaplibreStyleSupportTable["requirements"][number];
type Ctx = { layer?: number; layerId?: string; source?: string; key?: string; operator?: string };

/** 式（配列）の中の演算子を拾う。literal の中は値なので歩かない */
function collectOperators(value: unknown, known: Set<string>, out: Set<string>): void {
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && known.has(value[0])) {
      out.add(value[0]);
      if (value[0] === "literal") return;
      for (const item of value.slice(1)) collectOperators(item, known, out);
      return;
    }
    for (const item of value) collectOperators(item, known, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectOperators(item, known, out);
  }
}

function hasNumberFormatUnit(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value[0] === "number-format") {
    const options = value[2];
    if (options && typeof options === "object" && !Array.isArray(options) && "unit" in options) return true;
  }
  if (value[0] === "literal") return false;
  return value.some((item) => hasNumberFormatUnit(item));
}

function isLegacyFunction(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "stops" in (value as object);
}

export function judgeMaplibreStyleSupport(
  style: unknown,
  table: MaplibreStyleSupportTable = MAPLIBRE_STYLE_SUPPORT_TABLE,
): MaplibreStyleSupportResult {
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    return { result: "unknown", reasons: [{ kind: "invalid-json" }] };
  }
  const doc = style as Record<string, any>;
  if (doc.version !== 8) return { result: "unknown", reasons: [{ kind: "not-v8" }] };

  const v5 = table.v5 as any;
  const v6 = table.v6 as any;
  const maplibre6 = table.maplibre6;
  const ops5 = new Set<string>(v5.operators);
  const ops6 = new Set<string>(v6.operators);
  const reasons: MaplibreStyleReason[] = [];
  let needsV6 = false;
  let unknown = false;
  const seen = new Set<string>();
  const push = (reason: MaplibreStyleReason) => {
    const key = JSON.stringify(reason);
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push(reason);
    if (reason.kind === "unknown-to-6") unknown = true;
    else if (reason.kind === "unknown-to-5") needsV6 = true;
    else if (reason.kind === "needs-js") {
      if (cmp(reason.requires ?? "0.0.0", maplibre6) > 0) unknown = true;
      else needsV6 = true;
    }
  };
  const requirement = (req: Requirement, ctx: Ctx) => push({ kind: "needs-js", ...ctx, requires: req.js });
  const reqs = table.requirements as Requirement[];
  const findReqs = (pred: (r: Requirement) => boolean) => reqs.filter(pred);

  // knownTo5: キーそのものを 5.6.2 の検証が知っているか。知らないキー・演算子は柱 1 で数えたので、
  // 同じものの「basic functionality」の補いは重ねて数えない
  const checkValue = (scope: "paint" | "layout" | "light" | "sky", type: string | undefined, key: string, value: unknown, ctx: Ctx, knownTo5 = true) => {
    // 式の演算子（柱 1 と、演算子の補いの行）
    const used = new Set<string>();
    collectOperators(value, ops6, used);
    if (isLegacyFunction(value)) {
      // 旧式の関数の stops の値は値として扱う（演算子を拾わない）
      used.clear();
    }
    for (const op of used) {
      if (!ops5.has(op)) { push({ kind: "unknown-to-5", ...ctx, operator: op }); continue; }
      for (const r of findReqs((x) => x.scope === "operator" && x.key === op && x.kind === "basic")) requirement(r, { ...ctx, operator: op });
    }
    if (hasNumberFormatUnit(value)) {
      for (const r of findReqs((x) => x.scope === "operator" && x.key === "number-format" && x.kind === "unit")) requirement(r, { ...ctx, operator: "number-format" });
    }
    const forKey = findReqs((x) => x.scope === scope && (x.type ?? undefined) === type && x.key === key);
    const dataDriven = (isLegacyFunction(value) && "property" in value) || [...used].some((op) => DATA_OPERATORS.has(op));
    for (const r of forKey) {
      if (r.kind === "basic") { if (knownTo5) requirement(r, ctx); }
      else if (r.kind === "data-driven" && dataDriven) requirement(r, ctx);
      else if (r.kind === "global-state" && used.has("global-state")) requirement(r, ctx);
    }
  };

  // ---- 層 ----
  const layers: unknown[] = Array.isArray(doc.layers) ? doc.layers : [];
  layers.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const layer = raw as Record<string, any>;
    const base: Ctx = { layer: index, layerId: safeStyleName(layer.id) };
    const type = layer.type;
    if (typeof type !== "string" || !v6.layerTypes.includes(type)) {
      push({ kind: "unknown-to-6", ...base, key: "type" });
      return;
    }
    if (!v5.layerTypes.includes(type)) push({ kind: "unknown-to-5", ...base, key: "type" });
    for (const section of ["paint", "layout"] as const) {
      const props = layer[section];
      if (!props || typeof props !== "object") continue;
      for (const [rawKey, value] of Object.entries(props as Record<string, unknown>)) {
        // paint の遷移のキー（<key>-transition）は、元のキーが遷移を持つなら元のキーと同じ扱い
        const transitionOf = section === "paint" && rawKey.endsWith("-transition") ? rawKey.slice(0, -"-transition".length) : null;
        const known = (t: any) =>
          (t[section][type] ?? []).includes(rawKey) || (transitionOf !== null && (t.transitionable?.[type] ?? []).includes(transitionOf));
        const ctx: Ctx = { ...base, key: `${section}.${safeStyleName(rawKey)}` };
        if (!known(v6)) { push({ kind: "unknown-to-6", ...ctx }); continue; }
        const knownTo5 = known(v5);
        if (!knownTo5) push({ kind: "unknown-to-5", ...ctx });
        if (transitionOf === null) checkValue(section, type, rawKey, value, ctx, knownTo5);
      }
    }
    if (layer.filter !== undefined) {
      const used = new Set<string>();
      collectOperators(layer.filter, ops6, used);
      for (const op of used) {
        if (!ops5.has(op)) { push({ kind: "unknown-to-5", ...base, key: "filter", operator: op }); continue; }
        for (const r of findReqs((x) => x.scope === "operator" && x.key === op && x.kind === "basic")) requirement(r, { ...base, key: "filter", operator: op });
      }
    }
  });

  // ---- source ----
  const sources = doc.sources && typeof doc.sources === "object" ? (doc.sources as Record<string, any>) : {};
  for (const [id, raw] of Object.entries(sources)) {
    const base: Ctx = { source: safeStyleName(id) };
    if (!raw || typeof raw !== "object") continue;
    const type = raw.type;
    const spec6 = typeof type === "string" ? v6.sources[type] : undefined;
    const spec5 = typeof type === "string" ? v5.sources[type] : undefined;
    if (!spec6) { push({ kind: "unknown-to-6", ...base, key: "type" }); continue; }
    if (!spec5) push({ kind: "unknown-to-5", ...base, key: "type" });
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const ctx: Ctx = { ...base, key: safeStyleName(key) };
      const in6 = spec6.keys.includes(key);
      const in5 = spec5 ? spec5.keys.includes(key) : false;
      // "*" を持つ型（vector・raster・raster-dem）は、どちらの検証も知らないキーを通す
      if (!in6) { if (!spec6.wildcard) push({ kind: "unknown-to-6", ...ctx }); continue; }
      if (!in5 && !(spec5 && spec5.wildcard)) push({ kind: "unknown-to-5", ...ctx });
      const enum6: string[] | undefined = spec6.enums?.[key];
      if (enum6 && typeof value === "string") {
        if (!enum6.includes(value)) { push({ kind: "unknown-to-6", ...ctx }); continue; }
        const enum5: string[] | undefined = spec5?.enums?.[key];
        if (enum5 && !enum5.includes(value)) push({ kind: "unknown-to-5", ...ctx });
        for (const r of findReqs((x) => x.scope === "source" && x.type === type && x.key === key && x.kind === "encoding-value" && (x as any).value === value)) {
          requirement(r, ctx);
        }
      }
    }
  }

  // ---- 最上位: light・sky の値（global-state の補い）と、glyphs の省略 ----
  for (const scope of ["light", "sky"] as const) {
    const obj = doc[scope];
    if (!obj || typeof obj !== "object") continue;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      checkValue(scope, undefined, key, value, { key: `${scope}.${safeStyleName(key)}` });
    }
  }
  if (doc.glyphs === undefined) {
    const usesText = layers.some((l: any) => l && l.type === "symbol" && l.layout && l.layout["text-field"] !== undefined);
    if (usesText) {
      for (const r of findReqs((x) => x.scope === "root" && x.key === "glyphs" && x.kind === "omit-glyphs")) requirement(r, { key: "glyphs" });
    }
  }

  const result: MaplibreStyleResult = unknown ? "unknown" : needsV6 ? "needs-v6" : "v5-ok";
  return { result, reasons };
}

/** 理由を 1 行の文字列にする（場所とキーは言語によらない書き方。取得の失敗の種類は translate で訳す） */
export function formatMaplibreStyleReasons(
  reasons: MaplibreStyleReason[],
  translate: (kind: MaplibreStyleReasonKind) => string,
  max = 3,
): string {
  const parts = reasons.map((r) => {
    if (!["unknown-to-5", "needs-js", "unknown-to-6"].includes(r.kind)) return translate(r.kind);
    const where = r.layer !== undefined ? `layers[${r.layer}]` : r.source !== undefined ? `sources.${r.source}` : "";
    const what = [r.key, r.operator ? `(${r.operator})` : ""].filter(Boolean).join(" ");
    const version = r.kind === "needs-js" && r.requires ? ` ≥ ${r.requires}` : "";
    return [where, what].filter(Boolean).join(" ") + version;
  });
  const shown = parts.slice(0, max).join(", ");
  return parts.length > max ? `${shown}, … (+${parts.length - max})` : shown;
}
