export interface MapListRequest {
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface MapListResult {
  docs: any[];
  prev: boolean;
  next: boolean;
  pageUpdate?: number;
}

// uid正準の保存要求 (ADR-0007)。uid無指定は新規作成、copyFromUid指定は複製。
// expectedRevision は楽観ロック(不一致で revision-conflict を返す)
export interface MapSaveRequest {
  mapObject: any;
  tins: any[];
  uid?: string | null;
  slug?: string;
  expectedRevision?: number | null;
  copyFromUid?: string | null;
}

export type MapSaveResult =
  | { result: 'Success'; uid: string; slug: string; revision: number }
  | { result: 'Exist' }
  | { result: 'Error' }
  | { error: 'revision-conflict'; current: number };

export interface StorageAdapter {
  listMaps(request: MapListRequest): Promise<MapListResult>;
  deleteMap(uidOrMapID: string): Promise<void>;
  readMapForEdit(uidOrMapID: string): Promise<any>;
  readMapForPreview(uidOrMapID: string): Promise<any>;
  saveMapForEdit(request: MapSaveRequest): Promise<MapSaveResult>;
  isSlugAvailable(slug: string, excludeUid?: string): Promise<boolean>;
}

export interface StorageAdapterDependencies {
  listMaps(query: string, page: number, pageSize: number): Promise<MapListResult>;
  deleteMap(uidOrMapID: string): Promise<void>;
  readMapForEdit(uidOrMapID: string): Promise<any>;
  readMapForPreview?(uidOrMapID: string): Promise<any>;
  saveMapForEdit(request: MapSaveRequest): Promise<MapSaveResult>;
  isSlugAvailable(slug: string, excludeUid?: string): Promise<boolean>;
}

export class ServiceBackedStorageAdapter implements StorageAdapter {
  constructor(private readonly dependencies: StorageAdapterDependencies) {}

  async listMaps(request: MapListRequest): Promise<MapListResult> {
    const { query, page, pageSize } = normalizeMapListRequest(request);
    return await this.dependencies.listMaps(query, page, pageSize);
  }

  async deleteMap(uidOrMapID: string): Promise<void> {
    assertMapID(uidOrMapID);
    await this.dependencies.deleteMap(uidOrMapID);
  }

  async readMapForEdit(uidOrMapID: string): Promise<any> {
    assertMapID(uidOrMapID);
    const result = await this.dependencies.readMapForEdit(uidOrMapID);
    assertJsonSerializable(result, 'map edit read result');
    return result;
  }

  async readMapForPreview(uidOrMapID: string): Promise<any> {
    assertMapID(uidOrMapID);
    const reader = this.dependencies.readMapForPreview ?? this.dependencies.readMapForEdit;
    const result = await reader(uidOrMapID);
    assertJsonSerializable(result, 'map preview read result');
    return result;
  }

  async saveMapForEdit(request: MapSaveRequest): Promise<MapSaveResult> {
    const { mapObject, tins } = request;
    assertJsonSerializable(mapObject, 'mapObject');
    assertJsonSerializable(tins, 'tins');
    if (!Array.isArray(tins)) {
      throw new TypeError('tins must be an array');
    }

    const result = await this.dependencies.saveMapForEdit(request);
    if (
      result && typeof result === 'object' &&
      (('result' in result && ['Success', 'Exist', 'Error'].includes((result as any).result)) ||
        ('error' in result && (result as any).error === 'revision-conflict'))
    ) {
      return result;
    }
    throw new TypeError(`unexpected map save result: ${JSON.stringify(result)}`);
  }

  async isSlugAvailable(slug: string, excludeUid?: string): Promise<boolean> {
    assertMapID(slug);
    return await this.dependencies.isSlugAvailable(slug, excludeUid);
  }
}

export function assertMapID(mapID: unknown): asserts mapID is string {
  if (typeof mapID !== 'string' || mapID.trim().length === 0) {
    throw new TypeError('mapID must be a non-empty string');
  }
}

export function normalizeMapListRequest(request: MapListRequest): Required<MapListRequest> {
  const query = typeof request.query === 'string' ? request.query : '';
  const page = normalizePositiveInteger(request.page, 1, 'page');
  // pageSize=0 は全件取得(ページネーションなし)
  const pageSize = normalizeNonNegativeInteger(request.pageSize, 20, 'pageSize');
  return { query, page, pageSize };
}

export function assertJsonSerializable(value: unknown, label: string): void {
  try {
    JSON.parse(JSON.stringify(value));
  } catch {
    throw new TypeError(`${label} must be JSON serializable`);
  }
}

function normalizePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}
