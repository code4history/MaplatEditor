'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings').init(); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const thumbExtractor = require('../lib/ui_thumbnail'); // eslint-disable-line no-undef
const nedbAccessor = require('../lib/nedbAccessor'); // eslint-disable-line no-undef

let mapFolder;
let tileFolder;
let uiThumbnailFolder;
let dbFile;

const maplist = {
    async request(condition, page) {
        const saveFolder = settings.getSetting('saveFolder');
        mapFolder = `${saveFolder}${path.sep}maps`;
        fs.ensureDir(mapFolder, () => {
        });
        tileFolder = `${saveFolder}${path.sep}tiles`;
        fs.ensureDir(tileFolder, () => {
        });
        uiThumbnailFolder = `${saveFolder}${path.sep}tmbs`;
        fs.ensureDir(uiThumbnailFolder, () => {
        });
        const focused = BrowserWindow.getFocusedWindow();
        dbFile = `${saveFolder}${path.sep}nedb.db`;

        const nedb = nedbAccessor.getInstance(dbFile);

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
                mapID: doc.mapID
            };
            if (typeof doc.title === 'object') {
                const lang = doc.lang || 'ja';
                res.title = doc.title[lang];
            } else res.title = doc.title;
            res.width = doc.width;
            res.height = doc.height;

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
            });
        });
    }
};

module.exports = maplist; // eslint-disable-line no-undef
