const { ipcRenderer, contextBridge } = require('electron'); // eslint-disable-line no-undef

let initialized = false;

const apis = {
  async request(condition, page) {
    ipcRenderer.send('mapedit_request', condition, page);
  },
  async updateTin(gcps, edges, index, bounds, strict, vertex) {
    ipcRenderer.send('mapedit_updateTin', gcps, edges, index, bounds, strict, vertex);
  },
  async checkExtentMap(extent) {
    ipcRenderer.send('mapedit_checkExtentMap', extent);
  },
  async getTmsListOfMapID(mapID) {
    return new Promise((res) => {
      ipcRenderer.once('mapedit_getTmsListOfMapID_finished', (ev, list) => {
        res(list);
      });
      ipcRenderer.send('mapedit_getTmsListOfMapID', mapID);
    });
  },
  async getWmtsFolder() {
    return new Promise((res) => {
      ipcRenderer.once('mapedit_getWmtsFolder_finished', (ev, folder) => {
        res(folder);
      });
      ipcRenderer.send('mapedit_getWmtsFolder');
    });
  },
  async checkID(mapID) {
    ipcRenderer.send('mapedit_checkID', mapID);
  },
  async download(mapID) {
    ipcRenderer.send('mapedit_download', mapID);
  },
  async uploadCsv(csvRepl, csvUpSettings) {
    ipcRenderer.send('mapedit_uploadCsv', csvRepl, csvUpSettings);
  },
  async save(mapObject, tins) {
    ipcRenderer.send('mapedit_save', mapObject, tins);
  },
  on(channel, callback) {
    ipcRenderer.on(`mapedit_${channel}`, (event, argv) => {
      callback(event, argv);
    });
  },
  once(channel, callback) {
    ipcRenderer.once(`mapedit_${channel}`, (event, argv) => {
      callback(event, argv);
    });
  }
};

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      contextBridge.exposeInMainWorld('mapedit', apis);
      initialized = true;
    }
  }
}