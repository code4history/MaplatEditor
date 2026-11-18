import type { ResourceListBadge } from "../components/resource-list/resourceListTypes";

export interface MapResourceDiagnostics {
  kind: "map";
  strictError?: boolean;
  missingPoiRefs?: boolean;
  missingAssetRefs?: boolean;
  /** 帰属表記（attr）が無い */
  missingAttribution?: boolean;
}

export interface AppResourceDiagnostics {
  kind: "app";
  mapRefError?: boolean;
  missingBaseMapRefs?: boolean;
  missingPoiRefs?: boolean;
  missingAssetRefs?: boolean;
  unsupportedPoisFormat?: boolean;
  /** 帰属表記が無い地図・ベースマップをソースに持つ */
  missingAttribution?: boolean;
}

export interface PoiSourceResourceDiagnostics {
  kind: "poi-source";
  missingAssetRefs?: boolean;
}

export type ResourceDiagnostics =
  | MapResourceDiagnostics
  | AppResourceDiagnostics
  | PoiSourceResourceDiagnostics;

export interface DiagnosticsBadgeLabels {
  strictError: string;
  mapRefError: string;
  missingBaseMap: string;
  missingPoi: string;
  missingAsset: string;
  poisFormat: string;
  /** 帰属表記が無いことの印。渡さない一覧（POI ソース）では出さない */
  missingAttribution?: string;
}

// 帰属表記が無いことの印（地図・アプリ・ベースマップの一覧で同じ形）
export function attributionBadge(missing: boolean | undefined, labels: { missingAttribution?: string }): ResourceListBadge[] {
  if (!missing || !labels.missingAttribution) return [];
  return [{ key: "missing-attribution", label: labels.missingAttribution, tone: "warning" }];
}

export function buildResourceDiagnosticsBadges(
  diagnostics: ResourceDiagnostics | null | undefined,
  labels: DiagnosticsBadgeLabels,
): ResourceListBadge[] {
  if (!diagnostics) return [];
  if (diagnostics.kind === "map") {
    return [
      ...(diagnostics.strictError ? [{ key: "strict-error", label: labels.strictError, tone: "danger" as const }] : []),
      ...(diagnostics.missingPoiRefs ? [{ key: "missing-poi", label: labels.missingPoi, tone: "warning" as const }] : []),
      ...(diagnostics.missingAssetRefs ? [{ key: "missing-asset", label: labels.missingAsset, tone: "warning" as const }] : []),
      ...attributionBadge(diagnostics.missingAttribution, labels),
    ];
  }
  if (diagnostics.kind === "app") {
    return [
      ...(diagnostics.mapRefError ? [{ key: "map-ref-error", label: labels.mapRefError, tone: "danger" as const }] : []),
      ...(diagnostics.missingBaseMapRefs ? [{ key: "missing-base-map", label: labels.missingBaseMap, tone: "warning" as const }] : []),
      ...(diagnostics.missingPoiRefs ? [{ key: "missing-poi", label: labels.missingPoi, tone: "warning" as const }] : []),
      ...(diagnostics.missingAssetRefs ? [{ key: "missing-asset", label: labels.missingAsset, tone: "warning" as const }] : []),
      ...(diagnostics.unsupportedPoisFormat ? [{ key: "pois-format", label: labels.poisFormat, tone: "warning" as const }] : []),
      ...attributionBadge(diagnostics.missingAttribution, labels),
    ];
  }
  return diagnostics.missingAssetRefs
    ? [{ key: "missing-asset", label: labels.missingAsset, tone: "warning" as const }]
    : [];
}
