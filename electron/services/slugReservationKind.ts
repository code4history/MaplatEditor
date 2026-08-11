// §7.3 kind 語彙写像（Single Source of Truth）。
// UI(SlugField.assetKind) ⇄ registry/slug_reservations ⇄ draft store(AssetDraftKind) の3系統を接続する。
import type { AssetKind } from './assetIdentity';

export type SlugFieldKind = 'map' | 'app' | 'poi-source' | 'base-map' | 'image-asset';
export type DraftKind = 'map' | 'app' | 'poi' | 'base-map' | 'image-asset';

const UI_TO_REGISTRY: Record<SlugFieldKind, AssetKind> = {
  map: 'map',
  app: 'app',
  'poi-source': 'poi_source',
  'base-map': 'base_map',
  'image-asset': 'asset',
};

const REGISTRY_TO_DRAFT: Record<AssetKind, DraftKind> = {
  map: 'map',
  app: 'app',
  poi_source: 'poi',
  base_map: 'base-map',
  asset: 'image-asset',
};

export function toRegistryKind(uiKind: SlugFieldKind): AssetKind {
  const kind = UI_TO_REGISTRY[uiKind];
  if (!kind) throw new Error(`Unknown SlugField kind: ${uiKind}`);
  return kind;
}

export function toDraftKind(registryKind: AssetKind): DraftKind {
  const kind = REGISTRY_TO_DRAFT[registryKind];
  if (!kind) throw new Error(`Unknown registry kind: ${registryKind}`);
  return kind;
}
