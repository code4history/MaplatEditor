// Asset Identity (ADR-0007): 全エディタ資産(map/app/base_map/poi_source/image asset)は
// 不変のUUID(uid)を正準キーとして持ち、ユーザーが編集可能でグローバルに一意な
// slug(表示・URL等に使う識別子)を併せ持つ。本モジュールはその純関数群であり、
// SqliteDataServiceおよびレガシーマイグレータの双方から利用される。
export type AssetKind = 'map' | 'app' | 'base_map' | 'poi_source' | 'asset';

export const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function generateUid(): string {
  return crypto.randomUUID();
}

export function resolveSlugCollision(desired: string, isTaken: (s: string) => boolean): string {
  const base = isValidSlug(desired) ? desired : 'untitled';

  if (!isTaken(base)) {
    return base;
  }

  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (isTaken(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}
