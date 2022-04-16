'use strict';

const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
let settings;
if (electron.app || electron.remote) {
  settings = require('./settings').init(); // eslint-disable-line no-undef
}
const AdmZip = require("adm-zip"); // eslint-disable-line no-undef
const nedbAccessor = require("../lib/nedb_accessor"); // eslint-disable-line no-undef
const {exists, normalizeRequestData} = require("../lib/utils"); // eslint-disable-line no-undef

let mapFolder;
let tileFolder;
let uiThumbnailFolder;
let tmpFolder;
//let outFolder;
let focused;
//let extKey;
let dbFile;
let nedb;

const DataUpload = {
  init() {
    if (settings) {
      const saveFolder = settings.getSetting("saveFolder");
      mapFolder = path.resolve(saveFolder, "maps");
      fs.ensureDir(mapFolder, () => {
      });
      tileFolder = path.resolve(saveFolder, "tiles");
      fs.ensureDir(tileFolder, () => {
      });
      uiThumbnailFolder = path.resolve(saveFolder, "tmbs");
      fs.ensureDir(uiThumbnailFolder, () => {
      });
      tmpFolder = settings.getSetting("tmpFolder");

      dbFile = path.resolve(saveFolder, "nedb.db");
      nedb = nedbAccessor.getInstance(dbFile);

      focused = BrowserWindow.getFocusedWindow();
    } else {
      mapFolder = '.';
      tileFolder = `.${path.sep}tiles`;
      tmpFolder = `.${path.sep}tmp`;
    }
  },
  showDataSelectDialog(mapImageRepl) {
    const dialog = require('electron').dialog; // eslint-disable-line no-undef
    const focused = BrowserWindow.getFocusedWindow();
    const self = this;
    dialog.showOpenDialog({ defaultPath: app.getPath('documents'), properties: ['openFile'],
      filters: [ {name: mapImageRepl, extensions: ['zip']} ]}).then(async (ret) => {
      if (ret.canceled) {
        focused.webContents.send('uploadedData', {
          err: 'Canceled'
        });
      } else {
        self.extractZip(ret.filePaths[0]);
      }
    });
  },
  async extractZip(zipFile) {
    try {
      const dataTmpFolder = path.resolve(tmpFolder, "zip");
      await fs.remove(dataTmpFolder);
      await fs.ensureDir(dataTmpFolder);
      const zip = new AdmZip(zipFile);
      zip.extractAllTo(dataTmpFolder, true);
      const mapTmpFolder = path.resolve(dataTmpFolder, "maps");
      const tileTmpFolder = path.resolve(dataTmpFolder, "tiles");
      const tmbTmpFolder = path.resolve(dataTmpFolder, "tmbs");
      const tmbOriginFolder = path.resolve(dataTmpFolder, "originals");
      const mapFile = (await fs.readdir(mapTmpFolder))[0];
      const mapID = mapFile.split(/\./)[0];
      const mapPath = path.resolve(mapTmpFolder, mapFile);
      const mapData = await fs.readJSON(mapPath, "utf8");
      const tilePath = path.resolve(tileTmpFolder, mapID);
      const tmbPath = path.resolve(tmbTmpFolder, `${mapID}.jpg`);
      //const originPath = path.resolve(tmbTmpFolder, mapID);
      const tileToPath = path.resolve(tileFolder, mapID);
      const tmbToPath = path.resolve(uiThumbnailFolder, `${mapID}.jpg`);

      const existCheckID = await nedb.find(mapID);
      if (existCheckID) throw 'Exist';
      const existCheckTile = await exists(tilePath);
      if (!existCheckTile) throw 'NoTile';
      const existCheckTmb = await exists(tmbPath);
      if (!existCheckTmb) throw 'NoTmb';

      await nedb.upsert(mapID, mapData);
      await fs.remove(tileToPath);
      await fs.move(tilePath, tileToPath);
      await fs.remove(tmbToPath);
      await fs.move(tmbPath, tmbToPath);

      const res = await normalizeRequestData(mapData, `${tileFolder}${path.sep}${mapID}${path.sep}0${path.sep}0`);
      res[0].mapID = mapID;
      res[0].status = 'Update';
      res[0].onlyOne = true;
      focused.webContents.send('uploadedData', res);
    } catch(err) {
      if (focused) {
        focused.webContents.send('uploadedData', {
          err
        });
      } else {
        console.log(err); // eslint-disable-line no-undef
      }
    }
  }
};

module.exports = DataUpload; // eslint-disable-line no-undef