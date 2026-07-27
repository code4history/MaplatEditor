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
import { resolveEditorLanguage } from '../../src/utils/editorLanguages';
import { resolveRuntimeStoragePaths } from './runtimeStoragePaths';
import { defaultDraftTileRoot } from './draftTilePaths';

const runtimeStoragePaths = resolveRuntimeStoragePaths(
  process.env.MAPLAT_E2E_ROOT,
  path.join(app.getPath('documents'), app.getName()),
  defaultDraftTileRoot(),
);

// lang はデフォルト値を持たせない: 未設定(初回起動)の場合はOSの言語から解決し
// (非対応言語は en へフォールバック)、その結果を設定として永続化する
const defaultSettings: AppSettings = {
  saveFolder: runtimeStoragePaths.saveFolder,
  tmsList: defaultTmsList
} as AppSettings;

import { EventEmitter } from 'events';

class SettingsService extends EventEmitter {
  private store: Store<AppSettings>;

  constructor() {
    super();
    this.store = new Store<AppSettings>({
      defaults: defaultSettings,
      ...(runtimeStoragePaths.settingsStoreCwd ? { cwd: runtimeStoragePaths.settingsStoreCwd } : {}),
    });
    if (!runtimeStoragePaths.isolated) this.migrateLegacySettings();
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
    if (key === 'lang') {
      return this.ensureLang();
    }
    return this.store.get(key);
  }

  // 初回起動(lang未設定)時のみOSの言語から解決して永続化する。
  // 一度Settingsで保存された値(または本メソッドで検出された値)は以後そのまま使われる
  private ensureLang(): string {
    const stored = this.store.get('lang');
    if (stored) return stored;
    const detected = resolveEditorLanguage(typeof app.getLocale === 'function' ? app.getLocale() : '');
    this.store.set('lang', detected);
    return detected;
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

  // ベースマップ系API (ADR-0007): 引数はuid正準。
  // 参照引数(mapRef/baseMapRef)はUUID形状=uid優先・それ以外slugフォールバックで解決される

  public async getTmsListOfMapID(mapRef: string): Promise<any[]> {
    const { default: SqliteDataService } = await import('./SqliteDataService');
    return SqliteDataService.getTmsListOfMapID(mapRef);
  }

  public async getBaseMapVisibilityOfMapID(mapRef: string): Promise<any[]> {
    const { default: SqliteDataService } = await import('./SqliteDataService');
    return SqliteDataService.getBaseMapVisibilityOfMapID(mapRef);
  }

  public async setBaseMapVisibilityForMapID(mapRef: string, baseMapRef: string, enabled: boolean): Promise<void> {
    const { default: SqliteDataService } = await import('./SqliteDataService');
    await SqliteDataService.setBaseMapVisibilityForMapID(mapRef, baseMapRef, enabled);
  }

  public async listBaseMaps(): Promise<any[]> {
    const { default: SqliteDataService } = await import('./SqliteDataService');
    return SqliteDataService.listBaseMaps();
  }

  public async saveUserBaseMap(
    payload: { uid?: string; slug: string; tms: any; expectedRevision?: number },
  ): Promise<
    | { result: 'Success'; uid: string; revision: number }
    | { result: 'Exist' }
    | { result: 'Error'; code: 'not-found' | 'invalid-request' | 'internal'; message?: string }
    | { error: 'revision-conflict'; current: number }
  > {
    const { default: SqliteDataService, RevisionConflictError } = await import('./SqliteDataService');
    try {
      const saved = await SqliteDataService.saveUserBaseMap(payload);
      return { result: 'Success', ...saved };
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return { error: 'revision-conflict', current: error.current };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Slug already in use')) return { result: 'Exist' };
      // slug 予約 promote conflict(M11-T7/AC4)も duplicate として operation 診断へ写像する
      if ((error as { kind?: string })?.kind === 'slug-reservation-conflict') return { result: 'Exist' };
      if (message === 'slug is required') return { result: 'Error', code: 'invalid-request', message };
      if (message.startsWith('Unknown user base map:')) return { result: 'Error', code: 'not-found', message };
      return { result: 'Error', code: 'internal', message };
    }
  }

  public async deleteUserBaseMap(baseMapRef: string): Promise<void> {
    const { default: SqliteDataService } = await import('./SqliteDataService');
    await SqliteDataService.deleteUserBaseMap(baseMapRef);
  }

  public async setBaseMapAlways(baseMapRef: string, always: boolean): Promise<void> {
    const { default: SqliteDataService } = await import('./SqliteDataService');
    await SqliteDataService.setBaseMapAlways(baseMapRef, always);
  }
}

export default new SettingsService();
