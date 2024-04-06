import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message: string) => ipcRenderer.send('message', message)
})

// MapEdit
contextBridge.exposeInMainWorld('mapedit', {
  async request(condition, page) {
    ipcRenderer.send('mapedit_request', condition, page)
  }
})
