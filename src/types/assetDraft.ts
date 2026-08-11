export const ASSET_DRAFT_KINDS = [
  'map',
  'app',
  'poi',
  'base-map',
  'image-asset',
] as const;

export type AssetDraftKind = (typeof ASSET_DRAFT_KINDS)[number];

export interface AssetDraftEnvelope<T = unknown> {
  schemaVersion: 1;
  kind: AssetDraftKind;
  assetUid: string;
  baseRevision: number | null;
  updatedAt: string;
  payload: T;
}

export interface AssetDraftSummary {
  kind: AssetDraftKind;
  assetUid: string;
  baseRevision: number | null;
  updatedAt: string;
  /** payload から best-effort 抽出した表示名(新規下書きカードの識別用)。抽出不能時は undefined */
  label?: string;
  /** payload から best-effort 抽出した slug。抽出不能時は undefined */
  slug?: string;
}
