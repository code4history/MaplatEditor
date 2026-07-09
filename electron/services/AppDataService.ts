import fs from 'fs-extra';
import path from 'path';
import SettingsService from './SettingsService';
import AppAssetService from './AppAssetService';
import SqliteDataService, { RevisionConflictError } from './SqliteDataService';
import SearchDataService, { type AppListResult } from './SearchDataService';
import { UUID_PATTERN } from '../adapters/StorageAdapter';
import { normalizeAppSource, type AppSource } from '../../src/utils/appSourceModel';

// uid正準の保存要求/結果 (ADR-0007)。uid無指定は新規作成。
// expectedRevision は楽観ロック(不一致で revision-conflict を返す)
export interface AppSaveRequest {
  document: any;
  uid?: string | null;
  slug: string;
  expectedRevision?: number | null;
}

export type AppSaveResult =
  | { result: 'Success'; uid: string; slug: string; revision: number }
  | { result: 'Exist' }
  | { result: 'Error' }
  | { error: 'revision-conflict'; current: number };

class AppDataService {
  private get folders() {
    const saveFolder = SettingsService.get('saveFolder');
    return {
      tileFolder: path.join(saveFolder, "tiles"),
    };
  }

  private getLocalizedTitle(value: any, lang: string, fallback: string): string {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      return value[lang] || value.ja || value.en || Object.values(value as Record<string, string>)[0] || fallback;
    }
    return fallback;
  }

  // uid正準の地図参照解決 (ADR-0007)。旧保存形のslug参照にはslugフォールバックで応える。
  // uid検索はUUID形状の引数に限定し、UUID形状のslugが他地図のuidを誤参照しないようにする
  private async findMapByRef(ref: string): Promise<any | null> {
    if (UUID_PATTERN.test(ref)) {
      const byUid = await SqliteDataService.findMap(ref);
      if (byUid) return byUid;
    }
    return await SqliteDataService.findMapBySlug(ref);
  }

  private async getMapTile(mapRef: string): Promise<string | null> {
    // 内部タイルはuidパス (ADR-0007)
    const mapDoc = await this.findMapByRef(mapRef);
    if (!mapDoc?.uid) return null;
    const thumbFolder = path.join(this.folders.tileFolder, mapDoc.uid, "0", "0");
    if (!fs.existsSync(thumbFolder)) return null;
    try {
      const files = await fs.readdir(thumbFolder);
      const tileFile = files.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
      return tileFile ? `file://${path.join(thumbFolder, tileFile).split(path.sep).join('/')}` : null;
    } catch {
      return null;
    }
  }

  // アプリの代表ビジュアル: アイコン → スプラッシュ → startFromがMaplat地図なら0/0/0タイル → null(NO IMAGE)
  private async resolveAppImage(doc: any): Promise<string | null> {
    const iconSource = doc.manifestSettings?.iconSource || doc.httpSettings?.iconSource;
    if (typeof iconSource === 'string' && iconSource.trim()) {
      const url = AppAssetService.fileUrlFor(iconSource);
      if (url) return url;
    }
    const splash = doc.appSettings?.splash || doc.splash;
    if (typeof splash === 'string' && splash.trim()) {
      const url = AppAssetService.fileUrlFor(`img/${splash}`);
      if (url) return url;
    }
    const sources: AppSource[] = (Array.isArray(doc.sources) ? doc.sources : []).map((raw: any) => normalizeAppSource(raw));
    // startFromは新形=uid、旧保存形=slugのどちらもあり得る (ADR-0007)
    const startFromID = doc.startFrom || doc.start_from || sources.find((source) => source.startFrom)?.mapUid;
    const startSource = sources.find((source) => source.mapUid === startFromID || source.mapSlug === startFromID);
    if (startSource?.sourceType === 'maplat') {
      return await this.getMapTile(startSource.mapUid);
    }
    return null;
  }

  async requestApps(query: string = '', page: number = 1, pageSize: number = 20): Promise<AppListResult> {
    const rawResult = await SearchDataService.listApps(query, page, pageSize);
    const docs = await Promise.all(rawResult.docs.map(async (doc: any) => {
      const appID = doc.appID || doc._id;
      const lang = doc.lang || 'ja';
      return {
        uid: doc.uid, // 一覧からの遷移・削除はuid正準 (ADR-0007)
        appID,
        title: this.getLocalizedTitle(doc.title || doc.appName, lang, appID),
        description: this.getLocalizedTitle(doc.description, lang, ''),
        image: await this.resolveAppImage(doc),
      };
    }));
    return { ...rawResult, docs };
  }

  // uid正準の読み出し (ADR-0007)。旧経路への保険としてslugフォールバックを残す
  async getApp(uidOrSlug: string): Promise<any | null> {
    const doc = UUID_PATTERN.test(uidOrSlug)
      ? (await SqliteDataService.findApp(uidOrSlug)) ?? (await SqliteDataService.findAppBySlug(uidOrSlug))
      : await SqliteDataService.findAppBySlug(uidOrSlug);
    if (!doc) return null;
    await this.resolveMaplatSourceRefs(doc);
    return doc;
  }

  // 旧保存形のmaplatソース参照(mapID=slug)を読込時にuidへ解決し、表示用slugを補完する
  // (ADR-0007)。孤児参照(該当地図なし)はそのまま残す(プレビュー時にエラーとして顕在化)。
  // 保存はレンダラが解決済みの新形(mapUid)で行うため、次回保存から新形で永続化される
  private async resolveMaplatSourceRefs(doc: any): Promise<void> {
    if (!Array.isArray(doc.sources)) return;
    const legacyStartFrom = typeof doc.startFrom === 'string' ? doc.startFrom : undefined;
    for (const raw of doc.sources) {
      if (!raw || typeof raw !== 'object') continue;
      const normalized = normalizeAppSource(raw);
      if (normalized.sourceType !== 'maplat' || !normalized.mapUid) continue;
      const mapDoc = await this.findMapByRef(normalized.mapUid);
      if (!mapDoc) continue;
      raw.mapUid = mapDoc.uid;
      raw.mapSlug = mapDoc.slug;
      // 旧保存形のstartFrom(slug)もuidへ追随させる
      if (legacyStartFrom && (legacyStartFrom === normalized.mapUid || legacyStartFrom === mapDoc.slug)) {
        doc.startFrom = mapDoc.uid;
      }
    }
  }

  // uid正準の保存 (ADR-0007): uidなし=新規作成、uidあり=revision楽観ロック付きupsert。
  // slug衝突(グローバルnamespace)は 'Exist'、他ウィンドウ先行更新は revision-conflict
  async saveApp(request: AppSaveRequest): Promise<AppSaveResult> {
    const { document } = request;
    const uid = request.uid ?? undefined;
    const slug = String(request.slug || '').trim();
    if (!slug) return { result: 'Error' };
    try {
      if (uid) {
        const existing = await SqliteDataService.findApp(uid);
        if (!existing) return { result: 'Error' };
        if (existing.slug !== slug && !(await SqliteDataService.isSlugAvailable(slug, uid))) {
          return { result: 'Exist' };
        }
        const { revision } = await SqliteDataService.upsertApp(
          uid, slug, document, request.expectedRevision ?? undefined
        );
        return { result: 'Success', uid, slug, revision };
      }
      if (!(await SqliteDataService.isSlugAvailable(slug))) return { result: 'Exist' };
      const { uid: createdUid } = await SqliteDataService.createApp(slug, document);
      return { result: 'Success', uid: createdUid, slug, revision: 1 };
    } catch (e: any) {
      if (e instanceof RevisionConflictError) {
        return { error: 'revision-conflict', current: e.current };
      }
      // registerAsset/renameAssetSlugのslug衝突(レースで先取りされた場合)は 'Exist' に写像
      if (e && typeof e.message === 'string' && e.message.startsWith('Slug already in use')) {
        return { result: 'Exist' };
      }
      console.error('[AppDataService.saveApp] Error:', e);
      return { result: 'Error' };
    }
  }

  async deleteApp(uid: string): Promise<void> {
    await SqliteDataService.deleteApp(uid);
  }
}

export default new AppDataService();
