// POI ソースの domain layer (Phase 2 Task 3, ADR-0007)。正本は Write Store (maplat.sqlite) の
// poi_sources テーブルで、本サービスは SqliteDataService の CRUD に GeoJSON 純ロジック
// (src/utils/poiGeoJson.ts) と LangResource 正規化 (ADR-0005) を被せる薄い層。
// 旧実装 (electron-store poi-sources.json + poi-sources/{uuid}/source.geojson) はゼロベース置換
// され、旧ファイルは読みも消しもしない (ディスク残置)。
//
// remote ソース (mode='remote') は read-only。fetch 結果のスナップショットを data_json に
// 永続 cache する — 43 §2.1 の「session memory cache」からの意図的逸脱で、POI-118 の
// 「network failure 時は cache で degraded 表示」を再起動を跨いで満たす上位互換
// (計画書 2026-07-09-poi-editor-phase2-poi-backend.md 設計コントラクト参照)。
// fetch payload には POI-121 の閾値を適用: 5MB 超 warning / 50MB 超 登録拒否。
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import SqliteDataService, {
  RevisionConflictError,
  PoiSourceNotFoundError,
  type PoiSourceRecord,
  type PoiSourceSummary,
} from './SqliteDataService';
import {
  normalizeLangResource,
  type LangResource,
} from '../../src/utils/langResource';
import {
  validateFeatureCollection,
  normalizeLegacyPoiList,
  ensureDisplayIds,
  ensureFeatureUids,
  type PoiEditorFC,
  type PoiValidationIssue,
} from '../../src/utils/poiGeoJson';

// POI editor の default 言語 (ADR-0005 既定、poiGeoJson.ts と一致)
const DEFAULT_LANG = 'ja';

const FETCH_TIMEOUT_MS = 10_000;
// POI-121: fetch payload の規模ガード
const REMOTE_WARN_BYTES = 5 * 1024 * 1024; // 5 MiB 超 → warning
const REMOTE_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB 超 → 登録拒否

export interface PoiSourceListRequest {
  query: string;
  page: number;
  pageSize: number;
}

// list の行 = SqliteDataService.PoiSourceSummary (FC blob を含まない)
export interface PoiSourceListResult {
  items: PoiSourceSummary[];
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  total: number;
}

// get の返り値: metadata + 内部形 FeatureCollection (_maplatUid 入り)
export interface PoiSourceDetail {
  uid: string;
  slug: string;
  title: Record<string, string>;
  mode: 'local' | 'remote';
  url: string | null;
  featureCount: number;
  revision: number;
  updatedAt: string;
  readOnly: boolean;
  fc: PoiEditorFC;
}

// Error 結果の機械可読コード (Phase 3 UI が affordance を組み立てる):
// 'network' = fetch 到達不能/timeout (POI-118 の degraded cache 表示対象)、
// 'http-status' = HTTP 非 2xx (remote-gone 等)、'parse' = 応答/ファイルが JSON でない、
// 'not-found' = 対象ソース不在 (並行 delete に負けた upsert 含む)、
// 'invalid-request' = 引数不正 (slug 欠落・非 remote への refresh・拡張子不正)、
// 'internal' = 予期しない内部エラー
export type PoiSourceErrorCode =
  | 'network'
  | 'http-status'
  | 'parse'
  | 'not-found'
  | 'invalid-request'
  | 'internal';

// 保存系の結果 union (MapSaveResult/AppSaveResult と同形。ファイルフェーズが無いため
// Error{uid,slug,revision} 拡張は不要)。'Invalid' = 検証エラーで拒否 (issues 参照)、
// 'ReadOnly' = remote ソースへの save 拒否。Success の issues は warning のみ
export type PoiSourceSaveResult =
  | { result: 'Success'; uid: string; slug: string; revision: number; issues: PoiValidationIssue[] }
  | { result: 'Exist' }
  | { result: 'Invalid'; issues: PoiValidationIssue[] }
  | { result: 'ReadOnly' }
  | { result: 'Error'; code: PoiSourceErrorCode; message?: string }
  | { error: 'revision-conflict'; current: number };

export interface PoiSourceReference {
  kind: 'map' | 'app';
  uid: string;
  slug: string;
}

interface PreparedFc {
  fc: PoiEditorFC;
  issues: PoiValidationIssue[];
  hasError: boolean;
}

type RemoteFetchResult =
  | { ok: true; text: string }
  | { ok: false; tooLarge: true }
  | { ok: false; tooLarge?: false; code: 'network' | 'http-status'; message: string };

export class PoiSourceService {
  private readonly remoteWarnBytes: number;
  private readonly remoteMaxBytes: number;
  private readonly fetchTimeoutMs: number;

