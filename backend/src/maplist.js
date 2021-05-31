'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings').init(); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const thumbExtractor = require('../lib/ui_thumbnail'); // eslint-disable-line no-undef
const ProgressReporter = require('../lib/progress_reporter'); // eslint-disable-line no-undef
const nedbAccessor = require('../lib/nedbAccessor'); // eslint-disable-line no-undef
const storeHandler = require('@maplat/core/es5/source/store_handler'); // eslint-disable-line no-undef
const roundTo = require("round-to"); // eslint-disable-line no-undef

function arrayRoundTo(array, decimal) {
  return array.map((item) => roundTo(item, decimal));
}
function pointsRoundTo(points) {
  return points.map((point) => arrayRoundTo(point, 2));
}
function pointSetsRoundTo(pointsets) {
  return pointsets.map((pointset) => {
    pointset[0] = arrayRoundTo(pointset[0], 2);
    pointset[1] = arrayRoundTo(pointset[1], 6);
    return pointset;
  });
}
function edgesRoundTo(edges) {
  return edges.map((edge) => {
    edge[0] = edge[0].map((illst) => arrayRoundTo(illst, 2));
    edge[1] = edge[1].map((merc) => arrayRoundTo(merc, 6));
    return edge;
  });
}

let tileFolder;
let originalFolder;
let uiThumbnailFolder;
let dbFile;
let focused;
let nedb;

// For legacy use
let mapFolder;
let compFolder;

