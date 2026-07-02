import Store from 'electron-store';
import { app, dialog } from 'electron';
import fs from 'fs-extra';
import path from 'path';

interface AppSettings {
  lang: string;
  saveFolder: string;
  tmsList: any[];
  [key: string]: any;
}

// @ts-ignore
import defaultTmsList from '../tms_list.json';

const defaultSettings: AppSettings = {
  lang: 'ja',
  saveFolder: path.join(app.getPath('documents'), app.getName()),
  tmsList: defaultTmsList
};

import { EventEmitter } from 'events';

class SettingsService extends EventEmitter {
  private store: Store<AppSettings>;

  constructor() {
    super();
    this.store = new Store<AppSettings>({ defaults: defaultSettings });
    this.migrateLegacySettings();
    this.ensureDataDirectories();
  }

  // ... (migrateLegacySettings remains same)

  private migrateLegacySettings() {
    // 既に移行済みの場合はスキップ
    if (this.store.has('migratedFromLegacy')) return;
    try {
      const appData = app.getPath('appData');
      const legacyStoragePath = path.join(appData, 'MaplatEditor', 'storage');

      if (fs.existsSync(legacyStoragePath)) {
          // 旧実装のsimple-storageはキーごとにJSONファイルを保存していた
          // saveFolder.json, lang.json を読み込んで新形式に移行する
          const saveFolderFile = path.join(legacyStoragePath, 'saveFolder.json');
          if (fs.existsSync(saveFolderFile)) {
              try {
                  const saveFolderVal = fs.readJsonSync(saveFolderFile);
                  if (saveFolderVal) this.store.set('saveFolder', saveFolderVal);
              } catch(e) {}
          }
          
          const langFile = path.join(legacyStoragePath, 'lang.json');
          if (fs.existsSync(langFile)) {
              try {
                  const langVal = fs.readJsonSync(langFile);
                  if (langVal) this.store.set('lang', langVal);
              } catch(e) {}
          }
           
          this.store.set('migratedFromLegacy', true);
          console.log("Migrated legacy settings.");
      }
    } catch (e) {
      console.error("Failed to migrate legacy settings", e);
    }
  }

  private ensureDataDirectories() {
    const saveFolder = this.store.get('saveFolder');
    try {
        fs.ensureDirSync(saveFolder);
    } catch (e) {
        console.error(`Could not create/access saveFolder: ${saveFolder}`, e);
    }
  }

  public get(key: string): any {
    // tmpFolder は OS の一時ディレクトリから動的に算出（旧実装: settings.getSetting('tmpFolder') 相当）
    if (key === 'tmpFolder') {
      return path.join(app.getPath('temp'), app.getName());
    }
    return this.store.get(key);
  }

  public getAll(): AppSettings {
    return this.store.store;
  }

  public set(key: string, value: any): void {
    const oldValue = this.store.get(key);
    this.store.set(key, value);
    if (key === 'saveFolder') {
      this.ensureDataDirectories();
    }
    if (key === 'lang' && oldValue !== value) {
        this.emit('changeLang', value);
    }
  }

  public async showSaveFolderDialog(mainWindow: any): Promise<string | null> {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: this.store.get('saveFolder'),
      properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      // 選択されたパスを返すだけ。保存は Settings.vue の saveSettings() に委ねる
      return result.filePaths[0];
    }
    return null;
  }

  public async getTmsListOfMapID(mapID: string): Promise<any[]> {
    const { default: DuckDbDataService } = await import('./DuckDbDataService');
    return DuckDbDataService.getTmsListOfMapID(mapID);
  }

  public async getBaseMapVisibilityOfMapID(mapID: string): Promise<any[]> {
    const { default: DuckDbDataService } = await import('./DuckDbDataService');
    return DuckDbDataService.getBaseMapVisibilityOfMapID(mapID);
  }

  public async setBaseMapVisibilityForMapID(mapID: string, baseMapId: string, enabled: boolean): Promise<void> {
    const { default: DuckDbDataService } = await import('./DuckDbDataService');
    await DuckDbDataService.setBaseMapVisibilityForMapID(mapID, baseMapId, enabled);
  }
}

export default new SettingsService();
