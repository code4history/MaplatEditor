import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld('settings', {
  get: (key: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  showSaveFolderDialog: () => ipcRenderer.invoke('settings:select-folder'),
})

contextBridge.exposeInMainWorld('maplist', {
  request: (query: string, page: number) => ipcRenderer.invoke('maplist:request', query, page),
  on: (channel: string, listener: (event: any, ...args: any[]) => void) => {
      ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
      ipcRenderer.removeListener(channel, listener); // Simple implementation
  }
})

contextBridge.exposeInMainWorld('mapedit', {
  request: (mapID: string) => ipcRenderer.invoke('mapedit:request', mapID),
  getTmsListOfMapID: (mapID: string) => ipcRenderer.invoke('mapedit:get-tms-list', mapID),
  updateTin: (gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any) =>
    ipcRenderer.invoke('mapedit:updateTin', gcps, edges, index, bounds, strict, vertex),
})

contextBridge.exposeInMainWorld('versions', {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
  v8: process.versions.v8
})

contextBridge.exposeInMainWorld('dialog', {
  showMessageBox: (options: any) => ipcRenderer.invoke('dialog:showMessageBox', options),
})
