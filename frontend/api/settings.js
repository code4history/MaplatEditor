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
  },
  async setSetting(key, value) {
    return new Promise((res) => {
      ipcRenderer.once('settings_setSetting_finished', () => {
        res();
      });
      ipcRenderer.send('settings_setSetting', key, value);
    });
  },
  async getSetting(key) {
    return new Promise((res) => {
      ipcRenderer.once('settings_getSetting_finished', (ev, value) => {
        res(value);
      });
      ipcRenderer.send('settings_getSetting', key);
    });
  },
  async showSaveFolderDialog(current) {
    ipcRenderer.send('settings_showSaveFolderDialog', current);
  },
  on(channel, callback) {
    ipcRenderer.on(`settings_${channel}`, (event, argv) => {
      callback(event, argv);
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