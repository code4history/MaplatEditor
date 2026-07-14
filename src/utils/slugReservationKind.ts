// §7.3 kind 語彙写像の renderer 複製。
// electron 側の electron/services/slugReservationKind.ts と同値表(§7.3)を保つ。
// renderer から electron ファイルを import すると build 境界を跨ぐため、5 行の写像は
// DRY より境界分離を優先して複製する(smoke Part A が electron 側の写像を検証済み)。

export type SlugFieldKind = 'map' | 'app' | 'poi-source' | 'base-map' | 'image-asset';
export type RegistryKind = 'map' | 'app' | 'poi_source' | 'base_map' | 'asset';

const UI_TO_REGISTRY: Record<SlugFieldKind, RegistryKind> = {
  map: 'map',
  app: 'app',
  'poi-source': 'poi_source',
  'base-map': 'base_map',
  'image-asset': 'asset',
};

export function toRegistryKind(uiKind: SlugFieldKind): RegistryKind {
  const kind = UI_TO_REGISTRY[uiKind];
  if (!kind) throw new Error(`Unknown SlugField kind: ${uiKind}`);
  return kind;
}
