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

const defaultSettings: AppSettings = {
  lang: 'ja',
  saveFolder: path.join(app.getPath('documents'), app.getName()),
  tmsList: []
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
}

export default new SettingsService();
