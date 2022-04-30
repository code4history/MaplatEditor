const {ipcMain, dialog} = require('electron'); // eslint-disable-line no-undef

module.exports = { // eslint-disable-line no-undef
  init() {
    ipcMain.on('dialog_request', async (ev, content) => {
      await dialog.showMessageBox(content);
      ev.reply("dialog_request_finished");
    });
  },
}