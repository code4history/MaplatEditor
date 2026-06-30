export interface SettingsAPI {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  showSaveFolderDialog(): Promise<string | null>;
}

export interface MapListAPI {
    request(query?: string, page?: number, pageSize?: number): Promise<any[]>;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
    off(channel: string, listener: (...args: any[]) => void): void;
}

export interface AppDraftAPI {
    save(draft: any): Promise<void>;
    load(): Promise<any>;
}

export interface AppEventsAPI {
    onMainProcessMessage(listener: (message: string) => void): () => void;
}

export interface MapEditAPI {
    request(mapID: string): Promise<any>;
    getTmsListOfMapID(mapID: string): Promise<any>;
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
    appEvents: AppEventsAPI;
  }
}
