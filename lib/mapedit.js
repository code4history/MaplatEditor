'use strict';
var path = require('path');
var settings = require('./settings');
var fs = require('fs-extra');
var fileUrl = require('file-url');
var electron = require('electron');
var BrowserWindow = electron.BrowserWindow;
var turf = require('@turf/turf');
var Tin = require('../common/js/tin');
var wkt = require('wellknown');
var isClockwise = turf.booleanClockwise;
const {ipcMain} = require('electron');

settings.init();

var mapFolder;
var compiledFolder;
var tileFolder;
var originalFolder;
var focused;
var tinObject;

var mapedit = {
    init: function() {
        var saveFolder = settings.getSetting('saveFolder');
        mapFolder = saveFolder + path.sep + 'maps';
        fs.ensureDir(mapFolder, function(err) {});
        compiledFolder = saveFolder + path.sep + 'compiled';
        fs.ensureDir(compiledFolder, function(err) {});
        tileFolder = saveFolder + path.sep + 'tiles';
        fs.ensureDir(tileFolder, function(err) {});
        originalFolder = saveFolder + path.sep + 'originals';
        fs.ensureDir(originalFolder, function(err) {});

        focused = BrowserWindow.getFocusedWindow();
        var self = this;
        ipcMain.on('updateTin', function(event, arg) {
            self.updateTin(arg);
        });
        tinObject = new Tin({});
    },
    request: function(mapID) {
        var self = this;
        var mapFile = mapFolder + path.sep + mapID + '.json';
        var compiledFile = compiledFolder + path.sep + mapID + '.json';

        var loadData = function(data) {
            var json = JSON.parse(data);
            if (!json.width || !json.height) {
                focused.webContents.send('mapData', json);
                return;
            }
            if (json.url) {
                json.url_ = json.url;
                self.setWh([json.width, json.height]);

                if (json.compiled) {
                    tinObject.setCompiled(json.compiled);
                    json.gcps = tinObject.points;
                }
                focused.webContents.send('mapData', json);
            } else {
                var thumbFolder = tileFolder + path.sep + mapID + path.sep + '0' + path.sep + '0';
                fs.readdir(thumbFolder, function(err, thumbs) {
                    if (!thumbs) {
                        focused.webContents.send('mapData', json);
                        return;
                    }
                    for (var i=0; i<thumbs.length; i++) {
                        var thumb = thumbs[i];
                        if (/^0\.jpg$/.test(thumb)) {
                        // if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
                            var thumbURL = fileUrl(thumbFolder + path.sep + thumb);
                            thumbURL = thumbURL.replace(/\/0\/0\/0\./, '/{z}/{x}/{y}.');
                            json.url_ = thumbURL;
                            self.setWh([json.width, json.height]);

                            if (json.compiled) {
                                tinObject.setCompiled(json.compiled);
                                json.gcps = tinObject.points;
                            }
                            focused.webContents.send('mapData', json);
                        }
                    }
                });
            }
        };

        fs.readFile(compiledFile, 'utf8', function(err, data) {
            if (err) {
                fs.readFile(mapFile, 'utf8', function (err, data) {
                    if (err) throw err;
                    loadData(data);
                });
                return;
            }
            loadData(data);
        });
    },
    setWh: function(wh) {
        tinObject.setWh(wh);
    },
    save: function(mapObject) {
        var status = mapObject.status;
        var mapID = mapObject.mapID;
        var url_ = mapObject.url_;
        delete mapObject.status;
        delete mapObject.mapID;
        delete mapObject.url_;
        delete mapObject.onlyOne;
        var content = JSON.stringify(mapObject, null, '    ');

        var compiled = JSON.parse(content);
        if (mapObject.gcps.length >= 3) {
            delete compiled.gcps;
            compiled.compiled = tinObject.getCompiled();
        }
        var compiledContent = JSON.stringify(compiled, null, null);

        var mapFile = mapFolder + path.sep + mapID + '.json';
        var compiledFile = compiledFolder + path.sep + mapID + '.json';
        Promise.all([
            new Promise(function(resolve, reject) {
                if (status != 'Update') {
                    try {
                        fs.statSync(mapFile);
                        reject('Exist');
                        return;
                    } catch(err) {
                    }
                    if (status.match(/^(Change|Copy):(.+)$/)) {
                        var isCopy = RegExp.$1 == 'Copy';
                        var oldMapID = RegExp.$2;
                        var oldMapFile = mapFolder + path.sep + oldMapID + '.json';
                        var oldCompiledFile = compiledFolder + path.sep + oldMapID + '.json';
                        var oldTile = tileFolder + path.sep + oldMapID;
                        var oldOriginal = originalFolder + path.sep + oldMapID + '.jpg';
                        var newTile = tileFolder + path.sep + mapID;
                        var newOriginal = originalFolder + path.sep + mapID + '.jpg';
                        fs.writeFile(mapFile, content, function(err) {
                            if (err) {
                                reject('Error');
                                return;
                            }
                            var nextPromise = Promise.all([
                                new Promise(function(resolve_, reject_) {
                                    if (isCopy) {
                                        resolve_();
                                    } else {
                                        fs.unlink(oldMapFile, function (err) {
                                            if (err) reject_(err);
                                            try {
                                                fs.statSync(oldCompiledFile);
                                                fs.unlink(oldCompiledFile, function (err) {
                                                    if (err) reject_(err);
                                                    resolve_();
                                                });
                                            } catch(err) {
                                                resolve_();
                                            }
                                        });
                                    }
                                }),
                                new Promise(function(resolve_, reject_) {
                                    var process = isCopy ? fs.copy : fs.rename;
                                    process(oldTile, newTile, function(err) {
                                        if (err) reject_(err);
                                        resolve_();
                                    });
                                }),
                                new Promise(function(resolve_, reject_) {
                                    var process = isCopy ? fs.copy : fs.rename;
                                    try {
                                        fs.statSync(oldOriginal);
                                        process(oldOriginal, newOriginal, function(err) {
                                            if (err) reject_(err);
                                            resolve_();
                                        });
                                    } catch(err) {
                                        resolve_();
                                    }
                                })
                            ]);
                            fs.writeFile(compiledFile, compiledContent, function(err) {
                                if (err) {
                                    reject('Error');
                                    return;
                                }
                                nextPromise.then(function() {
                                    resolve('Success');
                                }).catch(function(e) {
                                    reject('Error');
                                });
                            });
                        });
                    } else {
                        fs.writeFile(mapFile, content, function(err) {
                            if (err) reject('Error');
                            else fs.writeFile(compiledFile, compiledContent, function(err) {
                                if (err) reject('Error');
                                else resolve('Success');
                            });
                        });
                    }
                } else {
                    fs.writeFile(mapFile, content, function(err) {
                        if (err) reject('Error');
                        else fs.writeFile(compiledFile, compiledContent, function(err) {
                            if (err) reject('Error');
                            else resolve('Success');
                        });
                    });
                }
            }),
            new Promise(function(resolve, reject) {
                var tmpFolder = settings.getSetting('tmpFolder') + path.sep + 'tiles';
                var tmpUrl = fileUrl(tmpFolder);
                var newTile = tileFolder + path.sep + mapID;
                var regex = new RegExp('^' + tmpUrl);
                if (url_ && url_.match(regex)) {
                    try {
                        fs.statSync(newTile);
                        fs.removeSync(newTile);
                    } catch(err) {
                    }
                    fs.rename(tmpFolder, newTile, function(err) {
                        if (err) reject(err);
                        fs.rename(newTile + path.sep + 'original.jpg', originalFolder + path.sep + mapID + '.jpg' ,function(err){
                            if (err) reject(err);
                            resolve();
                        });
                    });
                } else {
                    resolve();
                }
            })
        ]).then(function() {
            focused.webContents.send('saveResult', 'Success');
        }).catch(function(err) {
            focused.webContents.send('saveResult', err);
        });
    },
    checkID: function(id) {
        var mapFile = mapFolder + path.sep + id + '.json';
        fs.stat(mapFile, function(err, stats) {
            if (err) focused.webContents.send('checkIDResult', true);
            else focused.webContents.send('checkIDResult', false);
        });
    },
    updateTin: function(gcps, strict) {
        tinObject.setPoints(gcps);
        if (gcps.length < 3) {
            focused.webContents.send('updatedTin', 'tooLessGcps');
            return;
        }
        tinObject.updateTinAsync(strict)
            .then(function() {
                focused.webContents.send('updatedTin', tinObject);
            }).catch(function(err) {
                throw err;
            });
    },
    transform: function(srcXy, isBackward) {
        if (!tinObject.points || tinObject.points.length < 3) {
            return 'tooLessGcps';
        }
        if (tinObject.strict_status == 'strict_error' && !isBackward) {
            return 'strictError';
        }
        return tinObject.transform(srcXy, !isBackward);
    },
    getTmsList: function() {
        return settings.getSetting('tmsList');
    }
};

module.exports = mapedit;
