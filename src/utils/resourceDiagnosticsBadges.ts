import type { ResourceListBadge } from "../components/resource-list/resourceListTypes";

export interface MapResourceDiagnostics {
  kind: "map";
  strictError?: boolean;
  missingPoiRefs?: boolean;
  missingAssetRefs?: boolean;
}

export interface AppResourceDiagnostics {
  kind: "app";
  mapRefError?: boolean;
  missingBaseMapRefs?: boolean;
  missingPoiRefs?: boolean;
  missingAssetRefs?: boolean;
  unsupportedPoisFormat?: boolean;
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
    ];
  }
  if (diagnostics.kind === "app") {
    return [
      ...(diagnostics.mapRefError ? [{ key: "map-ref-error", label: labels.mapRefError, tone: "danger" as const }] : []),
      ...(diagnostics.missingBaseMapRefs ? [{ key: "missing-base-map", label: labels.missingBaseMap, tone: "warning" as const }] : []),
      ...(diagnostics.missingPoiRefs ? [{ key: "missing-poi", label: labels.missingPoi, tone: "warning" as const }] : []),
      ...(diagnostics.missingAssetRefs ? [{ key: "missing-asset", label: labels.missingAsset, tone: "warning" as const }] : []),
      ...(diagnostics.unsupportedPoisFormat ? [{ key: "pois-format", label: labels.poisFormat, tone: "warning" as const }] : []),
    ];
  }
  return diagnostics.missingAssetRefs
    ? [{ key: "missing-asset", label: labels.missingAsset, tone: "warning" as const }]
    : [];
}
