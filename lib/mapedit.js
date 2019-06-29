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
            var promise = new Promise(function(resolve, reject) {
                if (json.url) {
                    json.url_ = json.url;
                    resolve(json);
                } else {
                    var thumbFolder = tileFolder + path.sep + mapID + path.sep + '0' + path.sep + '0';
                    fs.readdir(thumbFolder, function(err, thumbs) {
                        if (!thumbs) {
                            resolve(json);
                            return;
                        }
                        for (var i=0; i<thumbs.length; i++) {
                            var thumb = thumbs[i];
                            if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
                                var thumbURL = fileUrl(thumbFolder + path.sep + thumb);
                                thumbURL = thumbURL.replace(/\/0\/0\/0\./, '/{z}/{x}/{y}.');
                                json.url_ = thumbURL;
                                resolve(json);
                                return;
                            }
                        }
                    });
                }
            });

            promise.then(function(json) {
                var promises = [Promise.resolve(json)];

                if (json.compiled) {
                    var tin = new Tin({});
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
                    for (var i=0; i< json.sub_maps.length; i++) {
                        var sub_map = json.sub_maps[i];
                        if (sub_map.compiled) {
                            var tin = new Tin({});
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
            }).then(function(results) {
                var json = results.shift();
                var tins = results;
                focused.webContents.send('mapData', [json, tins]);
            });
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
    save: function(mapObject, tins) {
        var status = mapObject.status;
        var mapID = mapObject.mapID;
        var url_ = mapObject.url_;
        var imageExtention = mapObject.imageExtention || 'jpg';
        delete mapObject.status;
        delete mapObject.mapID;
        delete mapObject.url_;
        var content = JSON.stringify(mapObject, null, '    ');

        var compiled = JSON.parse(content);
        tins.map(function(tin, index) {
            if (typeof tin == 'string') return;
            if (index == 0) {
                delete compiled.gcps;
                compiled.compiled = tin;
            } else {
                var sub_map = compiled.sub_maps[index - 1];
                delete sub_map.gcps;
                sub_map.compiled = tin;
            }
        });
        var compiledContent = JSON.stringify(compiled, null, null);

        var mapFile = mapFolder + path.sep + mapID + '.json';
        var compiledFile = compiledFolder + path.sep + mapID + '.json';

        var tmpFolder = settings.getSetting('tmpFolder') + path.sep + 'tiles';
        var tmpUrl = fileUrl(tmpFolder);
        var newTile = tileFolder + path.sep + mapID;
        var newOriginal = originalFolder + path.sep + mapID + '.' + imageExtention;
        var regex = new RegExp('^' + tmpUrl);
        var tmpCheck = url_ && url_.match(regex);

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
                        var oldOriginal = originalFolder + path.sep + oldMapID + '.' + imageExtention;
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
                                        fs.remove(oldMapFile, function (err) {
                                            if (err) reject_(err);
                                            try {
                                                fs.statSync(oldCompiledFile);
                                                fs.remove(oldCompiledFile, function (err) {
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
                                    if (tmpCheck) {
                                        if (isCopy) {
                                            resolve_();
                                        } else {
                                            try {
                                                fs.statSync(oldTile);
                                                fs.remove(oldTile, function(err) {
                                                    if (err) reject_(err);
                                                    resolve_();
                                                });
                                            } catch(err) {
                                                resolve_();
                                            }
                                        }
                                    } else {
                                        var process = isCopy ? fs.copy : fs.move;
                                        try {
                                            fs.statSync(oldTile);
                                            process(oldTile, newTile, function(err) {
                                                if (err) reject_(err);
                                                resolve_();
                                            });
                                        } catch(err) {
                                            resolve_();
                                        }
                                    }
                                }),
                                new Promise(function(resolve_, reject_) {
                                    if (tmpCheck) {
                                        if (isCopy) {
                                            resolve_();
                                        } else {
                                            try {
                                                fs.statSync(oldOriginal);
                                                fs.remove(oldOriginal, function(err) {
                                                    if (err) reject_(err);
                                                    resolve_();
                                                });
                                            } catch(err) {
                                                resolve_();
                                            }
                                        }
                                    } else {
                                        var process = isCopy ? fs.copy : fs.move;
                                        try {
                                            fs.statSync(oldOriginal);
                                            process(oldOriginal, newOriginal, function (err) {
                                                if (err) reject_(err);
                                                resolve_();
                                            });
                                        } catch (err) {
                                            resolve_();
                                        }
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
                if (tmpCheck) {
                    try {
                        fs.statSync(newTile);
                        fs.removeSync(newTile);
                    } catch(err) {
                    }
                    fs.move(tmpFolder, newTile, function(err) {
                        if (err) reject(err);
                        try {
                            fs.statSync(newOriginal);
                            fs.removeSync(newOriginal);
                        } catch(err) {
                        }
                        fs.move(newTile + path.sep + 'original.' + imageExtention, newOriginal ,function(err){
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
    updateTin: function(gcps, edges, index, bounds, strict, vertex) {
        var wh = index == 0 ? bounds : null;
        var bd = index != 0 ? bounds : null;
        this.createTinFromGcpsAsync(gcps, edges, wh, bd, strict, vertex)
            .then(function(tin) {
                focused.webContents.send('updatedTin', [index, tin]);
            });
    },
    createTinFromGcpsAsync: function(gcps, edges, wh, bounds, strict, vertex) {
        if (gcps.length < 3) return Promise.resolve('tooLessGcps');
        return new Promise(function(resolve, reject) {
            var tin = new Tin({});
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
                .then(function() {
                    resolve(tin.getCompiled());
                }).catch(function(err) {
                    console.log(err);
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
    getTmsList: function() {
        return settings.getSetting('tmsList');
    }
};

module.exports = mapedit;
