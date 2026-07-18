import SqliteDataService, { RevisionConflictError } from './SqliteDataService';
import SearchDataService, { type AppListResult } from './SearchDataService';
import { normalizeAppSource } from '../../src/utils/appSourceModel';
import { resolveAppListImage } from './resourceImageResolver';

// uid正準の保存要求/結果 (ADR-0007)。uid無指定は新規作成。
// expectedRevision は楽観ロック(不一致で revision-conflict を返す)
export interface AppSaveRequest {
  document: any;
  uid?: string | null;
  slug: string;
  expectedRevision?: number | null;
  // 新規作成の明示合図 (D11改)。true=create経路(uid採用)、なし/false=従来のuid有無dispatch
  create?: boolean;
}

export type AppSaveResult =
  | { result: 'Success'; uid: string; slug: string; revision: number }
  | { result: 'Exist' }
  | { result: 'Error' }
  | { error: 'revision-conflict'; current: number };

class AppDataService {
  private getLocalizedTitle(value: any, lang: string, fallback: string): string {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      return value[lang] || value.ja || value.en || Object.values(value as Record<string, string>)[0] || fallback;
    }
    return fallback;
  }

  // アプリの代表ビジュアル: アイコン → スプラッシュ → startFromがMaplat地図なら0/0/0タイル → null(NO IMAGE)
  // M12-T1-HOTFIX-1: ロジック本体は共有 resolver（resourceImageResolver.resolveAppListImage）へ
  // 一元化（優先順位は従来どおり。search:apps 経路と同一実装）
  private async resolveAppImage(doc: any): Promise<string | null> {
    return resolveAppListImage(doc);
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
    const doc = await SqliteDataService.findAppByRef(uidOrSlug);
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
      const normalized = normalizeAppSource(raw, doc.lang || 'ja');
      if (normalized.sourceType !== 'maplat' || !normalized.mapUid) continue;
      const mapDoc = await SqliteDataService.findMapByRef(normalized.mapUid);
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
      if (request.create === true) {
        // 新規作成の明示合図(D11改): 事前採番uidを採用。uid有無ではなくcreateフラグで分岐し、
        // 既存update経路の復活防止不変条件(lookup失敗=Error)を侵さない。
        // excludeUid=事前採番uid: 自分の予約(帰属=asset_uid)を空き扱いにする(D2改)
        if (!(await SqliteDataService.isSlugAvailable(slug, uid))) return { result: 'Exist' };
        const { uid: createdUid } = await SqliteDataService.createApp(slug, document, uid);
        return { result: 'Success', uid: createdUid, slug, revision: 1 };
      }
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
      // slug 予約 promote conflict(M11-T7/AC4)も duplicate として写像する
      if (e?.kind === 'slug-reservation-conflict') {
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
