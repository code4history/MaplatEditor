'use strict';

const EventEmitter = require('events'); // eslint-disable-line no-undef
const storage = require('electron-json-storage'); // eslint-disable-line no-undef
const defaultStoragePath = storage.getDefaultDataPath();
const path = require('path'); // eslint-disable-line no-undef
const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const BrowserWindow = electron.BrowserWindow;
const tmsListDefault = require('../../tms_list.json'); // eslint-disable-line no-undef
const i18next = require('i18next'); // eslint-disable-line no-undef
const Backend = require('i18next-fs-backend');
const {ipcMain} = require("electron"); // eslint-disable-line no-undef
let settings;
let editorStoragePath;

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
      ipcMain.on('settings_lang', async (ev) => {
        await settings.asyncReady;
        ev.reply('settings_lang_got', settings.json.lang);
      });
      ipcMain.on('settings_setSetting', async (ev, key, value) => {
        await settings.asyncReady;
        settings.setSetting(key, value);
        ev.reply('settings_setSetting_finished');
      });
      ipcMain.on('settings_getSetting', async (ev, key) => {
        await settings.asyncReady;
        const value = key == null ? settings.getSetting() : settings.getSetting(key);
        ev.reply('settings_getSetting_finished', value);
      });
      ipcMain.on('settings_showSaveFolderDialog', async (ev, current) => {
        await settings.asyncReady;
        settings.showSaveFolderDialog(ev, current);
      });
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
    ]).then((res) => res[0]);
    this.defaultStorage().getAll((error, data) => {
      if (error) throw error;

      if (Object.keys(data).length === 0) {
        this.json = {
          saveFolder: path.resolve(app.getPath('documents') + path.sep + app.getName())
        };
        this.defaultStorage().set('saveFolder', this.json.saveFolder, {});
      } else {
        this.json = data;
      }
      fs.ensureDir(this.json.saveFolder, () => {
        editorStoragePath = `${this.json.saveFolder}${path.sep}settings`;
        this.editorStorage().get('tmsList', {}, (error, data) => {
          if (!Array.isArray(data)) {
            data = [];
            this.editorStorage().set('tmsList', [], {});
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
        this.translate = (dataFragment) => {
          if (!dataFragment || typeof dataFragment != 'object') return dataFragment;
          const langs = Object.keys(dataFragment);
          let key = langs.reduce((prev, curr) => {
            if (curr === 'en' || !prev) {
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

  defaultStorage() {
    storage.setDataPath(defaultStoragePath);
    return storage;
  }

  editorStorage() {
    storage.setDataPath(editorStoragePath);
    return storage;
  }

  do(verb, data) {
    if (this.redoable) {
      this.behaviorChain = this.behaviorChain.slice(0, this.currentPosition + 1);
    }
    this.behaviorChain.push({verb, data});
    this.currentPosition++;
  }

  get redoable() {
    return this.behaviorChain.length !== this.currentPosition;
  }

  redo() {
    if (!this.redoable) return;
    this.currentPosition++;
    return this.behaviorChain[this.currentPosition].data;
  }

  get undoable() {
    return this.currentPosition !== 0;
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

  async getTmsListOfMapID(mapID) {
    return new Promise((resolve) => {
      const settingKey = `tmsList.${mapID}`;
      const tmsListBase = this.json.tmsList;
      this.editorStorage().get(settingKey, {}, (error, data) => {
        let saveFlag = false;
        const tmsList = [];
        tmsListBase.map((tms) => {
          if (tms.always) {
            tmsList.push(tms);
            return;
          }
          const mapID = tms.mapID;
          let flag = data[mapID];
          if (flag == null) {
            flag = data[mapID] = true;
            saveFlag = true;
          }
          if (flag) {
            tmsList.push(tms);
          }
        });
        if (saveFlag) {
          this.editorStorage().set(settingKey, data, {}, () => {
            resolve(tmsList);
          });
        } else resolve(tmsList);
      });
    });
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
    this.defaultStorage().set(key, value, {}, (error) => {
      if (error) throw error;
      if (key === 'lang') {
        this.i18n.changeLanguage(value, () => {
          this.emit('changeLang');
        });
      } else if (key === 'saveFolder') {
        fs.ensureDir(value, () => {
          editorStoragePath = `${value}${path.sep}settings`;
        });
      }
    });
  }

  showSaveFolderDialog(ev, oldSetting) {
    const dialog = require('electron').dialog; // eslint-disable-line no-undef
    dialog.showOpenDialog({ defaultPath: oldSetting, properties: ['openDirectory']}).then((ret) => {
      if(!ret.canceled) {
        ev.reply('settings_saveFolderSelected', ret.filePaths[0]);
      }
    });
  }
}
Settings.init();

module.exports = Settings; // eslint-disable-line no-undef
