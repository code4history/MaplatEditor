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
  // 新規作成の明示合図 (D11改)。true=create経路(uid採用)、なし/false=従来のuid有無dispatch
  create?: boolean;
  // UID維持改名の残作業引き継ぎ (D5改)。Map専用: originals(slugキー)改名の再試行救済
  renameFromSlug?: string;
}

export type MapSaveResult =
  | { result: 'Success'; uid: string; slug: string; revision: number }
  | { result: 'Exist' }
  // uid/slug/revision付きのErrorは「DBコミット済み・ファイル操作のみ失敗」。
  // レンダラはrevision等を補正してから再試行する(偽のrevision-conflict防止)。
  // errorKey は additive (M13-T2 §5.3/§7): DBに未到達の reject (例: originals 未対応拡張子)
  // では uid/slug/revision を伴わず errorKey のみを返す
  | { result: 'Error'; uid?: string; slug?: string; revision?: number; errorKey?: string }
  | { error: 'revision-conflict'; current: number };

// Asset UID (UUIDv4) の形状 (ADR-0007)。slugは英数+ハイフンを許すためUUID形状と
// 重なり得る — uid引数の検証と uid優先解決の分岐に使う。
// (本モジュールは m1 smoke が単一ファイルでtranspileするため、importせずここに定義する)
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // uid正準フィールドの境界検証 (ADR-0007)
    if (request.slug != null) assertMapID(request.slug);
    if (request.uid != null) assertUid(request.uid, 'uid');
    if (request.copyFromUid != null) assertUid(request.copyFromUid, 'copyFromUid');
    if (request.renameFromSlug != null) assertMapID(request.renameFromSlug);
    if (request.create != null && typeof request.create !== 'boolean') {
      throw new TypeError('create must be a boolean');
    }
    if (request.expectedRevision != null &&
        (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 1)) {
      throw new TypeError('expectedRevision must be a positive integer');
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
    if (excludeUid != null) assertUid(excludeUid, 'excludeUid');
    return await this.dependencies.isSlugAvailable(slug, excludeUid);
  }
}

export function assertMapID(mapID: unknown): asserts mapID is string {
  if (typeof mapID !== 'string' || mapID.trim().length === 0) {
    throw new TypeError('mapID must be a non-empty string');
  }
}

export function assertUid(uid: unknown, label: string): asserts uid is string {
  if (typeof uid !== 'string' || !UUID_PATTERN.test(uid)) {
    throw new TypeError(`${label} must be a UUID`);
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
