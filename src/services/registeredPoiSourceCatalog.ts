import type { FeatureCollection, Point } from "geojson";

export type PoiSourceCatalogKey = string;
export type PoiSourceMode = "local" | "remote";
export type PoiSourceStatus = "ready" | "invalid" | "unreachable" | "unknown";

export type PoiSourceValidationErrorCode =
  | "invalid_json"
  | "not_feature_collection"
  | "unsupported_geometry"
  | "missing_name"
  | "duplicate_feature_id"
  | "network_error"
  | "timeout"
  | "tls_error"
  | "unsupported_scheme"
  | "payload_too_large";

export interface PoiSourceValidation {
  status: PoiSourceStatus;
  checkedAt?: string;
  errorCode?: PoiSourceValidationErrorCode;
  message?: string;
}

export interface PoiSourceSummary {
  catalogKey: PoiSourceCatalogKey;
  sourceId: string;
  title: string;
  mode: PoiSourceMode;
  featureCount: number | null;
  url?: string;
  status: PoiSourceStatus;
  readOnly: boolean;
  updatedAt?: string;
  validation: PoiSourceValidation;
}

export interface PoiSourceListRequest {
  query: string;
  page: number;
  pageSize: number;
}

export interface PoiSourceListResponse {
  items: PoiSourceSummary[];
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export type PoiFeatureCollection = FeatureCollection<Point, Record<string, unknown>>;

export interface PoiSourceDocument {
  summary: PoiSourceSummary;
  geojson?: PoiFeatureCollection;
  remote?: {
    url: string;
    lastFetchedAt?: string;
    lastValidatedAt?: string;
  };
}

export interface PoiSourceCreateLocalInput {
  title: string;
  geojson?: PoiFeatureCollection | { kind: "empty" };
}

export interface PoiSourceRegisterRemoteInput {
  title: string;
  url: string;
}

export type PoiSourceValidateRemoteInput =
  | { kind: "source"; sourceId: string }
  | { kind: "url"; url: string };

export interface SelectedPoiSourceRef {
  kind: "registered-poi-source";
  sourceId: string;
  catalogKey: PoiSourceCatalogKey;
  mode: PoiSourceMode;
  cachedTitle?: string | Record<string, string>;
}
