'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings'); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const im = require('../lib/imagemagick_modified.js'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;

settings.init();

let mapFolder;
let tileFolder;
let uiThumbnailFolder;

const maplist = {
    request() {
        const saveFolder = settings.getSetting('saveFolder');
        mapFolder = `${saveFolder}${path.sep}maps`;
        fs.ensureDir(mapFolder, () => {});
        tileFolder = `${saveFolder}${path.sep}tiles`;
        fs.ensureDir(tileFolder, () => {});
        uiThumbnailFolder = `${saveFolder}${path.sep}tmbs`;
        fs.ensureDir(uiThumbnailFolder, () => {});
        const focused = BrowserWindow.getFocusedWindow();

        new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
            fs.readdir(mapFolder, (err, files) => {
                resolve(files.map((file) => {
                    const fullPath = mapFolder + path.sep + file;
                    const mapID = path.parse(fullPath).name;
                    return { fullPath, mapID };
                }).filter((file) => fs.statSync(file.fullPath).isFile() && /.*\.json$/.test(file.fullPath)));
            });
        }).then((files) => {
            for (let i=0; i<files.length; i++) {
                const tmp = files[i];
                new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
                    const file = tmp;
                    fs.readFile(file.fullPath, 'utf8', (err, data) => {
                        if (err) throw err;
                        const json = JSON.parse(data);
                        if (json.title == null || json.attr == null) resolve();
                        if (typeof json.title == 'object') {
                            const lang = json.lang || 'ja';
                            file.title = json.title[lang];
                        } else file.title = json.title;
                        file.width = json.width;
                        file.height = json.height;
                        resolve(file);
                    });
                }).then((file) => {
                    if (!file) return;
                    if (!file.width || !file.height) return file;
                    const thumbFolder = `${tileFolder}${path.sep}${file.mapID}${path.sep}0${path.sep}0`;
                    return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
                        fs.readdir(thumbFolder, (err, thumbs) => {
                            if (!thumbs) {
                                resolve(file);
                                return;
                            }
                            let thumbFile;
                            for (let i=0; i<thumbs.length; i++) {
                                const thumb = thumbs[i];
                                // if (/^0\.jpg$/.test(thumb)) {
                                if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
                                    thumbFile = `${thumbFolder}${path.sep}${thumb}`;
                                    const thumbURL = fileUrl(thumbFile);
                                    file.thumbnail = thumbURL;
                                }
                            }
                            resolve([file, thumbFile]);
                        });
                    });
                }).then((result) => {
                    const file = result[0];
                    const thumbFile = result[1];
                    if (!file) return;
                    focused.webContents.send('mapListAdd', file);

                    const uiThumbnail = `${uiThumbnailFolder}${path.sep}${file.mapID}_menu.jpg`;
                    fs.stat(uiThumbnail, (err, stat) => {
                        if (err != null && err.code === 'ENOENT') {
                            im.identify(thumbFile, (err, features) => {
                                if (err) {
                                    console.log(err);
                                    return;
                                }

                                const width = features.width;
                                const height = features.height;
                                console.log(`${width} ${height}`);
                            });
                        }
                    });
                });
            }
        });
    }
};

module.exports = maplist; // eslint-disable-line no-undef
