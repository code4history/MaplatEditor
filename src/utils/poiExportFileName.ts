// export 出力の POI 外部ファイル名（`pois/<base>.geojson` の base）を決める純関数（M4-T2 §5.2）。
//
// なぜ出力側で sanitize が要るか: ファイル名の基底は POI ソースの slug だけでなく、
// **生 FC / ラッパー内 FC の `id` / `properties.id`** からも来る（M4-T2 設計 §5.2 の E2 / E5）。
// POI ソースの slug は SqliteDataService.registerAsset:1691 が isValidSlug（= SLUG_PATTERN,
// electron/services/assetIdentity.ts:13）で弾くので安全だが、**FC の id は利用者が raw JSON
// ペインで自由に書ける値で、この検査を一切通らない**。
// ∴ `{"type":"FeatureCollection","id":"../../etc/passwd"}` を pois に置けば出力ディレクトリの
// 外へ書き出され得る。ファイル名を組み立てる直前に必ず通すこと。
//
// suggestSlug（poiSourceSlug.ts）は流用しない。あちらは import 時の slug 提案であり
// NFKD 正規化・拡張子除去・小文字化を含む。ここで必要なのは既存 slug を壊さない防御であって、
// `Kyoto_1` を `kyoto-1` へ変えてはならない。
//
// 【重要】ここで決まるのはファイル名だけで、viewer のレイヤ key ではない。viewer は key を
// 外部ファイルの中身（`FC.id || FC.properties.id`, MaplatCore/src/normalize_pois.ts:124）から
// 決めるため、sanitize で名前が変わっても cluster の key・namespaceID は変わらない。
import { SLUG_MAX, SEQUENCE_MAX_INDEX, slugCandidate } from "./slugSequence";

/** sanitize の結果が空になったときの基底名 */
export const POI_FILE_BASE_FALLBACK = "poi";

/**
 * 任意の値を `SLUG_PATTERN` を満たすファイル名基底へ落とす。
 * 非文字列・空・全除去された場合は {@link POI_FILE_BASE_FALLBACK}。
 */
export function sanitizePoiFileBase(raw: unknown): string {
  if (typeof raw !== "string") return POI_FILE_BASE_FALLBACK;
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    // 切り詰めで末尾に残ったハイフンも落とす（`pois/xxx-.geojson` を作らない）
    .replace(/-$/, "");
  return cleaned || POI_FILE_BASE_FALLBACK;
}

/**
 * `taken` に対して未使用の基底名を確保する（`base`, `base-2`, … `base-100`）。
 * 候補生成は slugCandidate（slugSequence）と同一規則。確保した名前は `taken` へ追加する。
 * 全候補が埋まっている場合は null（呼び出し側が非外部化のフォールバックへ倒す）。
 */
export function reservePoiFileBase(base: string, taken: Set<string>): string | null {
  for (let n = 1; n <= SEQUENCE_MAX_INDEX; n++) {
    const candidate = slugCandidate(base, n);
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    return candidate;
  }
  return null;
}
