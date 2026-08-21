export interface SettingsAPI {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  showSaveFolderDialog(): Promise<string | null>;
}

export interface MapListAPI {
    request(query?: string, page?: number, pageSize?: number): Promise<any>;
    onRefresh(listener: () => void): () => void;
}

export interface AssetDraftsAPI {
    put(draft: import('./types/assetDraft').AssetDraftEnvelope): Promise<void>;
    get(kind: import('./types/assetDraft').AssetDraftKind, assetUid: string): Promise<import('./types/assetDraft').AssetDraftEnvelope | null>;
    // M12-T20 (§5.1): keepStaging=true は envelope のみ削除し staging 物理削除を行わない
    // (dirty→clean 遷移専用。残渣は起動時孤児 GC が回収)
    remove(kind: import('./types/assetDraft').AssetDraftKind, assetUid: string, opts?: { keepStaging?: boolean }): Promise<void>;
    list(kind?: import('./types/assetDraft').AssetDraftKind): Promise<import('./types/assetDraft').AssetDraftSummary[]>;
    flushSync(draft: import('./types/assetDraft').AssetDraftEnvelope): { ok: boolean; error?: string };
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
    // 新規作成の明示合図 (M11-T7/D11改)。true=create経路(uid採用)
    create?: boolean;
}

export type AppSaveResult =
    | { result: 'Success'; uid: string; slug: string; revision: number }
    | { result: 'Exist' }
    | { result: 'Error' }
    | { error: 'revision-conflict'; current: number };

export interface AppEditAPI {
    request(uid: string): Promise<any>;
    save(payload: AppSavePayload): Promise<AppSaveResult>;
    preparePreview(document: any): Promise<{ url: string; port: number; warnings: string[] }>;
    stopPreview(): Promise<void>;
    // m6-t6 (§3.2): overrideKeys はオンザフライ入力（保存しない）。省略時は現行どおり
    export(document: any, overrideKeys?: { googleApiKey?: string; mapboxToken?: string }): Promise<{ result: "Success" | "Canceled" | "Error"; outDir?: string; warnings: string[]; message?: string }>;
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
    // 新規作成の明示合図 (M11-T7/D11改)。true=create経路(uid採用)
    create?: boolean;
    // UID維持改名の残作業引き継ぎ (M11-T7/D5改)。Map専用
    renameFromSlug?: string;
}

// slug 予約 API (M11-T7/§7.2)
export type SlugReservationResult =
    | { result: 'ok' }
    | { result: 'conflict' }
    | { result: 'error'; message: string };

export interface SlugReservationApi {
    reserve(payload: { slug: string; assetUid: string; assetKind: string; draftUid: string }): Promise<SlugReservationResult>;
    move(payload: { fromSlug: string | null; toSlug: string; assetUid: string; assetKind: string; draftUid: string }): Promise<SlugReservationResult>;
    release(payload: { slug: string; assetUid: string }): Promise<void>;
    check(payload: { slug: string; excludeUid?: string }): Promise<'available' | 'reserved-by-other' | 'taken'>;
}

export type MapSaveResult =
    // url (M12-T17): 新規原本アップロード(tmpCheck)でタイルが恒久領域へ移動された場合のみ設定される
    // 恒久タイルURL({z}/{x}/{y}.ext パターンのテンプレート文字列)。既存地図の通常更新・clone・
    // rename 経路(tmpCheckが偽)では省略(undefined)。electron/adapters/StorageAdapter.ts の
    // 正本定義と同期すること(手動同期ミラー、M12-T17 設計レビュー v1 Major1)
    | { result: 'Success'; uid: string; slug: string; revision: number; url?: string }
    | { result: 'Exist' }
    // uid/slug/revision付きのErrorは「DBコミット済み・ファイル操作のみ失敗」。
    // レンダラはrevision等を補正してから再試行する(偽のrevision-conflict防止)。
    // errorKey は additive (M13-T2 §5.3/§7): DBに未到達の reject (例: originals 未対応拡張子)
    // では uid/slug/revision を伴わず errorKey のみを返す
    | { result: 'Error'; uid?: string; slug?: string; revision?: number; errorKey?: string }
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
    resourceDiagnostics?: import('./utils/resourceDiagnosticsBadges').ResourceDiagnostics;
}

export interface PoiSourceListResult {
    items: PoiSourceListRow[];
    page: number;
    hasPrev: boolean;
    hasNext: boolean;
    total: number;
}

export interface PoiSourceDetailResult extends PoiSourceListRow {
    lang: string;
    readOnly: boolean;
    fc: any;
}

export interface PoiValidationIssue {
    level: 'error' | 'warning';
    code: string;
    featureId?: string;
    message?: string;
}

