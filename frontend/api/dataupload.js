const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async showDataSelectDialog(mapImageRepl) {
    ipcRenderer.send('dataupload_showDataSelectDialog', mapImageRepl);
  },
  on(channel, callback) {
    ipcRenderer.on(`dataupload_${channel}`, (event, argv) => {
      callback(event, argv);
    });
  }
};

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      contextBridge.exposeInMainWorld('dataupload', apis);
      initialized = true;
    }
  }
}