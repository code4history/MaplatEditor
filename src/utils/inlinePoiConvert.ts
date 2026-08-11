// M3-T6: inline POI (pois 配列の非参照 object 要素) の GeoJSON 変換 (設計 §5.4)。
// renderer 完結・document 不変更 (非破壊・可逆)。変換が触ってよいのは slugReservations と
// assetDrafts.put のみで、pois 配列・Undo 履歴は一切変更しない (update:pois を発火しない)。
// 正規化は既存共用純関数 (normalizePoiSourceCollection + validateFeatureCollection) の再利用のみ。
//
// 層構造注記 (設計 v1.0 レビュー Info-3 — 据え置き): composables/useResourceDuplicate からの
// import は utils→composables の逆行だが、reserveSequencedSlug は window API を使う plain async
// 関数で composable 性 (setup 依存・リアクティブ state) を持たず動作上の問題はない。
// (a) 複製 wrapper と (b) 本変換が同一の tryReserve 実装を共有する骨格を優先する。
import { reserveSequencedSlug } from "../composables/useResourceDuplicate";
import { toPoiEditState, type PoiEditState } from "../composables/usePoiEditSession";
import { MAX_ASSET_DRAFT_BYTES } from "../services/assetDraftStore";
import type { AssetDraftEnvelope } from "../types/assetDraft";
import type { LangResource } from "./langResource";
import type { LangCode } from "./editorLanguages";
import {
  normalizePoiSourceCollection,
  validateFeatureCollection,
  type PoiEditorFC,
  type PoiValidationIssue,
} from "./poiGeoJson";

export interface InlineConvertOutcome {
  fc: PoiEditorFC & { lang: LangCode };
  issues: PoiValidationIssue[];
  hasError: boolean;
}

// 任意入力 (生 FC 要素 / 変換群 = 旧オブジェクト+生 Feature の配列) を内部形 FC へ正規化し検証する。
// 生 FC 要素は layerMeta (type/features/id/name/lang 以外のトップレベル) が round-trip 保持され、
// 変換群は normalizeLegacyPoiList の配列受容に載る。error issue (非 Point 等 — POI-104) は
// hasError で返し、warning (POI-108/121 等) は変換を止めない (PoiEdit 保存時の既存文法で表示される)。
export function convertInlineEntries(input: unknown, lang: LangCode): InlineConvertOutcome {
  const fc = normalizePoiSourceCollection(input, lang);
  const issues = validateFeatureCollection(fc);
  return { fc, issues, hasError: issues.some((issue) => issue.level === "error") };
}

// ドラフト title の決定 (設計 §5.4 手順4, POI-114 整合):
// 生 FC 要素 = FC.name (非空時) → 無ければホストタイトル / 変換群 (配列) = ホストタイトル
export function resolveConvertTitle(input: unknown, hostTitle: LangResource | undefined): LangResource {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const name = (input as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim() !== "") return name;
    if (name && typeof name === "object" && !Array.isArray(name)) {
      const record = name as Record<string, string>;
      if (Object.values(record).some((value) => typeof value === "string" && value.trim() !== "")) {
        return record;
      }
    }
  }
  return hostTitle ?? "";
}

export type InlineConvertFailureReason =
  | "slug-exhausted" // 予約候補の全枯渇 (予約は成立していないため解放なし)
  | "invalid" // 検証 error (POI-104 非 Point 等)
  | "too-large" // envelope が MAX_ASSET_DRAFT_BYTES (20MB) 超 (POI-121 warning とは独立の絶対上限)
  | "failed"; // assetDrafts.put の失敗

export type InlineConvertResult =
  | { ok: true; slug: string; uid: string }
  | { ok: false; reason: InlineConvertFailureReason };

// 変換フロー本体 (設計 §5.4 処理列)。順序は複製フローと同じ「slug を先に確保してから成果物を作る」
// 文法 (予約 → 検証。v1.0 レビュー Info-4 据え置き)。失敗系はすべて予約を解放し、document・
// 既存ドラフトを変更しない (AC6-10)。
export async function convertInlineEntriesToDraft(args: {
  /** 生 FC 要素そのもの、または変換群 (旧オブジェクト+生 Feature) を並べた配列 */
  input: unknown;
  /** 変換 slug の基底 (map=mapID / app=appID)。候補系列 = <hostSlug>-poi → -poi2… */
  hostSlug: string;
  /** 変換群のドラフト title 基底 (map=title / app=appName) */
  hostTitle: LangResource | undefined;
  lang: LangCode;
}): Promise<InlineConvertResult> {
  const reserved = await reserveSequencedSlug(args.hostSlug, "-poi", "poi-source", "poi-source");
  if (reserved === null) {
    console.warn("[inlinePoiConvert] slug reservation exhausted for base:", args.hostSlug);
    return { ok: false, reason: "slug-exhausted" };
  }
  const release = async (): Promise<void> => {
    try {
      await window.slugReservations.release({ slug: reserved.slug, assetUid: reserved.uid });
    } catch {
      // 解放失敗は予約 GC (期限切れ回収) に委ねる (ベストエフォート)
    }
  };

  const outcome = convertInlineEntries(args.input, args.lang);
  if (outcome.hasError) {
    console.warn("[inlinePoiConvert] validation error:", JSON.stringify(outcome.issues));
    await release();
    return { ok: false, reason: "invalid" };
  }

  const payload: PoiEditState = toPoiEditState({
    lang: outcome.fc.lang,
    slug: reserved.slug,
    title: resolveConvertTitle(args.input, args.hostTitle),
    fc: outcome.fc,
  });
  const envelope: AssetDraftEnvelope<PoiEditState> = {
    schemaVersion: 1,
    kind: "poi",
    assetUid: reserved.uid,
    baseRevision: null,
    updatedAt: new Date().toISOString(),
    payload,
  };
  // JSON 化は (1) 20MB 上限検査 と (2) plain object 化の両方を担う。
  // 入力 entries は呼び出し側 (PoiReferenceEditor) では Vue reactive Proxy であり、
  // Proxy のまま IPC (contextBridge) へ渡すと structured clone が
  // "An object could not be cloned" で失敗するため、put へは JSON round-trip した
  // plain envelope を渡す (envelope は契約上 JSON 直列化可能)。
  let encoded: string | null = null;
  try {
    encoded = JSON.stringify(envelope);
  } catch {
    // stringify 不能 (循環参照等) は too-large と同じく中断へ倒す (安全側)
  }
  if (encoded === null || new TextEncoder().encode(encoded).length > MAX_ASSET_DRAFT_BYTES) {
    await release();
    return { ok: false, reason: "too-large" };
  }

  try {
    await window.assetDrafts.put(JSON.parse(encoded) as AssetDraftEnvelope<PoiEditState>);
  } catch (cause) {
    console.warn("[inlinePoiConvert] assetDrafts.put failed:", cause);
    await release();
    return { ok: false, reason: "failed" };
  }
  return { ok: true, slug: reserved.slug, uid: reserved.uid };
}
