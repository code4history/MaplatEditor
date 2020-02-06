'use strict';

const im = require('../lib/imagemagick_modified.js'); // eslint-disable-line no-undef
const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
let settings;
if (electron.app || electron.remote) {
    settings = require('./settings'); // eslint-disable-line no-undef
    settings.init();
}
const fileUrl = require('file-url'); // eslint-disable-line no-undef

let mapFolder;
let tileFolder;
let tmpFolder;
let outFolder;
let focused;
let extKey;

const cropperForLogic2 = (srcFile, zoom, x, y, maxZoom, width, height) => {
    const parallel = [];
    const cropSize = 256 * Math.pow(2, maxZoom - zoom - 1);

    parallel.push(new Promise((resolve, reject) => {
        const args = [srcFile];
        let zw, zh;
        if (zoom != maxZoom) {
            zw = Math.round(width / Math.pow(2, maxZoom - zoom));
            zh = Math.round(height / Math.pow(2, maxZoom - zoom));
            args.push('-geometry');
            args.push(`${zw}x${zh}!`);
        } else {
            zw = width;
            zh = height;
        }
        const tileFolder = outFolder + path.sep + zoom + path.sep + x;
        fs.ensureDir(tileFolder, (err) => {
            if (err) {
                reject(err);
                return;
            }
            args.push(`${tileFolder}${path.sep}${y}.${extKey}`);
            im.convert(args, (err, stdout, stderr) => { // eslint-disable-line no-unused-vars
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }));

    if (zoom != maxZoom) {
        parallel.push(new Promise((resolve, reject) => {
            const args = [srcFile];
            args.push('+repage');
            args.push('-crop');
            args.push(`${cropSize}x${cropSize}`);
            args.push('+repage');
            const tmpImageBase = `${outFolder}/tmpImage-${zoom}-${x}-${y}`;
            args.push(`${tmpImageBase}.${extKey}`);

            im.convert(args, (err, stdout, stderr) => { // eslint-disable-line no-unused-vars
                if (err) {
                    reject(err);
                    return;
                }
                let zi = 0;
                let innerPromise;
                if (width <= cropSize && height <= cropSize) {
                    innerPromise = cropperForLogic2(`${tmpImageBase}.${extKey}`, zoom + 1, x * 2, y * 2, maxZoom, width, height);
                } else {
                    const innerPromises = [];
                    for (let zy = 0; zy < (height <= cropSize ? 1 : 2); zy++) {
                        for (let zx = 0; zx < (width <= cropSize ? 1 : 2); zx++) {
                            const nextFile = `${tmpImageBase}-${zi}.${extKey}`;
                            const nextWidth = zx == 0 ? width <= cropSize ? width : cropSize : width - cropSize;
                            const nextHeight = zy == 0 ? height <= cropSize ? height : cropSize : height - cropSize;
                            innerPromises.push(cropperForLogic2(nextFile, zoom + 1, x * 2 + zx, y * 2 + zy, maxZoom, nextWidth, nextHeight));
                            zi++;
                        }
                    }
                    innerPromise = Promise.all(innerPromises);
                }

                innerPromise.then(() => {
                    resolve();
                }).catch((err) => {
                    reject(err);
                });
            });
        }));
    }

    if (zoom == 0) {
        parallel.push(new Promise((resolve, reject) => {
            fs.copy(srcFile, `${outFolder}${path.sep}original.${extKey}`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        }));
    }

    return Promise.all(parallel).then(() => {
        if (zoom != 0) {
            fs.remove(srcFile, () => {
            });
        }
        return Promise.resolve();
    });
};

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
            // filters: [ {name: '地図画像', extensions: ['jpg']} ] }, function (baseDir){
            filters: [ {name: mapImageRepl, extensions: ['jpg', 'png', 'jpeg']} ] }, (baseDir) => {
            if(baseDir && baseDir[0]) {
                self.imageCutter2(baseDir[0]);
            } else {
                focused.webContents.send('mapUploaded', {
                    err: 'Canceled'
                });
            }
        });
    },
    imageCutter(srcFile) {
        const regex   =  new RegExp('([^\\/]+)\\.([^\\.]+)$');

        new Promise((resolve, reject) => {
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
        }).then(() =>
            new Promise((resolve, reject) => {
                const result = {};
                fs.ensureDir(outFolder, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    im.identify(srcFile, (err, features) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        result.width = features.width;
                        result.height = features.height;

                        const xZoom = Math.ceil(Math.log(result.width / 256) / Math.log(2));
                        const yZoom = Math.ceil(Math.log(result.height / 256) / Math.log(2));
                        result.zoom = xZoom > yZoom ? xZoom : yZoom;
                        if (result.zoom < 0) result.zoom = 0;

                        resolve(result);
                    });
                });
            })
        ).then((arg) => {
            const parallel = [Promise.resolve(arg)];

            for (let z = arg.zoom; z >= 0; z--) {
                const args = [srcFile];
                let zw, zh;
                if (z != arg.zoom) {
                    zw = Math.round(arg.width / Math.pow(2, arg.zoom - z));
                    zh = Math.round(arg.height / Math.pow(2, arg.zoom - z));
                    args.push('-geometry');
                    args.push(`${zw}x${zh}!`);
                } else {
                    zw = arg.width;
                    zh = arg.height;
                }
                args.push('-crop');
                args.push('256x256');
                args.push(`${outFolder}/tmpImage-${z}.${extKey}`);

                (() => {
                    const _args = args;
                    const _z = z;
                    const _zw = zw;
                    const _zh = zh;
                    const func = new Promise((resolve, reject) => {
                        im.convert(_args, (err, stdout, stderr) => { // eslint-disable-line no-unused-vars
                            if (err) {
                                reject(err);
                                return;
                            }
                            let zi = 0;
                            for (let zy = 0; zy * 256 < _zh; zy++) {
                                for (let zx = 0; zx * 256 < _zw; zx++) {
                                    let origName;
                                    if (_z == 0) {
                                        origName = `${outFolder}/tmpImage-0.${extKey}`;
                                    } else {
                                        origName = `${outFolder}/tmpImage-${z}-${zi}.${extKey}`;
                                    }
                                    fs.mkdirsSync(`${outFolder}/${z}/${zx}`);
                                    const changeName = `${outFolder}/${z}/${zx}/${zy}.${extKey}`;

                                    fs.renameSync(origName, changeName);

                                    zi++;
                                }
                            }

                            resolve();
                        });
                    });
                    parallel.push(func);
                })();
            }

            parallel.push(new Promise((resolve, reject) => {
                fs.copy(srcFile, `${outFolder}${path.sep}original.${extKey}`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            }));

            return Promise.all(parallel);
        }).then((args) => {
            const arg = args[0];
            let thumbURL = fileUrl(outFolder);
            thumbURL = `${thumbURL}/{z}/{x}/{y}.${extKey}`;
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    width: arg.width,
                    height: arg.height,
                    url: thumbURL,
                    imageExtention: extKey
                });
            }
        }).catch((err) => {
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    err
                });
            }
        });
    },
    imageCutter2(srcFile) {
        const regex   =  new RegExp('([^\\/]+)\\.([^\\.]+)$');

        new Promise((resolve, reject) => {
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
        }).then(() =>
            new Promise((resolve, reject) => {
                const result = {};
                fs.ensureDir(outFolder, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    im.identify(srcFile, (err, features) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        result.width = features.width;
                        result.height = features.height;

                        const xZoom = Math.ceil(Math.log(result.width / 256) / Math.log(2));
                        const yZoom = Math.ceil(Math.log(result.height / 256) / Math.log(2));
                        result.zoom = xZoom > yZoom ? xZoom : yZoom;
                        if (result.zoom < 0) result.zoom = 0;

                        resolve(result);
                    });
                });
            })
        ).then((arg) =>
            Promise.all([Promise.resolve(arg), cropperForLogic2(srcFile, 0, 0, 0, arg.zoom, arg.width, arg.height)])
        ).then((args) => {
            const arg = args[0];
            let thumbURL = fileUrl(outFolder);
            thumbURL = `${thumbURL}/{z}/{x}/{y}.${extKey}`;
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    width: arg.width,
                    height: arg.height,
                    url: thumbURL,
                    imageExtention: extKey
                });
            }
        }).catch((err) => {
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    err
                });
            } else {
                console.log(err); // eslint-disable-line no-undef
            }
        });
    }
};

module.exports = MapUpload; // eslint-disable-line no-undef