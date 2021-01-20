'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings').init(); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const thumbExtractor = require('../lib/ui_thumbnail'); // eslint-disable-line no-undef
const nedbAccessor = require('../lib/nedbAccessor'); // eslint-disable-line no-undef

let tileFolder;
let originalFolder;
let uiThumbnailFolder;
let dbFile;
let focused;
let nedb;

const maplist = {
    init() {
        const saveFolder = settings.getSetting('saveFolder');
        tileFolder = `${saveFolder}${path.sep}tiles`;
        fs.ensureDir(tileFolder, () => {});
        originalFolder = `${saveFolder}${path.sep}originals`;
        fs.ensureDir(originalFolder, () => {});
        uiThumbnailFolder = `${saveFolder}${path.sep}tmbs`;
        fs.ensureDir(uiThumbnailFolder, () => {});

        dbFile = `${saveFolder}${path.sep}nedb.db`;
        nedb = nedbAccessor.getInstance(dbFile);

        focused = BrowserWindow.getFocusedWindow();
    },
    async request(condition, page) {
        if (!condition || condition === "") condition = null;
        let result;
        let pageUpdate = 0;
        while (1) {
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
            return new Promise((resolve, reject) => {
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
            }).catch((e) => { console.log(e); });
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
