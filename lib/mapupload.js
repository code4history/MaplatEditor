'use strict';

var async = require('async');
var im    = require('./imagemagick_modified.js');
const os = require('os');
const path = require('path');
const app = require('electron').app;
const fs = require('fs-extra');
var electron = require('electron');
var BrowserWindow = electron.BrowserWindow;
var settings;
var electron = require('electron');
if (electron.app || electron.remote) {
    settings = require('./settings');
    settings.init();
}
var fileUrl = require('file-url');

var mapFolder;
var tileFolder;
var tmpFolder;
var focused;

var MapUpload = {
    init: function() {
        if (settings) {
            var saveFolder = settings.getSetting('saveFolder');
            mapFolder = saveFolder + path.sep + 'maps';
            fs.ensureDir(mapFolder, function (err) {
            });
            tileFolder = saveFolder + path.sep + 'tiles';
            fs.ensureDir(tileFolder, function (err) {
            });
            tmpFolder = settings.getSetting('tmpFolder');
            focused = BrowserWindow.getFocusedWindow();
        } else {
            mapFolder = '.';
            tileFolder = '.' + path.sep + 'tiles';
            tmpFolder = '.' + path.sep + 'tmp';
        }
    },
    showMapSelectDialog: function() {
        var dialog = require('electron').dialog;
        var focused = BrowserWindow.getFocusedWindow();
        var self = this;
        dialog.showOpenDialog({ defaultPath: app.getPath('documents'), properties: ['openFile'],
            // filters: [ {name: '地図画像', extensions: ['jpg']} ] }, function (baseDir){
            filters: [ {name: '地図画像', extensions: ['jpg', 'png', 'jpeg']} ] }, function (baseDir){
            if(baseDir && baseDir[0]) {
                self.imageCutter(baseDir[0]);
            } else {
                focused.webContents.send('mapUploaded', {
                    err: 'Canceled'
                });
            }
        });
    },
    imageCutter: function(srcFile) {
        var regex   =  new RegExp('([^\\/]+)\\.([^\\.]+)$');
        var extKey;
        var outFolder;

        new Promise(function(resolve, reject) {
            if (srcFile.match(regex)) {
                extKey  = RegExp.$2;
            } else {
                reject('画像拡張子エラー');
            }
            outFolder = tmpFolder + path.sep + 'tiles';
            try {
                fs.statSync(outFolder);
                fs.remove(outFolder, function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            } catch(err) {
                resolve();
            }
        }).then(function() {
            return new Promise(function(resolve, reject) {
                var result = {};
                fs.ensureDir(outFolder, function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    im.identify(srcFile, function(err, features) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        result.width = features.width;
                        result.height = features.height;

                        var xZoom = Math.ceil(Math.log(result.width / 256) / Math.log(2));
                        var yZoom = Math.ceil(Math.log(result.height / 256) / Math.log(2));
                        result.zoom = xZoom > yZoom ? xZoom : yZoom;
                        if (result.zoom < 0) result.zoom = 0;

                        resolve(result);
                    });
                });
            });
        }).then(function(arg) {
            var parallel = [Promise.resolve(arg)];

            for (var z = arg.zoom; z >= 0; z--) {
                var args = [srcFile];
                var zw, zh;
                if (z != arg.zoom) {
                    zw = Math.round(arg.width / Math.pow(2, arg.zoom - z));
                    zh = Math.round(arg.height / Math.pow(2, arg.zoom - z));
                    args.push('-geometry');
                    args.push(zw + 'x' + zh + '!');
                } else {
                    zw = arg.width;
                    zh = arg.height;
                }
                args.push('-crop');
                args.push('256x256');
                args.push(outFolder + '/tmpImage-' + z + '.' + extKey);

                (function () {
                    var _args = args;
                    var _z = z;
                    var _zw = zw;
                    var _zh = zh;
                    var func = new Promise(function (resolve, reject) {
                        im.convert(_args, function (err, stdout, stderr) {
                            if (err) {
                                reject(err);
                                return;
                            }
                            var zi = 0;
                            for (var zy = 0; zy * 256 < _zh; zy++) {
                                for (var zx = 0; zx * 256 < _zw; zx++) {
                                    var origName;
                                    if (_z == 0) {
                                        origName = outFolder + '/tmpImage-0.' + extKey;
                                    } else {
                                        origName = outFolder + '/tmpImage-' + _z + '-' + zi + '.' + extKey;
                                    }
                                    fs.mkdirsSync(outFolder + '/' + _z + '/' + zx);
                                    var changeName = outFolder + '/' + _z + '/' + zx + '/' + zy + '.' + extKey;

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

            parallel.push(new Promise(function(resolve, reject) {
                fs.copy(srcFile, outFolder + path.sep + 'original.' + extKey, function(err){
                    if (err) reject(err);
                    else resolve();
                });
            }));

            return Promise.all(parallel);
        }).then(function(args) {
            var arg = args[0];
            var thumbURL = fileUrl(outFolder);
            thumbURL = thumbURL + '/{z}/{x}/{y}.' + extKey;
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    width: arg.width,
                    height: arg.height,
                    url: thumbURL,
                    imageExtention: extKey
                });
            }
        }).catch(function(err) {
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    err: err
                });
            }
        });
    },
    imageCutter2: function(srcFile) {
        var regex   =  new RegExp('([^\\/]+)\\.([^\\.]+)$');
        var extKey;
        var outFolder;

        new Promise(function(resolve, reject) {
            if (srcFile.match(regex)) {
                extKey  = RegExp.$2;
            } else {
                reject('画像拡張子エラー');
            }
            outFolder = tmpFolder + path.sep + 'tiles';
            try {
                fs.statSync(outFolder);
                fs.remove(outFolder, function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            } catch(err) {
                resolve();
            }
        }).then(function() {
            return new Promise(function(resolve, reject) {
                var result = {};
                fs.ensureDir(outFolder, function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    im.identify(srcFile, function(err, features) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        result.width = features.width;
                        result.height = features.height;

                        var xZoom = Math.ceil(Math.log(result.width / 256) / Math.log(2));
                        var yZoom = Math.ceil(Math.log(result.height / 256) / Math.log(2));
                        result.zoom = xZoom > yZoom ? xZoom : yZoom;
                        if (result.zoom < 0) result.zoom = 0;

                        resolve(result);
                    });
                });
            });
        }).then(function(arg) {
            var parallel = [Promise.resolve(arg)];

            for (var z = arg.zoom; z >= 0; z--) {
                var args = [srcFile];
                var zw, zh;
                if (z != arg.zoom) {
                    zw = Math.round(arg.width / Math.pow(2, arg.zoom - z));
                    zh = Math.round(arg.height / Math.pow(2, arg.zoom - z));
                    args.push('-geometry');
                    args.push(zw + 'x' + zh + '!');
                } else {
                    zw = arg.width;
                    zh = arg.height;
                }
                args.push('-crop');
                args.push('256x256');
                args.push(outFolder + '/tmpImage-' + z + '.' + extKey);

                (function () {
                    var _args = args;
                    var _z = z;
                    var _zw = zw;
                    var _zh = zh;
                    var func = new Promise(function (resolve, reject) {
                        im.convert(_args, function (err, stdout, stderr) {
                            if (err) {
                                reject(err);
                                return;
                            }
                            var zi = 0;
                            for (var zy = 0; zy * 256 < _zh; zy++) {
                                for (var zx = 0; zx * 256 < _zw; zx++) {
                                    var origName;
                                    if (_z == 0) {
                                        origName = outFolder + '/tmpImage-0.' + extKey;
                                    } else {
                                        origName = outFolder + '/tmpImage-' + _z + '-' + zi + '.' + extKey;
                                    }
                                    fs.mkdirsSync(outFolder + '/' + _z + '/' + zx);
                                    var changeName = outFolder + '/' + _z + '/' + zx + '/' + zy + '.' + extKey;

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

            parallel.push(new Promise(function(resolve, reject) {
                fs.copy(srcFile, outFolder + path.sep + 'original.' + extKey, function(err){
                    if (err) reject(err);
                    else resolve();
                });
            }));

            return Promise.all(parallel);
        }).then(function(args) {
            var arg = args[0];
            var thumbURL = fileUrl(outFolder);
            thumbURL = thumbURL + '/{z}/{x}/{y}.' + extKey;
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    width: arg.width,
                    height: arg.height,
                    url: thumbURL,
                    imageExtention: extKey
                });
            }
        }).catch(function(err) {
            if (focused) {
                focused.webContents.send('mapUploaded', {
                    err: err
                });
            }
        });
    },
    cropperForLogic2: function(srcFile, zoom, x, y, maxZoom, width, height) {
        var parallel = [Promise.resolve(arg)];
        var cropSize = 256 * Math.pow(2, maxZoom - zoom - 1);

        parallel.push(new Promise(function(resolve, reject) {
            var args = [srcFile];
            var zw, zh;
            if (zoom != maxZoom) {
                zw = Math.round(width / Math.pow(2, maxZoom - zoom));
                zh = Math.round(height / Math.pow(2, maxZoom - zoom));
                args.push('-geometry');
                args.push(zw + 'x' + zh + '!');
            } else {
                zw = width;
                zh = height;
            }
            var tileFolder = outFolder + path.sep + zoom + path.sep + x;
            fs.ensureDir(tileFolder, function (err) {
                if (err) {
                    reject(err);
                    return;
                }
                args.push(tileFolder + path.sep + y + '.' + extKey);
                im.convert(args, function (err, stdout, stderr) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        }));

        if (zoom == maxZoom) {
            parallel.push(new Promise(function(resolve, reject) {
                var args = [srcFile];
                var zw, zh;
                args.push('-crop');
                args.push(cropSize + 'x' + cropSize);
                


            }));
        }

        if (zoom == 0) {
            parallel.push(new Promise(function(resolve, reject) {
                fs.copy(srcFile, outFolder + path.sep + 'original.' + extKey, function(err){
                    if (err) reject(err);
                    else resolve();
                });
            }));
        }

        return Promise.all(parallel).then(function() {
            //削除
        });
    }
};

module.exports = MapUpload;