  // options はテスト用の閾値注入 (m9-t3 smoke)。実運用は既定値
  constructor(options?: { remoteWarnBytes?: number; remoteMaxBytes?: number; fetchTimeoutMs?: number }) {
    this.remoteWarnBytes = options?.remoteWarnBytes ?? REMOTE_WARN_BYTES;
    this.remoteMaxBytes = options?.remoteMaxBytes ?? REMOTE_MAX_BYTES;
    this.fetchTimeoutMs = options?.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
  }

  // 任意入力 (内部形FC / 交換形FC / 旧POI形式) を内部形へ正規化し検証する。
  // ensureDisplayIds/ensureFeatureUids は内部形入力には冪等 (既存 id/_maplatUid を維持)
  private prepare(input: unknown): PreparedFc {
    const structural = validateFeatureCollection(input);
    const isFc =
      input !== null && typeof input === 'object' && !Array.isArray(input) &&
      (input as any).type === 'FeatureCollection';
    // 旧POI形式 (配列/単体) は FeatureCollection でないため構造エラーを一旦許し、正規化後に再検証する
    if (isFc && structural.some((i) => i.code === 'not-feature-collection')) {
      return { fc: { type: 'FeatureCollection', features: [] }, issues: structural, hasError: true };
    }
    const normalized = normalizeLegacyPoiList(input, DEFAULT_LANG);
    const withIds = ensureDisplayIds(normalized).features;
    const withUids = ensureFeatureUids(withIds);
    const fc: PoiEditorFC = { type: 'FeatureCollection', features: withUids };
    const issues = validateFeatureCollection(fc);
    return { fc, issues, hasError: issues.some((i) => i.level === 'error') };
  }

  private titleInternal(title: unknown): Record<string, string> {
    return normalizeLangResource(title as LangResource | null | undefined, DEFAULT_LANG);
  }

  private detail(record: PoiSourceRecord): PoiSourceDetail {
    return {
      uid: record.uid,
      slug: record.slug,
      title: this.titleInternal(record.title),
      mode: record.mode,
      url: record.url,
      featureCount: record.featureCount,
      revision: record.revision,
      updatedAt: record.updatedAt,
      readOnly: record.mode === 'remote',
      fc: JSON.parse(record.dataJson) as PoiEditorFC,
    };
  }

  // registerAsset/renameAssetSlug の slug 衝突(レースで先取り)を 'Exist' に、並行 delete に負けた
  // upsert (PoiSourceNotFoundError) を Error{code:'not-found'} に写像 (AppDataService と同機構)
  private mapWriteError(e: any): PoiSourceSaveResult {
    if (e instanceof RevisionConflictError) {
      return { error: 'revision-conflict', current: e.current };
    }
    if (e instanceof PoiSourceNotFoundError) {
      return { result: 'Error', code: 'not-found', message: e.message };
    }
    if (e && typeof e.message === 'string' && e.message.startsWith('Slug already in use')) {
      return { result: 'Exist' };
    }
    console.error('[PoiSourceService] write error:', e);
    return { result: 'Error', code: 'internal', message: e instanceof Error ? e.message : String(e) };
  }

  private async createSource(
    slug: string,
    title: unknown,
    mode: 'local' | 'remote',
    fc: PoiEditorFC,
    issues: PoiValidationIssue[],
    url?: string,
  ): Promise<PoiSourceSaveResult> {
    const trimmed = String(slug ?? '').trim();
    if (!trimmed) return { result: 'Error', code: 'invalid-request', message: 'slug is required' };
    if (!(await SqliteDataService.isSlugAvailable(trimmed))) return { result: 'Exist' };
    try {
      const { uid } = await SqliteDataService.createPoiSource(trimmed, {
        title: this.titleInternal(title),
        mode,
        url,
        dataJson: JSON.stringify(fc),
        featureCount: fc.features.length,
      });
      return { result: 'Success', uid, slug: trimmed, revision: 1, issues };
    } catch (e: any) {
      return this.mapWriteError(e);
    }
  }

