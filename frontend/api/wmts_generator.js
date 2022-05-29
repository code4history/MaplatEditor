const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async generate(mapID, width, height, tinSerial, extKey, hash) {
    ipcRenderer.send('wmtsGen_generate', mapID, width, height, tinSerial, extKey, hash);
  },
  on(channel, callback) {
    ipcRenderer.on(`wmtsGen_${channel}`, (event, argv) => {
      callback(event, argv);
    });
  }
};

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      contextBridge.exposeInMainWorld('wmtsGen', apis);
      initialized = true;
    }
  }
}