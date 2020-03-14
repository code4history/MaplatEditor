'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings'); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const Tin = require('@maplat/tin'); // eslint-disable-line no-undef
const AdmZip = require('adm-zip'); // eslint-disable-line no-undef

settings.init();

let mapFolder;
let compiledFolder;
let tileFolder;
let originalFolder;
let thumbFolder;
let tmpFolder;
let focused;

const mapedit = {
    init() {
        const saveFolder = settings.getSetting('saveFolder');
        mapFolder = `${saveFolder}${path.sep}maps`;
        fs.ensureDir(mapFolder, () => {});
        compiledFolder = `${saveFolder}${path.sep}compiled`;
        fs.ensureDir(compiledFolder, () => {});
        tileFolder = `${saveFolder}${path.sep}tiles`;
        fs.ensureDir(tileFolder, () => {});
        originalFolder = `${saveFolder}${path.sep}originals`;
        fs.ensureDir(originalFolder, () => {});
        thumbFolder = `${saveFolder}${path.sep}tmbs`;
        tmpFolder = settings.getSetting('tmpFolder');
        fs.ensureDir(thumbFolder, () => {});

        focused = BrowserWindow.getFocusedWindow();
    },
    request(mapID) {
        const self = this;
        const mapFile = `${mapFolder}${path.sep}${mapID}.json`;
        const compiledFile = `${compiledFolder}${path.sep}${mapID}.json`;

        const loadData = (data) => {
            const json = JSON.parse(data);
            if (!json.width || !json.height) {
                focused.webContents.send('mapData', [json, ]);
                return;
            }
            const promise = new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
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

            promise.then((json) => {
                const promises = [Promise.resolve(json)];

                if (json.compiled) {
                    const tin = new Tin({});
                    tin.setCompiled(json.compiled);
                    json.gcps = tin.points;
                    json.edges = tin.edges || [];
                    delete json.compiled;
                    promises.push(Promise.resolve(tin.getCompiled()));
                } else {
                    promises.push(self.createTinFromGcpsAsync(json.gcps, json.edges || [], [json.width, json.height],
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
                            promises.push(self.createTinFromGcpsAsync(sub_map.gcps, sub_map.edges || [], null,
                                sub_map.bounds, json.strictMode, json.vertexMode));
                        }
                    }
                }

                return Promise.all(promises);
            }).then((results) => {
                const json = results.shift();
                const tins = results;
                focused.webContents.send('mapData', [json, tins]);
            });
        };

        fs.readFile(compiledFile, 'utf8', (err, data) => {
            if (err) {
                fs.readFile(mapFile, 'utf8', (err, data) => {
                    if (err) throw err;
                    loadData(data);
                });
                return;
            }
            loadData(data);
        });
    },
    download(mapObject) {
        setTimeout(() => { // eslint-disable-line no-undef
            const mapID = mapObject.mapID;
            const zip_file = `${tmpFolder}${path.sep}${mapID}.zip`;
            const zip = new AdmZip();

            zip.addLocalFile(`${compiledFolder}${path.sep}${mapID}.json`, 'maps', `${mapID}.json`);
            zip.addLocalFile(`${thumbFolder}${path.sep}${mapID}_menu.jpg`, 'tmbs', `${mapID}_menu.jpg`);
            zip.addLocalFolder(`${tileFolder}${path.sep}${mapID}`, `tiles${path.sep}${mapID}`);

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
    save(mapObject, tins) {
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
            if (index == 0) {
                delete compiled.gcps;
                compiled.compiled = tin;
            } else {
                const sub_map = compiled.sub_maps[index - 1];
                delete sub_map.gcps;
                sub_map.compiled = tin;
            }
        });
        const compiledContent = JSON.stringify(compiled, null, null);

        const mapFile = `${mapFolder}${path.sep}${mapID}.json`;
        const compiledFile = `${compiledFolder}${path.sep}${mapID}.json`;

        const tmpFolder = `${settings.getSetting('tmpFolder')}${path.sep}tiles`;
        const tmpUrl = fileUrl(tmpFolder);
        const newTile = tileFolder + path.sep + mapID;
        const newOriginal = `${originalFolder}${path.sep}${mapID}.${imageExtention}`;
        const newThumbnail = `${thumbFolder}${path.sep}${mapID}_menu.jpg`;
        const regex = new RegExp(`^${tmpUrl}`);
        const tmpCheck = url_ && url_.match(regex);

        Promise.all([
            new Promise((resolve, reject) => {
                if (status != 'Update') {
                    try {
                        fs.statSync(mapFile);
                        reject('Exist');
                        return;
                    } catch(err) { // eslint-disable-line no-empty
                    }
                    if (status.match(/^(Change|Copy):(.+)$/)) {
                        const isCopy = RegExp.$1 == 'Copy';
                        const oldMapID = RegExp.$2;
                        const oldMapFile = `${mapFolder}${path.sep}${oldMapID}.json`;
                        const oldCompiledFile = `${compiledFolder}${path.sep}${oldMapID}.json`;
                        const oldTile = `${tileFolder}${path.sep}${oldMapID}`;
                        const oldOriginal = `${originalFolder}${path.sep}${oldMapID}.${imageExtention}`;
                        const oldThumbnail = `${thumbFolder}${path.sep}${oldMapID}_menu.jpg`;
                        fs.writeFile(mapFile, content, (err) => {
                            if (err) {
                                reject('Error');
                                return;
                            }
                            const nextPromise = Promise.all([
                                new Promise((resolve_, reject_) => {
                                    if (isCopy) {
                                        resolve_();
                                    } else {
                                        fs.remove(oldMapFile, (err) => {
                                            if (err) reject_(err);
                                            try {
                                                fs.statSync(oldCompiledFile);
                                                fs.remove(oldCompiledFile, (err) => {
                                                    if (err) reject_(err);
                                                    resolve_();
                                                });
                                            } catch(err) {
                                                resolve_();
                                            }
                                        });
                                    }
                                }),
                                new Promise((resolve_, reject_) => {
                                    if (tmpCheck) {
                                        if (isCopy) {
                                            resolve_();
                                        } else {
                                            try {
                                                fs.statSync(oldTile);
                                                fs.remove(oldTile, (err) => {
                                                    if (err) reject_(err);
                                                    resolve_();
                                                });
                                            } catch(err) {
                                                resolve_();
                                            }
                                        }
                                    } else {
                                        const process = isCopy ? fs.copy : fs.move;
                                        try {
                                            fs.statSync(oldTile);
                                            process(oldTile, newTile, (err) => {
                                                if (err) reject_(err);
                                                resolve_();
                                            });
                                        } catch(err) {
                                            resolve_();
                                        }
                                    }
                                }),
                                new Promise((resolve_, reject_) => {
                                    if (tmpCheck) {
                                        if (isCopy) {
                                            resolve_();
                                        } else {
                                            try {
                                                fs.statSync(oldOriginal);
                                                fs.remove(oldOriginal, (err) => {
                                                    if (err) reject_(err);
                                                    resolve_();
                                                });
                                            } catch(err) {
                                                resolve_();
                                            }
                                        }
                                    } else {
                                        const process = isCopy ? fs.copy : fs.move;
                                        try {
                                            fs.statSync(oldOriginal);
                                            process(oldOriginal, newOriginal, (err) => {
                                                if (err) reject_(err);
                                                try {
                                                    fs.statSync(oldThumbnail);
                                                    process(oldThumbnail, newThumbnail, (err) => {
                                                        if (err) reject_(err);
                                                        resolve();
                                                    });
                                                } catch(err) {
                                                    resolve();
                                                }
                                            });
                                        } catch (err) {
                                            resolve_();
                                        }
                                    }
                                })
                            ]);
                            fs.writeFile(compiledFile, compiledContent, (err) => {
                                if (err) {
                                    reject('Error');
                                    return;
                                }
                                nextPromise.then(() => {
                                    resolve('Success');
                                }).catch(() => {
                                    reject('Error');
                                });
                            });
                        });
                    } else {
                        fs.writeFile(mapFile, content, (err) => {
                            if (err) reject('Error');
                            else fs.writeFile(compiledFile, compiledContent, (err) => {
                                if (err) reject('Error');
                                else resolve('Success');
                            });
                        });
                    }
                } else {
                    fs.writeFile(mapFile, content, (err) => {
                        if (err) reject('Error');
                        else fs.writeFile(compiledFile, compiledContent, (err) => {
                            if (err) reject('Error');
                            else resolve('Success');
                        });
                    });
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
    checkID(id) {
        const mapFile = `${mapFolder}${path.sep}${id}.json`;
        fs.stat(mapFile, (err, stats) => { // eslint-disable-line no-unused-vars
            if (err) focused.webContents.send('checkIDResult', true);
            else focused.webContents.send('checkIDResult', false);
        });
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
    }
};

module.exports = mapedit; // eslint-disable-line no-undef
