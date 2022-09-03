const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async showMessageBox(content) {
    console.log("!!!")
    console.log(content)
    return new Promise((res) => {
      console.log("AAA")
      console.log(content)
      ipcRenderer.once('dialog_request_finished', (ev, resp) => {
        res(resp);
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