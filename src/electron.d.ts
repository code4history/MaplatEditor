export interface SettingsAPI {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  showSaveFolderDialog(): Promise<string | null>;
}

export interface MapListAPI {
    request(query?: string, page?: number, pageSize?: number): Promise<any>;
    onRefresh(listener: () => void): () => void;
}

export interface AppDraftAPI {
    save(draft: any): Promise<void>;
    load(): Promise<any>;
}

export interface AppListAPI {
    request(query?: string, page?: number, pageSize?: number): Promise<any>;
    delete(uid: string, condition: string, page: number): Promise<any>;
    onRefresh(listener: () => void): () => void;
}

// uid正準のアプリ保存要求/結果 (ADR-0007)。uid無指定は新規作成
export interface AppSavePayload {
    document: any;
    uid?: string;
    slug: string;
    expectedRevision?: number;
}

export type AppSaveResult =
    | { result: 'Success'; uid: string; slug: string; revision: number }
    | { result: 'Exist' }
    | { result: 'Error' }
    | { error: 'revision-conflict'; current: number };

export interface AppEditAPI {
    request(uid: string): Promise<any>;
    save(payload: AppSavePayload): Promise<AppSaveResult>;
    preparePreview(document: any): Promise<{ url: string; port: number }>;
    export(document: any): Promise<{ result: "Success" | "Canceled" | "Error"; outDir?: string; warnings: string[]; message?: string }>;
}

export interface AppEventsAPI {
    onMainProcessMessage(listener: (message: string) => void): () => void;
    onTaskProgress(listener: (progress: any) => void): () => void;
    onMigrationReport(listener: (report: any) => void): () => void;
}

// uid正準の保存要求/結果 (ADR-0007)
export interface MapSavePayload {
    mapObject: any;
    tins: any[];
    uid?: string;
    slug?: string;
    expectedRevision?: number;
    copyFromUid?: string;
}

export type MapSaveResult =
    | { result: 'Success'; uid: string; slug: string; revision: number }
    | { result: 'Exist' }
    // uid/slug/revision付きのErrorは「DBコミット済み・ファイル操作のみ失敗」。
    // レンダラはrevision等を補正してから再試行する(偽のrevision-conflict防止)
    | { result: 'Error'; uid?: string; slug?: string; revision?: number }
    | { error: 'revision-conflict'; current: number };

export interface AssetsAPI {
    checkSlug(payload: { slug: string; excludeUid?: string }): Promise<boolean>;
}

// POI ソース (ADR-0007): uid正準 + slug契約。title は LangResource (内部形/交換形どちらも受容し
// main 側で内部形へ正規化される)。fc は editor 内部形 FeatureCollection (_maplatUid 入り)
export interface PoiSourceListRow {
    uid: string;
    slug: string;
    title: Record<string, string>;
    mode: 'local' | 'remote';
    url: string | null;
    featureCount: number;
    revision: number;
    updatedAt: string;
}

export interface PoiSourceListResult {
    items: PoiSourceListRow[];
    page: number;
    hasPrev: boolean;
    hasNext: boolean;
    total: number;
}

export interface PoiSourceDetailResult extends PoiSourceListRow {
    readOnly: boolean;
    fc: any;
}

export interface PoiValidationIssue {
    level: 'error' | 'warning';
    code: string;
    featureId?: string;
    message?: string;
}

// maps/apps の保存結果 union と同形 (ファイルフェーズが無いため Error{uid,slug,revision} 拡張なし)。
// 'Invalid' = 検証エラーで拒否 (issues 参照)、'ReadOnly' = remote ソースへの save 拒否
export type PoiSourceSaveResult =
    | { result: 'Success'; uid: string; slug: string; revision: number; issues: PoiValidationIssue[] }
    | { result: 'Exist' }
    | { result: 'Invalid'; issues: PoiValidationIssue[] }
    | { result: 'ReadOnly' }
    | { result: 'Error'; message?: string }
    | { error: 'revision-conflict'; current: number };