// Error 結果の機械可読コード: 'network' = fetch 到達不能/timeout (POI-118 degraded 表示対象)、
// 'http-status' = HTTP 非 2xx (remote-gone 等)、'parse' = 応答/ファイルが JSON でない、
// 'not-found' = 対象ソース不在 (並行 delete 含む)、'invalid-request' = 引数不正、'internal' = 内部エラー
export type PoiSourceErrorCode =
    | 'network'
    | 'http-status'
    | 'parse'
    | 'not-found'
    | 'invalid-request'
    | 'internal';

// maps/apps の保存結果 union と同形 (ファイルフェーズが無いため Error{uid,slug,revision} 拡張なし)。
// 'Invalid' = 検証エラーで拒否 (issues 参照)、'ReadOnly' = remote ソースへの save 拒否
export type PoiSourceSaveResult =
    | { result: 'Success'; uid: string; slug: string; revision: number; issues: PoiValidationIssue[] }
    | { result: 'Exist' }
    | { result: 'Invalid'; issues: PoiValidationIssue[] }
    | { result: 'ReadOnly' }
    | { result: 'Error'; code: PoiSourceErrorCode; message?: string }
    | { error: 'revision-conflict'; current: number };

export type PoiSourceExportResult =
    | { result: 'Success'; filePath: string }
    | { result: 'Canceled' }
    | { result: 'Error'; message?: string };

export interface PoiSourceReference {
    kind: 'map' | 'app';
    uid: string;
    slug: string;
}

export interface PoiSourcesAPI {
    list(request: { query: string; page: number; pageSize: number }): Promise<PoiSourceListResult>;
    get(uid: string): Promise<PoiSourceDetailResult | null>;
    // uid = renderer 事前採番 preset (D11改/M11-T7): slug 予約の帰属と行 uid を一致させる。
    // fc 指定時は内容入りの単一作成 (M11-T10b 遅延作成の保存経路)。prepare 検証で error あれば Invalid 拒否
    createLocal(input: { slug: string; title: any; lang?: string; uid?: string; fc?: unknown }): Promise<PoiSourceSaveResult>;
    save(uid: string, payload: { slug: string; title: any; fc: any; expectedRevision?: number }): Promise<PoiSourceSaveResult>;
    importFile(input: { slug: string; title: any; filePath: string; lang?: string; langOverride?: boolean; uid?: string }): Promise<PoiSourceSaveResult>;
    detectImportLanguage(filePath: string, fallbackLang?: string): Promise<string>;
    registerRemote(input: { slug: string; title: any; url: string; lang?: string; langOverride?: boolean; uid?: string }): Promise<PoiSourceSaveResult>;
    refreshRemote(uid: string): Promise<PoiSourceSaveResult>;
    cloneToLocal(uid: string, input: { slug: string; title?: any }): Promise<PoiSourceSaveResult>;
    findReferences(uid: string): Promise<PoiSourceReference[]>;
    delete(uid: string): Promise<{ ok: true; references: PoiSourceReference[] }>;
    exportFile(uid: string): Promise<PoiSourceExportResult>;
    // インポート用ネイティブファイル選択 (Phase 3)。キャンセル時は null
    pickImportFile(): Promise<{ filePath: string; fileName: string } | null>;
}

// 画像アセット (ADR-0007): uid正準 + slug契約。title は LangResource (内部形/交換形どちらも受容し
// main 側で内部形へ正規化される)。バイト実体は main 側の {saveFolder}/assets/{uid}.{ext} に持ち、
// renderer には file:// URL (getFilePath) またはメタデータ行のみが渡る
export interface ImageAssetRow {
    uid: string;
    slug: string;
    lang: string;
    sourceName: string | null;
    title: Record<string, string>;
    mime: string;
    ext: string;
    width: number | null;
    height: number | null;
    byteSize: number;
    revision: number;
    updatedAt: string;
}

export type ImageAssetErrorCode = 'not-found' | 'invalid-request' | 'internal';

export type ImageAssetSaveResult =
    | { result: 'Success'; uid: string; slug: string; revision: number; mime: string; ext: string; width: number | null; height: number | null }
    | { result: 'Exist' }
    | { result: 'Error'; code: ImageAssetErrorCode; message?: string; uid?: string; slug?: string; revision?: number }
    | { error: 'revision-conflict'; current: number };

// 逆参照 (poi_sources の icon/selectedIcon/image 参照)。AID-006 の削除確認フローが使う
export interface ImageAssetReference {
    uid: string;
    slug: string;
    title: Record<string, string>;
}

export interface ImageAssetReferencesResult {
    poiSources: ImageAssetReference[];
}

