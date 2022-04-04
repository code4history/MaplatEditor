'use strict';

const { createCanvas, Image } = require('../lib/canvas_loader'); // eslint-disable-line no-undef

const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
let settings;
if (electron.app || electron.remote) {
  settings = require('./settings').init(); // eslint-disable-line no-undef
}
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const thumbExtractor = require('../lib/ui_thumbnail'); // eslint-disable-line no-undef
const ProgressReporter = require('../lib/progress_reporter'); // eslint-disable-line no-undef

let mapFolder;
let tileFolder;
let uiThumbnailFolder;
let tmpFolder;
let outFolder;
let focused;
let extKey;

const MapUpload = {
  init() {
    if (settings) {
      const saveFolder = settings.getSetting('saveFolder');
      mapFolder = `${saveFolder}${path.sep}maps`;
      fs.ensureDir(mapFolder, () => {
      });
      tileFolder = `${saveFolder}${path.sep}tiles`;
      fs.ensureDir(tileFolder, () => {
      });
      uiThumbnailFolder = `${saveFolder}${path.sep}tmbs`;
      fs.ensureDir(uiThumbnailFolder, () => {
      });
      tmpFolder = settings.getSetting('tmpFolder');
      focused = BrowserWindow.getFocusedWindow();
    } else {
      mapFolder = '.';
      tileFolder = `.${path.sep}tiles`;
      tmpFolder = `.${path.sep}tmp`;
    }
  },
  showMapSelectDialog(mapImageRepl) {
    const dialog = require('electron').dialog; // eslint-disable-line no-undef
    const focused = BrowserWindow.getFocusedWindow();
    const self = this;
    dialog.showOpenDialog({ defaultPath: app.getPath('documents'), properties: ['openFile'],
      filters: [ {name: mapImageRepl, extensions: ['jpg', 'png', 'jpeg']} ]}).then((ret) => {
      if (ret.canceled) {
        focused.webContents.send('uploadedMap', {
          err: 'Canceled'
        });
      } else {
        self.imageCutter(ret.filePaths[0]);
      }
    });
  },
  async imageCutter(srcFile) {
    try {
      const regex   =  new RegExp('([^\\/]+)\\.([^\\.]+)$');
      await new Promise((resolve, reject) => {
        if (srcFile.match(regex)) {
          extKey  = RegExp.$2;
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
      const image = await new Promise((res, rej) => {
        fs.readFile(srcFile, (err, buf) => {
          if (err) rej(err);
          const img = new Image();
          img.onload = () => { res(img) };
          img.onerror = (err) => { rej(err) };
          img.src = buf;
        });
      });
      const width = image.width;
      const height = image.height;
      const maxZoom = Math.ceil(Math.log(Math.max(width, height) / 256)/ Math.log(2));

      const tasks = [];
      const mime = extKey === 'png' ? 'image/png' : 'image/jpeg';
      const quality = extKey === 'png' ? {} : {quality: 0.9};

      for (let z = maxZoom; z >= 0; z--) {
        const pw = Math.round(width / Math.pow(2, maxZoom - z));
        const ph = Math.round(height / Math.pow(2, maxZoom - z));
        for (let tx = 0; tx * 256 < pw; tx++) {
          const tw = (tx + 1) * 256 > pw ? pw - tx * 256 : 256;
          const sx = tx * 256 * Math.pow(2, maxZoom - z);
          const sw = (tx + 1) * 256 * Math.pow(2, maxZoom - z) > width ? width - sx : 256 * Math.pow(2, maxZoom - z);
          const tileFolder = `${outFolder}${path.sep}${z}${path.sep}${tx}`;
          await fs.ensureDir(tileFolder);
          for (let ty = 0; ty * 256 < ph; ty++) {
            const th = (ty + 1) * 256 > ph ? ph - ty * 256 : 256;
            const sy = ty * 256 * Math.pow(2, maxZoom - z);
            const sh = (ty + 1) * 256 * Math.pow(2, maxZoom - z) > height ? height - sy : 256 * Math.pow(2, maxZoom - z);

            const tileFile = `${tileFolder}${path.sep}${ty}.${extKey}`;
            tasks.push([tileFile, sx, sy, sw, sh, tw, th]);
          }
        }
      }

      const progress = new ProgressReporter(focused, tasks.length, 'mapupload.dividing_tile', 'mapupload.next_thumbnail');
      progress.update(0);

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const canvas = createCanvas(task[5], task[6]);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, task[1], task[2], task[3], task[4], 0, 0, task[5], task[6]);

        const buffer = canvas.toBuffer(mime, quality);
        await fs.outputFile(task[0], buffer);
        progress.update(i + 1);
      }

      await fs.copy(srcFile, `${outFolder}${path.sep}original.${extKey}`);

      const thumbFrom = `${outFolder}${path.sep}0${path.sep}0${path.sep}0.${extKey}`;
      const thumbTo = `${outFolder}${path.sep}thumbnail.jpg`;
      await thumbExtractor.make_thumbnail(thumbFrom, thumbTo);

      const url = `${fileUrl(outFolder)}/{z}/{x}/{y}.${extKey}`;
      if (focused) {
        focused.webContents.send('uploadedMap', {
          width,
          height,
          url,
          imageExtension: extKey
        });
      }
    } catch(err) {
      if (focused) {
        focused.webContents.send('uploadedMap', {
          err
        });
      } else {
        console.log(err); // eslint-disable-line no-undef
      }
    }
  }
};

module.exports = MapUpload; // eslint-disable-line no-undef