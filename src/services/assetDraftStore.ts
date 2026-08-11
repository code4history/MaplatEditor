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

// M12-T20 (§5.1 実装注意/レビュー Info5): storage key `assetDrafts:{kind}:{assetUid}` の逆パース。
// validUid は uid 中の ':' を許容するため単純 split は不可。プレフィックス除去後の**最初の** ':'
// で kind/uid を分解する（kind 名は固定集合で ':' を含まない）
function parseStorageKey(key: string): { kind: AssetDraftKind; assetUid: string } | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const rest = key.slice(KEY_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) return null;
  const kind = rest.slice(0, sep);
  const assetUid = rest.slice(sep + 1);
  if (!isKind(kind) || !validUid(assetUid)) return null;
  return { kind, assetUid };
}

// M12-T20 (§5.1): draft 削除の main 側チョークポイント。envelope 削除（remove の
// keepStaging でない経路 / removeKey の隔離削除 — 常に）に同期して staging dir 回収等の
// 後始末を注入できる。hook の失敗は envelope 削除自体を妨げない
export interface AssetDraftStoreHooks {
  onRemoved?: (kind: AssetDraftKind, assetUid: string) => void;
}

// 多言語オブジェクト({ja: "..", en: ".."})または文字列から最初の非空文字列を返す
function firstLangValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim();
    }
  }
  return undefined;
}

// 新規下書きカードの識別用に payload から表示名/slug を best-effort 抽出する。
// kind ごとの正確なスキーマには依存せず、代表的なフィールド名を順に試す
function draftLabelOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  return (
    firstLangValue(p.appName) ??
    firstLangValue(p.title) ??
    firstLangValue(p.name)
  );
}

function draftSlugOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  for (const key of ['appID', 'slug', 'mapID']) {
    const v = p[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export class AssetDraftStore {
  constructor(
    private readonly store: AssetDraftKeyValueStore,
    private readonly hooks: AssetDraftStoreHooks = {},
  ) {}

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

  // M12-T20 (§5.1): keepStaging=true は envelope のみ削除し onRemoved（staging 物理削除）を
  // 発火しない（dirty→clean 遷移専用。悪用しても「削除しない」方向のみの緩和で、残渣は
  // 起動時孤児 GC が回収するため安全上の新リスクはない）
  remove(kind: AssetDraftKind, assetUid: string, opts?: { keepStaging?: boolean }): void {
    if (!isKind(kind) || !validUid(assetUid)) return;
    this.removeKey(storageKey(kind, assetUid), opts?.keepStaging === true);
  }

  // M12-T32 §4.3: データフォルダ切替成功時に全ドラフト（envelope + map staging dir）を消去する。
  // 既存の per-draft 削除経路（removeKey → onRemoved → staging fs.remove GC）を反復して通す。
  // index 直接 delete で staging ファイルを孤児化する実装は禁止（回収漏れは起動時孤児 GC が backstop）。
  // list() は index のスナップショットを返すため、反復中の remove による index 変更を安全に横断できる。
  wipeAllDrafts(): void {
    const summaries = this.list();
    for (const { kind, assetUid } of summaries) {
      this.remove(kind, assetUid);
    }
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
            label: draftLabelOf(draft.payload),
            slug: draftSlugOf(draft.payload),
          });
        }
      } catch {
        this.removeKey(key);
      }
    }
    return summaries.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }

  // M12-T20 (§5.1): 隔離削除（get/list の validate 失敗）からの直接呼び出しは keepStaging を
  // 渡さない = onRemoved を**常に**発火する（壊れた envelope → draft 死亡 → staging はゴミ）
  private removeKey(key: string, keepStaging = false): void {
    this.store.delete(key);
    const index = this.store.get<string[]>(INDEX_KEY, []).filter((entry) => entry !== key);
    this.store.set(INDEX_KEY, index);
    if (keepStaging || !this.hooks.onRemoved) return;
    const parsed = parseStorageKey(key);
    if (!parsed) return;
    try {
      this.hooks.onRemoved(parsed.kind, parsed.assetUid);
    } catch (cause) {
      console.warn('[assetDraftStore] onRemoved hook failed:', cause);
    }
  }
}
