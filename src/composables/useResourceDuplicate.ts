// M11-T10: 複製 slug 採番の共通処理（5資産種の一覧で共用）。
// reserve は予約表しか見ないため、registry(保存済み資産)も見る check を前置しないと
// 保存済み slug (taken) に対しても予約が成立してしまう。
// M3-T6: 採番候補・切詰め幅・系列上限は utils/slugSequence.ts へ一本化した
// (旧 candidate 実装と同値 — smoke:m3-t6 で表駆動検証)。reserveCopySlug は
// reserveSequencedSlug(suffix "-copy") への挙動不変 wrapper (AC6-8(a))。
import type { SlugFieldKind } from "../utils/slugReservationKind";
import { findAvailableSlug } from "../utils/slugSequence";
import { checkSlugAvailability } from "./useSlugAvailability";

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

// --- M5-T9: ローカル複製 ("-local") ---
//
// M3-T6 が (a) "-copy" と (b) "-poi" をここへ畳んだとき、**(c) "-local" だけが
// PoiEdit.vue の中に取り残された**。view の中にあったため service 層のテストから
// 到達できず、次の2つの欠陥がテストに掛からないまま残っていた:
//   1. off-by-one — 候補を 49件しか検査せず、**未検査の base-local50 を返していた**
//   2. 長さ切詰が無く SLUG_MAX を超える slug を生成し得た
//      (isValidSlug は SLUG_PATTERN のパターンのみで長さを見ない)
//
// 【"-copy" / "-poi" と取得方式が違う】
// あちらは check → reserve で **予約を成立させる**が、こちらは **空き確認のみ**である。
// clone は直後の cloneToLocal が slug を確定する経路で、予約を挟むと解放責務が
// 新たに生じる。findAvailableSlug の tryAcquire 抽象はこの差を吸収するためにある
// (slugSequence.ts の該当コメント参照) ∴ **差を潰さず、規則だけを揃える**。
const LOCAL_SUFFIX = "-local";
const LOCAL_MAX_INDEX = 50;

/**
 * ローカル複製の base を正規化する。slug に使えない文字を "-" へ畳み、
 * 結果が空なら fallbackBase を使う。
 *
 * **-copy / -poi との差は「正規化を持つかどうか」である。**
 * reserveSequencedSlug は `baseSlug || fallbackBase` だけで正規化を持たない。
 * clone にだけ正規化があるのは現行 view の挙動であり、その理由は記録されていない
 * (本タスクは adaptation ∴ 挙動を保つ)。
 *
 * 正規化は空判定より **前** に走る ∴ **fallback が効くのは入力が完全に空のときだけ**である。
 * "札幌" や "###" は "-" へ畳まれ、非空なので fallback には落ちない (= "--local" になる)。
 * **これが現行の挙動であり、正しい**。改善余地としては設計 §8 へ申し送ってある。
 */
export function normalizeCloneBase(
  baseSlug: string | undefined,
  fallbackBase: string,
): string {
  return String(baseSlug ?? "").replace(/[^A-Za-z0-9_-]+/g, "-") || fallbackBase;
}

/**
 * ローカル複製用の空き slug を探す。**予約はしない**（直後の cloneToLocal が確定する）。
 * 候補は正本 slugSequence の規則（base-local, base-local2 … base-local50）。
 *
 * @returns 空き slug / 全候補が埋まっていれば `null`（呼出元が clone_failed を出す）
 */
export async function findLocalCloneSlug(
  baseSlug: string | undefined,
  fallbackBase: string,
): Promise<string | null> {
  const base = normalizeCloneBase(baseSlug, fallbackBase);
  // M11-T7/AC17: 生 checkSlug ではなく sanctioned wrapper (registry AND 予約合成) を使う
  return findAvailableSlug(base, (slug) => checkSlugAvailability({ slug }), {
    suffix: LOCAL_SUFFIX,
    maxIndex: LOCAL_MAX_INDEX,
  });
}

// grid 一覧（Map/App）の複製遷移先。エディタ側 duplicateFrom 受け口の契約（設計v3.2）:
// duplicateFrom=複製元uid / draftUid=予約帰属uid(=create uid) / slug=予約済みslug / new=1
export function duplicateEditorPath(editorPath: string, sourceUid: string, reserved: ReservedCopySlug): string {
  return `${editorPath}?duplicateFrom=${sourceUid}&draftUid=${reserved.uid}&slug=${encodeURIComponent(reserved.slug)}&new=1`;
}
