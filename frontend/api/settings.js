const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async lang() {
    return new Promise((res) => {
      // Event listener that setter of electron-json-storage was finished
      ipcRenderer.once('settings_lang_got', (ev, langVal) => {
        res(langVal);
      });
      // Request for backend logic for setter of electron-json-storage
      ipcRenderer.send('settings_lang');
    });
  }
};

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      contextBridge.exposeInMainWorld('settings', apis);
      initialized = true;
    }
  }
}