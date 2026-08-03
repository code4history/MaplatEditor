import Store from 'electron-store';
import { app, dialog } from 'electron';
import fs from 'fs-extra';
import path from 'path';

interface AppSettings {
  lang: string;
  saveFolder: string;
  /**
   * M5-T8: JPEG デコードの会計メモリ**キャップ**（MB = 2^20 バイト）。`null` = 自動。
   * M5-T6 では「デコーダへそのまま渡す運用値」だったが、m5-t8 で画像ごとの自動決定へ移り、
   * この設定は「自動決定値がこれを超えたら弾く」上限の意味になった。
   */
  jpegDecodeMaxMemoryMB: number | null;
  /** M5-T8: JPEG デコードの解像度**キャップ**（MP = 1e6 ピクセルの十進）。`null` = 自動 */
  jpegDecodeMaxResolutionMP: number | null;
  [key: string]: any;
}

/**
 * M5-T8: JPEG デコードキャップの下限。
 *
 * 既定は**「自動」（`null`）**である。M5-T6 の既定 8192 / 800 は撤去した — 実測トリガの
 * 画像（470 MP・会計 9865 MB）が 8192 では通らず、利用者に設定を触らせる前提自体が
 * 誤りだったためである。いまは画像ごとにヘッダから必要量を導出して渡す（設計 §5.3）。
 *
 * 下限は jpeg-js の既定値。これを下回るキャップは防御を弱めるだけなので受け付けない
 * （ガードの出自は decompression bomb 対策 CVE-2020-8175）。
 *
 * **上限は機械安全枠（`resolveDecodeSafety()`）である**（人間指示 2026-08-03:
 * 「自動かつ、入れさせる場合も上限値を設けてください」）。これを超える値を許すと、
 * jpeg-js の会計ガードは通るのに V8 ヒープが尽きて**アプリが強制終了する**帯
 * （設計 §3.6）へ利用者が自分で足を踏み入れられてしまう。
 */
const JPEG_DECODE_MAX_MEMORY_MB_MIN = 512;
const JPEG_DECODE_MAX_RESOLUTION_MP_MIN = 100;

/**
 * JPEG デコードキャップの正規化。**この関数だけが正規化を行う**（読み出し・書き込みの両方が通る）。
 *
 * 読み出し側でも正規化するのは、electron-store の実体が利用者の編集できる JSON ファイルで
 * あり、UI を通らない値が入り得るためである（過去形式の吸収ではなく、信頼できない入力の検証）。
 *
 * @returns 正規化済みのキャップ。`null` は**自動**（キャップなし）を意味する。
 */
function normalizeJpegDecodeCap(value: unknown, min: number, max: number): number | null {
  // 未設定・空欄は「自動」。数値と数値文字列だけを受け付ける
  // （true → 1 のような暗黙変換で通さない）。それ以外も「自動」へ落とす
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

import { resolveDecodeSafety } from '../utils/decodeSafety';
import { resolveEditorLanguage } from '../../src/utils/editorLanguages';
import { resolveRuntimeStoragePaths } from './runtimeStoragePaths';
import { defaultDraftTileRoot } from './draftTilePaths';

const runtimeStoragePaths = resolveRuntimeStoragePaths(
  process.env.MAPLAT_E2E_ROOT,
  path.join(app.getPath('documents'), app.getName()),
  defaultDraftTileRoot(),
);

// lang はデフォルト値を持たせない: 未設定(初回起動)の場合はOSの言語から解決し
// (非対応言語は en へフォールバック)、その結果を設定として永続化する。
// 一方 M5-T6 の JPEG デコード上限は「初回から効いている値」であるべきなので既定を持たせる
// (lang の設計意図とは別種)
const defaultSettings: AppSettings = {
  saveFolder: runtimeStoragePaths.saveFolder,
  // M5-T8: 既定は「自動」。利用者が数値を入れたときだけキャップとして働く
  jpegDecodeMaxMemoryMB: null,
  jpegDecodeMaxResolutionMP: null,
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

  /**
   * M5-T8: JPEG デコードの**キャップ**。**設定値の読み出し口はここ1つだけ**にする。
   * 呼び出し側が `get('jpegDecodeMaxMemoryMB')` を直接読むと正規化が抜けるため作らない。
   *
   * `null` は**自動**（キャップなし）を意味する。運用値そのものではない点に注意
   * （M5-T6 の `getJpegDecodeLimits` は運用値を返していた。**意味が変わったので改名した** —
   * 同名のまま意味だけ変えると、旧義で読む人を誤らせる）。
   */
  public getJpegDecodeCaps(): { maxMemoryUsageInMB: number | null; maxResolutionInMP: number | null } {
    const safety = resolveDecodeSafety();
    return {
      maxMemoryUsageInMB: normalizeJpegDecodeCap(
        this.store.get('jpegDecodeMaxMemoryMB'),
        JPEG_DECODE_MAX_MEMORY_MB_MIN,
        safety.maxMemoryMB,
      ),
      maxResolutionInMP: normalizeJpegDecodeCap(
        this.store.get('jpegDecodeMaxResolutionMP'),
        JPEG_DECODE_MAX_RESOLUTION_MP_MIN,
        safety.maxResolutionMP,
      ),
    };
  }

  public set(key: string, value: any): void {
    const oldValue = this.store.get(key);
    // M5-T8: 書き込み側でも同じ正規化を通し、UI から不正値・過大値が保存されること自体を防ぐ
    if (key === 'jpegDecodeMaxMemoryMB') {
      value = normalizeJpegDecodeCap(value, JPEG_DECODE_MAX_MEMORY_MB_MIN, resolveDecodeSafety().maxMemoryMB);
    } else if (key === 'jpegDecodeMaxResolutionMP') {
      value = normalizeJpegDecodeCap(value, JPEG_DECODE_MAX_RESOLUTION_MP_MIN, resolveDecodeSafety().maxResolutionMP);
    }
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
