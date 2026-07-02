import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import Datastore from '@seald-io/nedb';
import { BrowserWindow } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import defaultTmsList from '../tms_list.json';
import SettingsService from './SettingsService';

type BaseMapScope = 'builtin' | 'user';

export interface MapListResult {
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
  duckDbFile: string;
  nedbFile: string;
}

function checkLocaleAttr(attr: any, condition: string): boolean {
  if (!attr) return false;
  const conds = condition.trim().split(/\s+/);
  if (typeof attr === 'string') {
    return conds.every(cond => new RegExp(cond, 'i').test(attr));
  }
  return conds.every(cond =>
    Object.values(attr as Record<string, string>).some(v => new RegExp(cond, 'i').test(v))
  );
}

function mapRowToDocument(row: any): any {
  const data = JSON.parse(row.data_json);
  data._id = row.map_id;
  return data;
}

function normalizeMapDocument(document: any): any {
  const normalized = { ...document };
  delete normalized._id;
  delete normalized.mapID;
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

class DuckDbDataService {
  private connection: DuckDBConnection | null = null;
  private activeDbFile: string | null = null;

  private get folders(): Folders {
    const saveFolder = SettingsService.get('saveFolder') as string;
    return {
      saveFolder,
      settingsDir: path.join(saveFolder, 'settings'),
      duckDbFile: path.join(saveFolder, 'maplat.duckdb'),
      nedbFile: path.join(saveFolder, 'nedb.db'),
    };
  }

  async reset(): Promise<void> {
    if (this.connection) {
      this.connection.disconnectSync();
    }
    this.connection = null;
    this.activeDbFile = null;
  }

  async getConnection(): Promise<DuckDBConnection> {
    const { saveFolder, duckDbFile } = this.folders;
    if (this.connection && this.activeDbFile === duckDbFile) return this.connection;

    await this.reset();
    await fs.ensureDir(saveFolder);
    const instance = await DuckDBInstance.fromCache(duckDbFile);
    this.connection = await instance.connect();
    this.activeDbFile = duckDbFile;
    await this.migrate();
    return this.connection;
  }

  async migrate(): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new Error('DuckDB connection is not initialized');
    const notifyProgress = await this.hasLegacyMigrationInputs();

    try {
      if (notifyProgress) sendMigrationProgress('database.migrating', 0);
      await connection.run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id VARCHAR PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT current_timestamp
        );
        CREATE TABLE IF NOT EXISTS maps (
          map_id VARCHAR PRIMARY KEY,
          data_json JSON NOT NULL,
          updated_at TIMESTAMP DEFAULT current_timestamp
        );
        CREATE TABLE IF NOT EXISTS base_maps (
          map_id VARCHAR NOT NULL,
          scope VARCHAR NOT NULL,
          sort_order INTEGER NOT NULL,
          data_json JSON NOT NULL,
          updated_at TIMESTAMP DEFAULT current_timestamp,
          PRIMARY KEY (scope, map_id)
        );
        CREATE TABLE IF NOT EXISTS map_base_map_visibility (
          map_id VARCHAR NOT NULL,
          base_map_id VARCHAR NOT NULL,
          enabled BOOLEAN NOT NULL,
          updated_at TIMESTAMP DEFAULT current_timestamp,
          PRIMARY KEY (map_id, base_map_id)
        );
      `);

      if (notifyProgress) sendMigrationProgress('database.migrating_builtin_basemaps', 25, '(1/4)');
      await this.applyBuiltinBaseMapMigration(connection);
      if (notifyProgress) sendMigrationProgress('database.migrating_legacy_maps', 50, '(2/4)');
      await this.migrateNeDB(connection);
      if (notifyProgress) sendMigrationProgress('database.migrating_legacy_basemaps', 75, '(3/4)');
      await this.migrateUserBaseMaps(connection);
      await connection.run(
        `INSERT OR REPLACE INTO schema_migrations (id, applied_at) VALUES ('2026-07-02-duckdb-map-and-basemap-source', current_timestamp)`
      );
      if (notifyProgress) sendMigrationProgress('database.archiving_legacy_files', 90, '(4/4)');
      await this.retireLegacyDataFiles();
      if (notifyProgress) sendMigrationProgress('database.migrated', 100, '(4/4)');
    } catch (e) {
      if (notifyProgress) sendMigrationProgress('database.migration_failed', 100);
      throw e;
    }
  }

  async findMap(mapID: string): Promise<any | null> {
    const connection = await this.getConnection();
    const reader = await connection.runAndReadAll(
      'SELECT map_id, data_json::VARCHAR AS data_json FROM maps WHERE map_id = $mapID',
      { mapID }
    );
    const rows = reader.getRowObjectsJson() as any[];
    if (rows.length === 0) return null;
    return mapRowToDocument(rows[0]);
  }

  async upsertMap(mapID: string, document: any): Promise<void> {
    const connection = await this.getConnection();
    await connection.run(
      `INSERT OR REPLACE INTO maps (map_id, data_json, updated_at)
       VALUES ($mapID, CAST($dataJson AS JSON), current_timestamp)`,
      { mapID, dataJson: JSON.stringify(normalizeMapDocument(document)) }
    );
  }

  async deleteMap(mapID: string): Promise<void> {
    const connection = await this.getConnection();
    await connection.run('DELETE FROM maps WHERE map_id = $mapID', { mapID });
  }

  async isMapIdAvailable(mapID: string): Promise<boolean> {
    return (await this.findMap(mapID)) === null;
  }

  async listMaps(query: string = '', page: number = 1, pageSize: number = 20): Promise<MapListResult> {
    const connection = await this.getConnection();
    const reader = await connection.runAndReadAll(
      'SELECT map_id, data_json::VARCHAR AS data_json FROM maps ORDER BY map_id'
    );
    let rawDocs = (reader.getRowObjectsJson() as any[]).map(mapRowToDocument);
    if (query && query.trim()) {
      rawDocs = rawDocs.filter((doc) =>
        ['title', 'officialTitle', 'description'].some(attr => checkLocaleAttr(doc[attr], query))
      );
    }

    let currentPage = page;
    let pageUpdate: number | undefined;
    while (currentPage > 1 && rawDocs.slice((currentPage - 1) * pageSize, currentPage * pageSize).length === 0) {
      currentPage--;
      pageUpdate = currentPage;
    }

    const start = (currentPage - 1) * pageSize;
    const pageDocs = rawDocs.slice(start, start + pageSize);
    const result: MapListResult = {
      docs: pageDocs,
      prev: currentPage > 1,
      next: rawDocs.length > start + pageSize,
    };
    if (pageUpdate !== undefined) result.pageUpdate = pageUpdate;
    return result;
  }

  async searchExtent(extent: number[]): Promise<string[]> {
    const connection = await this.getConnection();
    const reader = await connection.runAndReadAll(
      'SELECT map_id, data_json::VARCHAR AS data_json FROM maps ORDER BY map_id'
    );
    return (reader.getRowObjectsJson() as any[])
      .map(mapRowToDocument)
      .filter((doc) => {
        if (!doc.compiled) return false;
        const pts = doc.compiled.vertices_points;
        if (!pts || pts.length === 0) return false;
        const ext: number[] = pts.reduce((ret: number[], vertex: any) => {
          const merc = vertex[1];
          if (ret.length === 0) return [merc[0], merc[1], merc[0], merc[1]];
          return [Math.min(ret[0], merc[0]), Math.min(ret[1], merc[1]),
                  Math.max(ret[2], merc[0]), Math.max(ret[3], merc[1])];
        }, []);
        return extent[0] <= ext[2] && ext[0] <= extent[2] &&
               extent[1] <= ext[3] && ext[1] <= extent[3];
      })
      .map((doc) => doc._id);
  }

  async getTmsListOfMapID(mapID: string): Promise<any[]> {
    const items = await this.getBaseMapVisibilityOfMapID(mapID);
    return items.filter((item) => item.enabled).map((item) => item.data);
  }

  async getBaseMapVisibilityOfMapID(mapID: string): Promise<BaseMapVisibilityItem[]> {
    const connection = await this.getConnection();
    const baseMapsReader = await connection.runAndReadAll(`
      SELECT map_id, scope, sort_order, data_json::VARCHAR AS data_json
      FROM base_maps
      ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END, sort_order, map_id
    `);
    const visibilityReader = await connection.runAndReadAll(
      'SELECT base_map_id, enabled FROM map_base_map_visibility WHERE map_id = $mapID',
      { mapID }
    );
    const visibility = new Map(
      (visibilityReader.getRowObjectsJson() as any[]).map((row) => [row.base_map_id, row.enabled])
    );
    const missingDefaults: Array<{ baseMapId: string; enabled: boolean }> = [];
    const items: BaseMapVisibilityItem[] = [];

    for (const row of baseMapsReader.getRowObjectsJson() as any[]) {
      const tms = JSON.parse(row.data_json);
      const locked = Boolean(tms.always);
      let enabled = visibility.get(row.map_id);
      if (enabled == null) {
        enabled = true;
        if (!locked) missingDefaults.push({ baseMapId: row.map_id, enabled });
      }
      items.push({
        mapID: row.map_id,
        scope: row.scope,
        enabled: locked ? true : Boolean(enabled),
        locked,
        data: tms,
      });
    }

    for (const item of missingDefaults) {
      await connection.run(
        `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
         VALUES ($mapID, $baseMapId, $enabled, current_timestamp)`,
        { mapID, baseMapId: item.baseMapId, enabled: item.enabled }
      );
    }
    return items;
  }

  async setBaseMapVisibilityForMapID(mapID: string, baseMapId: string, enabled: boolean): Promise<void> {
    const connection = await this.getConnection();
    const baseMapReader = await connection.runAndReadAll(
      'SELECT data_json::VARCHAR AS data_json FROM base_maps WHERE map_id = $baseMapId ORDER BY CASE scope WHEN \'builtin\' THEN 0 ELSE 1 END LIMIT 1',
      { baseMapId }
    );
    const baseMapRows = baseMapReader.getRowObjectsJson() as any[];
    if (baseMapRows.length > 0) {
      const tms = JSON.parse(baseMapRows[0].data_json);
      if (tms.always) return;
    }
    await connection.run(
      `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
       VALUES ($mapID, $baseMapId, $enabled, current_timestamp)`,
      { mapID, baseMapId, enabled }
    );
  }

  async listBaseMaps(): Promise<BaseMapCatalogItem[]> {
    const connection = await this.getConnection();
    const reader = await connection.runAndReadAll(`
      SELECT map_id, scope, data_json::VARCHAR AS data_json
      FROM base_maps
      ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END, sort_order, map_id
    `);
    return (reader.getRowObjectsJson() as any[]).map((row) => ({
      mapID: row.map_id,
      scope: row.scope,
      data: JSON.parse(row.data_json),
    }));
  }

  async saveUserBaseMap(tms: any): Promise<void> {
    const mapID = String(tms?.mapID ?? '').trim();
    if (!mapID) throw new Error('mapID is required');
    const connection = await this.getConnection();
    const builtinReader = await connection.runAndReadAll(
      `SELECT 1 FROM base_maps WHERE scope = 'builtin' AND map_id = $mapID`,
      { mapID }
    );
    if ((builtinReader.getRowObjectsJson() as any[]).length > 0) {
      throw new Error(`Base map ID conflicts with a builtin base map: ${mapID}`);
    }

    const existingReader = await connection.runAndReadAll(
      `SELECT sort_order FROM base_maps WHERE scope = 'user' AND map_id = $mapID`,
      { mapID }
    );
    const existingRows = existingReader.getRowObjectsJson() as any[];
    let sortOrder: number;
    if (existingRows.length > 0) {
      sortOrder = Number(existingRows[0].sort_order);
    } else {
      const nextReader = await connection.runAndReadAll(
        `SELECT COALESCE(MAX(sort_order) + 1, 0)::INTEGER AS next_order FROM base_maps WHERE scope = 'user'`
      );
      sortOrder = Number((nextReader.getRowObjectsJson() as any[])[0].next_order);
    }
    await connection.run(
      `INSERT OR REPLACE INTO base_maps (map_id, scope, sort_order, data_json, updated_at)
       VALUES ($mapID, 'user', $sortOrder, CAST($dataJson AS JSON), current_timestamp)`,
      { mapID, sortOrder, dataJson: JSON.stringify({ ...tms, mapID }) }
    );
  }

  async deleteUserBaseMap(baseMapId: string): Promise<void> {
    const connection = await this.getConnection();
    await connection.run(
      `DELETE FROM base_maps WHERE scope = 'user' AND map_id = $baseMapId`,
      { baseMapId }
    );
    const remainsReader = await connection.runAndReadAll(
      'SELECT 1 FROM base_maps WHERE map_id = $baseMapId',
      { baseMapId }
    );
    if ((remainsReader.getRowObjectsJson() as any[]).length === 0) {
      await connection.run(
        'DELETE FROM map_base_map_visibility WHERE base_map_id = $baseMapId',
        { baseMapId }
      );
    }
  }

  private async applyBuiltinBaseMapMigration(connection: DuckDBConnection): Promise<void> {
    const builtinIDs = maybeJsonArray(defaultTmsList).map((tms) => String(tms.mapID)).filter(Boolean);
    await this.upsertBaseMaps(connection, 'builtin', maybeJsonArray(defaultTmsList));
    if (builtinIDs.length > 0) {
      const placeholders = builtinIDs.map((_, index) => `$id${index}`).join(', ');
      const params = Object.fromEntries(builtinIDs.map((id, index) => [`id${index}`, id]));
      await connection.run(
        `DELETE FROM base_maps WHERE scope = 'builtin' AND map_id NOT IN (${placeholders})`,
        params
      );
    }
  }

  private async migrateNeDB(connection: DuckDBConnection): Promise<void> {
    const { nedbFile } = this.folders;
    if (!(await fs.pathExists(nedbFile))) return;
    const db = new Datastore({ filename: nedbFile, autoload: true });
    const docs = await new Promise<any[]>((resolve, reject) => {
      db.find({}).sort({ _id: 1 }).exec((err: any, documents: any[]) => {
        if (err) reject(err);
        else resolve(documents);
      });
    });
    for (const doc of docs) {
      if (!doc?._id) continue;
      await connection.run(
        `INSERT INTO maps (map_id, data_json, updated_at)
         SELECT $mapID, CAST($dataJson AS JSON), current_timestamp
         WHERE NOT EXISTS (SELECT 1 FROM maps WHERE map_id = $mapID)`,
        { mapID: doc._id, dataJson: JSON.stringify(normalizeMapDocument(doc)) }
      );
    }
  }

  private async migrateUserBaseMaps(connection: DuckDBConnection): Promise<void> {
    const { settingsDir } = this.folders;
    const storeList = maybeJsonArray(SettingsService.get('tmsList'));
    if (isDefaultTmsList(storeList)) {
      storeList.length = 0;
    }
    if (storeList.length > 0) await this.upsertBaseMaps(connection, 'user', storeList);

    const userTmsListPath = path.join(settingsDir, 'tmsList.json');
    if (await fs.pathExists(userTmsListPath)) {
      await this.upsertBaseMaps(connection, 'user', maybeJsonArray(await fs.readJson(userTmsListPath)));
    }

    if (!(await fs.pathExists(settingsDir))) return;
    const files = await fs.readdir(settingsDir);
    for (const file of files) {
      const mapID = safeMapIDFromSpecificFile(file);
      if (!mapID) continue;
      const fileData = await fs.readJson(path.join(settingsDir, file));
      if (!fileData || typeof fileData !== 'object' || Array.isArray(fileData)) continue;
      for (const [baseMapId, enabled] of Object.entries(fileData)) {
        await connection.run(
          `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
           VALUES ($mapID, $baseMapId, $enabled, current_timestamp)`,
          { mapID, baseMapId, enabled: Boolean(enabled) }
        );
      }
    }
  }

  private async upsertBaseMaps(connection: DuckDBConnection, scope: BaseMapScope, list: any[]): Promise<void> {
    for (let index = 0; index < list.length; index++) {
      const tms = list[index];
      if (!tms?.mapID) continue;
      await connection.run(
        `INSERT OR REPLACE INTO base_maps (map_id, scope, sort_order, data_json, updated_at)
         VALUES ($mapID, $scope, $sortOrder, CAST($dataJson AS JSON), current_timestamp)`,
        {
          mapID: String(tms.mapID),
          scope,
          sortOrder: index,
          dataJson: JSON.stringify(tms),
        }
      );
    }
  }

  private async hasLegacyMigrationInputs(): Promise<boolean> {
    const { nedbFile, settingsDir } = this.folders;
    if (await fs.pathExists(nedbFile)) return true;
    if (!(await fs.pathExists(settingsDir))) return false;
    const files = await fs.readdir(settingsDir);
    return files.some((file) => file === 'tmsList.json' || safeMapIDFromSpecificFile(file) != null);
  }

  // Temporary retirement policy while the DuckDB path stabilizes. Replace this
  // body with destructive deletion only after migrated data has been validated.
  private async retireLegacyDataFiles(): Promise<void> {
    const { nedbFile, settingsDir } = this.folders;
    await this.renameIfExists(nedbFile, path.join(path.dirname(nedbFile), '_nedb.db'));
    await this.renameIfExists(settingsDir, path.join(path.dirname(settingsDir), '_settings'));
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

export default new DuckDbDataService();
