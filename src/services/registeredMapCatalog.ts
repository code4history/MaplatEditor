// MIRROR of MaplatEditorSaaS/packages/shared/src/contracts/registered-map-selector.ts
// 正本に変更があれば、smoke script (m1-t2-registered-map-catalog-smoke.mjs)
// の shape assertion が検知する

export type RegisteredMapCatalogKey = string;

export type RegisteredMapStatus =
  | "ready"
  | "processing"
  | "failed"
  | "unknown";

export interface RegisteredMapSummary {
  catalogKey: RegisteredMapCatalogKey;
  runtimeMapId: string;
  title: string;
  width: number | null;
  height: number | null;
  thumbnailUrl?: string | null;
  status: RegisteredMapStatus;
  workspaceUlid?: string;
  mapUlid?: string;
}

export interface RegisteredMapListRequest {
  query: string;
  page: number;
  pageSize: number;
}

export interface RegisteredMapListResponse {
  items: RegisteredMapSummary[];
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface RegisteredMapCatalog {
  listMaps(request: RegisteredMapListRequest): Promise<RegisteredMapListResponse>;
}

export interface SelectedRegisteredMapRef {
  kind: "registered-map";
  runtimeMapId: string;
  catalogKey: RegisteredMapCatalogKey;
}

export interface DesktopMapItem {
  mapID: string;
  title: string;
  image: string | null;
  width?: number;
  height?: number;
}

export interface DesktopListResult {
  docs: DesktopMapItem[];
  prev: boolean;
  next: boolean;
  pageUpdate?: number;
}

// --- 内部 helpers ---

function assertValidPageSize(pageSize: unknown): asserts pageSize is number {
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new TypeError(
      `pageSize must be a positive integer; got ${String(pageSize)}`
    );
  }
}

function assertMaplistAvailable(maplist: unknown): asserts maplist is {
  request: (query: string, page: number, pageSize?: number) => Promise<DesktopListResult>;
} {
  if (
    typeof maplist !== "object" || maplist === null ||
    typeof (maplist as { request?: unknown }).request !== "function"
  ) {
    throw new Error(
      "window.maplist.request is not available; createDesktopRegisteredMapCatalog requires Electron preload to expose maplist"
    );
  }
}

function getMaplist(): unknown {
  try {
    return (window as any).maplist;
  } catch {
    return undefined;
  }
}

// --- 正規化関数 ---

export function normalizeDesktopMapItem(item: DesktopMapItem): RegisteredMapSummary {
  return {
    catalogKey: `desktop:${item.mapID}`,
    runtimeMapId: item.mapID,
    title: item.title,
    width: item.width ?? null,
    height: item.height ?? null,
    thumbnailUrl: item.image,
    status: "unknown",
  };
}

export function normalizeDesktopListResult(
  result: DesktopListResult,
  requestedPage: number
): RegisteredMapListResponse {
  return {
    items: result.docs.map(normalizeDesktopMapItem),
    page: result.pageUpdate ?? requestedPage,
    hasPrev: result.prev,
    hasNext: result.next,
  };
}

// --- Factory 関数 ---

export function createDesktopRegisteredMapCatalog(): RegisteredMapCatalog {
  return {
    async listMaps(request) {
      assertMaplistAvailable(getMaplist());
      assertValidPageSize(request.pageSize);
      const result = await (window as any).maplist.request(
        request.query,
        request.page,
        request.pageSize
      );
      return normalizeDesktopListResult(result, request.page);
    },
  };
}

export function createDesktopRegisteredMapCatalogFromBackend(
  backend: (query: string, page: number, pageSize: number) => Promise<DesktopListResult>
): RegisteredMapCatalog {
  return {
    async listMaps(request) {
      assertValidPageSize(request.pageSize);
      const result = await backend(request.query, request.page, request.pageSize);
      return normalizeDesktopListResult(result, request.page);
    },
  };
}
