'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings').init(); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const Tin = require('@maplat/tin').default; // eslint-disable-line no-undef
const AdmZip = require('adm-zip'); // eslint-disable-line no-undef
const rfs = require('recursive-fs'); // eslint-disable-line no-undef
const ProgressReporter = require('../lib/progress_reporter'); // eslint-disable-line no-undef
const nedbAccessor = require('../lib/nedb_accessor'); // eslint-disable-line no-undef
const storeHandler = require('@maplat/core/es5/source/store_handler'); // eslint-disable-line no-undef
const {dialog} = require("electron"); // eslint-disable-line no-undef
const csv = require('csv-parser'); // eslint-disable-line no-undef
const proj  = require('proj4'); // eslint-disable-line no-undef

let tileFolder;
let originalFolder;
let thumbFolder;
let tmpFolder;
let focused;
let dbFile;
let nedb;
let extentCheck;
let extentBuffer;

const mapedit = {
  init() {
    const saveFolder = settings.getSetting('saveFolder');
    tileFolder = `${saveFolder}${path.sep}tiles`;
    fs.ensureDir(tileFolder, () => {});
    originalFolder = `${saveFolder}${path.sep}originals`;
    fs.ensureDir(originalFolder, () => {});
    thumbFolder = `${saveFolder}${path.sep}tmbs`;
    tmpFolder = settings.getSetting('tmpFolder');
    fs.ensureDir(thumbFolder, () => {});

    dbFile = `${saveFolder}${path.sep}nedb.db`;
    nedb = nedbAccessor.getInstance(dbFile);

    focused = BrowserWindow.getFocusedWindow();
  },
  async request(mapID) {
    const json = await nedb.find(mapID);
    let url_;
    const whReady = (json.width && json.height) || (json.compiled && json.compiled.wh);
    if (!whReady) {
      focused.webContents.send('mapData', [json, ]);
      return;
    }
    await new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
      if (json.url) {
        url_ = json.url;
        resolve();
      } else {
        const thumbFolder = `${tileFolder}${path.sep}${mapID}${path.sep}0${path.sep}0`;
        fs.readdir(thumbFolder, (err, thumbs) => {
          if (!thumbs) {
            resolve();
            return;
          }
          for (let i=0; i<thumbs.length; i++) {
            const thumb = thumbs[i];
            if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
              let thumbURL = fileUrl(thumbFolder + path.sep + thumb);
              thumbURL = thumbURL.replace(/\/0\/0\/0\./, '/{z}/{x}/{y}.');
              url_ = thumbURL;
              resolve();
              return;
            }
          }
        });
      }
    });
    
    const res = await storeHandler.store2HistMap(json, true);
    res[0].url_ = url_;
    focused.webContents.send('mapData', res);
  },
  async download(mapObject, tins) {
    const mapID = mapObject.mapID;

    mapObject = await storeHandler.histMap2Store(mapObject, tins);

    const tmpFile = `${settings.getSetting('tmpFolder')}${path.sep}${mapID}.json`;
    fs.writeFileSync(tmpFile, JSON.stringify(mapObject));

    const targets = [
      [tmpFile, 'maps', `${mapID}.json`],
      [`${thumbFolder}${path.sep}${mapID}.jpg`, 'tmbs', `${mapID}.jpg`]
    ];

    const {dirs, files} = await rfs.read(`${tileFolder}${path.sep}${mapID}`); // eslint-disable-line no-unused-vars
    files.map((file) => {
      const localPath = path.resolve(file);
      const zipName = path.basename(localPath);
      const zipPath = path.dirname(localPath).match(/[/\\](tiles[/\\].+$)/)[1];
      targets.push([localPath, zipPath, zipName]);
    });

    const progress = new ProgressReporter(focused, targets.length, 'mapdownload.adding_zip', 'mapdownload.creating_zip');
    progress.update(0);
    const zip_file = `${tmpFolder}${path.sep}${mapID}.zip`;
    const zip = new AdmZip();

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      zip.addLocalFile(target[0], target[1], target[2]);
      progress.update(i + 1);
    }

    zip.writeZip(zip_file, () => {
      const dialog = require('electron').dialog; // eslint-disable-line no-undef
      const focused = BrowserWindow.getFocusedWindow();
      dialog.showSaveDialog({
        defaultPath: `${app.getPath('documents')}${path.sep}${mapID}.zip`,
        filters: [ {name: "Output file", extensions: ['zip']} ]
      }).then((ret) => {
        if(!ret.canceled) {
          fs.moveSync(zip_file, ret.filePath, {
            overwrite: true
          });
          focused.webContents.send('mapDownloadResult', 'Success');
        } else {
          fs.removeSync(zip_file);
          focused.webContents.send('mapDownloadResult', 'Canceled');
        }
        fs.removeSync(tmpFile);
      });
    });
  },
  async save(mapObject, tins) {
    const status = mapObject.status;
    const mapID = mapObject.mapID;
    const url_ = mapObject.url_;
    const imageExtension = mapObject.imageExtension || mapObject.imageExtention || 'jpg';
    if (tins.length === 0) tins = ['tooLessGcps'];
    const compiled = await storeHandler.histMap2Store(mapObject, tins);

    const tmpFolder = `${settings.getSetting('tmpFolder')}${path.sep}tiles`;
    const tmpUrl = fileUrl(tmpFolder);
    const newTile = tileFolder + path.sep + mapID;
    const newOriginal = `${originalFolder}${path.sep}${mapID}.${imageExtension}`;
    const newThumbnail = `${thumbFolder}${path.sep}${mapID}.jpg`;
    const regex = new RegExp(`^${tmpUrl}`);
    const tmpCheck = url_ && url_.match(regex);

    Promise.all([
      new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
        if (status !== 'Update') {
          const existCheck = await nedb.find(mapID);
          if (existCheck) {
            reject('Exist');
            return;
          }

          if (status.match(/^(Change|Copy):(.+)$/)) {
            const isCopy = RegExp.$1 === 'Copy';
            const oldMapID = RegExp.$2;
            const oldTile = `${tileFolder}${path.sep}${oldMapID}`;
            const oldOriginal = `${originalFolder}${path.sep}${oldMapID}.${imageExtension}`;
            const oldThumbnail = `${thumbFolder}${path.sep}${oldMapID}.jpg`;
            try {
              await nedb.upsert(mapID, compiled);
              if (!isCopy) {
                await nedb.delete(oldMapID);
              }
              if (tmpCheck) {
                if (!isCopy) {
                  await new Promise((res_, rej_) => {
                    try {
                      fs.statSync(oldTile);
                      fs.remove(oldTile, (err) => {
                        if (err) rej_(err);
                        res_();
                      });
                    } catch(err) {
                      res_();
                    }
                  });
                  await new Promise((res_, rej_) => {
                    try {
                      fs.statSync(oldOriginal);
                      fs.remove(oldOriginal, (err) => {
                        if (err) rej_(err);
                        res_();
                      });
                    } catch (err) {
                      res_();
                    }
                  });
                  await new Promise((res_, rej_) => {
                    try {
                      fs.statSync(oldThumbnail);
                      fs.remove(oldThumbnail, (err) => {
                        if (err) rej_(err);
                        res_();
                      });
                    } catch (err) {
                      res_();
                    }
                  });
                }
              } else {
                const process = isCopy ? fs.copy : fs.move;
                await new Promise((res_, rej_) => {
                  try {
                    fs.statSync(oldTile);
                    process(oldTile, newTile, (err) => {
                      if (err) rej_(err);
                      res_();
                    });
                  } catch (err) {
                    res_();
                  }
                });
                await new Promise((res_, rej_) => {
                  try {
                    fs.statSync(oldOriginal);
                    process(oldOriginal, newOriginal, (err) => {
                      if (err) rej_(err);
                      res_();
                    });
                  } catch (err) {
                    res_();
                  }
                });
                await new Promise((res_, rej_) => {
                  try {
                    fs.statSync(oldThumbnail);
                    process(oldThumbnail, newThumbnail, (err) => {
                      if (err) rej_(err);
                      res_();
                    });
                  } catch (err) {
                    res_();
                  }
                });
              }
              resolve('Success');
            } catch(e) {
              reject('Error');
            }
          } else {
            try {
              await nedb.upsert(mapID, compiled);
              resolve('Success');
            } catch(e) {
              reject('Error');
            }
          }
        } else {
          try {
            await nedb.upsert(mapID, compiled);
            resolve('Success');
          } catch(e) {
            reject('Error');
          }
        }
      }),
      new Promise((resolve, reject) => {
        if (tmpCheck) {
          try {
            fs.statSync(newTile);
            fs.removeSync(newTile);
          } catch(err) { // eslint-disable-line no-empty
          }
          fs.move(tmpFolder, newTile, (err) => {
            if (err) reject(err);
            try {
              fs.statSync(newOriginal);
              fs.removeSync(newOriginal);
            } catch(err) { // eslint-disable-line no-empty
            }
            fs.move(`${newTile}${path.sep}original.${imageExtension}`, newOriginal, (err) => {
              if (err) reject(err);
              try {
                fs.statSync(newThumbnail);
                fs.removeSync(newThumbnail);
              } catch(err) { // eslint-disable-line no-empty
              }
              fs.move(`${newTile}${path.sep}thumbnail.jpg`, newThumbnail, (err) => {
                if (err) reject(err);
                resolve();
              });
            });
          });
        } else {
          resolve();
        }
      })
    ]).then(() => {
      focused.webContents.send('saveResult', 'Success');
    }).catch((err) => {
      focused.webContents.send('saveResult', err);
    });
  },
  async checkID(id) {
    const json = await nedb.find(id);
    if (!json) focused.webContents.send('checkIDResult', true);
    else focused.webContents.send('checkIDResult', false);
  },
  uploadCsv(csvRepl, csvUpSettings) {
    dialog.showOpenDialog({ defaultPath: app.getPath('documents'), properties: ['openFile'],
      filters: [ {name: csvRepl, extensions: []} ]}).then((ret) => {
      if (ret.canceled) {
        focused.webContents.send('uploadedCsv', {
          err: 'Canceled'
        });
      } else {
        const file = ret.filePaths[0];
        const results = [];
        const options = {
          strict: true,
          headers: false,
          skipLines: csvUpSettings.ignoreHeader ? 1 : 0
        };
        fs.createReadStream(file)
          .pipe(csv(options))
          .on('data', (data) => results.push(data))
          .on('end', () => {
            let error;
            const gcps = [];
            if (results.length === 0) error = "csv_format_error";
            results.forEach((line) => {
              if (error) return;
              try {
                const illstCoord = [];
                const rawGeoCoord = [];
                illstCoord[0] = parseFloat(line[csvUpSettings.pixXColumn - 1]);
                illstCoord[1] = parseFloat(line[csvUpSettings.pixYColumn - 1]);
                if (csvUpSettings.reverseMapY) illstCoord[1] = -1 * illstCoord[1];
                rawGeoCoord[0] = parseFloat(line[csvUpSettings.lngColumn - 1]);
                rawGeoCoord[1] = parseFloat(line[csvUpSettings.latColumn - 1]);
                const geoCoord = proj(csvUpSettings.projText, "EPSG:3857", rawGeoCoord);
                gcps.push([illstCoord, geoCoord]);
              } catch(e) {
                error = "csv_format_error";
              }
            });
            if (error) {
              focused.webContents.send('uploadedCsv', {
                err: error
              });
            } else {
              focused.webContents.send('uploadedCsv', {
                gcps
              });
            }
          })
          .on('error', (e) => {
            focused.webContents.send('uploadedCsv', {
              err: e
            });
          });
      }
    });
  },
  updateTin(gcps, edges, index, bounds, strict, vertex) {
    const wh = index === 0 ? bounds : null;
    const bd = index !== 0 ? bounds : null;
    this.createTinFromGcpsAsync(gcps, edges, wh, bd, strict, vertex)
      .then((tin) => {
        focused.webContents.send('updatedTin', [index, tin]);
      }).catch((err) => {
        throw(err);
      });
  },
  createTinFromGcpsAsync(gcps, edges, wh, bounds, strict, vertex) {
    if (gcps.length < 3) return Promise.resolve('tooLessGcps');
    return new Promise((resolve, reject) => {
      const tin = new Tin({});
      if (wh) {
        tin.setWh(wh);
      } else if (bounds) {
        tin.setBounds(bounds);
      } else {
        reject('Both wh and bounds are missing');
      }
      tin.setStrictMode(strict);
      tin.setVertexMode(vertex);
      tin.setPoints(gcps);
      tin.setEdges(edges);
      tin.updateTinAsync()
        .then(() => {
          resolve(tin.getCompiled());
        }).catch((err) => {
          console.log(err); // eslint-disable-line no-console,no-undef
          if (err == 'SOME POINTS OUTSIDE') {
            resolve('pointsOutside');
          } else if (err.indexOf('TOO LINEAR') == 0) {
            resolve('tooLinear');
          } else if (err.indexOf('Vertex indices of edge') > -1 || err.indexOf('is degenerate!') > -1 ||
            err.indexOf('already exists or intersects with an existing edge!') > -1) {
            resolve('edgeError');
          } else {
            reject(err);
          }
        });
    });
  },
  getTmsList() {
    return settings.getSetting('tmsList');
  },
  async getTmsListOfMapID(mapID) {
    if (mapID) return settings.getTmsListOfMapID(mapID);
    else return this.getTmsList();
  },
  async checkExtentMap(extent) {
    if (!extentCheck) {
      if (!(extentBuffer && extentBuffer.reduce((ret, item, idx) => ret && (item === extent[idx]), true))) {
        extentCheck = true;
        extentBuffer = extent;
        const mapList = await nedb.searchExtent(extent);
        console.log('mapList'); // eslint-disable-line no-undef
        focused.webContents.send('extentMapList', mapList);
        setTimeout(() => { // eslint-disable-line no-undef
          extent = extentCheck;
          extentCheck = undefined;
          if (extent !== true) {
            this.checkExtentMap(extent);
          }
        }, 1000);
      }
    } else {
      extentCheck = extent;
    }
  },
  getWmtsFolder() {
    const saveFolder = settings.getSetting('saveFolder');
    return path.resolve(saveFolder, './wmts');
  }
};

module.exports = mapedit; // eslint-disable-line no-undef