export interface ImageAssetsAPI {
    // uid = renderer 事前採番 preset (D11改/M11-T7): slug 予約の帰属と行 uid を一致させる
    add(input: { slug: string; title: any; lang: string; sourceName: string; sourcePath: string; uid?: string }): Promise<ImageAssetSaveResult>;
    list(): Promise<ImageAssetRow[]>;
    search(query: string): Promise<ImageAssetRow[]>;
    get(ref: string): Promise<ImageAssetRow | null>;
    updateMetadata(uid: string, input: { slug: string; title: any; lang: string; expectedRevision: number }): Promise<ImageAssetSaveResult>;
    delete(uid: string): Promise<{ ok: true }>;
    getFilePath(ref: string): Promise<string | null>;
    findReferences(ref: string): Promise<ImageAssetReferencesResult>;
    // インポート用ネイティブファイル選択。キャンセル時は null
    pickImageFile(): Promise<{ filePath: string; fileName: string } | null>;
}

export interface AppAssetsAPI {
    uploadTmsThumbnail(mapID: string): Promise<{ err?: string; path?: string; fileUrl?: string }>;
    // m19-t2: ext は省略可能（既定 'jpg' = 地図の uid 規約）。返値の path / path52 は kind 依存で、
    // path は「kind が指す側の所在」である（kind='512' では 512px）。52px の所在は
    // kind==='52' ? path : path52 でのみ求める（`path52 ?? path` は 512px を掴むため禁止）。
    replaceMapThumbnail(
        mapUid: string,
        kind: '512' | '52',
        derive52: boolean,
        ext?: string
    ): Promise<{ fileUrl?: string; fileUrl52?: string; path?: string; path52?: string; err?: string }>;
    generateTmsThumbnail(
        mapID: string,
        tms: { url?: string; minZoom?: number; maxZoom?: number },
        coverageLngLats: [number, number][]
    ): Promise<{ err?: string; path?: string; fileUrl?: string }>;
    uploadSplash(): Promise<{ err?: string; splash?: string; fileUrl?: string }>;
    uploadPwaIcon(appID: string): Promise<{ err?: string; path?: string; fileUrl?: string }>;
    fileUrl(relPath: string): Promise<string | null>;
}

// uid正準のベースマップ保存要求 (ADR-0007)。uid無指定は新規作成。
// create=true (§7.2b/D11改) は新規作成の明示合図(uid=事前採番preset)
export interface BaseMapSavePayload {
    uid?: string;
    slug: string;
    // 種別軸（m6-t1）。renderer 側は src/utils/baseMapEditorDocument.ts の BaseMapSavePayload で
    // tms.kind: BaseMapKind を保持。main は素通しで data_json に書くため、ここは kind 明示の最小差分
    // （{ kind?: string } & Record<string, unknown>）で契約を文書化する（m11-t7:574 の 400 文字窓を維持）。
    tms: { kind?: string } & Record<string, unknown>;
    expectedRevision?: number;
    create?: boolean;
}

export type BaseMapSaveResult =
    // m19-t2: thumbnail は永続化された実効値。新規作成では backend が 52px/512px を
    // uid 名へ付け替えるため payload の値と異なりうる（renderer は返値側を採ること）
    | { result: 'Success'; uid: string; revision: number; thumbnail?: string }
    | { result: 'Exist' }
    | { result: 'Error'; code: 'not-found' | 'invalid-request' | 'internal'; message?: string }
    | { error: 'revision-conflict'; current: number };

// m6-t7: TileJsonImportService.ts の型を electron.d.ts 側で複製する（既存の BaseMapsAPI 等と
// 同じく main プロセス側の型を import せず独自定義する慣例に合わせる）
export type TileJsonImportResult =
    | { ok: true; fields: TileJsonMappedFields; sourceUrl: string }
    | {
          ok: false;
          code:
              | 'unsupported-scheme'
              | 'network'
              | 'http-status'
              | 'too-large'
              | 'invalid-json'
              | 'missing-tiles'
              | 'vector-tileset';
          message?: string;
      };

export interface TileJsonMappedFields {
    url: string;
    minZoom: number;
    maxZoom: number;
    attr?: string;
    title?: string;
    coverageLngLats?: [number, number][];
}

export interface BaseMapsAPI {
    // m22-t1: url_ は merc の実行時専用タイルURL。IPC 返却時にのみ item レベルへ付与され、
    // 永続化されない（merc かつ導出可能なときのみ own key として存在する）
    list(): Promise<Array<{ uid: string; mapID: string; scope: "builtin" | "user"; data: any; revision: number; thumbnailUrl?: string | null; url_?: string; alwaysVisible: boolean; alwaysLocked: boolean }>>;
    saveUser(payload: BaseMapSavePayload): Promise<BaseMapSaveResult>;
    deleteUser(baseMapUid: string): Promise<void>;
    setAlways(baseMapUid: string, always: boolean): Promise<void>;
    // m6-t7: tms 編集画面の「TileJSON から読み込む」ボタン用
    importTileJson(url: string): Promise<TileJsonImportResult>;
}

