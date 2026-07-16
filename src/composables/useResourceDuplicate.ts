// M11-T10: 複製 slug 採番の共通処理（5資産種の一覧で共用）。
// reserve は予約表しか見ないため、registry(保存済み資産)も見る check を前置しないと
// 保存済み slug (taken) に対しても予約が成立してしまう。採番候補・切詰め幅・失敗判定を
// ここへ一元化する。
import type { SlugFieldKind } from "../utils/slugReservationKind";

// suggestSlug と同じ slug 最大長。候補は suffix 込みでこの長さに収まるよう切り詰める。
const SLUG_MAX = 100;
const COPY_SUFFIX = "-copy";
const COPY_MAX_INDEX = 100;

export interface ReservedCopySlug {
  slug: string;
  uid: string;
}

// 複製用に新 UID を採番し、"-copy" → "-copy2".."-copy100" の順で空き slug を予約する。
// 予約帰属は asset_uid=uid（D2改）。全候補枯渇時は null（呼出元が duplicate_failed 診断を出す）。
export async function reserveCopySlug(
  baseSlug: string | undefined,
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
  const candidate = (suffix: string): string => base.slice(0, SLUG_MAX - suffix.length) + suffix;
  const first = candidate(COPY_SUFFIX);
  if (await tryReserve(first)) return { slug: first, uid };
  for (let i = 2; i <= COPY_MAX_INDEX; i++) {
    const next = candidate(`${COPY_SUFFIX}${i}`);
    if (await tryReserve(next)) return { slug: next, uid };
  }
  return null;
}

// grid 一覧（Map/App）の複製遷移先。エディタ側 duplicateFrom 受け口の契約（設計v3.2）:
// duplicateFrom=複製元uid / draftUid=予約帰属uid(=create uid) / slug=予約済みslug / new=1
export function duplicateEditorPath(editorPath: string, sourceUid: string, reserved: ReservedCopySlug): string {
  return `${editorPath}?duplicateFrom=${sourceUid}&draftUid=${reserved.uid}&slug=${encodeURIComponent(reserved.slug)}&new=1`;
}
