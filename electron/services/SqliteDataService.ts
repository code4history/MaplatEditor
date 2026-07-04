// Write Store (ADR-0001): 全ての書き込みと単一レコード読みはSQLite(maplat.sqlite)が担う。
// WALモード+busy_timeoutにより、ロック保持は書き込みトランザクション中のみとなり、
// 複数エディタインスタンスの同時利用が可能。一覧/全文/位置情報検索は
// SearchDataService(インメモリDuckDBのsqlite ATTACH)が担当する。
import { DatabaseSync } from 'node:sqlite';
import Datastore from '@seald-io/nedb';
import { BrowserWindow } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import builtinBaseMaps from '../builtin_base_maps.json';
import defaultTmsList from '../tms_list.json';
import SettingsService from './SettingsService';
import { normalizeRuntimeKeys } from './MaplatRuntimeKeys';

type BaseMapScope = 'builtin' | 'user';

export interface MapListResult {
  docs: any[];
  prev: boolean;
  next: boolean;
  pageUpdate?: number;
}

export interface AppListResult {
  docs: any[];
  prev: boolean;
  next: boolean;
  pageUpdate?: number;
}

export interface BaseMapVisibilityItem {
  mapID: string;
  scope: BaseMapScope;
  enabled: boolean;
  locked: boolean;
  data: any;
}

export interface BaseMapCatalogItem {
  mapID: string;
  scope: BaseMapScope;
  data: any;
}

interface Folders {
  saveFolder: string;
  settingsDir: string;
  retiredSettingsDir: string;
  sqliteFile: string;
  nedbFile: string;
  retiredNedbFile: string;
}

const LEGACY_MIGRATION_ID = '2026-07-04-sqlite-write-store-legacy-import';

export function mapRowToDocument(row: any): any {
  const data = JSON.parse(row.data_json);
  data._id = row.map_id;
  return data;
}

export function appRowToDocument(row: any): any {
  const data = JSON.parse(row.data_json);
  data._id = row.app_id;
  data.appID = row.app_id;
  return data;
}

function normalizeMapDocument(document: any): any {
  const normalized = { ...document };
  delete normalized._id;
  delete normalized.mapID;
  return normalized;
}

function normalizeAppDocument(document: any): any {
  const normalized = normalizeRuntimeKeys(document);
  delete normalized._id;
  delete normalized.appID;
  return normalized;
}

function maybeJsonArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function isDefaultTmsList(value: any[]): boolean {
  return JSON.stringify(value) === JSON.stringify(defaultTmsList);
}

function safeMapIDFromSpecificFile(fileName: string): string | null {
  const dotMatch = fileName.match(/^tmsList\.(.+)\.json$/);
  if (dotMatch) return dotMatch[1];
  const underscoreMatch = fileName.match(/^tmsList_(.+)\.json$/);
  if (underscoreMatch) return underscoreMatch[1];
  return null;
}

function sendMigrationProgress(text: string, percent: number, progress: string = ''): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('app:taskProgress', { text, percent, progress });
  });
}

class SqliteDataService {
  private db: DatabaseSync | null = null;
  private activeDbFile: string | null = null;

  private get folders(): Folders {
    const saveFolder = SettingsService.get('saveFolder') as string;
    return {
      saveFolder,
      settingsDir: path.join(saveFolder, 'settings'),
      retiredSettingsDir: path.join(saveFolder, '_settings'),
      sqliteFile: path.join(saveFolder, 'maplat.sqlite'),
      nedbFile: path.join(saveFolder, 'nedb.db'),
      retiredNedbFile: path.join(saveFolder, '_nedb.db'),
    };
  }

  get databaseFile(): string {
    return this.folders.sqliteFile;
  }

