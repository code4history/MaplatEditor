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

// M4-T4: 上書きレイヤ (ラッパー) の許可キー。viewer 正本 normalize_pois.ts:23 の OVERRIDE_KEYS と同一。
export const POI_OVERRIDE_KEYS = ["hide", "title", "icon", "selectedIcon"] as const;

// ラッパー判別で「座標を持つ = POI オブジェクト」を弾くキー。viewer 正本 :25-31 と同一。
const COORD_KEYS = ["lnglat", "lng", "lat", "longitude", "latitude"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// M4-T4: 上書きレイヤ (ラッパー) の判別。viewer 正本 isPoiLayerRef (normalize_pois.ts:36-46) と
// 同一規則 — layer が string または FeatureCollection で、自身は FC ではなく、座標キーを持たない
// plain object。main (poiReferenceResolver の外部ファイル化) と renderer (PoiReferenceEditor の
// 要素分類) の双方がこの1本を使う (恒久指示「同一扱い処理は共通実装へ徹底」)。
// t2 で resolver 内に private で置いていた同名関数はここへ移設した (挙動同一)。
export function isPoiLayerRef(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.type === "FeatureCollection") return false;
  const layer = value.layer;
  const layerIsString = typeof layer === "string";
  const layerIsFc = isPlainObject(layer) && layer.type === "FeatureCollection";
  if (!layerIsString && !layerIsFc) return false;
  if (COORD_KEYS.some(key => value[key] !== undefined)) return false;
  return true;
}

// M4-T4: 上書きキーを1つ以上持つラッパーか。**非配列 (pois 全体) の位置ではこれが受容条件**である
// — viewer の isPoiLayerRefAsWhole (normalize_pois.ts:49-51) が旧レイヤ辞書の保護のため上書きキーの
// 存在を追加要求する。∴ 上書きを持たない素ラッパーを単独形で保存すると else 分岐 (レイヤ名キー
// object 扱い) へ落ちて壊れる。配列要素位置では isPoiLayerRef だけで受容される (安全性が位置で逆転)。
export function isPoiLayerRefAsWhole(value: unknown): boolean {
  if (!isPoiLayerRef(value)) return false;
  const record = value as Record<string, unknown>;
  return POI_OVERRIDE_KEYS.some(key => record[key] !== undefined);
}

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

// M4-T4: viewer は先頭が FC **または上書きレイヤ**ならレイヤ配列モードへ入る
// (normalize_pois.ts:106-109 の `layers[0].type === "FeatureCollection" || isPoiLayerRef(layers[0])`)。
// shapes だけでは上書きレイヤと旧 POI オブジェクトを区別できない (どちらも "object") ため、
// **元の要素列を必須の第2引数で受ける**。
//
// 任意引数にはしない: 渡し忘れた呼び出しが viewer と乖離した旧判定へ静かに落ちる罠になり、
// 本タスクが是正している欠陥 (判定源の分裂) を共有述語の内部に作り直すことになるため。
// 本モジュールは poiUidOf に依存しない (冒頭コメント) ので、参照 → "fc" の写像を済ませた shapes と
// 生の entries の両方を受ける形が、この分業を壊さず二挙動も作らない唯一の形である。
export function poisLayerMode(
  shapes: readonly PoisEntryShape[],
  entries: readonly unknown[],
): PoisLayerMode {
  if (shapes.length === 0) return "empty";
  const head = shapes[0];
  if (head === "fc") return "multi";
  if (isPoiLayerRef(entries[0])) return "multi";
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
  return poisLayerKeyOf(entry) !== undefined;
}

// 上と同じ key 導出の値版 (M4-T2 §5.2)。truthy な key があればその値、無ければ undefined。
// hasPoisLayerKey はこれの存在判定として実装されており、判定位置は常に1箇所で一致する
// (id → properties.id の順・truthy 判定は viewer normalize_pois.ts:124 と同じ `||` 意味論)。
// M4-T2 では外部ファイル名の基底として使う — viewer がレイヤ key を読む位置と揃えるため
// (揃えないと、公開データ旧形の FC ような properties.id 側に key を持つ FC が
//  fallback 名 'poi' へ落ちる)。
export function poisLayerKeyOf(entry: unknown): unknown {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const record = entry as Record<string, unknown>;
  if (record.id) return record.id;
  const properties = record.properties;
  if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
    const key = (properties as Record<string, unknown>).id;
    if (key) return key;
  }
  return undefined;
}
