'use strict';

const {Jimp} = require('../lib/utils'); // eslint-disable-line no-undef

const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const {ipcMain} = require("electron"); // eslint-disable-line no-undef
const settings = require('./settings').init(); // eslint-disable-line no-undef

const fileUrl = require('file-url'); // eslint-disable-line no-undef
const thumbExtractor = require('../lib/ui_thumbnail'); // eslint-disable-line no-undef
const ProgressReporter = require('../lib/progress_reporter'); // eslint-disable-line no-undef

let mapFolder;
let tileFolder;
let uiThumbnailFolder;
let tmpFolder;
let outFolder;
let extKey;
let toExtKey;

let initialized = false;

const MapUpload = {
  init() {
    const saveFolder = settings.getSetting('saveFolder');
    mapFolder = path.resolve(saveFolder, "maps");
    fs.ensureDir(mapFolder, () => {
    });
    tileFolder = path.resolve(saveFolder, "tiles");
    fs.ensureDir(tileFolder, () => {
    });
    uiThumbnailFolder = path.resolve(saveFolder, "tmbs");
    fs.ensureDir(uiThumbnailFolder, () => {
    });
    tmpFolder = settings.getSetting('tmpFolder');

    if (!initialized) {
      initialized = true;
      ipcMain.on('mapupload_showMapSelectDialog', async (event, mapImageRepl) => {
        this.showMapSelectDialog(event, mapImageRepl);
      });
    }
  },
  showMapSelectDialog(ev, mapImageRepl) {
    const dialog = require('electron').dialog; // eslint-disable-line no-undef
    const self = this;
    dialog.showOpenDialog({ defaultPath: app.getPath('documents'), properties: ['openFile'],
      filters: [ {name: mapImageRepl, extensions: ['jpg', 'png', 'jpeg']} ]}).then((ret) => {
      if (ret.canceled) {
        ev.reply('mapupload_uploadedMap', {
          err: 'Canceled'
        });
      } else {
        self.imageCutter(ev, ret.filePaths[0]);
      }
    });
  },
  async imageCutter(ev, srcFile) {
    try {
      const regex   =  new RegExp('([^\\/]+)\\.([^\\.]+)$');
      await new Promise((resolve, reject) => {
        if (srcFile.match(regex)) {
          extKey  = RegExp.$2;
          toExtKey = extKey.toLowerCase();
          if (toExtKey === 'jpeg') toExtKey = "jpg";
        } else {
          reject('画像拡張子エラー');
        }
        outFolder = `${tmpFolder}${path.sep}tiles`;
        try {
          fs.statSync(outFolder);
          fs.remove(outFolder, (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        } catch(err) {
          resolve();
        }
      });
      await fs.ensureDir(outFolder);
      const imageJimp = await Jimp.read(srcFile);
      const width = imageJimp.bitmap.width;
      const height = imageJimp.bitmap.height;
      const maxZoom = Math.ceil(Math.log(Math.max(width, height) / 256)/ Math.log(2));

      const tasks = [];
      for (let z = maxZoom; z >= 0; z--) {
        const pw = Math.round(width / Math.pow(2, maxZoom - z));
        const ph = Math.round(height / Math.pow(2, maxZoom - z));
        for (let tx = 0; tx * 256 < pw; tx++) {
          const tw = (tx + 1) * 256 > pw ? pw - tx * 256 : 256;
          const sx = tx * 256 * Math.pow(2, maxZoom - z);
          const sw = (tx + 1) * 256 * Math.pow(2, maxZoom - z) > width ? width - sx : 256 * Math.pow(2, maxZoom - z);
          const tileFolder = path.resolve(outFolder, `${z}`, `${tx}`);
          await fs.ensureDir(tileFolder);
          for (let ty = 0; ty * 256 < ph; ty++) {
            const th = (ty + 1) * 256 > ph ? ph - ty * 256 : 256;
            const sy = ty * 256 * Math.pow(2, maxZoom - z);
            const sh = (ty + 1) * 256 * Math.pow(2, maxZoom - z) > height ? height - sy : 256 * Math.pow(2, maxZoom - z);

            const tileFile = path.resolve(tileFolder, `${ty}.${toExtKey}`);
            tasks.push([tileFile, sx, sy, sw, sh, tw, th]);
          }
        }
      }

      const progress = new ProgressReporter("mapedit", tasks.length, 'mapupload.dividing_tile', 'mapupload.next_thumbnail');
      progress.update(ev, 0);

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        const canvasJimp = imageJimp.clone().crop(task[1], task[2], task[3], task[4]).resize(task[5], task[6]);
        await canvasJimp.write(task[0]);

        progress.update(ev, i + 1);
        await new Promise((s) => setTimeout(s, 1)); // eslint-disable-line no-undef
      }

      await fs.copy(srcFile, path.resolve(outFolder, `original.${toExtKey}`));

      const thumbFrom = path.resolve(outFolder, "0", "0", `0.${toExtKey}`);
      const thumbTo = path.resolve(outFolder, "thumbnail.jpg");
      await thumbExtractor.make_thumbnail(thumbFrom, thumbTo);

      const url = `${fileUrl(outFolder)}/{z}/{x}/{y}.${toExtKey}`;
      ev.reply('mapupload_uploadedMap', {
        width,
        height,
        url,
        imageExtension: toExtKey
      });
    } catch(err) {
      ev.reply('mapupload_uploadedMap', {
        err
      });
    }
  }
};

module.exports = MapUpload; // eslint-disable-line no-undef