// Asset Identity (ADR-0007): 全エディタ資産(map/app/base_map/poi_source/image asset)は
// 不変のUUID(uid)を正準キーとして持ち、ユーザーが編集可能でグローバルに一意な
// slug(表示・URL等に使う識別子)を併せ持つ。本モジュールはその純関数群であり、
// SqliteDataServiceおよびレガシーマイグレータの双方から利用される。
import { randomUUID } from 'node:crypto';

export type AssetKind = 'map' | 'app' | 'base_map' | 'poi_source' | 'asset';

export const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

const MAX_SUFFIX_ATTEMPTS = 10000;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function generateUid(): string {
  return randomUUID();
}

export function resolveSlugCollision(desired: string, isTaken: (s: string) => boolean): string {
  const base = isValidSlug(desired) ? desired : 'untitled';

  if (!isTaken(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 2 + MAX_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = `${base}_${suffix}`;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
  throw new Error(`resolveSlugCollision: could not find a free slug for "${base}" within ${MAX_SUFFIX_ATTEMPTS} attempts`);
}
