import {
  ASSET_DRAFT_KINDS,
  type AssetDraftEnvelope,
  type AssetDraftKind,
  type AssetDraftSummary,
} from '../types/assetDraft';

export { ASSET_DRAFT_KINDS };
export const MAX_ASSET_DRAFT_BYTES = 20 * 1024 * 1024;
const INDEX_KEY = 'assetDrafts:index';
const KEY_PREFIX = 'assetDrafts:';

export interface AssetDraftKeyValueStore {
  get<T>(key: string, fallback?: T): T;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

const isKind = (value: unknown): value is AssetDraftKind =>
  typeof value === 'string' && (ASSET_DRAFT_KINDS as readonly string[]).includes(value);

const validUid = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);

export function validateAssetDraftEnvelope(value: unknown): asserts value is AssetDraftEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Draft envelope must be an object');
  const draft = value as Partial<AssetDraftEnvelope>;
  if (draft.schemaVersion !== 1) throw new TypeError('Unsupported draft schemaVersion');
  if (!isKind(draft.kind)) throw new TypeError('Invalid draft kind');
  if (!validUid(draft.assetUid)) throw new TypeError('Invalid draft assetUid');
  if (draft.baseRevision !== null && (!Number.isInteger(draft.baseRevision) || (draft.baseRevision as number) < 0)) {
    throw new TypeError('Invalid draft baseRevision');
  }
  if (typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))) {
    throw new TypeError('Invalid draft updatedAt');
  }
  if (!Object.prototype.hasOwnProperty.call(draft, 'payload') || draft.payload === undefined) {
    throw new TypeError('Draft payload is required');
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(draft);
  } catch {
    throw new TypeError('Draft must be JSON serializable');
  }
  if (!encoded) throw new TypeError('Draft must be JSON serializable');
  if (Buffer.byteLength(encoded, 'utf8') > MAX_ASSET_DRAFT_BYTES) throw new RangeError('Draft payload is too large');
}

const storageKey = (kind: AssetDraftKind, assetUid: string) => `${KEY_PREFIX}${kind}:${assetUid}`;

export class AssetDraftStore {
  constructor(private readonly store: AssetDraftKeyValueStore) {}

  put(value: AssetDraftEnvelope): void {
    validateAssetDraftEnvelope(value);
    const key = storageKey(value.kind, value.assetUid);
    this.store.set(key, JSON.parse(JSON.stringify(value)));
    const index = new Set(this.store.get<string[]>(INDEX_KEY, []));
    index.add(key);
    this.store.set(INDEX_KEY, [...index].sort());
  }

  get(kind: AssetDraftKind, assetUid: string): AssetDraftEnvelope | null {
    if (!isKind(kind) || !validUid(assetUid)) return null;
    const key = storageKey(kind, assetUid);
    const value = this.store.get<unknown>(key, null);
    if (value === null) return null;
    try {
      validateAssetDraftEnvelope(value);
      return JSON.parse(JSON.stringify(value));
    } catch {
      this.removeKey(key);
      return null;
    }
  }

  remove(kind: AssetDraftKind, assetUid: string): void {
    if (!isKind(kind) || !validUid(assetUid)) return;
    this.removeKey(storageKey(kind, assetUid));
  }

  list(kind?: AssetDraftKind): AssetDraftSummary[] {
    if (kind !== undefined && !isKind(kind)) throw new TypeError('Invalid draft kind');
    const summaries: AssetDraftSummary[] = [];
    for (const key of this.store.get<string[]>(INDEX_KEY, [])) {
      const value = this.store.get<unknown>(key, null);
      try {
        validateAssetDraftEnvelope(value);
        const draft = value as AssetDraftEnvelope;
        if (kind === undefined || draft.kind === kind) {
          summaries.push({
            kind: draft.kind,
            assetUid: draft.assetUid,
            baseRevision: draft.baseRevision,
            updatedAt: draft.updatedAt,
          });
        }
      } catch {
        this.removeKey(key);
      }
    }
    return summaries.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }

  private removeKey(key: string): void {
    this.store.delete(key);
    const index = this.store.get<string[]>(INDEX_KEY, []).filter((entry) => entry !== key);
    this.store.set(INDEX_KEY, index);
  }
}
