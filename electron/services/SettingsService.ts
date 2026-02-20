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
    // Check if we already have settings, if so skip
    if (this.store.has('migratedFromLegacy')) return;
    try {
      const appData = app.getPath('appData');
      const legacyStoragePath = path.join(appData, 'MaplatEditor', 'storage');
      
      if (fs.existsSync(legacyStoragePath)) {
          // Try to read saveFolder.json
          // Note: In legacy implementation, simple-storage might have been used or specific keys
          // We will attempt to read key-based files if they exist, or 'storage.json'
          // For now, minimal migration logic as previously implemented
          
          const saveFolderFile = path.join(legacyStoragePath, 'saveFolder.json');
          if (fs.existsSync(saveFolderFile)) {
              // Legacy often stored just the JSON string primitive in the file for simple keys
              // or a full JSON object. We try to read it.
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
      const newPath = result.filePaths[0];
      this.set('saveFolder', newPath);
      return newPath;
    }
    return null;
  }

  public async getTmsListOfMapID(mapID: string): Promise<any[]> {
    return new Promise((resolve) => {
      // 1. Get base tmsList (from default settings which is tms_list.json)
      // The `tmsList` store could be empty due to earlier bugs overwriting it persistently in electron-store.
      // We will ALWAYS load default maps from our constant source `defaultTmsList`, then fetch store's tmsList, then concat user's file.
      // Let's re-read config from original file just in case store is polluted
      const tmsListBase: any[] = [...defaultTmsList];
      
      const saveFolder = this.store.get('saveFolder');
      const settingsDir = path.join(saveFolder, 'settings');
      
      // Legacy behavior: `data` was loaded from editorStorage('tmsList.json')
      let userListFromStore: any[] = this.store.get('tmsList') || [];
      if (!Array.isArray(userListFromStore)) {
          userListFromStore = [];
      }
      
      // Let's concat user's explicitly loaded list on top of defaults
      let mergedTmsList = tmsListBase.concat(userListFromStore);

      try {
          const userTmsListPath = path.join(settingsDir, 'tmsList.json');
          if (fs.existsSync(userTmsListPath)) {
              const userTmsList = fs.readJsonSync(userTmsListPath);
              if (Array.isArray(userTmsList)) {
                  mergedTmsList = tmsListBase.concat(userTmsList);
              }
          }
      } catch(e) {
          console.error("Failed to read user tmsList.json", e);
      }

      // 2. Map-specific visible status (tmsList.mapID.json equivalent)
      // Legacy code used `editorStorage().get('tmsList.' + mapID)`
      // In the new system, we'll store this in a file specific to the map ID under settings/tmsList_[mapID].json
      // or using electron-store if it was migrated.
      
      // For compatibility with manual edits, we look for settings/tmsList.[mapID].json
      let fileData: Record<string, boolean> = {};
      const mapSpecificConfigPath = path.join(settingsDir, `tmsList.${mapID}.json`);
      let saveFlag = false;

      try {
          if (fs.existsSync(mapSpecificConfigPath)) {
              fileData = fs.readJsonSync(mapSpecificConfigPath) || {};
          }
      } catch (e) {
          console.error(`Failed to read ${mapSpecificConfigPath}`, e);
      }

      const tmsList: any[] = [];
      
      mergedTmsList.forEach((tms) => {
        if (tms.always) {
          tmsList.push(tms);
          return;
        }
        
        const tmsMapID = tms.mapID;
        let flag = fileData[tmsMapID];
        
        if (flag == null) {
          flag = fileData[tmsMapID] = true;
          saveFlag = true;
        }
        
        if (flag) {
          tmsList.push(tms);
        }
      });

      if (saveFlag) {
        // Save back the defaults if it was missing keys
        try {
            fs.ensureDirSync(settingsDir);
            fs.writeJsonSync(mapSpecificConfigPath, fileData, { spaces: 2 });
        } catch (e) {
            console.error(`Failed to write to ${mapSpecificConfigPath}`, e);
        }
      }
      
      resolve(tmsList);
    });
  }
}

export default new SettingsService();
