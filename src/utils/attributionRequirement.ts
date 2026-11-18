// 帰属表記（attr）が要るのに無い地図を見分ける。Vue / i18next に依存しない純粋なモジュール
// （renderer と main の両方、smoke からも使う）。
//
// Viewer（MaplatCore）が地図の上に出す帰属表記は、地図の定義の attr と、提供元の申告（Google の応答・
// TileJSON）の 2 つだけで、ライブラリの既定値では埋めない。データにも提供元の申告にも無ければ何も出さない。
// ∴ エディタは帰属表記の無いデータを作らず、既にあるものは見つけて知らせる。
//
// 例外は Google の地図だけ: 帰属表記は Google が返す表示を使い、利用者は入力しない
// （baseMapEditorDocument の usesGoogleAttribution の注記）。
import { usesGoogleAttribution } from "./baseMapEditorDocument";
import {
  resolveAppSource,
  type AppSource,
  type BaseMapMasterLookup,
} from "./appSourceModel";

/** attr に文字があるか。文字列でも言語別のオブジェクトでもよい。空白だけは無いとみなす（Viewer と同じ）。 */
export function hasAttributionText(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      (text) => typeof text === "string" && text.trim() !== "",
    );
  }
  return false;
}

/**
 * 帰属表記が要るのに無いか。地図（Maplat の地図）にもベースマップのマスタにも使う。
 * Google の地図（kind が google、または旧保存形で maptype が google_*）は入力させないので対象外。
 */
export function lacksRequiredAttribution(
  data: { attr?: unknown; kind?: unknown; maptype?: unknown } | null | undefined,
): boolean {
  if (!data) return false;
  if (usesGoogleAttribution(data)) return false;
  return !hasAttributionText(data.attr);
}

/** 帰属表記が無いアプリのソース 1 件（書き出しを止める理由に名前を出す）。 */
export interface SourceWithoutAttribution {
  sourceType: AppSource["sourceType"];
  mapUid: string;
  /** 画面に出す名前（slug。引けなければ mapUid）。 */
  name: string;
}

/**
 * アプリのソースのうち、帰属表記が要るのに無いものを並びのまま返す。
 * - Maplat の地図: mapDocOf(mapUid) が返す地図の文書の attr を見る（引けなければ判定しない）
 * - ベースマップ由来（背景地図・重ね地図）: マスタの attr を見る。マスタが引けないものは
 *   別の理由（マスタ欠落）で扱うので、ここでは数えない
 */
export function findSourcesWithoutAttribution(
  sources: readonly AppSource[],
  lookup: BaseMapMasterLookup,
  mapDocOf: (mapUid: string) => { attr?: unknown; mapID?: unknown; slug?: unknown } | null | undefined,
): SourceWithoutAttribution[] {
  const found: SourceWithoutAttribution[] = [];
  for (const source of sources) {
    if (source.sourceType === "maplat") {
      const doc = mapDocOf(source.mapUid);
      if (!doc || !lacksRequiredAttribution(doc)) continue;
      const slug = typeof doc.slug === "string" && doc.slug ? doc.slug
        : typeof doc.mapID === "string" && doc.mapID ? doc.mapID
          : source.mapSlug || source.mapUid;
      found.push({ sourceType: source.sourceType, mapUid: source.mapUid, name: slug });
      continue;
    }
    const resolved = resolveAppSource(source, lookup);
    if (!resolved.ok) continue;
    if (!lacksRequiredAttribution(resolved.master.data)) continue;
    found.push({ sourceType: source.sourceType, mapUid: source.mapUid, name: resolved.master.mapID || source.mapUid });
  }
  return found;
}