export interface MapEditAPI {
    request(uidOrMapID: string): Promise<any>;
    previewSource(uidOrMapID: string): Promise<any>;
    // ベースマップ表示設定はuid正準 (ADR-0007)。mapRefは保存済み地図=uid、未保存地図=slug
    getTmsListOfMapID(mapRef: string): Promise<any>;
    getBaseMapVisibilityOfMapID(mapRef: string): Promise<any>;
    setBaseMapVisibilityForMapID(mapRef: string, baseMapUid: string, enabled: boolean): Promise<void>;
    // m1-t4 (HR-6): 位置合わせシフト値の編集環境永続化（visibility と同じ uid 正準）
    getBaseMapShiftsOfMapID(mapRef: string): Promise<Array<{ baseMapUid: string; mapID: string; x: number; y: number }>>;
    setBaseMapShiftForMapID(mapRef: string, baseMapRef: string, x: number, y: number): Promise<void>;
    updateTin(gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any): Promise<any>;
    save(payload: MapSavePayload): Promise<MapSaveResult>;
    checkExtentMap(extent: number[]): Promise<any>;
    download(mapObject: any, tins: any[]): Promise<any>;
    // M13-T1 (§2.2): 保存済み地図専用のstrict-free搬出
    downloadSaved(mapRef: string): Promise<'Success' | 'Canceled' | 'Error'>;
    // M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
    uploadCsv(csvRepl: string, csvUpSettings: any): Promise<any>;
    // M12-T20 (§5.1): 復元時ガード用の staging 実在照会
    stagingStatus(url_: string, uid?: string): Promise<{ alive: boolean; savedTilesExist: boolean }>;
    getWmtsFolder(): Promise<any>;
    onProgress(listener: (progress: any) => void): () => void;
}

// m6-t8 §3.4: 生成される TileJSON 3.0.0 文書の renderer 側型
export interface MercTileJsonDocument {
    tilejson: '3.0.0';
    tiles: [string];
    minzoom: number;
    maxzoom: number;
    bounds: [number, number, number, number];
}

// m6-t8: メルカトルタイル生成。従来 (window as any).wmtsGen として呼ばれていたが型付けする
export interface WmtsGenAPI {
    generate(
        uid: string,
        mapID: string,
        width: number,
        height: number,
        tinSerial: any,
        extKey: string,
        hash: string,
        targetBaseMapUid: string,
    ): Promise<{
        hash: string;
        tileJson?: MercTileJsonDocument;
        err?: any;
        // 実装レビュー M-2: JPEG デコード予算超過の構造化エラー（MapUploadResult と同型）
        errorCode?: 'jpeg_machine_limit' | 'jpeg_memory_limit' | 'jpeg_resolution_limit';
        configuredMB?: number;
        configuredMP?: number;
        prediction?: { requiredMemoryMB: number; recommendedMemoryMB: number } | { megapixels: number; recommendedResolutionMP: number };
        machine?: { requiredHeapMB: number; availableHeapMB: number; megapixels: number };
    }>;
}

declare global {
  interface Window {
    settings: SettingsAPI;
    maplist: MapListAPI;
    mapedit: MapEditAPI;
    assetDrafts: AssetDraftsAPI;
    applist: AppListAPI;
    appedit: AppEditAPI;
    appEvents: AppEventsAPI;
    poiSources: PoiSourcesAPI;
    baseMaps: BaseMapsAPI;
    appAssets: AppAssetsAPI;
    assets: AssetsAPI;
    imageAssets: ImageAssetsAPI;
    slugReservations: SlugReservationApi;
    search: SearchAPI;
    wmtsGen: WmtsGenAPI;
    isE2E: boolean;
    testDebug?: any;
  }
}

interface SearchAPI {
  /** bboxはWGS84。main processでEPSG:3857へ変換される。 */
  maps(filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }): Promise<{ docs: any[]; total: number; prev?: number; next?: number }>;
  apps(filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }): Promise<{ docs: any[]; total: number; prev?: number; next?: number }>;
  poiSources(filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }): Promise<{ docs: any[]; total: number; prev?: number; next?: number }>;
  baseMaps(filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }): Promise<{ docs: any[]; total: number; prev?: number; next?: number }>;
  imageAssets(filter: { q?: string; page: number; pageSize: number }): Promise<{ docs: any[]; total: number; prev?: number; next?: number }>;
  /** 既存互換のraw API。bboxはEPSG:3857。UIは各search APIを使用する。 */
  searchExtent(kind: 'map' | 'poi-source' | 'app', bbox: [number, number, number, number]): Promise<string[]>;
  resourceBbox(kind: 'map', uid: string): Promise<[number, number, number, number] | null>;
  appCoverage(appUid: string, mapUids?: string[]): Promise<{ coverageLngLats: [number, number][]; maps: number } | null>;
}
