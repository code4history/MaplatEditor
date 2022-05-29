const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async start() {
    ipcRenderer.send('maplist_start');
  },
  async migration() {
    ipcRenderer.send('maplist_migration');
  },
  async request(condition, page) {
    ipcRenderer.send('maplist_request', condition, page);
  },
  async deleteOld() {
    ipcRenderer.send('maplist_deleteOld');
  },
  async delete(mapID, condition, page) {
    ipcRenderer.send('maplist_delete', mapID, condition, page);
  },
  on(channel, callback) {
    ipcRenderer.on(`maplist_${channel}`, (event, argv) => {
      callback(event, argv);
    });
  }
};

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      contextBridge.exposeInMainWorld('maplist', apis);
      initialized = true;
    }
  }
}