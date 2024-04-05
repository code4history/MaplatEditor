import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message: string) => ipcRenderer.send('message', message)
})

contextBridge.exposeInMainWorld('baseApi', {
  // Define on-demand require function for setting set of frontend and backend logics
  async require(module_name) {
    return new Promise(async (res, rej) => {
      try {
        // Event listener that backend logic registration was finished
        ipcRenderer.once('require_ready', () => {
          res(undefined);
        });
        // Frontend logic registration
        const frontend = await import(`./${module_name}`);
        frontend.init();
        // Request for backend logic registration
        ipcRenderer.send('require', module_name);        
      } catch (err) {
        rej(err);
      }
    });
  }
});
