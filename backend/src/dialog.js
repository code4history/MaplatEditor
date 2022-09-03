const {ipcMain, dialog} = require('electron'); // eslint-disable-line no-undef

let initialized = false;

module.exports = { // eslint-disable-line no-undef
  init() {
    if (!initialized) {
      initialized = true;
      ipcMain.on('dialog_request', async (ev, content) => {
        const resp = await dialog.showMessageBox(content);
        ev.reply("dialog_request_finished", resp);
      });
    }
  },
}