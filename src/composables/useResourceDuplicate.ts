// M11-T10: 複製 slug 採番の共通処理（5資産種の一覧で共用）。
// reserve は予約表しか見ないため、registry(保存済み資産)も見る check を前置しないと
// 保存済み slug (taken) に対しても予約が成立してしまう。
// M3-T6: 採番候補・切詰め幅・系列上限は utils/slugSequence.ts へ一本化した
// (旧 candidate 実装と同値 — smoke:m3-t6 で表駆動検証)。reserveCopySlug は
// reserveSequencedSlug(suffix "-copy") への挙動不変 wrapper (AC6-8(a))。
import type { SlugFieldKind } from "../utils/slugReservationKind";
import { findAvailableSlug } from "../utils/slugSequence";

const COPY_SUFFIX = "-copy";

export interface ReservedCopySlug {
  slug: string;
  uid: string;
}

// 新 UID を採番し、base+suffix → base+suffix+"2".."100" の順で空き slug を予約する。
// 予約帰属は asset_uid=uid（D2改）。全候補枯渇時は null。
// (a) 複製 "-copy" (reserveCopySlug) と (b) inline POI 変換 "-poi" (inlinePoiConvert) が
// 同一の tryReserve 実装 (slugReservations.check → reserve) を共有する (設計 §6.2)。
export async function reserveSequencedSlug(
  baseSlug: string | undefined,
  suffix: string,
  assetKind: SlugFieldKind,
  fallbackBase: string,
): Promise<ReservedCopySlug | null> {
  const uid = crypto.randomUUID();
  const base = baseSlug || fallbackBase;
  const tryReserve = async (slug: string): Promise<boolean> => {
    try {
      if ((await window.slugReservations.check({ slug })) !== "available") return false;
      const result = await window.slugReservations.reserve({ slug, assetUid: uid, assetKind, draftUid: uid });
      return result.result === "ok";
    } catch {
      return false;
    }
  };
  const slug = await findAvailableSlug(base, tryReserve, { suffix });
  return slug === null ? null : { slug, uid };
}

// 複製用に新 UID を採番し、"-copy" → "-copy2".."-copy100" の順で空き slug を予約する。
// 全候補枯渇時は null（呼出元が duplicate_failed 診断を出す）。
// 公開シグネチャ・返値・候補系列・切詰めとも M11-T10 実装から不変 (M3-T6 で内部委譲のみ)。
export async function reserveCopySlug(
  baseSlug: string | undefined,
  assetKind: SlugFieldKind,
  fallbackBase: string,
): Promise<ReservedCopySlug | null> {
  return reserveSequencedSlug(baseSlug, COPY_SUFFIX, assetKind, fallbackBase);
}

// grid 一覧（Map/App）の複製遷移先。エディタ側 duplicateFrom 受け口の契約（設計v3.2）:
// duplicateFrom=複製元uid / draftUid=予約帰属uid(=create uid) / slug=予約済みslug / new=1
export function duplicateEditorPath(editorPath: string, sourceUid: string, reserved: ReservedCopySlug): string {
  return `${editorPath}?duplicateFrom=${sourceUid}&draftUid=${reserved.uid}&slug=${encodeURIComponent(reserved.slug)}&new=1`;
}
