const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

contextBridge.exposeInMainWorld('baseApi', {
  // Define on-demand require function for setting set of frontend and backend logics
  async require(module_name) {
    return new Promise((res) => {
      // Event listener that backend logic registration was finished
      ipcRenderer.once('require_ready', () => {
        res();
      });
      // Frontend logic registration
      const frontend = require(`./${module_name}`); // eslint-disable-line no-undef
      frontend.init();
      // Request for backend logic registration
      ipcRenderer.send('require', module_name);
    });
  }
});