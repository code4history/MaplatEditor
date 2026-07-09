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

export interface PoiSourcesAPI {
    list(request: { query: string; page: number; pageSize: number }): Promise<any>;
    get(sourceId: string): Promise<any>;
    createLocal(input: { title: string; geojson?: any }): Promise<any>;
    registerRemote(input: { title: string; url: string }): Promise<any>;
    validateRemote(input: { kind: "source"; sourceId: string } | { kind: "url"; url: string }): Promise<any>;
    saveLocal(sourceId: string, geojson: any): Promise<any>;
    delete(sourceId: string): Promise<any>;
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

export interface BaseMapsAPI {
    list(): Promise<Array<{ mapID: string; scope: "builtin" | "user"; data: any; thumbnailUrl?: string | null; alwaysVisible: boolean; alwaysLocked: boolean }>>;
    saveUser(tms: any, originalMapID?: string): Promise<void>;
    deleteUser(baseMapId: string): Promise<void>;
    setAlways(baseMapId: string, always: boolean): Promise<void>;
}

export interface MapEditAPI {
    request(uidOrMapID: string): Promise<any>;
    previewSource(uidOrMapID: string): Promise<any>;
    getTmsListOfMapID(mapID: string): Promise<any>;
    getBaseMapVisibilityOfMapID(mapID: string): Promise<any>;
    setBaseMapVisibilityForMapID(mapID: string, baseMapId: string, enabled: boolean): Promise<void>;
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
