'use strict';
const path = require('path'); // eslint-disable-line no-undef
const settings = require('./settings'); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const fileUrl = require('file-url'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;

settings.init();

let mapFolder;
let tileFolder;

const maplist = {
    request() {
        const saveFolder = settings.getSetting('saveFolder');
        mapFolder = `${saveFolder}${path.sep}maps`;
        fs.ensureDir(mapFolder, () => {});
        tileFolder = `${saveFolder}${path.sep}tiles`;
        fs.ensureDir(tileFolder, () => {});
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
                            for (let i=0; i<thumbs.length; i++) {
                                const thumb = thumbs[i];
                                // if (/^0\.jpg$/.test(thumb)) {
                                if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
                                    const thumbURL = fileUrl(thumbFolder + path.sep + thumb);
                                    file.thumbnail = thumbURL;
                                }
                            }
                            resolve(file);
                        });
                    });
                }).then((file) => {
                    if (!file) return;
                    focused.webContents.send('mapListAdd', file);
                });
            }
        });
    }
};

module.exports = maplist; // eslint-disable-line no-undef