  // scheme 検査は呼び出し元 (fetchSnapshot) が済ませている前提。
  // 本文は stream で逐次読みし、累積バイト数が remoteMaxBytes を超えた時点で abort する
  // (POI-121)。content-length 事前チェックだけでは chunked 応答を捕捉できず、
  // response.text() は判定前に全量バッファしてしまうため
  private async fetchRemote(url: string): Promise<RemoteFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return { ok: false, code: 'http-status', message: `HTTP ${response.status} ${response.statusText}` };
      }
      // content-length が明らかに上限超過なら本文を読まずに打ち切る
      const contentLength = response.headers.get('content-length');
      if (contentLength && Number.parseInt(contentLength, 10) > this.remoteMaxBytes) {
        controller.abort();
        return { ok: false, tooLarge: true };
      }
      if (!response.body) {
        // body stream 非対応環境の保険 (Node の fetch は常に body を持つ)
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > this.remoteMaxBytes) {
          return { ok: false, tooLarge: true };
        }
        return { ok: true, text };
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > this.remoteMaxBytes) {
          controller.abort();
          return { ok: false, tooLarge: true };
        }
        chunks.push(Buffer.from(value));
      }
      return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
    } catch (e: any) {
      const message = e?.name === 'AbortError' ? 'Fetch timed out' : String(e);
      return { ok: false, code: 'network', message };
    } finally {
      clearTimeout(timeout);
    }
  }

  // fetch → POI-121 サイズガード → JSON parse → 内部形化+検証。
  // 戻り値: 登録/更新に使える snapshot、または失敗を表す PoiSourceSaveResult
  private async fetchSnapshot(
    url: string,
  ): Promise<{ ok: true; fc: PoiEditorFC; issues: PoiValidationIssue[] } | { ok: false; failure: PoiSourceSaveResult }> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, failure: { result: 'Invalid', issues: [{ level: 'error', code: 'unsupported-scheme' }] } };
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { ok: false, failure: { result: 'Invalid', issues: [{ level: 'error', code: 'unsupported-scheme' }] } };
    }

    const fetched = await this.fetchRemote(url);
    if (!fetched.ok) {
      if (fetched.tooLarge) {
        return { ok: false, failure: { result: 'Invalid', issues: [{ level: 'error', code: 'payload-too-large' }] } };
      }
      return { ok: false, failure: { result: 'Error', code: fetched.code, message: fetched.message } };
    }
    const byteSize = Buffer.byteLength(fetched.text, 'utf8');
    if (byteSize > this.remoteMaxBytes) {
      return { ok: false, failure: { result: 'Invalid', issues: [{ level: 'error', code: 'payload-too-large' }] } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fetched.text);
    } catch {
      return { ok: false, failure: { result: 'Error', code: 'parse', message: 'Response is not valid JSON' } };
    }
    const prepared = this.prepare(parsed);
    if (prepared.hasError) {
      return { ok: false, failure: { result: 'Invalid', issues: prepared.issues } };
    }
    const issues = [...prepared.issues];
    // POI-121: fetch payload 自体の 5MB 超 warning (validate の scale-byte-size と重複させない)
    if (byteSize > this.remoteWarnBytes && !issues.some((i) => i.code === 'scale-byte-size')) {
      issues.push({ level: 'warning', code: 'scale-byte-size' });
    }
    return { ok: true, fc: prepared.fc, issues };
  }

  // --- Public API ---

  async list(request: PoiSourceListRequest): Promise<PoiSourceListResult> {
    if (!Number.isInteger(request.page) || request.page < 1) {
      throw new TypeError(`page must be >= 1; got ${request.page}`);
    }
    if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 100) {
      throw new TypeError(`pageSize must be 1-100; got ${request.pageSize}`);
    }
    const query = String(request.query ?? '').trim();
    const all = query
      ? await SqliteDataService.searchPoiSources(query)
      : await SqliteDataService.listPoiSources();
    const start = (request.page - 1) * request.pageSize;
    return {
      items: all.slice(start, start + request.pageSize),
      page: request.page,
      hasPrev: request.page > 1,
      hasNext: start + request.pageSize < all.length,
      total: all.length,
    };
  }

  // uid正準 + slug フォールバック (SqliteDataService.findPoiSourceByRef, ADR-0007)
  async get(ref: string): Promise<PoiSourceDetail | null> {
    const record = await SqliteDataService.findPoiSourceByRef(ref);
    return record ? this.detail(record) : null;
  }

  async createLocal(input: { slug: string; title: LangResource }): Promise<PoiSourceSaveResult> {
    const empty: PoiEditorFC = { type: 'FeatureCollection', features: [] };
    return await this.createSource(input.slug, input.title, 'local', empty, []);
  }

  // 保存はuid正準。検証エラー (level='error') があれば拒否し issues を返す (POI-104 ほか)。
  // remote ソースは read-only (cloneToLocal へ誘導)。expectedRevision は楽観ロック
  async save(
    uid: string,
    input: { slug: string; title: LangResource; fc: unknown; expectedRevision?: number },
  ): Promise<PoiSourceSaveResult> {
    const existing = await SqliteDataService.findPoiSource(uid);
    if (!existing) return { result: 'Error', code: 'not-found', message: `POI source not found: ${uid}` };
    if (existing.mode === 'remote') return { result: 'ReadOnly' };

    const slug = String(input.slug ?? '').trim();
    if (!slug) return { result: 'Error', code: 'invalid-request', message: 'slug is required' };

    const prepared = this.prepare(input.fc);
    if (prepared.hasError) return { result: 'Invalid', issues: prepared.issues };

    if (slug !== existing.slug && !(await SqliteDataService.isSlugAvailable(slug, uid))) {
      return { result: 'Exist' };
    }
    try {
      const { revision } = await SqliteDataService.upsertPoiSource(
        uid,
        slug,
        {
          title: this.titleInternal(input.title),
          mode: 'local',
          dataJson: JSON.stringify(prepared.fc),
          featureCount: prepared.fc.features.length,
        },
        input.expectedRevision ?? undefined,
      );
      return { result: 'Success', uid, slug, revision, issues: prepared.issues };
    } catch (e: any) {
      return this.mapWriteError(e);
    }
  }

  // .geojson/.json を読み、FeatureCollection または 旧POIオブジェクト形式を内部形化して
  // 新規 local ソースとして取り込む。Point以外を含む場合は取込拒否 (POI-104)
  async importFile(input: { slug: string; title: LangResource; filePath: string }): Promise<PoiSourceSaveResult> {
    const ext = path.extname(String(input.filePath ?? '')).toLowerCase();
    if (ext !== '.geojson' && ext !== '.json') {
      return { result: 'Error', code: 'invalid-request', message: `Unsupported file extension: ${ext || '(none)'}` };
    }
    let text: string;
    try {
      text = await readFile(input.filePath, 'utf8');
    } catch (e: any) {
      return { result: 'Error', code: 'not-found', message: `Failed to read file: ${e?.message ?? e}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { result: 'Error', code: 'parse', message: 'File is not valid JSON' };
    }
    const prepared = this.prepare(parsed);
    if (prepared.hasError) return { result: 'Invalid', issues: prepared.issues };
    return await this.createSource(input.slug, input.title, 'local', prepared.fc, prepared.issues);
  }

  // fetch → 正規化/検証 → 成功時のみ登録。fetch snapshot を data_json に永続 cache する
  // (仕様の session memory cache からの意図的逸脱 — 冒頭コメント参照)
  async registerRemote(input: { slug: string; title: LangResource; url: string }): Promise<PoiSourceSaveResult> {
    const url = String(input.url ?? '').trim();
    const snapshot = await this.fetchSnapshot(url);
    if (!snapshot.ok) return snapshot.failure;
    return await this.createSource(input.slug, input.title, 'remote', snapshot.fc, snapshot.issues, url);
  }

  // 明示再取得 (POI-118)。fetch 失敗時は既存 snapshot を無傷に保つ (degraded cache)。
  // fetch を跨いだ並行 delete は upsertPoiSource の not-found ガードが捕捉し、mapWriteError が
  // Error{code:'not-found'} に写像する (削除済みソースを復活させない)
  async refreshRemote(uid: string): Promise<PoiSourceSaveResult> {
    const existing = await SqliteDataService.findPoiSource(uid);
    if (!existing) return { result: 'Error', code: 'not-found', message: `POI source not found: ${uid}` };
    if (existing.mode !== 'remote' || !existing.url) {
      return { result: 'Error', code: 'invalid-request', message: `POI source is not remote: ${uid}` };
    }
    const snapshot = await this.fetchSnapshot(existing.url);
    if (!snapshot.ok) return snapshot.failure;
    try {
      const { revision } = await SqliteDataService.upsertPoiSource(uid, existing.slug, {
        title: this.titleInternal(existing.title),
        mode: 'remote',
        url: existing.url,
        dataJson: JSON.stringify(snapshot.fc),
        featureCount: snapshot.fc.features.length,
      });
      return { result: 'Success', uid, slug: existing.slug, revision, issues: snapshot.issues };
    } catch (e: any) {
      return this.mapWriteError(e);
    }
  }

  // remote (または local) ソースを新規 local ソースへ複製。features (_maplatUid 含む) は維持
  async cloneToLocal(uid: string, input: { slug: string; title?: LangResource }): Promise<PoiSourceSaveResult> {
    const existing = await SqliteDataService.findPoiSource(uid);
    if (!existing) return { result: 'Error', code: 'not-found', message: `POI source not found: ${uid}` };
    const prepared = this.prepare(JSON.parse(existing.dataJson));
    if (prepared.hasError) return { result: 'Invalid', issues: prepared.issues };
    const title = input.title !== undefined && input.title !== null ? input.title : existing.title;
    return await this.createSource(input.slug, title, 'local', prepared.fc, prepared.issues);
  }

  // apps/maps からの参照走査 (AID-006 の器)。Phase 7 で参照が書かれるまで常に空
  async findReferences(uid: string): Promise<PoiSourceReference[]> {
    return await SqliteDataService.findPoiSourceReferences(uid);
  }

  // 削除は参照があってもブロックしない (confirm フロー用に references を返すのみ)
  async delete(uid: string): Promise<{ ok: true; references: PoiSourceReference[] }> {
    const references = await this.findReferences(uid);
    await SqliteDataService.deletePoiSource(uid);
    return { ok: true, references };
  }
}

export default new PoiSourceService();
