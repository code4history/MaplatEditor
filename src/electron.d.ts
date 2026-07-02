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
    delete(appID: string, condition: string, page: number): Promise<any>;
    onRefresh(listener: () => void): () => void;
}

export interface AppEditAPI {
    request(appID: string): Promise<any>;
    save(appID: string, document: any): Promise<any>;
    checkID(appID: string): Promise<boolean>;
    preparePreview(document: any): Promise<{ url: string; port: number }>;
    export(document: any): Promise<{ result: "Success" | "Canceled" | "Error"; outDir?: string; warnings: string[]; message?: string }>;
}

export interface AppEventsAPI {
    onMainProcessMessage(listener: (message: string) => void): () => void;
    onTaskProgress(listener: (progress: any) => void): () => void;
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
    uploadSplash(): Promise<{ err?: string; splash?: string; fileUrl?: string }>;
    uploadPwaIcon(appID: string): Promise<{ err?: string; path?: string; fileUrl?: string }>;
    fileUrl(relPath: string): Promise<string | null>;
}

export interface BaseMapsAPI {
    list(): Promise<Array<{ mapID: string; scope: "builtin" | "user"; data: any; thumbnailUrl?: string | null }>>;
    saveUser(tms: any): Promise<void>;
    deleteUser(baseMapId: string): Promise<void>;
}

export interface MapEditAPI {
    request(mapID: string): Promise<any>;
    previewSource(mapID: string): Promise<any>;
    getTmsListOfMapID(mapID: string): Promise<any>;
    getBaseMapVisibilityOfMapID(mapID: string): Promise<any>;
    setBaseMapVisibilityForMapID(mapID: string, baseMapId: string, enabled: boolean): Promise<void>;
    updateTin(gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any): Promise<any>;
    save(mapObject: any, tins: any[]): Promise<any>;
    checkID(mapID: string): Promise<any>;
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
  }
}
