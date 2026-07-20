import { ipcRenderer, contextBridge } from 'electron'

// バックエンド(メインプロセス)から転送されたエラー/警告をDevToolsコンソールに出す (#18)
ipcRenderer.on('backend:log', (_event, payload: { level: 'error' | 'warn'; message: string; timestamp: string }) => {
  const line = `[Main process ${payload.timestamp}] ${payload.message}`
  if (payload.level === 'warn') console.warn(line)
  else console.error(line)
})

// --------- Expose some API to the Renderer process ---------

contextBridge.exposeInMainWorld('settings', {
  get: (key: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  showSaveFolderDialog: () => ipcRenderer.invoke('settings:select-folder'),
})

contextBridge.exposeInMainWorld('maplist', {
  request: (query: string, page: number, pageSize?: number) => ipcRenderer.invoke('maplist:request', query, page, pageSize),
  delete: (mapID: string, condition: string, page: number) => ipcRenderer.invoke('maplist:delete', mapID, condition, page),
  onRefresh(listener: () => void): () => void {
    const wrapper = () => listener();
    ipcRenderer.on('maplist:refresh', wrapper);
    return () => {
      ipcRenderer.removeListener('maplist:refresh', wrapper);
    };
  },
})

contextBridge.exposeInMainWorld('mapedit', {
  request: (mapID: string) => ipcRenderer.invoke('mapedit:request', mapID),
  previewSource: (mapID: string) => ipcRenderer.invoke('mapedit:preview-source', mapID),
  // ベースマップ表示設定はuid正準 (ADR-0007)。mapRefは保存済み地図=uid、未保存地図=slug
  getTmsListOfMapID: (mapRef: string) => ipcRenderer.invoke('mapedit:get-tms-list', mapRef),
  getBaseMapVisibilityOfMapID: (mapRef: string) => ipcRenderer.invoke('mapedit:get-base-map-visibility', mapRef),
  setBaseMapVisibilityForMapID: (mapRef: string, baseMapUid: string, enabled: boolean) =>
    ipcRenderer.invoke('mapedit:set-base-map-visibility', mapRef, baseMapUid, enabled),
  updateTin: (gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any) =>
    ipcRenderer.invoke('mapedit:updateTin', gcps, edges, index, bounds, strict, vertex),
  // payload: { mapObject, tins, uid?, slug?, expectedRevision?, copyFromUid? } (ADR-0007)
  save: (payload: any) =>
    ipcRenderer.invoke('mapedit:save', payload),
  checkExtentMap: (extent: number[]) =>
    ipcRenderer.invoke('mapedit:checkExtentMap', extent),
  download: (mapObject: any, tins: any[]) =>
    ipcRenderer.invoke('mapedit:download', mapObject, tins),
  uploadCsv: (csvRepl: string, csvUpSettings: any) =>
    ipcRenderer.invoke('mapedit:uploadCsv', csvRepl, csvUpSettings),
  getWmtsFolder: () =>
    ipcRenderer.invoke('mapedit:getWmtsFolder'),
  onProgress(listener: (progress: any) => void): () => void {
    const wrapper = (_event: any, arg: any) => listener(arg);
    ipcRenderer.on('mapedit:taskProgress', wrapper);
    return () => {
      ipcRenderer.removeListener('mapedit:taskProgress', wrapper);
    };
  },
})

contextBridge.exposeInMainWorld('dataupload', {
  showDataSelectDialog: () => ipcRenderer.invoke('dataupload:showDataSelectDialog'),
})

contextBridge.exposeInMainWorld('wmtsGen', {
  generate: (mapID: string, width: number, height: number, tinSerial: any, extKey: string, hash: string) =>
    ipcRenderer.invoke('wmtsGen:generate', mapID, width, height, tinSerial, extKey, hash),
})

// 旧実装: window.mapupload 相当
contextBridge.exposeInMainWorld('mapupload', {
  // 旧実装: window.mapupload.showMapSelectDialog(mapImageLabel)
  // → ipcRenderer.invoke で結果を Promise として受け取る
  showMapSelectDialog: (mapImageLabel: string) =>
    ipcRenderer.invoke('mapupload:showMapSelectDialog', mapImageLabel),
})

contextBridge.exposeInMainWorld('versions', {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
  v8: process.versions.v8
})

contextBridge.exposeInMainWorld('assetDrafts', {
  put: (draft: any) => ipcRenderer.invoke('asset-drafts:put', draft),
  get: (kind: string, assetUid: string) => ipcRenderer.invoke('asset-drafts:get', kind, assetUid),
  remove: (kind: string, assetUid: string) => ipcRenderer.invoke('asset-drafts:remove', kind, assetUid),
  list: (kind?: string) => ipcRenderer.invoke('asset-drafts:list', kind),
  flushSync: (draft: any) => ipcRenderer.sendSync('asset-drafts:flush-sync', draft),
})

contextBridge.exposeInMainWorld('applist', {
  request: (query: string, page: number, pageSize?: number) => ipcRenderer.invoke('applist:request', query, page, pageSize),
  // 削除はuid正準 (ADR-0007)
  delete: (uid: string, condition: string, page: number) => ipcRenderer.invoke('applist:delete', uid, condition, page),
  onRefresh(listener: () => void): () => void {
    const wrapper = () => listener();
    ipcRenderer.on('applist:refresh', wrapper);
    return () => {
      ipcRenderer.removeListener('applist:refresh', wrapper);
    };
  },
})

contextBridge.exposeInMainWorld('appedit', {
  // uid正準の読み出し/保存 (ADR-0007)。saveのpayload: { document, uid?, slug, expectedRevision? }
  request: (uid: string) => ipcRenderer.invoke('appedit:request', uid),
  save: (payload: any) => ipcRenderer.invoke('appedit:save', payload),
  preparePreview: (document: any) => ipcRenderer.invoke('appedit:prepare-preview', document),
  export: (document: any) => ipcRenderer.invoke('appedit:export', document),
})

contextBridge.exposeInMainWorld('dialog', {
  showMessageBox: (options: any) => ipcRenderer.invoke('dialog:showMessageBox', options),
})

contextBridge.exposeInMainWorld('appEvents', {
  onMainProcessMessage(listener: (message: string) => void): () => void {
    const wrapper = (_event: any, message: string) => listener(message);
    ipcRenderer.on('main-process-message', wrapper);
    return () => {
      ipcRenderer.removeListener('main-process-message', wrapper);
    };
  },
  onTaskProgress(listener: (progress: any) => void): () => void {
    const wrapper = (_event: any, progress: any) => listener(progress);
    ipcRenderer.on('app:taskProgress', wrapper);
    return () => {
      ipcRenderer.removeListener('app:taskProgress', wrapper);
    };
  },
  // レガシー移行が実行された起動でmainプロセスから届く移行レポート (ADR-0007)
  onMigrationReport(listener: (report: any) => void): () => void {
    const wrapper = (_event: any, report: any) => listener(report);
    ipcRenderer.on('app:migrationReport', wrapper);
    return () => {
      ipcRenderer.removeListener('app:migrationReport', wrapper);
    };
  },
})

contextBridge.exposeInMainWorld('baseMaps', {
  list: () => ipcRenderer.invoke('basemaps:list'),
  // uid正準の保存 (ADR-0007): payload = { uid?, slug, tms }(uidなし=新規作成)。
  // create=true (§7.2b/D11改) は新規作成の明示合図(uid=事前採番preset)
  saveUser: (payload: { uid?: string; slug: string; tms: any; expectedRevision?: number; create?: boolean }) => ipcRenderer.invoke('basemaps:save-user', payload),
  deleteUser: (baseMapUid: string) => ipcRenderer.invoke('basemaps:delete-user', baseMapUid),
  setAlways: (baseMapUid: string, always: boolean) => ipcRenderer.invoke('basemaps:set-always', baseMapUid, always),
})

contextBridge.exposeInMainWorld('appAssets', {
  uploadTmsThumbnail: (mapID: string) => ipcRenderer.invoke('appassets:upload-tms-thumbnail', mapID),
  // M12-T15 (R5): Maplat地図サムネイル置換（512px/52px 独立 + 512px→52px 流用）
  replaceMapThumbnail: (mapUid: string, kind: '512' | '52', derive52: boolean) =>
    ipcRenderer.invoke('appassets:replace-map-thumbnail', mapUid, kind, derive52),
  generateTmsThumbnail: (mapID: string, tms: any, coverageLngLats: [number, number][]) =>
    ipcRenderer.invoke('appassets:generate-tms-thumbnail', mapID, tms, coverageLngLats),
  uploadSplash: () => ipcRenderer.invoke('appassets:upload-splash'),
  uploadPwaIcon: (appID: string) => ipcRenderer.invoke('appassets:upload-pwa-icon', appID),
  fileUrl: (relPath: string) => ipcRenderer.invoke('appassets:file-url', relPath),
})

// POI ソース (ADR-0007): uid正準 + slug契約。get は uid-or-slug 参照を受ける。
// save の payload: { slug, title, fc, expectedRevision? }(結果 union は maps/apps と同形)
contextBridge.exposeInMainWorld('poiSources', {
  list: (request: any) => ipcRenderer.invoke('poisource:list', request),
  get: (uid: string) => ipcRenderer.invoke('poisource:get', uid),
  createLocal: (input: any) => ipcRenderer.invoke('poisource:createLocal', input),
  save: (uid: string, payload: any) => ipcRenderer.invoke('poisource:save', uid, payload),
  importFile: (input: any) => ipcRenderer.invoke('poisource:importFile', input),
  detectImportLanguage: (filePath: string, fallbackLang?: string) =>
    ipcRenderer.invoke('poisource:detectImportLanguage', filePath, fallbackLang),
  registerRemote: (input: any) => ipcRenderer.invoke('poisource:registerRemote', input),
  refreshRemote: (uid: string) => ipcRenderer.invoke('poisource:refreshRemote', uid),
  cloneToLocal: (uid: string, input: any) => ipcRenderer.invoke('poisource:cloneToLocal', uid, input),
  findReferences: (uid: string) => ipcRenderer.invoke('poisource:findReferences', uid),
  delete: (uid: string) => ipcRenderer.invoke('poisource:delete', uid),
  exportFile: (uid: string) => ipcRenderer.invoke('poisource:exportFile', uid),
  // インポート用ネイティブファイル選択 (Phase 3)。キャンセル時は null
  pickImportFile: () => ipcRenderer.invoke('poisource:pickImportFile'),
})

contextBridge.exposeInMainWorld('assets', {
  checkSlug: (payload: { slug: string; excludeUid?: string }) =>
    ipcRenderer.invoke('asset:checkSlug', payload),
})

// 画像アセット (ADR-0007): uid正準 + slug契約。get/getFilePath は uid-or-slug 参照を受ける。
// channel prefix は imageassets:* (asset:checkSlug とは別名前空間)
contextBridge.exposeInMainWorld('imageAssets', {
  // uid = renderer 事前採番 preset (D11改/M11-T7): slug 予約の帰属と行 uid を一致させる
  add: (input: { slug: string; title: any; lang: string; sourceName: string; sourcePath: string; uid?: string }) =>
    ipcRenderer.invoke('imageassets:add', input),
  list: () => ipcRenderer.invoke('imageassets:list'),
  search: (query: string) => ipcRenderer.invoke('imageassets:search', query),
  get: (ref: string) => ipcRenderer.invoke('imageassets:get', ref),
  updateMetadata: (uid: string, input: { slug: string; title: any; lang: string; expectedRevision: number }) =>
    ipcRenderer.invoke('imageassets:update-metadata', uid, input),
  delete: (uid: string) => ipcRenderer.invoke('imageassets:delete', uid),
  getFilePath: (ref: string) => ipcRenderer.invoke('imageassets:getFilePath', ref),
  findReferences: (ref: string) => ipcRenderer.invoke('imageassets:findReferences', ref),
  // インポート用ネイティブファイル選択。キャンセル時は null
  pickImageFile: () => ipcRenderer.invoke('imageassets:pickImageFile'),
})

// slug 予約 (M11-T7/§7.2): 複数 instance 間の slug 予約・移動・解放・確認。
// payload-only の invoke のみ(m2安全API境界: raw ipcRenderer を渡さない)。
contextBridge.exposeInMainWorld('search', {
  // bbox filter は WGS84。main process の search handler が EPSG:3857 へ変換する。
  maps: (filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }) =>
    ipcRenderer.invoke('search:maps', filter),
  apps: (filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }) =>
    ipcRenderer.invoke('search:apps', filter),
  poiSources: (filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }) =>
    ipcRenderer.invoke('search:poiSources', filter),
  baseMaps: (filter: { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number }) =>
    ipcRenderer.invoke('search:baseMaps', filter),
  imageAssets: (filter: { q?: string; page: number; pageSize: number }) =>
    ipcRenderer.invoke('search:imageAssets', filter),
  searchExtent: (kind: 'map' | 'poi-source' | 'app', bbox: [number, number, number, number]) =>
    ipcRenderer.invoke('search:extent', kind, bbox),
  // raw searchExtent は既存互換の EPSG:3857。UI は上記 search:* filter を使う。
  resourceBbox: (kind: 'map', uid: string) =>
    ipcRenderer.invoke('search:resourceBbox', kind, uid),
  appCoverage: (appUid: string, mapUids?: string[]) =>
    ipcRenderer.invoke('search:appCoverage', appUid, mapUids),
})

contextBridge.exposeInMainWorld('isE2E', Boolean(process.env.MAPLAT_E2E_ROOT))

contextBridge.exposeInMainWorld('slugReservations', {
  reserve: (payload: { slug: string; assetUid: string; assetKind: string; draftUid: string }) =>
    ipcRenderer.invoke('slug-reservations:reserve', payload),
  move: (payload: { fromSlug: string | null; toSlug: string; assetUid: string; assetKind: string; draftUid: string }) =>
    ipcRenderer.invoke('slug-reservations:move', payload),
  release: (payload: { slug: string; assetUid: string }) =>
    ipcRenderer.invoke('slug-reservations:release', payload),
  check: (payload: { slug: string; excludeUid?: string }) =>
    ipcRenderer.invoke('slug-reservations:check', payload),
})
