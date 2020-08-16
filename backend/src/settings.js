'use strict';

const EventEmitter = require('events'); // eslint-disable-line no-undef
const storage = require('electron-json-storage'); // eslint-disable-line no-undef
const editorSetting = require('electron-json-storage'); // eslint-disable-line no-undef
const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const tmsListDefault = require('../../tms_list.json'); // eslint-disable-line no-undef
const i18next = require('i18next'); // eslint-disable-line no-undef
const Backend = require('i18next-fs-backend'); // eslint-disable-line no-undef
let settings;

const protect = [
    'tmpFolder',
    'tmsList'
];

const defaultSetting = {
    lang: 'ja'
};

class Settings extends EventEmitter {
    static init() {
        if (!settings) {
            settings = new Settings();
        }
        return settings;
    }

    static asyncInit() {
        const settings = Settings.init();
        return settings.asyncReady;
    }

    constructor() {
        super();
        this.behaviorChain = [];
        this.currentPosition = 0;
        let resolveEditorSetting, resolveI18n;
        this.asyncReady = Promise.all([
            new Promise((resolve) => {
                resolveI18n = resolve;
            }),
            new Promise((resolve) => {
                resolveEditorSetting = resolve;
            })
        ]).then((res) => {
            return res[0];
        });
        storage.getAll((error, data) => {
            if (error) throw error;

            if (Object.keys(data).length === 0) {
                this.json = {
                    saveFolder: path.resolve(app.getPath('documents') + path.sep + app.getName())
                };
                storage.set('saveFolder', this.json.saveFolder, {});
            } else {
                this.json = data;
            }
            fs.ensureDir(this.json.saveFolder, () => {
                const editorSettingFolder = `${this.json.saveFolder}${path.sep}settings`;
                editorSetting.setDataPath(editorSettingFolder);
                editorSetting.get('tmsList', {}, (error, data) => {
                    if (!Array.isArray(data)) {
                        data = [];
                        editorSetting.set('tmsList', [], {});
                    }
                    this.json.tmsList = tmsListDefault.concat(data);
                    resolveEditorSetting();
                });
            });
            this.json = Object.assign(defaultSetting, this.json);
            this.json.tmpFolder = path.resolve(`${app.getPath('temp')}${path.sep}${app.getName()}`);
            fs.ensureDir(this.json.tmpFolder, () => {});

            const lang = this.json.lang;
            this.i18n = i18next.use(Backend);
            const i18nPromise = this.i18n.init({
                lng: lang,
                fallbackLng: 'en',
                backend: {
                    loadPath: `${__dirname}/../../locales/{{lng}}/{{ns}}.json` // eslint-disable-line no-undef
                }
            });
            i18nPromise.then((t) => {
                this.t = t;
                this.translate = function(dataFragment) {
                    if (!dataFragment || typeof dataFragment != 'object') return dataFragment;
                    const langs = Object.keys(dataFragment);
                    let key = langs.reduce((prev, curr) => {
                        if (curr == 'en' || !prev) {
                            prev = dataFragment[curr];
                        }
                        return prev;
                    }, null);
                    key = (typeof key == 'string') ? key : `${key}`;
                    if (this.i18n.exists(key, {ns: 'translation', nsSeparator: '__X__yX__X__'}))
                        return this.t(key, {ns: 'translation', nsSeparator: '__X__yX__X__'});
                    for (let i = 0; i < langs.length; i++) {
                        const lang = langs[i];
                        this.i18n.addResource(lang, 'translation', key, dataFragment[lang]);
                    }
                    return this.t(key, {ns: 'translation', nsSeparator: '__X__yX__X__'});
                };
                resolveI18n(this);
            });
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
            if (key === 'lang') {
                this.i18n.changeLanguage(value, () => {
                    this.emit('changeLang');
                });
            } else if (key === 'saveFolder') {
                fs.ensureDir(value, () => {
                    const editorSettingFolder = `${value}${path.sep}settings`;
                    editorSetting.setDataPath(editorSettingFolder);
                    editorSetting.set('test', 'f', {});
                });
            }
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
Settings.init();

module.exports = Settings; // eslint-disable-line no-undef