export interface PoiSourceReference {
    kind: 'map' | 'app';
    uid: string;
    slug: string;
}

export interface PoiSourcesAPI {
    list(request: { query: string; page: number; pageSize: number }): Promise<PoiSourceListResult>;
    get(uid: string): Promise<PoiSourceDetailResult | null>;
    createLocal(input: { slug: string; title: any }): Promise<PoiSourceSaveResult>;
    save(uid: string, payload: { slug: string; title: any; fc: any; expectedRevision?: number }): Promise<PoiSourceSaveResult>;
    importFile(input: { slug: string; title: any; filePath: string }): Promise<PoiSourceSaveResult>;
    registerRemote(input: { slug: string; title: any; url: string }): Promise<PoiSourceSaveResult>;
    refreshRemote(uid: string): Promise<PoiSourceSaveResult>;
    cloneToLocal(uid: string, input: { slug: string; title?: any }): Promise<PoiSourceSaveResult>;
    findReferences(uid: string): Promise<PoiSourceReference[]>;
    delete(uid: string): Promise<{ ok: true; references: PoiSourceReference[] }>;
}

export interface AppAssetsAPI {
    uploadTmsThumbnail(mapID: string): Promise<{ err?: string; path?: string; fileUrl?: string }>;
    generateTmsThumbnail(
        mapID: string,
        tms: { url?: string; minZoom?: number; maxZoom?: number },
        coverageLngLats: [number, number][]
    ): Promise<{ err?: string; path?: string; fileUrl?: string }>;
    uploadSplash(): Promise<{ err?: string; splash?: string; fileUrl?: string }>;
    uploadPwaIcon(appID: string): Promise<{ err?: string; path?: string; fileUrl?: string }>;
    fileUrl(relPath: string): Promise<string | null>;
}

// uid正準のベースマップ保存要求 (ADR-0007)。uid無指定は新規作成
export interface BaseMapSavePayload {
    uid?: string;
    slug: string;
    tms: any;
}

export interface BaseMapsAPI {
    list(): Promise<Array<{ uid: string; mapID: string; scope: "builtin" | "user"; data: any; thumbnailUrl?: string | null; alwaysVisible: boolean; alwaysLocked: boolean }>>;
    saveUser(payload: BaseMapSavePayload): Promise<{ uid: string; revision: number }>;
    deleteUser(baseMapUid: string): Promise<void>;
    setAlways(baseMapUid: string, always: boolean): Promise<void>;
}

export interface MapEditAPI {
    request(uidOrMapID: string): Promise<any>;
    previewSource(uidOrMapID: string): Promise<any>;
    // ベースマップ表示設定はuid正準 (ADR-0007)。mapRefは保存済み地図=uid、未保存地図=slug
    getTmsListOfMapID(mapRef: string): Promise<any>;
    getBaseMapVisibilityOfMapID(mapRef: string): Promise<any>;
    setBaseMapVisibilityForMapID(mapRef: string, baseMapUid: string, enabled: boolean): Promise<void>;
    updateTin(gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any): Promise<any>;
    save(payload: MapSavePayload): Promise<MapSaveResult>;
    checkExtentMap(extent: number[]): Promise<any>;
    download(mapObject: any, tins: any[]): Promise<any>;
    uploadCsv(csvRepl: string, csvUpSettings: any): Promise<any>;
    getWmtsFolder(): Promise<any>;
    onProgress(listener: (progress: any) => void): () => void;
}

declare global {
  interface Window {
    settings: SettingsAPI;
    maplist: MapListAPI;
    mapedit: MapEditAPI;
    appdraft: AppDraftAPI;
    applist: AppListAPI;
    appedit: AppEditAPI;
    appEvents: AppEventsAPI;
    poiSources: PoiSourcesAPI;
    baseMaps: BaseMapsAPI;
    appAssets: AppAssetsAPI;
    assets: AssetsAPI;
  }
}
