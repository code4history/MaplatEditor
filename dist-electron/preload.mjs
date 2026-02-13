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
  // You can expose other APTs you need here.
  // ...
});
electron.contextBridge.exposeInMainWorld("settings", {
  get: (key) => electron.ipcRenderer.invoke("settings:get", key),
  set: (key, value) => electron.ipcRenderer.invoke("settings:set", key, value),
  showSaveFolderDialog: () => electron.ipcRenderer.invoke("settings:select-folder")
});
electron.contextBridge.exposeInMainWorld("maplist", {
  request: (query, page) => electron.ipcRenderer.invoke("maplist:request", query, page),
  on: (channel, listener) => {
    electron.ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off: (channel, listener) => {
    electron.ipcRenderer.removeListener(channel, listener);
  }
});
electron.contextBridge.exposeInMainWorld("mapedit", {
  request: (mapID) => electron.ipcRenderer.invoke("mapedit:request", mapID)
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
