import { ipcRenderer, contextBridge } from 'electron'

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
  getTmsListOfMapID: (mapID: string) => ipcRenderer.invoke('mapedit:get-tms-list', mapID),
  updateTin: (gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any) =>
    ipcRenderer.invoke('mapedit:updateTin', gcps, edges, index, bounds, strict, vertex),
  save: (mapObject: any, tins: any[]) =>
    ipcRenderer.invoke('mapedit:save', mapObject, tins),
  checkID: (mapID: string) =>
    ipcRenderer.invoke('mapedit:checkID', mapID),
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
