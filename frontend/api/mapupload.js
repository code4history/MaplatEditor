const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async showMapSelectDialog(mapImageRepl) {
    ipcRenderer.send('mapupload_showMapSelectDialog', mapImageRepl);
  },
  on(channel, callback) {
    ipcRenderer.on(`mapupload_${channel}`, (event, argv) => {
      callback(event, argv);
    });
  }
};

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      contextBridge.exposeInMainWorld('mapupload', apis);
      initialized = true;
    }
  }
}