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
import type { FeatureCollection } from 'geojson';

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
  toExportForm,
  normalizePoiSourceCollection,
  resolvePoiSourceLanguage,
  type PoiEditorFC,
  type PoiValidationIssue,
} from '../../src/utils/poiGeoJson';
import { findAvailableSlug } from '../../src/utils/slugSequence';
import type { PoiZipImport } from './PoiPackageService';
import SettingsService from './SettingsService';
import { UUID_PATTERN } from '../adapters/StorageAdapter';

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
  lang: string;
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
  | { ok: true; text: string; contentLanguage?: string }
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
  private prepare(input: unknown, fallbackLang: string = DEFAULT_LANG): PreparedFc {
    const structural = validateFeatureCollection(input);
    const isFc =
      input !== null && typeof input === 'object' && !Array.isArray(input) &&
      (input as any).type === 'FeatureCollection';
    // 旧POI形式 (配列/単体) は FeatureCollection でないため構造エラーを一旦許し、正規化後に再検証する
    if (isFc && structural.some((i) => i.code === 'not-feature-collection')) {
      return { fc: { type: 'FeatureCollection', features: [] }, issues: structural, hasError: true };
    }
    const normalizedCollection = normalizePoiSourceCollection(input, fallbackLang);
    const withUids = normalizedCollection.features;
    // 仕様 §2.3: layer metadata (icon/selectedIcon/hide は編集対象 POI-111、
    // poiTemplate/iconTemplate/poiStyle は UI 無しで round-trip 保持、未知キーも POI-007 系
    // テンプレートの将来拡張のため保持) を save/importFile/registerRemote/refreshRemote/
    // cloneToLocal の全経路 (すべてここを通る) で保持する。ただし FC.id / FC.name は
    // エディタが独立概念として持たない (slug/title 由来、export 時にのみ書き込む、§2.3) ため
    // ここで削除する — これにより data_json が uid/slug/revision を含まない不変条件
    // (ADR-0007) も自動的に守られる (FC.id が slug と同じ文字列であっても data_json には残らない)。
    // m18-t5: layer metadata の正本位置は FC.properties 直下（過去形式として FC トップレベルも受容）。
    // FC.properties を優先で layerMeta へ重ねる。
    const { type: _type, features: _features, id: _id, name: _name, lang: _lang, properties: _props, ...layerMeta } = isFc
      ? (input as Record<string, unknown>)
      : {};
    if (isFc) {
      const fcProps = (input as Record<string, unknown>).properties;
      if (fcProps && typeof fcProps === 'object' && !Array.isArray(fcProps)) {
        Object.assign(layerMeta, fcProps);
      }
    }
    const fc: PoiEditorFC = { ...layerMeta, type: 'FeatureCollection', lang: normalizedCollection.lang, features: withUids };
    const issues = validateFeatureCollection(fc);
    return { fc, issues, hasError: issues.some((i) => i.level === 'error') };
  }

  private withLanguageOverride(input: unknown, lang: string | undefined, override: boolean | undefined): unknown {
    if (!override || !input || typeof input !== 'object' || Array.isArray(input)) return input;
    return { ...(input as Record<string, unknown>), lang: resolvePoiSourceLanguage(lang, DEFAULT_LANG) };
  }

  private titleInternal(title: unknown, lang: string = DEFAULT_LANG): Record<string, string> {
    return normalizeLangResource(title as LangResource | null | undefined, lang);
  }

  private detail(record: PoiSourceRecord): PoiSourceDetail {
    const fc = JSON.parse(record.dataJson) as PoiEditorFC;
    const lang = resolvePoiSourceLanguage(fc.lang, SettingsService.get('lang'));
    return {
      uid: record.uid,
      slug: record.slug,
      title: this.titleInternal(record.title, lang),
      lang,
      mode: record.mode,
      url: record.url,
      featureCount: record.featureCount,
      revision: record.revision,
      updatedAt: record.updatedAt,
      readOnly: record.mode === 'remote',
      fc: { ...fc, lang },
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
    // slug 予約 promote conflict(M11-T7/AC4)も duplicate として operation 診断へ写像する
    if (e?.kind === 'slug-reservation-conflict') {
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
    presetUid?: string,
  ): Promise<PoiSourceSaveResult> {
    const trimmed = String(slug ?? '').trim();
    if (!trimmed) return { result: 'Error', code: 'invalid-request', message: 'slug is required' };
    // preset uid (D11改/M11-T7): renderer 事前採番 uid。slug 予約の帰属(asset_uid)と行 uid を
    // 一致させ promote を成立させる。UUID 形状のみ受理(registry 汚染防止)
    if (presetUid != null && !UUID_PATTERN.test(presetUid)) {
      return { result: 'Error', code: 'invalid-request', message: 'uid must be a UUID' };
    }
    if (!(await SqliteDataService.isSlugAvailable(trimmed, presetUid))) return { result: 'Exist' };
    try {
      const { uid } = await SqliteDataService.createPoiSource(trimmed, {
        title: this.titleInternal(title, fc.lang),
        mode,
        url,
        dataJson: JSON.stringify(fc),
        featureCount: fc.features.length,
      }, presetUid);
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
        return { ok: true, text, contentLanguage: response.headers.get('content-language') || undefined };
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
      return { ok: true, text: Buffer.concat(chunks).toString('utf8'), contentLanguage: response.headers.get('content-language') || undefined };
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
    fallbackLang: string = DEFAULT_LANG,
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
    const parsedLang = parsed && typeof parsed === 'object' ? (parsed as any).lang : undefined;
    const prepared = this.prepare(
      parsed,
      resolvePoiSourceLanguage(parsedLang, fetched.contentLanguage || fallbackLang),
    );
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

  // preview / package export 用の export 形 FC (POI-117/143)。get と同じ uid正準+slugフォールバック
  // 解決 (remote ソースも data_json の snapshot cache から同様に返る)。FC.id=slug / FC.name=title を
  // 書き込み、_maplat* を剥がし、座標を7桁丸め (Write Store は変更しないため精度は劣化しない)。
  // 見つからない/読めない参照は null (呼び出し側の poiReferenceResolver が要素落ち+警告に写像)
  async exportForm(ref: string): Promise<FeatureCollection | null> {
    try {
      const detail = await this.get(ref);
      if (!detail) return null;
      return toExportForm(detail.fc, detail.slug, detail.title, {
        roundCoordinates: true,
        defaultLang: detail.lang,
      });
    } catch (e) {
      console.error('[PoiSourceService] exportForm failed:', ref, e);
      return null;
    }
  }

  // M11-T10b: fc 指定時は内容入りの単一書き込み作成（遅延作成の保存経路）。
  // prepare で正規化+検証し、error issue があれば Invalid 拒否（中途の空行を残さない）。
  // fc 省略時は従来どおり空 FC で作成（後方互換）。
  async createLocal(input: { slug: string; title: LangResource; lang?: string; uid?: string; fc?: unknown }): Promise<PoiSourceSaveResult> {
    if (input.fc !== undefined) {
      // fallback 言語は既存の空 FC 経路と同じ式に固定（fc.lang があれば prepare 内でそちらが優先される）
      const prepared = this.prepare(input.fc, resolvePoiSourceLanguage(input.lang, SettingsService.get('lang')));
      if (prepared.hasError) return { result: 'Invalid', issues: prepared.issues };
      return await this.createSource(input.slug, input.title, 'local', prepared.fc, prepared.issues, undefined, input.uid);
    }
    const empty: PoiEditorFC = {
      type: 'FeatureCollection',
      lang: resolvePoiSourceLanguage(input.lang, SettingsService.get('lang')),
      features: [],
    };
    return await this.createSource(input.slug, input.title, 'local', empty, [], undefined, input.uid);
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
          title: this.titleInternal(input.title, prepared.fc.lang),
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

  // import 衝突の自動採番 (M3-T6 §6.2 (c)): base, base2..base100 の順で isSlugAvailable
  // (DB + 予約表) の空きを探す。予約はしない — 直後の createSource が isSlugAvailable を
  // 再検査するため、レース (検査後の先取り) は従来どおり 'Exist' へ写像される。
  // 全候補枯渇時は null (呼び出し側が 'Exist' を返す)。
  private async resolveImportSlug(slug: unknown, excludeUid?: string): Promise<string | null> {
    const base = String(slug ?? '').trim();
    if (!base) return base; // 空 slug は createSource の invalid-request 検査へそのまま委ねる
    return findAvailableSlug(base, (candidate) => SqliteDataService.isSlugAvailable(candidate, excludeUid));
  }

  // .geojson/.json を読み、FeatureCollection または 旧POIオブジェクト形式を内部形化して
  // 新規 local ソースとして取り込む。Point以外を含む場合は取込拒否 (POI-104)。
  // slug 同名衝突は 'Exist' 停止ではなく自動採番 (M3-T6。枯渇/レース時のみ 'Exist')
  async importFile(input: { slug: string; title: LangResource; filePath: string; lang?: string; langOverride?: boolean; uid?: string }): Promise<PoiSourceSaveResult> {
    const ext = path.extname(String(input.filePath ?? '')).toLowerCase();
    if (ext === '.zip') {
      const resolvedSlug = await this.resolveImportSlug(input.slug, input.uid);
      if (resolvedSlug === null) return { result: 'Exist' };
      let preparedImport: PoiZipImport | null = null;
      try {
        const { importPoiZip } = await import('./PoiPackageService');
        preparedImport = await importPoiZip(input.filePath);
        const prepared = this.prepare(
          this.withLanguageOverride(preparedImport.fc, input.lang, input.langOverride),
          input.lang || SettingsService.get('lang'),
        );
        if (prepared.hasError) {
          await preparedImport.cleanup();
          return { result: 'Invalid', issues: prepared.issues };
        }
        const result = await this.createSource(resolvedSlug, input.title, 'local', prepared.fc, prepared.issues, undefined, input.uid);
        if (!('result' in result) || result.result !== 'Success') await preparedImport.cleanup();
        return result;
      } catch (e: any) {
        if (preparedImport) await preparedImport.cleanup();
        return { result: 'Error', code: 'invalid-request', message: e?.message ?? String(e) };
      }
    }
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
    const prepared = this.prepare(
      this.withLanguageOverride(parsed, input.lang, input.langOverride),
      input.lang || SettingsService.get('lang'),
    );
    if (prepared.hasError) return { result: 'Invalid', issues: prepared.issues };
    const resolvedSlug = await this.resolveImportSlug(input.slug, input.uid);
    if (resolvedSlug === null) return { result: 'Exist' };
    return await this.createSource(resolvedSlug, input.title, 'local', prepared.fc, prepared.issues, undefined, input.uid);
  }

  // fetch → 正規化/検証 → 成功時のみ登録。fetch snapshot を data_json に永続 cache する
  // (仕様の session memory cache からの意図的逸脱 — 冒頭コメント参照)
  async registerRemote(input: { slug: string; title: LangResource; url: string; lang?: string; langOverride?: boolean; uid?: string }): Promise<PoiSourceSaveResult> {
    const url = String(input.url ?? '').trim();
    const snapshot = await this.fetchSnapshot(url, input.lang || SettingsService.get('lang'));
    if (!snapshot.ok) return snapshot.failure;
    const fc = this.withLanguageOverride(snapshot.fc, input.lang, input.langOverride) as PoiEditorFC;
    const prepared = this.prepare(fc, input.lang);
    return await this.createSource(input.slug, input.title, 'remote', prepared.fc, snapshot.issues, url, input.uid);
  }

  async detectImportLanguage(filePath: string, fallbackLang?: string): Promise<string> {
    const ext = path.extname(String(filePath ?? '')).toLowerCase();
    if (ext === '.zip') {
      const { importPoiZip } = await import('./PoiPackageService');
      const imported = await importPoiZip(filePath);
      try {
        return resolvePoiSourceLanguage((imported.fc as PoiEditorFC).lang, fallbackLang || SettingsService.get('lang'));
      } finally {
        await imported.cleanup();
      }
    }
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    return resolvePoiSourceLanguage(parsed?.lang, fallbackLang || SettingsService.get('lang'));
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
    const existingFc = JSON.parse(existing.dataJson) as PoiEditorFC;
    const snapshot = await this.fetchSnapshot(existing.url, existingFc.lang);
    if (!snapshot.ok) return snapshot.failure;
    try {
      const { revision } = await SqliteDataService.upsertPoiSource(uid, existing.slug, {
        title: this.titleInternal(existing.title, snapshot.fc.lang),
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
