'use strict';

const EventEmitter = require('events'); // eslint-disable-line no-undef
const storage = require('electron-json-storage'); // eslint-disable-line no-undef
const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const tmsList = require('../../tms_list.json'); // eslint-disable-line no-undef
let json;
let undoredo;
let settings;

const protect = [
    'tmpFolder',
    'tmsList'
];

const defaultSetting = {
    lang: 'ja'
};

const settings = {
    init() {
        if (!undoredo) {
            undoredo = new UndoRedo();
        }
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
            json = Object.assign(defaultSetting, json);
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
    },
    do(verb, data) {
        undoredo.do(verb, data);
    },
    undo() {
        undoredo.undo();
    },
    redo() {
        undoredo.redo();
    }
};
settings.init();

class Settings extends EventEmitter {
    static init() {
        if (!settings) {
            settings = new Settings();
        }
        return settings;
    }

    constructor() {
        super();
        this.behaviorChain = [];
        this.currentPosition = 0;
        storage.getAll((error, data) => {
            if (error) throw error;

            if (Object.keys(data).length === 0) {
                this.json = {
                    saveFolder: path.resolve(app.getPath('documents') + path.sep + app.getName())
                };
                storage.set('saveFolder', this.json.saveFolder, {});
                fs.ensureDir(this.json.saveFolder, () => {});
            } else {
                this.json = data;
            }
            this.json = Object.assign(defaultSetting, this.json);
            this.json.tmpFolder = path.resolve(app.getPath('temp') + path.sep + app.getName());
            fs.ensureDir(this.json.tmpFolder, () => {});
            this.json.tmsList = tmsList;
        });
    }

    do(verb, data) {
        if (this.redoable) {
            this.behaviorChain = this.behaviorChain.slice(0, this.currentPosition + 1);
        }
        this.behaviorChain.push({verb, data});
        this.currentPosition++;
    }

    get redoable() {
        return this.behaviorChain.length != this.currentPosition;
    }

    redo() {
        if (!this.redoable) return;
        this.currentPosition++;
        return this.behaviorChain[this.currentPosition].data;
    }

    get undoable() {
        return this.currentPosition != 0;
    }

    undo() {
        if (!this.undoable) return;
        this.currentPosition--;
        return this.behaviorChain[this.currentPosition].data;
    }

    get menuData() {
        return {
            undoable: this.undoable,
            redoable: this.redoable,
            undo: this.undoable ? this.behaviorChain[this.currentPosition - 1].verb : undefined,
            redo: this.redoable ? this.behaviorChain[this.currentPosition].verb : undefined
        };
    }

    getSetting(key) {
        return this.json[key];
    }

    getSettings() {
        return this.json;
    }

    setSetting(key, value) {
        if (protect.indexOf(key) >= 0) throw `"${key}" is protected.`;
        this.json[key] = value;
        storage.set(key, value, {}, (error) => {
            if (error) throw error;
        });
    }

    showSaveFolderDialog(oldSetting) {
        const dialog = require('electron').dialog; // eslint-disable-line no-undef
        const focused = BrowserWindow.getFocusedWindow();
        dialog.showOpenDialog({ defaultPath: oldSetting, properties: ['openDirectory']}, (baseDir) => {
            if(baseDir && baseDir[0]) {
                focused.webContents.send('saveFolderSelected',baseDir[0]);
            }
        });
    }
}

module.exports = settings; // eslint-disable-line no-undef