  async reset(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // noop
      }
    }
    this.db = null;
    this.activeDbFile = null;
  }

  async getDb(): Promise<DatabaseSync> {
    const { saveFolder, sqliteFile } = this.folders;
    if (this.db && this.activeDbFile === sqliteFile) return this.db;

    await this.reset();
    await fs.ensureDir(saveFolder);
    const db = new DatabaseSync(sqliteFile);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA busy_timeout=5000');
    this.db = db;
    this.activeDbFile = sqliteFile;
    await this.migrate();
    return db;
  }

  private async migrate(): Promise<void> {
    const db = this.db;
    if (!db) throw new Error('SQLite connection is not initialized');
    const notifyProgress = await this.hasLegacyMigrationInputs();

    try {
      if (notifyProgress) sendMigrationProgress('database.migrating', 0);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS maps (
          map_id TEXT PRIMARY KEY,
          data_json TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS apps (
          app_id TEXT PRIMARY KEY,
          data_json TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS base_maps (
          map_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (scope, map_id)
        );
        CREATE TABLE IF NOT EXISTS map_base_map_visibility (
          map_id TEXT NOT NULL,
          base_map_id TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          updated_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (map_id, base_map_id)
        );
      `);

      if (notifyProgress) sendMigrationProgress('database.migrating_builtin_basemaps', 25, '(1/4)');
      this.applyBuiltinBaseMapSeed(db);

      const alreadyMigrated = db
        .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
        .get(LEGACY_MIGRATION_ID);
      if (!alreadyMigrated) {
        if (notifyProgress) sendMigrationProgress('database.migrating_legacy_maps', 50, '(2/4)');
        await this.migrateNeDB(db);
        if (notifyProgress) sendMigrationProgress('database.migrating_legacy_basemaps', 75, '(3/4)');
        await this.migrateUserBaseMaps(db);
        db.prepare('INSERT OR REPLACE INTO schema_migrations (id) VALUES (?)').run(LEGACY_MIGRATION_ID);
        if (notifyProgress) sendMigrationProgress('database.archiving_legacy_files', 90, '(4/4)');
        await this.retireLegacyDataFiles();
      }
      if (notifyProgress) sendMigrationProgress('database.migrated', 100, '(4/4)');
    } catch (e) {
      if (notifyProgress) sendMigrationProgress('database.migration_failed', 100);
      throw e;
    }
  }

  // --- maps ---

  async findMap(mapID: string): Promise<any | null> {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT map_id, data_json FROM maps WHERE map_id = ?')
      .get(mapID) as any;
    return row ? mapRowToDocument(row) : null;
  }

  async upsertMap(mapID: string, document: any): Promise<void> {
    const db = await this.getDb();
    db.prepare(
      `INSERT OR REPLACE INTO maps (map_id, data_json, updated_at)
       VALUES (?, ?, datetime('now'))`
    ).run(mapID, JSON.stringify(normalizeMapDocument(document)));
  }

  async deleteMap(mapID: string): Promise<void> {
    const db = await this.getDb();
    db.prepare('DELETE FROM maps WHERE map_id = ?').run(mapID);
  }

  async isMapIdAvailable(mapID: string): Promise<boolean> {
    return (await this.findMap(mapID)) === null;
  }

  async readAllMaps(): Promise<any[]> {
    const db = await this.getDb();
    const rows = db
      .prepare('SELECT map_id, data_json FROM maps ORDER BY map_id')
      .all() as any[];
    return rows.map(mapRowToDocument);
  }

  // --- apps ---

  async findApp(appID: string): Promise<any | null> {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT app_id, data_json FROM apps WHERE app_id = ?')
      .get(appID) as any;
    return row ? appRowToDocument(row) : null;
  }

  async upsertApp(appID: string, document: any): Promise<void> {
    const db = await this.getDb();
    db.prepare(
      `INSERT OR REPLACE INTO apps (app_id, data_json, updated_at)
       VALUES (?, ?, datetime('now'))`
    ).run(appID, JSON.stringify(normalizeAppDocument(document)));
  }

  async deleteApp(appID: string): Promise<void> {
    const db = await this.getDb();
    db.prepare('DELETE FROM apps WHERE app_id = ?').run(appID);
  }

  async isAppIdAvailable(appID: string): Promise<boolean> {
    return (await this.findApp(appID)) === null;
  }

  async readAllApps(): Promise<any[]> {
    const db = await this.getDb();
    const rows = db
      .prepare('SELECT app_id, data_json FROM apps ORDER BY app_id')
      .all() as any[];
    return rows.map(appRowToDocument);
  }

  // --- base maps ---

  async getTmsListOfMapID(mapID: string): Promise<any[]> {
    const items = await this.getBaseMapVisibilityOfMapID(mapID);
    return items.filter((item) => item.enabled).map((item) => item.data);
  }

  async getBaseMapVisibilityOfMapID(mapID: string): Promise<BaseMapVisibilityItem[]> {
    const db = await this.getDb();
    const baseMapRows = db
      .prepare(`
        SELECT map_id, scope, sort_order, data_json
        FROM base_maps
        ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END, sort_order, map_id
      `)
      .all() as any[];
    const visibilityRows = db
      .prepare('SELECT base_map_id, enabled FROM map_base_map_visibility WHERE map_id = ?')
      .all(mapID) as any[];
    const visibility = new Map(visibilityRows.map((row) => [row.base_map_id, Boolean(row.enabled)]));

    const insertDefault = db.prepare(
      `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    );
    const items: BaseMapVisibilityItem[] = [];
    for (const row of baseMapRows) {
      const tms = JSON.parse(row.data_json);
      const locked = Boolean(tms.always);
      let enabled = visibility.get(row.map_id);
      if (enabled == null) {
        enabled = true;
        if (!locked) insertDefault.run(mapID, row.map_id, 1);
      }
      items.push({
        mapID: row.map_id,
        scope: row.scope,
        enabled: locked ? true : Boolean(enabled),
        locked,
        data: tms,
      });
    }
    return items;
  }

  async setBaseMapVisibilityForMapID(mapID: string, baseMapId: string, enabled: boolean): Promise<void> {
    const db = await this.getDb();
    const row = db
      .prepare(
        `SELECT data_json FROM base_maps WHERE map_id = ?
         ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END LIMIT 1`
      )
      .get(baseMapId) as any;
    if (row) {
      const tms = JSON.parse(row.data_json);
      if (tms.always) return;
    }
    db.prepare(
      `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(mapID, baseMapId, enabled ? 1 : 0);
  }

  async listBaseMaps(): Promise<BaseMapCatalogItem[]> {
    const db = await this.getDb();
    const rows = db
      .prepare(`
        SELECT map_id, scope, data_json
        FROM base_maps
        ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END, sort_order, map_id
      `)
      .all() as any[];
    return rows.map((row: any) => ({
      mapID: row.map_id,
      scope: row.scope,
      data: JSON.parse(row.data_json),
    }));
  }

  async saveUserBaseMap(tms: any): Promise<void> {
    const mapID = String(tms?.mapID ?? '').trim();
    if (!mapID) throw new Error('mapID is required');
    const db = await this.getDb();
    const builtinRow = db
      .prepare(`SELECT 1 FROM base_maps WHERE scope = 'builtin' AND map_id = ?`)
      .get(mapID);
    if (builtinRow) {
      throw new Error(`Base map ID conflicts with a builtin base map: ${mapID}`);
    }

    const existing = db
      .prepare(`SELECT sort_order FROM base_maps WHERE scope = 'user' AND map_id = ?`)
      .get(mapID) as any;
    let sortOrder: number;
    if (existing) {
      sortOrder = Number(existing.sort_order);
    } else {
      const next = db
        .prepare(`SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM base_maps WHERE scope = 'user'`)
        .get() as any;
      sortOrder = Number(next.next_order);
    }
    db.prepare(
      `INSERT OR REPLACE INTO base_maps (map_id, scope, sort_order, data_json, updated_at)
       VALUES (?, 'user', ?, ?, datetime('now'))`
    ).run(mapID, sortOrder, JSON.stringify({ ...tms, mapID }));
  }

  async deleteUserBaseMap(baseMapId: string): Promise<void> {
    const db = await this.getDb();
    db.prepare(`DELETE FROM base_maps WHERE scope = 'user' AND map_id = ?`).run(baseMapId);
    const remains = db.prepare('SELECT 1 FROM base_maps WHERE map_id = ?').get(baseMapId);
    if (!remains) {
      db.prepare('DELETE FROM map_base_map_visibility WHERE base_map_id = ?').run(baseMapId);
    }
  }

  // --- migration internals ---

  // ビルトインベースマップは起動ごとに builtin_base_maps.json(正本: KTGISカタログ)から再シードする
  private applyBuiltinBaseMapSeed(db: DatabaseSync): void {
    const list = maybeJsonArray(builtinBaseMaps);
    this.upsertBaseMaps(db, 'builtin', list);
    const builtinIDs = list.map((tms) => String(tms.mapID)).filter(Boolean);
    if (builtinIDs.length > 0) {
      const placeholders = builtinIDs.map(() => '?').join(', ');
      db.prepare(`DELETE FROM base_maps WHERE scope = 'builtin' AND map_id NOT IN (${placeholders})`)
        .run(...builtinIDs);
    }
  }

  // nedb.db(または退避済み _nedb.db)からのMaplat地図マイグレーション
  private async migrateNeDB(db: DatabaseSync): Promise<void> {
    const nedbFile = await this.resolveLegacyPath(this.folders.nedbFile, this.folders.retiredNedbFile);
    if (!nedbFile) return;
    const store = new Datastore({ filename: nedbFile, autoload: true });
    const docs = await new Promise<any[]>((resolve, reject) => {
      store.find({}).sort({ _id: 1 }).exec((err: any, documents: any[]) => {
        if (err) reject(err);
        else resolve(documents);
      });
    });
    const insert = db.prepare(
      `INSERT INTO maps (map_id, data_json, updated_at)
       SELECT ?, ?, datetime('now')
       WHERE NOT EXISTS (SELECT 1 FROM maps WHERE map_id = ?)`
    );
    for (const doc of docs) {
      if (!doc?._id) continue;
      insert.run(doc._id, JSON.stringify(normalizeMapDocument(doc)), doc._id);
    }
  }

  // settings(または退避済み _settings)配下のユーザーベースマップ/個別地図の表示設定マイグレーション
  private async migrateUserBaseMaps(db: DatabaseSync): Promise<void> {
    const settingsDir = await this.resolveLegacyPath(this.folders.settingsDir, this.folders.retiredSettingsDir);
    const storeList = maybeJsonArray(SettingsService.get('tmsList'));
    if (isDefaultTmsList(storeList)) {
      storeList.length = 0;
    }
    if (storeList.length > 0) this.upsertBaseMaps(db, 'user', storeList);

    if (!settingsDir) return;
    const userTmsListPath = path.join(settingsDir, 'tmsList.json');
    if (await fs.pathExists(userTmsListPath)) {
      this.upsertBaseMaps(db, 'user', maybeJsonArray(await fs.readJson(userTmsListPath)));
    }

    const files = await fs.readdir(settingsDir);
    const insertVisibility = db.prepare(
      `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    );
    for (const file of files) {
      const mapID = safeMapIDFromSpecificFile(file);
      if (!mapID) continue;
      const fileData = await fs.readJson(path.join(settingsDir, file));
      if (!fileData || typeof fileData !== 'object' || Array.isArray(fileData)) continue;
      for (const [baseMapId, enabled] of Object.entries(fileData)) {
        insertVisibility.run(mapID, baseMapId, enabled ? 1 : 0);
      }
    }
  }

  private upsertBaseMaps(db: DatabaseSync, scope: BaseMapScope, list: any[]): void {
    const insert = db.prepare(
      `INSERT OR REPLACE INTO base_maps (map_id, scope, sort_order, data_json, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );
    for (let index = 0; index < list.length; index++) {
      const tms = list[index];
      if (!tms?.mapID) continue;
      insert.run(String(tms.mapID), scope, index, JSON.stringify(tms));
    }
  }

  // 先行のDuckDB移行が退避名(_nedb.db/_settings)へリネーム済みの場合があるため両方を受け付ける
  private async resolveLegacyPath(livePath: string, retiredPath: string): Promise<string | null> {
    if (await fs.pathExists(livePath)) return livePath;
    if (await fs.pathExists(retiredPath)) return retiredPath;
    return null;
  }

  private async hasLegacyMigrationInputs(): Promise<boolean> {
    const { nedbFile, retiredNedbFile, settingsDir, retiredSettingsDir } = this.folders;
    if (await fs.pathExists(nedbFile)) return true;
    if (await fs.pathExists(retiredNedbFile)) return true;
    const dir = (await fs.pathExists(settingsDir))
      ? settingsDir
      : (await fs.pathExists(retiredSettingsDir))
        ? retiredSettingsDir
        : null;
    if (!dir) return false;
    const files = await fs.readdir(dir);
    return files.some((file) => file === 'tmsList.json' || safeMapIDFromSpecificFile(file) != null);
  }

  // Legacy Data Retirement: 消費済み入力を _ 接頭辞名へリネーム退避する(削除はしない)
  private async retireLegacyDataFiles(): Promise<void> {
    const { nedbFile, retiredNedbFile, settingsDir, retiredSettingsDir } = this.folders;
    await this.renameIfExists(nedbFile, retiredNedbFile);
    await this.renameIfExists(settingsDir, retiredSettingsDir);
  }

  private async renameIfExists(from: string, preferredTo: string): Promise<void> {
    if (!(await fs.pathExists(from))) return;
    let to = preferredTo;
    let suffix = 1;
    while (await fs.pathExists(to)) {
      const parsed = path.parse(preferredTo);
      to = path.join(parsed.dir, `${parsed.name}.${suffix}${parsed.ext}`);
      suffix++;
    }
    await fs.move(from, to, { overwrite: false });
  }
}

export default new SqliteDataService();