const maplist = {
  init() {
    const saveFolder = settings.getSetting('saveFolder');
    tileFolder = `${saveFolder}${path.sep}tiles`;
    fs.ensureDir(tileFolder, () => {});
    originalFolder = `${saveFolder}${path.sep}originals`;
    fs.ensureDir(originalFolder, () => {});
    uiThumbnailFolder = `${saveFolder}${path.sep}tmbs`;
    fs.ensureDir(uiThumbnailFolder, () => {});
    // For legacy
    mapFolder = `${saveFolder}${path.sep}maps`;
    compFolder = `${saveFolder}${path.sep}compiled`;

    dbFile = `${saveFolder}${path.sep}nedb.db`;
    nedb = nedbAccessor.getInstance(dbFile);

    focused = BrowserWindow.getFocusedWindow();
  },
  async start() {
    try {
      fs.statSync(compFolder);
    } catch (err) {
      this.request();
      return;
    }
    try {
      fs.statSync(`${compFolder}${path.sep}.updated`);
      this.request();
      return;
    } catch (err) {
      focused.webContents.send('migrationConfirm', {});
    }
  },
  async migration() {
    const maps = fs.readdirSync(compFolder);
    const progress = new ProgressReporter(focused, maps.length, 'maplist.migrating', 'maplist.migrated');
    progress.update(0);
    for (let i = 0; i < maps.length; i++) {
      const map = maps[i];
      if (map.match(/\.json$/)) {
        const mapID = map.replace(".json", "");
        const jsonLoad = fs.readJsonSync(`${compFolder}${path.sep}${map}`);
        let json = await storeHandler.store2HistMap(jsonLoad);
        json = json[0];
        if (json.gcps) json.gcps = pointSetsRoundTo(json.gcps);
        if (json.edges) json.edges = edgesRoundTo(json.edges);
        if (json.sub_maps) {
          json.sub_maps = json.sub_maps.map((sub_map) => {
            if (sub_map.gcps) sub_map.gcps = pointSetsRoundTo(sub_map.gcps);
            if (sub_map.edges) sub_map.edges = edgesRoundTo(sub_map.edges);
            if (sub_map.bounds) sub_map.bounds = pointsRoundTo(sub_map.bounds);
            return sub_map;
          });
        }
        const histMaps = await storeHandler.store2HistMap(json);
        //let histMaps = json;
        const store = await storeHandler.histMap2Store(histMaps[0], histMaps[1]);

        nedb.upsert(mapID, store);
      }
      progress.update(i + 1);
      await new Promise((res) => {
        setTimeout(res, 500); // eslint-disable-line no-undef
      });
    }
    fs.writeFileSync(`${compFolder}${path.sep}.updated`, "done");

    this.request();
    focused.webContents.send('deleteOldConfirm', {});
  },
  async deleteOld() {
    const folders = [compFolder, mapFolder];
    const progress = new ProgressReporter(focused, folders.length, 'maplist.deleting_old', 'maplist.deleted_old');
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      fs.removeSync(folder);
      progress.update(i + 1);
      await new Promise((res) => {
        setTimeout(res, 500); // eslint-disable-line no-undef
      });
    }
    focused.webContents.send('deletedOld', {});
  },
  async request(condition = "", page = 1) {
    if (!condition || condition === "") condition = null;
    let result;
    let pageUpdate = 0;
    while (1) { // eslint-disable-line no-constant-condition
      result = await nedb.search(condition, (page - 1) * 20, 20);
      if (result.docs.length === 0 && page > 1) {
        page--;
        pageUpdate = page;
      } else break;
    }
    if (pageUpdate) result.pageUpdate = pageUpdate;

    const thumbFiles = [];
    const docs = await Promise.all(result.docs.map(async (doc) => {
      const res = {
        mapID: doc._id
      };
      if (typeof doc.title === 'object') {
        const lang = doc.lang || 'ja';
        res.title = doc.title[lang];
      } else res.title = doc.title;
      res.imageExtension = doc.imageExtension || doc.imageExtention;
      res.width = doc.width || (doc.compiled && doc.compiled.wh && doc.compiled.wh[0]);
      res.height = doc.height || (doc.compiled && doc.compiled.wh && doc.compiled.wh[1]);

      if (!res.width || !res.height) return res;

      const thumbFolder = `${tileFolder}${path.sep}${res.mapID}${path.sep}0${path.sep}0`;
      return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
        fs.readdir(thumbFolder, (err, thumbs) => {
          if (err) {
            //reject(err);
            resolve(res);
            return;
          }
          if (!thumbs) {
            resolve(res);
            return;
          }
          let thumbFile;
          for (let i = 0; i < thumbs.length; i++) {
            const thumb = thumbs[i];
            if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
              thumbFile = `${thumbFolder}${path.sep}${thumb}`;
              res.thumbnail = fileUrl(thumbFile);
              const uiThumbnail = `${uiThumbnailFolder}${path.sep}${res.mapID}.jpg`;
              const uiThumbnail_old = `${uiThumbnailFolder}${path.sep}${res.mapID}_menu.jpg`;
              thumbFiles.push([thumbFile, uiThumbnail, uiThumbnail_old]);
            }
          }
          resolve(res);
        });
      });
    }));

    result.docs = docs;

    focused.webContents.send('mapList', result);

    thumbFiles.forEach((thumbFile) => {
      thumbExtractor.make_thumbnail(thumbFile[0], thumbFile[1], thumbFile[2]).then(() => {
      }).catch((e) => { console.log(e); }); // eslint-disable-line no-undef
    });
  },
  async delete(mapID, condition, page) {
    const nedb = nedbAccessor.getInstance(dbFile);
    try {
      await nedb.delete(mapID);
      const tile = `${tileFolder}${path.sep}${mapID}`;
      const thumbnail = `${uiThumbnailFolder}${path.sep}${mapID}.jpg`;
      await new Promise((res_, rej_) => {
        try {
          fs.statSync(tile);
          fs.remove(tile, (err) => {
            if (err) rej_(err);
            res_();
          });
        } catch (err) {
          res_();
        }
      });
      await new Promise((res_, rej_) => {
        try {
          fs.statSync(thumbnail);
          fs.remove(thumbnail, (err) => {
            if (err) rej_(err);
            res_();
          });
        } catch (err) {
          res_();
        }
      });
      await new Promise((res_, rej_) => {
        try {
          const originals = fs.readdir(originalFolder);
          const files = originals.filter((file) => !!file.match(new RegExp(`^${mapID}\\.`)));
          files.forEach((file) => {
            const original = `${originalFolder}${path.sep}${file}`;
            let error = false;
            fs.remove(original, (err) => {
              if (err) {
                error = true;
                rej_(err);
              }
            });
            if (!error) res_();
          });
        } catch (err) {
          res_();
        }
      });
      this.request(condition, page);
    } catch (e) {
      focused.webContents.send('deleteError', e);
    }
  }
};

module.exports = maplist; // eslint-disable-line no-undef
