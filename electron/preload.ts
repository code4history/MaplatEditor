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
  getTmsListOfMapID: (mapID: string) => ipcRenderer.invoke('mapedit:get-tms-list', mapID),
  getBaseMapVisibilityOfMapID: (mapID: string) => ipcRenderer.invoke('mapedit:get-base-map-visibility', mapID),
  setBaseMapVisibilityForMapID: (mapID: string, baseMapId: string, enabled: boolean) =>
    ipcRenderer.invoke('mapedit:set-base-map-visibility', mapID, baseMapId, enabled),
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

contextBridge.exposeInMainWorld('appdraft', {
  save: (draft: any) => ipcRenderer.invoke('appdraft:save', draft),
  load: () => ipcRenderer.invoke('appdraft:load'),
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
  saveUser: (tms: any, originalMapID?: string) => ipcRenderer.invoke('basemaps:save-user', tms, originalMapID),
  deleteUser: (baseMapId: string) => ipcRenderer.invoke('basemaps:delete-user', baseMapId),
  setAlways: (baseMapId: string, always: boolean) => ipcRenderer.invoke('basemaps:set-always', baseMapId, always),
})

contextBridge.exposeInMainWorld('appAssets', {
  uploadTmsThumbnail: (mapID: string) => ipcRenderer.invoke('appassets:upload-tms-thumbnail', mapID),
  generateTmsThumbnail: (mapID: string, tms: any, coverageLngLats: [number, number][]) =>
    ipcRenderer.invoke('appassets:generate-tms-thumbnail', mapID, tms, coverageLngLats),
  uploadSplash: () => ipcRenderer.invoke('appassets:upload-splash'),
  uploadPwaIcon: (appID: string) => ipcRenderer.invoke('appassets:upload-pwa-icon', appID),
  fileUrl: (relPath: string) => ipcRenderer.invoke('appassets:file-url', relPath),
})

contextBridge.exposeInMainWorld('poiSources', {
  list: (request: any) => ipcRenderer.invoke('poisource:list', request),
  get: (sourceId: string) => ipcRenderer.invoke('poisource:get', sourceId),
  createLocal: (input: any) => ipcRenderer.invoke('poisource:createLocal', input),
  registerRemote: (input: any) => ipcRenderer.invoke('poisource:registerRemote', input),
  validateRemote: (input: any) => ipcRenderer.invoke('poisource:validateRemote', input),
  saveLocal: (sourceId: string, geojson: any) => ipcRenderer.invoke('poisource:saveLocal', sourceId, geojson),
  delete: (sourceId: string) => ipcRenderer.invoke('poisource:delete', sourceId),
})

contextBridge.exposeInMainWorld('assets', {
  checkSlug: (payload: { slug: string; excludeUid?: string }) =>
    ipcRenderer.invoke('asset:checkSlug', payload),
})
