"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // 必要に応じて他のAPIをここに追加する
});
electron.contextBridge.exposeInMainWorld("settings", {
  get: (key) => electron.ipcRenderer.invoke("settings:get", key),
  set: (key, value) => electron.ipcRenderer.invoke("settings:set", key, value),
  showSaveFolderDialog: () => electron.ipcRenderer.invoke("settings:select-folder")
});
electron.contextBridge.exposeInMainWorld("maplist", {
  request: (query, page) => electron.ipcRenderer.invoke("maplist:request", query, page),
  delete: (mapID, condition, page) => electron.ipcRenderer.invoke("maplist:delete", mapID, condition, page),
  on: (channel, listener) => {
    electron.ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off: (channel, listener) => {
    electron.ipcRenderer.removeListener(channel, listener);
  }
});
electron.contextBridge.exposeInMainWorld("mapedit", {
  request: (mapID) => electron.ipcRenderer.invoke("mapedit:request", mapID),
  getTmsListOfMapID: (mapID) => electron.ipcRenderer.invoke("mapedit:get-tms-list", mapID),
  updateTin: (gcps, edges, index, bounds, strict, vertex) => electron.ipcRenderer.invoke("mapedit:updateTin", gcps, edges, index, bounds, strict, vertex),
  save: (mapObject, tins) => electron.ipcRenderer.invoke("mapedit:save", mapObject, tins),
  checkID: (mapID) => electron.ipcRenderer.invoke("mapedit:checkID", mapID),
  checkExtentMap: (extent) => electron.ipcRenderer.invoke("mapedit:checkExtentMap", extent),
  download: (mapObject, tins) => electron.ipcRenderer.invoke("mapedit:download", mapObject, tins),
  uploadCsv: (csvRepl, csvUpSettings) => electron.ipcRenderer.invoke("mapedit:uploadCsv", csvRepl, csvUpSettings),
  getWmtsFolder: () => electron.ipcRenderer.invoke("mapedit:getWmtsFolder")
});
electron.contextBridge.exposeInMainWorld("dataupload", {
  showDataSelectDialog: () => electron.ipcRenderer.invoke("dataupload:showDataSelectDialog")
});
electron.contextBridge.exposeInMainWorld("wmtsGen", {
  generate: (mapID, width, height, tinSerial, extKey, hash) => electron.ipcRenderer.invoke("wmtsGen:generate", mapID, width, height, tinSerial, extKey, hash)
});
electron.contextBridge.exposeInMainWorld("mapupload", {
  // 旧実装: window.mapupload.showMapSelectDialog(mapImageLabel)
  // → ipcRenderer.invoke で結果を Promise として受け取る
  showMapSelectDialog: (mapImageLabel) => electron.ipcRenderer.invoke("mapupload:showMapSelectDialog", mapImageLabel)
});
electron.contextBridge.exposeInMainWorld("versions", {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
  v8: process.versions.v8
});
electron.contextBridge.exposeInMainWorld("dialog", {
  showMessageBox: (options) => electron.ipcRenderer.invoke("dialog:showMessageBox", options)
});
