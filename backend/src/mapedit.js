'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings').init(); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const Tin = require('@maplat/tin'); // eslint-disable-line no-undef
const AdmZip = require('adm-zip'); // eslint-disable-line no-undef
const rfs = require('recursive-fs'); // eslint-disable-line no-undef
const ProgressReporter = require('../lib/progress_reporter'); // eslint-disable-line no-undef
const nedbAccessor = require('../lib/nedbAccessor'); // eslint-disable-line no-undef

let tileFolder;
let originalFolder;
let thumbFolder;
let tmpFolder;
let focused;
let dbFile;
let nedb;

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
        let json = await nedb.find(mapID);
        const whReady = (json.width && json.height) || json.compiled.wh;
        if (!whReady) {
            focused.webContents.send('mapData', [json, ]);
            return;
        }
        json = await new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
            if (json.url) {
                json.url_ = json.url;
                resolve(json);
            } else {
                const thumbFolder = `${tileFolder}${path.sep}${mapID}${path.sep}0${path.sep}0`;
                fs.readdir(thumbFolder, (err, thumbs) => {
                    if (!thumbs) {
                        resolve(json);
                        return;
                    }
                    for (let i=0; i<thumbs.length; i++) {
                        const thumb = thumbs[i];
                        if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
                            let thumbURL = fileUrl(thumbFolder + path.sep + thumb);
                            thumbURL = thumbURL.replace(/\/0\/0\/0\./, '/{z}/{x}/{y}.');
                            json.url_ = thumbURL;
                            resolve(json);
                            return;
                        }
                    }
                });
            }
        });

        const promises = [];

        if (json.compiled) {
            const tin = new Tin({});
            tin.setCompiled(json.compiled);
            json.gcps = tin.points;
            json.edges = tin.edges || [];
            if (tin.wh) {
                json.width = tin.wh[0];
                json.height = tin.wh[1];
            }
            delete json.compiled;
            promises.push(Promise.resolve(tin.getCompiled()));
        } else {
            promises.push(this.createTinFromGcpsAsync(json.gcps, json.edges || [], [json.width, json.height],
              null, json.strictMode, json.vertexMode));
        }
        if (json.sub_maps) {
            for (let i=0; i< json.sub_maps.length; i++) {
                const sub_map = json.sub_maps[i];
                if (sub_map.compiled) {
                    const tin = new Tin({});
                    tin.setCompiled(sub_map.compiled);
                    sub_map.gcps = tin.points;
                    sub_map.edges = tin.edges || [];
                    delete sub_map.compiled;
                    promises.push(Promise.resolve(tin.getCompiled()));
                } else {
                    promises.push(this.createTinFromGcpsAsync(sub_map.gcps, sub_map.edges || [], null,
                      sub_map.bounds, json.strictMode, json.vertexMode));
                }
            }
        }

        const tins = await Promise.all(promises);
        focused.webContents.send('mapData', [json, tins]);
    },
    download(mapObject) {
        setTimeout(async () => { // eslint-disable-line no-undef
            const mapID = mapObject.mapID;
            const targets = [
                [`${compiledFolder}${path.sep}${mapID}.json`, 'maps', `${mapID}.json`],
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
                }, (filename) => {
                    if(filename && filename[0]) {
                        fs.moveSync(zip_file, filename, {
                            overwrite: true
                        });
                        focused.webContents.send('mapDownloadResult', 'Success');
                    } else {
                        fs.removeSync(zip_file);
                        focused.webContents.send('mapDownloadResult', 'Canceled');
                    }
                });
            });
        }, 1000);
    },
    async save(mapObject, tins) {
        const status = mapObject.status;
        const mapID = mapObject.mapID;
        const url_ = mapObject.url_;
        const imageExtention = mapObject.imageExtention || 'jpg';
        delete mapObject.status;
        delete mapObject.mapID;
        delete mapObject.url_;
        const content = JSON.stringify(mapObject, null, '    ');

        const compiled = JSON.parse(content);
        tins.map((tin, index) => {
            if (typeof tin == 'string') return;
            if (index === 0) {
                delete compiled.gcps;
                delete compiled.edges;
                delete compiled.width;
                delete compiled.height;
                compiled.compiled = tin;
            } else {
                const sub_map = compiled.sub_maps[index - 1];
                delete sub_map.gcps;
                delete sub_map.edges;
                sub_map.compiled = tin;
            }
        });

        const tmpFolder = `${settings.getSetting('tmpFolder')}${path.sep}tiles`;
        const tmpUrl = fileUrl(tmpFolder);
        const newTile = tileFolder + path.sep + mapID;
        const newOriginal = `${originalFolder}${path.sep}${mapID}.${imageExtention}`;
        const newThumbnail = `${thumbFolder}${path.sep}${mapID}.jpg`;
        const regex = new RegExp(`^${tmpUrl}`);
        const tmpCheck = url_ && url_.match(regex);

        Promise.all([
            new Promise(async (resolve, reject) => {
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
                        const oldOriginal = `${originalFolder}${path.sep}${oldMapID}.${imageExtention}`;
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
                        fs.move(`${newTile}${path.sep}original.${imageExtention}`, newOriginal, (err) => {
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
    updateTin(gcps, edges, index, bounds, strict, vertex) {
        const wh = index == 0 ? bounds : null;
        const bd = index != 0 ? bounds : null;
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
    }
};

module.exports = mapedit; // eslint-disable-line no-undef
