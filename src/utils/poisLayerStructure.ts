// M3-T6 §5.10: レイヤ構造判定の共有純関数 (renderer / main 共用 — v1.2 人間検証差し戻し (2) の実装形)。
// viewer 正本 MaplatCore/src/normalize_pois.ts のレイヤ判別 (配列の先頭要素だけで一度に決まる —
// :28 先頭判別 / :29-37 複層 key 導出 / :38-43 単層) を editor 側の静的判別へ写した唯一の実装。
// UI (PoiReferenceEditor のペイン構成・変換可否・混在警告表示) と main (poiReferenceResolver の
// 混在警告発行) の双方がここを使う — 恒久指示「同一扱い処理は共通実装へ徹底」。
// 本モジュールは poiUidOf に依存しない形状分類のみを持つ (参照 → fc の写像は renderer 側
// 呼び出しで合成する。resolver は解決後配列を判定するため写像不要 — §5.10)。

// pois 配列要素の静的形状。viewer 正本 normalize_pois.ts の判別軸に対応する。
// fc: 非配列 object かつ type === "FeatureCollection" / object: その他の非 null 非配列 object /
// string: 文字列 / junk: それ以外 (配列・数値・null・undefined・boolean 等)
export type PoisEntryShape = "fc" | "object" | "string" | "junk";

// unknown 全域で定義された 4 値排他の全域関数 (§4.2 決定木の第 2 段の判定源)
export function poisEntryShape(entry: unknown): PoisEntryShape {
  if (typeof entry === "string") return "string";
  if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
    return (entry as Record<string, unknown>).type === "FeatureCollection" ? "fc" : "object";
  }
  return "junk";
}

// レイヤモード (§4.2 の完全分割表 C1〜C7 の決定木・第 1〜2 段に対応):
// [] → "empty" / 先頭 "fc" → "multi" (要素ごとが 1 レイヤ — normalize_pois.ts:28-37) /
// 先頭 "string" → "indeterminate" (URL は fetch 置換後の内容が静的判定不能 — :26) /
// それ以外 (object / junk) → "single" (配列全体で 1 レイヤ — :38-43。junk 先頭は viewer で
// TypeError になり得るため editor 側の最弱仮定 — §4.2 C7 注記)
export type PoisLayerMode = "empty" | "multi" | "single" | "indeterminate";

export function poisLayerMode(shapes: readonly PoisEntryShape[]): PoisLayerMode {
  if (shapes.length === 0) return "empty";
  const head = shapes[0];
  if (head === "fc") return "multi";
  if (head === "string") return "indeterminate";
  return "single";
}

// 混在判定: "fc" と "object" の両方が存在 (string / junk は数えない — §8.1 の出口側判定と同一)。
// §4.2 の警告列はこの述語の値の転記であり、mode によるゲートは挟まない (唯一の判定源 — §5.10)
export function hasMixedPoisShapes(shapes: readonly PoisEntryShape[]): boolean {
  return shapes.includes("fc") && shapes.includes("object");
}

// viewer normalize_pois.ts:30 の key 導出 (layer.id || (layer.properties && layer.properties.id))
// の truthy 判定。複層モードで index >= 1 の生メンバーが key を持たない場合、viewer は throw する
// (:31-33 "POI layers include bad key setting" = POI 全損)。§4.2 / §5.4 の viewer-fatal 注記
// (poiref.layer_key_missing_warning) の判定に使う — UI のみで使用し resolver の警告契約 (AC6-7)
// は拡張しない (§5.10)
export function hasPoisLayerKey(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  if (record.id) return true;
  const properties = record.properties;
  if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
    return Boolean((properties as Record<string, unknown>).id);
  }
  return false;
}
