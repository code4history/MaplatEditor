// M3-T6: slug 連番採番の共有純関数 (renderer/main 共用、設計 §6.1 — 旧 m12-t5 統合)。
// 3 系統 — (a) 複製 "-copy" (useResourceDuplicate.reserveCopySlug) / (b) inline POI 変換 "-poi"
// (inlinePoiConvert) / (c) import 衝突自動採番 (PoiSourceService.importFile, suffix なし) — の
// 候補生成規則をここへ一本化する。検査手段の差 (予約成立 / 空き確認) は tryAcquire コールバック
// 抽象で吸収する。候補生成は旧 reserveCopySlug の candidate 実装
// (base.slice(0, SLUG_MAX - suffix.length) + suffix) と同値 (挙動不変 — AC6-8(a))。

// suggestSlug と同じ slug 最大長。候補は suffix (連番込み) がこの長さに収まるよう base を切り詰める。
export const SLUG_MAX = 100;
// 連番候補の上限 (旧 COPY_MAX_INDEX と同値)。n=1 (連番なし) 〜 n=SEQUENCE_MAX_INDEX。
export const SEQUENCE_MAX_INDEX = 100;

export interface SlugSequenceOptions {
  /** 連番の前に挟む接尾辞。既定 ""。例 "-copy" / "-poi" */
  suffix?: string;
  /** 候補系列の上限 index。既定 100 (旧 COPY_MAX_INDEX と同値) */
  maxIndex?: number;
  /** slug 最大長。既定 100 (SLUG_MAX / suggestSlug と同値) */
  slugMax?: number;
}

// n=1: base+suffix (連番なし)、n>=2: base+suffix+n。
// base は suffix+連番込みで slugMax に収まるよう切り詰める (旧 reserveCopySlug candidate と同一規則)。
//
// M5-T5: **生成部は必ず "-" で始まる** (人間指示 2026-08-03)。base との間に区切りが無いと
// `foo2` が利用者の付けた名前なのか衝突回避で生成した名前なのか区別できないため。
// suffix ("-copy" / "-poi" / "-local") は既に "-" 始まり ∴ 素の連番のときだけ足りない。
// これを「suffix が空なら」の分岐ではなく **不変条件1つ** として表現する (全系統が同じ規則になる)。
// n=1 は衝突が無く base をそのまま使う ∴ 生成部が存在せず "-" も付かない。
// この非対称があるからこそ「"-" があれば生成名」という判定が成立する。
export function slugCandidate(base: string, n: number, opts?: SlugSequenceOptions): string {
  const generated = (opts?.suffix ?? "") + (n >= 2 ? String(n) : "");
  const tail = generated && !generated.startsWith("-") ? "-" + generated : generated;
  const slugMax = opts?.slugMax ?? SLUG_MAX;
  return base.slice(0, slugMax - tail.length) + tail;
}

// 候補を順に tryAcquire へ渡し、最初に true を返した slug を返す。全候補枯渇は null。
// tryAcquire の意味は呼び出し側の検査手段に委ねる (予約成立 / 空き確認 — 設計レビュー (2-e) の
// 検査手段差はこのコールバック抽象で吸収する)。
export async function findAvailableSlug(
  base: string,
  tryAcquire: (slug: string) => Promise<boolean>,
  opts?: SlugSequenceOptions,
): Promise<string | null> {
  const maxIndex = opts?.maxIndex ?? SEQUENCE_MAX_INDEX;
  for (let n = 1; n <= maxIndex; n++) {
    const candidate = slugCandidate(base, n, opts);
    if (await tryAcquire(candidate)) return candidate;
  }
  return null;
}
