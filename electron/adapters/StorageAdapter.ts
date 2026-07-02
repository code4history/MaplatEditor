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

export interface MapSaveRequest {
  mapObject: any;
  tins: any[];
}

export type MapSaveResult = 'Success' | 'Exist' | 'Error';

export interface StorageAdapter {
  listMaps(request: MapListRequest): Promise<MapListResult>;
  deleteMap(mapID: string): Promise<void>;
  readMapForEdit(mapID: string): Promise<any>;
  readMapForPreview(mapID: string): Promise<any>;
  saveMapForEdit(request: MapSaveRequest): Promise<MapSaveResult>;
  isMapIdAvailable(mapID: string): Promise<boolean>;
}

export interface StorageAdapterDependencies {
  listMaps(query: string, page: number, pageSize: number): Promise<MapListResult>;
  deleteMap(mapID: string): Promise<void>;
  readMapForEdit(mapID: string): Promise<any>;
  readMapForPreview?(mapID: string): Promise<any>;
  saveMapForEdit(mapObject: any, tins: any[]): Promise<string>;
  isMapIdAvailable(mapID: string): Promise<boolean>;
}

export class ServiceBackedStorageAdapter implements StorageAdapter {
  constructor(private readonly dependencies: StorageAdapterDependencies) {}

  async listMaps(request: MapListRequest): Promise<MapListResult> {
    const { query, page, pageSize } = normalizeMapListRequest(request);
    return await this.dependencies.listMaps(query, page, pageSize);
  }

  async deleteMap(mapID: string): Promise<void> {
    assertMapID(mapID);
    await this.dependencies.deleteMap(mapID);
  }

  async readMapForEdit(mapID: string): Promise<any> {
    assertMapID(mapID);
    const result = await this.dependencies.readMapForEdit(mapID);
    assertJsonSerializable(result, 'map edit read result');
    return result;
  }

  async readMapForPreview(mapID: string): Promise<any> {
    assertMapID(mapID);
    const reader = this.dependencies.readMapForPreview ?? this.dependencies.readMapForEdit;
    const result = await reader(mapID);
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

    const result = await this.dependencies.saveMapForEdit(mapObject, tins);
    if (result === 'Success' || result === 'Exist' || result === 'Error') {
      return result;
    }
    throw new TypeError(`unexpected map save result: ${result}`);
  }

  async isMapIdAvailable(mapID: string): Promise<boolean> {
    assertMapID(mapID);
    return await this.dependencies.isMapIdAvailable(mapID);
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
  const pageSize = normalizePositiveInteger(request.pageSize, 20, 'pageSize');
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
