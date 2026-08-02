import path from 'path';
import { app, dialog, type BrowserWindow } from 'electron';
import SqliteDataService from './SqliteDataService';
import MapEditService, { hasStrictError } from './MapEditService';
import { normalizeAppSource } from '../../src/utils/appSourceModel';
import { buildAndWriteMapZip } from '../utils/mapDownloadZip';

// M13-T1 (§2.3): App save/preview/export と Viewer runtime ingress の入口ゲート。
// MapEditService.ts の requestPreviewSource() 内 strict throw (保存済み地図読み出し時) や
// createCompiledFromGcps() 内 strict throw (GCP編集中のTIN再計算) とは呼び出し文脈が異なる
// (App側の複数map refs一括判定 vs. Map単体の読み出し/TIN計算)。エラーキーは
// 'appedit.preview.strict_error' を再利用する (§2.3/§1.3)
export type ViewerPurpose = 'app-save' | 'app-preview' | 'app-export' | 'viewer-runtime';

class MapPurposeService {
    async classifyViewerRuntimeRefs(mapRefs: string[]): Promise<{ missing: string[]; strictError: string[] }> {
        const missing: string[] = [];
        const strictError: string[] = [];
        for (const ref of mapRefs) {
            const doc = await SqliteDataService.findMapByRef(ref);
            if (!doc) {
                missing.push(ref);
                continue;
            }
            if (hasStrictError(doc)) {
                strictError.push(ref);
            }
        }
        return { missing, strictError };
    }

    // mapRefs のいずれかが strict_error または不在なら reject する。空配列は即 resolve
    async assertViewerRuntimeAllowed(mapRefs: string[], _purpose: ViewerPurpose): Promise<void> {
        const classified = await this.classifyViewerRuntimeRefs(mapRefs);
        if (classified.missing.length > 0 || classified.strictError.length > 0) {
            // 不在も strict と同じ拒否理由キーで統一する (§2.3: 呼び出し元 UI は既に
            // appedit.preview.strict_error を「選択・表示不可」の一般的な理由文言として使っている)
            throw new Error('appedit.preview.strict_error');
        }
    }

    // document.sources から sourceType==='maplat' の mapUid を重複排除して収集する共通ユーティリティ
    // (AppDataService.saveApp() / AppPreviewService.prepare() / AppExportService.exportApp() の
    // 3箇所で重複していた収集ロジックを一元化する。§2.3)
    collectMaplatMapRefs(document: any): string[] {
        const sources = Array.isArray(document?.sources) ? document.sources : [];
        const lang = document?.lang || 'ja';
        const refs = new Set<string>();
        for (const raw of sources) {
            if (!raw || typeof raw !== 'object') continue;
            const normalized = normalizeAppSource(raw, lang);
            if (normalized.sourceType === 'maplat' && normalized.mapUid) {
                refs.add(normalized.mapUid);
            }
        }
        return Array.from(refs);
    }

    // 保存済み地図を strict-free に ZIP 搬出する。main-owned、dialog を含む。
    // 内部で発生した例外(map not found / too_less_gcps / dialog・fs エラー等)はすべて catch し
    // 'Error' へ写像する — reject しない (§2.1/§2.3: milestone v2.1 の型契約
    // Promise<'Success'|'Canceled'|'Error'> は常にこの3値のいずれかで resolve する契約と解釈)
    async downloadSavedMap(win: BrowserWindow, mapRef: string): Promise<'Success' | 'Canceled' | 'Error'> {
        try {
            const previewJson = await MapEditService.buildPreviewSource(mapRef); // strict-free（§2.5）
            // M5-T1: mapDoc の取得を mapObject の合成より前へ移す。
            // buildPreviewSource() は preview 用途のために url へ**ランタイム**のタイルURL
            // (store.url_ ?? previewJson.url) を入れて返す。ローカルタイル地図ではこれが
            // file:///Users/<ユーザ名>/… という実行環境の絶対パスになるため、そのまま搬出すると
            // 交換形 JSON に絶対パスが焼き込まれ、再インポートで DB へ永続化されて
            // 同梱タイルが二度と使われなくなる（設計書 §1.1）。
            // ∴ **交換形の url は DB 正本**とする（不変条件 I-3）。AppExportService が
            // DB doc + delete url_ で既に満たしている不変条件へ揃える。
            // strict-free 読み出し・compiled 整備・tins は buildPreviewSource のまま使う（§1.3）
            const mapDoc = await SqliteDataService.findMapByRef(mapRef);
            const mapObject = {
                ...previewJson,
                mapID: previewJson.mapID,
                uid: previewJson.uid,
                url: mapDoc?.url,
            };
            const tins = [
                previewJson.compiled ?? 'tooLessGcps',
                ...(previewJson.sub_maps ?? []).map((subMap: any) => subMap.compiled ?? 'tooLessGcps'),
            ];
            const slug = mapDoc?.slug || previewJson.mapID;
            const fileKey = mapDoc?.uid || slug;
            const ret = await dialog.showSaveDialog(win, {
                defaultPath: path.join(app.getPath('documents'), `${slug}.zip`),
                filters: [{ name: 'Output file', extensions: ['zip'] }],
            });
            if (ret.canceled || !ret.filePath) return 'Canceled';
            await buildAndWriteMapZip(win, mapObject, tins, slug, fileKey, ret.filePath);
            return 'Success';
        } catch (e) {
            console.error('[MapPurposeService.downloadSavedMap]', e);
            return 'Error';
        }
    }
}

export default new MapPurposeService();
