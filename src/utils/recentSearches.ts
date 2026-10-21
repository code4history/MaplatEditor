// 一覧トップの検索条件の記憶（直近の検索条件）— 純関数だけを置く。
//
// 設計: .nayuta/2026-10-21-nov26-editor-feat1-design.md（v1.0）§4.2・§4.4・§4.9
// 保存先は electron-store の設定ファイル（キー `recentSearches`）。ここは I/O を持たず、
// 値の正規化・重複排除・上限で切る処理だけを担う（window.settings を扱うのは
// src/composables/useRecentSearches.ts だけ）。
import type { ResourceListKind } from "../components/resource-list/resourceListTypes";

/** 直近の検索条件 1 件。`at` は記録時刻（epoch ms）で、並びの根拠。表示には使わない。 */
export interface RecentSearchEntry {
  q: string;
  at: number;
}

/** 画面（kind）ごとの直近の検索条件。 */
export type RecentSearches = Partial<Record<ResourceListKind, RecentSearchEntry[]>>;

/**
 * 件数上限。**画面の形（グリッド／左右ペイン）ではなく kind で固定する**（設計 §4.1）。
 * 形が将来変わっても履歴の上限が勝手に変わらない。
 */
export const RECENT_SEARCH_LIMIT: Record<ResourceListKind, number> = {
  map: 10,
  "poi-source": 10,
  app: 10,
  "base-map": 5,
  "image-asset": 5,
};

/** 入力の停止から記録するまでの遅延（設計 §4.3、テストで固定する値）。 */
export const RECENT_SEARCH_RECORD_DELAY_MS = 800;

/** electron-store のキー（1 本だけ足す）。 */
export const RECENT_SEARCH_STORE_KEY = "recentSearches";

/** タグとして読めず URL も長くなるため、これを超える q は記録しない（設計 §4.4）。 */
export const RECENT_SEARCH_MAX_QUERY_LENGTH = 200;

/**
 * 履歴に入れる表記へ正規化する。前後の空白（半角・全角）を除くだけで、
 * 内部の空白は畳まない（検索語は空白区切りの AND 検索であり、畳むと結果が変わり得る）。
 *
 * @returns 記録する表記。空（空白のみ）や長すぎる値は `null`（＝記録しない）。
 */
export function normalizeQueryForHistory(q: string): string | null {
  const trimmed = q.replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, "");
  if (!trimmed) return null;
  if (trimmed.length > RECENT_SEARCH_MAX_QUERY_LENGTH) return null;
  return trimmed;
}

/**
 * 重複判定キー。SQLite の LIKE は ASCII について大文字小文字を区別しないため
 * （electron/services/SqliteDataService.ts の `raw LIKE ?`）、`Tokyo` と `tokyo` は
 * 実質同じ検索である（設計 §4.4）。表示は入力どおりの表記を残す。
 */
export function sameSearchKey(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * 1 件記録する。同じ条件が既にあれば件数を増やさず**先頭へ移動**し、
 * 上限を超えた分は末尾から落とす（設計 §4.3-5/6・§4.5）。
 *
 * @param limit 省略時は無制限（呼び出し側が `RECENT_SEARCH_LIMIT[kind]` を渡す）。
 */
export function insertRecentSearch(
  list: RecentSearchEntry[],
  q: string,
  now: number,
  limit: number = Number.POSITIVE_INFINITY,
): RecentSearchEntry[] {
  const normalized = normalizeQueryForHistory(q);
  if (normalized === null) return list;
  const rest = list.filter((entry) => !sameSearchKey(entry.q, normalized));
  return [{ q: normalized, at: now }, ...rest].slice(0, limit);
}

/** 該当 1 件だけを消す（× ボタン）。現在の検索条件には触れない（設計 §4.5）。 */
export function removeRecentSearch(list: RecentSearchEntry[], q: string): RecentSearchEntry[] {
  return list.filter((entry) => !sameSearchKey(entry.q, q));
}

/**
 * 読み込み時の正規化（設計 §4.9）。設定ファイルは利用者が手で編集できる JSON なので、
 * 未知の形・壊れた値を受けても落ちないようにする。**正規化は読み込み時にしか行わない。**
 *
 * - 配列でなければ []
 * - 要素は `{ q: string, at: number }` のみ受理（空 q・200 文字超は捨てる）
 * - 正規化キーで重複を除き（新しい表記を残す）、`at` 降順（同じ at は元の順）に並べ、上限で切る
 */
export function normalizeRecentSearches(value: unknown, kind: ResourceListKind): RecentSearchEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: Array<{ entry: RecentSearchEntry; index: number }> = [];
  value.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object") return;
    const candidate = raw as { q?: unknown; at?: unknown };
    if (typeof candidate.q !== "string") return;
    if (typeof candidate.at !== "number" || !Number.isFinite(candidate.at)) return;
    const q = normalizeQueryForHistory(candidate.q);
    if (q === null) return;
    entries.push({ entry: { q, at: candidate.at }, index });
  });
  entries.sort((a, b) => b.entry.at - a.entry.at || a.index - b.index);
  const seen = new Set<string>();
  const normalized: RecentSearchEntry[] = [];
  for (const { entry } of entries) {
    const key = entry.q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(entry);
    if (normalized.length >= RECENT_SEARCH_LIMIT[kind]) break;
  }
  return normalized;
}
