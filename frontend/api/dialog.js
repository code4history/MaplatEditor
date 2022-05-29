const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async showMessageBox(content) {
    return new Promise((res) => {
      ipcRenderer.once('dialog_request_finished', () => {
        res();
      });
      ipcRenderer.send('dialog_request', content);
    });
  }
};

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      contextBridge.exposeInMainWorld('dialog', apis);
      initialized = true;
    }
  }
}