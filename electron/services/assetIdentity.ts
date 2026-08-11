// Asset Identity (ADR-0007): 全エディタ資産(map/app/base_map/poi_source/image asset)は
// 不変のUUID(uid)を正準キーとして持ち、ユーザーが編集可能でグローバルに一意な
// slug(表示・URL等に使う識別子)を併せ持つ。本モジュールはその純関数群であり、
// SqliteDataServiceおよびレガシーマイグレータの双方から利用される。
import { randomUUID } from 'node:crypto';
// M5-T10: 候補生成規則の正本。renderer/main 共用の依存ゼロ純関数モジュールである
// (electron/ → src/utils/ の境界越えには importSlugResolver.ts:25 の前例がある)。
import { findAvailableSlugSync, SEQUENCE_MAX_INDEX } from '../../src/utils/slugSequence';

export type AssetKind = 'map' | 'app' | 'base_map' | 'poi_source' | 'asset';

export const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function generateUid(): string {
  return randomUUID();
}

/**
 * 移行 / seed の slug 衝突解決。
 *
 * 【候補生成規則は持たない】(M5-T10)
 * `base`, `base-2`, `base-3` … と上限・長さ切詰は `src/utils/slugSequence.ts` が正本であり、
 * import (importSlugResolver) / 複製 "-copy" / inline POI 変換 "-poi" と共有する。
 * **生成部が必ず "-" で始まる**ことにより、利用者が付けた名前と衝突回避で生成した名前が
 * 区別できる (m5-t5 の不変条件)。旧実装の `base_2` はこの区別を壊していた —
 * ビルトインカタログ自身が `gsi_ort_USA10` のような下線入り ID を持つためである。
 *
 * 【ここが持つのは移行固有の方針2点だけ】
 *   1. 無効 slug を 'untitled' へ正規化する — import は拒否して利用者に直させられるが、
 *      **移行には拒否する相手が居ない**。nedb の _id が無効でも救済するしかない
 *   2. 枯渇は throw — 移行の途中で null を受けても呼び出し側に打つ手が無い
 *
 * 【なぜ同期版を使うか】呼び出し元3箇所はいずれも node:sqlite の同期トランザクション内に
 * あり await を跨げない (SqliteDataService の applyBuiltinBaseMapSeed / importLegacyMaps /
 * importLegacyBaseMaps)。
 *
 * @param isTaken 取られていれば true。正本の述語は逆向き (isAvailable) なので、
 *                反転はこの関数の中に閉じる (呼び出し元3箇所のシグネチャは変えない)。
 */
export function resolveSlugCollision(desired: string, isTaken: (s: string) => boolean): string {
  const base = isValidSlug(desired) ? desired : 'untitled';
  const found = findAvailableSlugSync(base, (candidate) => !isTaken(candidate));
  if (found === null) {
    throw new Error(`resolveSlugCollision: could not find a free slug for "${base}" within ${SEQUENCE_MAX_INDEX} attempts`);
  }
  return found;
}
