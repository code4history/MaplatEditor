'use strict';

const storage = require('electron-json-storage'); // eslint-disable-line no-undef
const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const tmsList = require('../tms_list.json'); // eslint-disable-line no-undef
let json;

const protect = [
    'tmpFolder',
    'tmsList'
];

const settings = {
    init() {
        if (json) return;
        storage.getAll((error, data) => {
            if (error) throw error;

            if (Object.keys(data).length === 0) {
                json = {
                    saveFolder: path.resolve(app.getPath('documents') + path.sep + app.getName())
                };
                storage.set('saveFolder', json.saveFolder, {});
                fs.ensureDir(json.saveFolder, () => {});
            } else {
                json = data;
            }
            json.tmpFolder = path.resolve(app.getPath('temp') + path.sep + app.getName());
            fs.ensureDir(json.tmpFolder, () => {});
            json.tmsList = tmsList;
        });
    },
    getSetting(key) {
        return json[key];
    },
    getSettings() {
        return json;
    },
    setSetting(key, value) {
        if (protect.indexOf(key) >= 0) throw `"${key}" is protected.`;
        json[key] = value;
        storage.set(key, value, {}, (error) => {
            if (error) throw error;
        });
    },
    showSaveFolderDialog(oldSetting) {
        const dialog = require('electron').dialog; // eslint-disable-line no-undef
        const focused = BrowserWindow.getFocusedWindow();
        dialog.showOpenDialog({ defaultPath: oldSetting, properties: ['openDirectory']}, (baseDir) => {
            if(baseDir && baseDir[0]) {
                focused.webContents.send('saveFolderSelected',baseDir[0]);
            }
        });
    }
};
settings.init();

module.exports = settings; // eslint-disable-line no-undef
