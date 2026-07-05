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
import { normalizeMapLangFields } from '../../src/utils/langResource';

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
  alwaysVisible: boolean;
  alwaysLocked: boolean;
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
const SEARCH_INDEX_BACKFILL_ID = '2026-07-04-search-index-backfill';
// 表示設定オプトイン化(ADR-0006): これ以前の map_base_map_visibility 行は
// オプトアウト時代の意味(未設定=表示)で書かれているため一括破棄する
const OPT_IN_VISIBILITY_FLIP_ID = '2026-07-05-opt-in-base-map-visibility';

// 常時表示から外せないベースマップ(ビューア/エディタの最終フォールバック基盤)
const FORCED_ALWAYS_BASE_MAP_IDS = new Set(['osm']);

// --- 全文検索(FTS5)/位置情報検索(R-Tree)用ヘルパー ---
// トークナイザはICU(Intl.Segmenter)の日本語単語分割。追加依存なしで全プラットフォーム同一動作。
const jaSegmenter = new Intl.Segmenter('ja', { granularity: 'word' });

export function tokenizeForSearch(text: string): string {
  if (!text) return '';
  return [...jaSegmenter.segment(text)]
    .filter((seg) => seg.isWordLike)
    .map((seg) => seg.segment)
    .join(' ');
}

// 文字列またはロケール別オブジェクト({ja:...,en:...})から検索対象文字列を集める
function collectSearchStrings(value: any): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  }
  return [];
}

function ftsRawFromJson(dataJson: string, fields: string[]): string {
  try {
    const doc = JSON.parse(dataJson);
    return fields.flatMap((field) => collectSearchStrings(doc?.[field])).join('\n');
  } catch {
    return '';
  }
}

// 地図のbbox(メルカトル座標)。compiled.vertices_points から算出(従来のsearchExtentと同一定義)
function mapBboxFromJson(dataJson: string): string | null {
  try {
    const doc = JSON.parse(dataJson);
    const pts = doc?.compiled?.vertices_points;
    if (!Array.isArray(pts) || pts.length === 0) return null;
    let bbox: number[] | null = null;
    for (const vertex of pts) {
      const merc = vertex?.[1];
      if (!Array.isArray(merc) || typeof merc[0] !== 'number' || typeof merc[1] !== 'number') continue;
      bbox = bbox
        ? [Math.min(bbox[0], merc[0]), Math.min(bbox[1], merc[1]), Math.max(bbox[2], merc[0]), Math.max(bbox[3], merc[1])]
        : [merc[0], merc[1], merc[0], merc[1]];
    }
    return bbox ? JSON.stringify(bbox) : null;
  } catch {
    return null;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// FTS5 MATCH式: 各トークンをダブルクォートで包んだ暗黙AND
function ftsMatchExpression(term: string): string | null {
  const tokens = tokenizeForSearch(term).split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' ');
}

export function mapRowToDocument(row: any): any {
  // 正規化導入(ADR-0005)前に保存された行はプレーン文字列の言語別フィールドを
  // 含みうるため、読み出し時にもオブジェクト形へ正規化する(再マイグレーション不要。
  // 次回保存時にupsertMap経由で正規化済みの形が永続化される)
  const data = normalizeMapLangFields(JSON.parse(row.data_json));
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
  // 言語別フィールドはDB内では常にオブジェクト形 (ADR-0005)。
  // nedb移行やインポート由来のプレーン文字列(=デフォルト言語の値)もここで正規化される
  const normalized = normalizeMapLangFields({ ...document });
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
    // WAL時の標準設定: コミット毎のfsyncを削減(電源断で直近コミットが巻き戻る可能性はあるがDB破損はしない)
    db.exec('PRAGMA synchronous=NORMAL');
    // INSERT OR REPLACE時の内部DELETEでもトリガを発火させる(検索索引の同期漏れ防止)
    db.exec('PRAGMA recursive_triggers=ON');
    this.registerSearchFunctions(db);
    this.db = db;
    this.activeDbFile = sqliteFile;
    await this.migrate();
    return db;
  }

  // 複数書き込みを1コミットに束ねる。node:sqliteは同期実行のため、コミット(fsync)を
  // 行数分繰り返すとメインプロセスのイベントループ(=プレビューHTTPサーバ等)が長時間停止する
  private withTransaction<T>(db: DatabaseSync, fn: () => T): T {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // noop
      }
      throw e;
    }
  }

  // 検索索引トリガから呼ぶSQL関数(JS実装)を登録する。
  // 注意: SQL関数は接続ごとの登録のため、この関数を登録しない外部ツールで
  // maps/appsに書き込むとトリガが失敗する(=索引が黙って古くなることはない)。
  private registerSearchFunctions(db: DatabaseSync): void {
    db.function('maplat_tokenize', { deterministic: true }, (text: unknown) =>
      tokenizeForSearch(String(text ?? ''))
    );
    db.function('maplat_map_fts_raw', { deterministic: true }, (dataJson: unknown) =>
      ftsRawFromJson(String(dataJson ?? ''), ['title', 'officialTitle', 'description'])
    );
    db.function('maplat_app_fts_raw', { deterministic: true }, (dataJson: unknown) =>
      ftsRawFromJson(String(dataJson ?? ''), ['title', 'appName', 'description'])
    );
    db.function('maplat_map_bbox', { deterministic: true }, (dataJson: unknown) =>
      mapBboxFromJson(String(dataJson ?? ''))
    );
  }

  private async migrate(): Promise<void> {
    const db = this.db;
    if (!db) throw new Error('SQLite connection is not initialized');

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
      CREATE TABLE IF NOT EXISTS base_map_always (
        base_map_id TEXT PRIMARY KEY,
        always_visible INTEGER NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    this.applySearchIndexSchema(db);
    this.applyBuiltinBaseMapSeed(db);

    // オプトイン化以前に書かれた表示設定は意味が反転しているため一度だけ全破棄する。
    // レガシー(nedb/settings)取込より前に行うことで、取込直後の設定は破棄されない。
    // ユーザー定義ベースマップの定義(base_maps)はここでは触らない
    const visibilityFlipped = db
      .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
      .get(OPT_IN_VISIBILITY_FLIP_ID);
    if (!visibilityFlipped) {
      this.withTransaction(db, () => {
        db.exec('DELETE FROM map_base_map_visibility');
        db.prepare('INSERT OR REPLACE INTO schema_migrations (id) VALUES (?)').run(OPT_IN_VISIBILITY_FLIP_ID);
      });
    }

    // レガシー移行は初回のみ。退避アーカイブ(_nedb.db/_settings)は残り続けるため、
    // 「入力ファイルの有無」ではなく「移行を実際に実行するか」で進捗通知を判定する
    const alreadyMigrated = db
      .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
      .get(LEGACY_MIGRATION_ID);
    if (alreadyMigrated) return;

    const notifyProgress = await this.hasLegacyMigrationInputs();
    try {
      if (notifyProgress) sendMigrationProgress('database.migrating', 0);
      if (notifyProgress) sendMigrationProgress('database.migrating_legacy_maps', 25, '(1/3)');
      await this.migrateNeDB(db);
      if (notifyProgress) sendMigrationProgress('database.migrating_legacy_basemaps', 50, '(2/3)');
      await this.migrateUserBaseMaps(db);
      db.prepare('INSERT OR REPLACE INTO schema_migrations (id) VALUES (?)').run(LEGACY_MIGRATION_ID);
      if (notifyProgress) sendMigrationProgress('database.archiving_legacy_files', 75, '(3/3)');
      await this.retireLegacyDataFiles();
      if (notifyProgress) sendMigrationProgress('database.migrated', 100, '(3/3)');
    } catch (e) {
      if (notifyProgress) sendMigrationProgress('database.migration_failed', 100);
      throw e;
    }
  }

  // 全文検索(FTS5)/位置情報検索(R-Tree)の索引スキーマとトリガ。
  // maps/appsへの書き込み(経路を問わず)でトリガが発火し、JSトークナイザで
  // 分かち書きした全文索引とbbox索引が同一トランザクション内で更新される。
  private applySearchIndexSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS maps_fts USING fts5(map_id UNINDEXED, raw UNINDEXED, words);
      CREATE VIRTUAL TABLE IF NOT EXISTS apps_fts USING fts5(app_id UNINDEXED, raw UNINDEXED, words);
      CREATE VIRTUAL TABLE IF NOT EXISTS maps_rtree USING rtree(id, min_x, max_x, min_y, max_y);
      CREATE TABLE IF NOT EXISTS maps_rtree_key (
        map_id TEXT PRIMARY KEY,
        rid INTEGER NOT NULL UNIQUE
      );
    `);
    // トリガ本体は将来変更しうるため、毎回DROP&CREATEで最新定義に揃える
    db.exec(`
      DROP TRIGGER IF EXISTS maps_search_ai;
      DROP TRIGGER IF EXISTS maps_search_au;
      DROP TRIGGER IF EXISTS maps_search_ad;
      DROP TRIGGER IF EXISTS apps_search_ai;
      DROP TRIGGER IF EXISTS apps_search_au;
      DROP TRIGGER IF EXISTS apps_search_ad;

      CREATE TRIGGER maps_search_ai AFTER INSERT ON maps BEGIN
        DELETE FROM maps_fts WHERE map_id = new.map_id;
        INSERT INTO maps_fts(map_id, raw, words)
          VALUES (new.map_id, maplat_map_fts_raw(new.data_json), maplat_tokenize(maplat_map_fts_raw(new.data_json)));
        DELETE FROM maps_rtree WHERE id IN (SELECT rid FROM maps_rtree_key WHERE map_id = new.map_id);
        DELETE FROM maps_rtree_key WHERE map_id = new.map_id;
        INSERT INTO maps_rtree_key(map_id, rid)
          SELECT new.map_id, new.rowid WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
        INSERT INTO maps_rtree(id, min_x, max_x, min_y, max_y)
          SELECT new.rowid,
                 json_extract(maplat_map_bbox(new.data_json), '$[0]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[2]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[1]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[3]')
          WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
      END;

      CREATE TRIGGER maps_search_au AFTER UPDATE ON maps BEGIN
        DELETE FROM maps_fts WHERE map_id IN (old.map_id, new.map_id);
        INSERT INTO maps_fts(map_id, raw, words)
          VALUES (new.map_id, maplat_map_fts_raw(new.data_json), maplat_tokenize(maplat_map_fts_raw(new.data_json)));
        DELETE FROM maps_rtree WHERE id IN (SELECT rid FROM maps_rtree_key WHERE map_id IN (old.map_id, new.map_id));
        DELETE FROM maps_rtree_key WHERE map_id IN (old.map_id, new.map_id);
        INSERT INTO maps_rtree_key(map_id, rid)
          SELECT new.map_id, new.rowid WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
        INSERT INTO maps_rtree(id, min_x, max_x, min_y, max_y)
          SELECT new.rowid,
                 json_extract(maplat_map_bbox(new.data_json), '$[0]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[2]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[1]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[3]')
          WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
      END;

      CREATE TRIGGER maps_search_ad AFTER DELETE ON maps BEGIN
        DELETE FROM maps_fts WHERE map_id = old.map_id;
        DELETE FROM maps_rtree WHERE id IN (SELECT rid FROM maps_rtree_key WHERE map_id = old.map_id);
        DELETE FROM maps_rtree_key WHERE map_id = old.map_id;
      END;

      CREATE TRIGGER apps_search_ai AFTER INSERT ON apps BEGIN
        DELETE FROM apps_fts WHERE app_id = new.app_id;
        INSERT INTO apps_fts(app_id, raw, words)
          VALUES (new.app_id,
                  new.app_id || char(10) || maplat_app_fts_raw(new.data_json),
                  maplat_tokenize(new.app_id || ' ' || maplat_app_fts_raw(new.data_json)));
      END;

      CREATE TRIGGER apps_search_au AFTER UPDATE ON apps BEGIN
        DELETE FROM apps_fts WHERE app_id IN (old.app_id, new.app_id);
        INSERT INTO apps_fts(app_id, raw, words)
          VALUES (new.app_id,
                  new.app_id || char(10) || maplat_app_fts_raw(new.data_json),
                  maplat_tokenize(new.app_id || ' ' || maplat_app_fts_raw(new.data_json)));
      END;

      CREATE TRIGGER apps_search_ad AFTER DELETE ON apps BEGIN
        DELETE FROM apps_fts WHERE app_id = old.app_id;
      END;
    `);

    // トリガ導入以前に書き込まれた既存行の索引を一度だけ再構築する
    const backfilled = db
      .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
      .get(SEARCH_INDEX_BACKFILL_ID);
    if (!backfilled) {
      db.exec(`
        BEGIN;
        DELETE FROM maps_fts;
        DELETE FROM maps_rtree;
        DELETE FROM maps_rtree_key;
        DELETE FROM apps_fts;
        INSERT INTO maps_fts(map_id, raw, words)
          SELECT map_id, maplat_map_fts_raw(data_json), maplat_tokenize(maplat_map_fts_raw(data_json)) FROM maps;
        INSERT INTO maps_rtree_key(map_id, rid)
          SELECT map_id, rowid FROM maps WHERE maplat_map_bbox(data_json) IS NOT NULL;
        INSERT INTO maps_rtree(id, min_x, max_x, min_y, max_y)
          SELECT rowid,
                 json_extract(maplat_map_bbox(data_json), '$[0]'),
                 json_extract(maplat_map_bbox(data_json), '$[2]'),
                 json_extract(maplat_map_bbox(data_json), '$[1]'),
                 json_extract(maplat_map_bbox(data_json), '$[3]')
          FROM maps WHERE maplat_map_bbox(data_json) IS NOT NULL;
        INSERT INTO apps_fts(app_id, raw, words)
          SELECT app_id,
                 app_id || char(10) || maplat_app_fts_raw(data_json),
                 maplat_tokenize(app_id || ' ' || maplat_app_fts_raw(data_json))
          FROM apps;
        INSERT OR REPLACE INTO schema_migrations (id) VALUES ('${SEARCH_INDEX_BACKFILL_ID}');
        COMMIT;
      `);
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
    if ((await this.findMap(mapID)) !== null) return false;
    // Maplat地図とベースマップ(ビルトイン含む)はID空間を共有する:
    // サムネイル等が tmbs/{mapID}.* を共有するため、両者横断で一意でなければならない
    const db = await this.getDb();
    return db.prepare('SELECT 1 FROM base_maps WHERE map_id = ?').get(mapID) == null;
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

  // --- search (FTS5 / R-Tree) ---

  // 各検索語: FTS5トークン一致(分かち書き後の単語AND) ∪ raw部分一致(従来の部分文字列検索の互換)。
  // 複数語はAND(積集合)。戻り値 null は「検索語なし=絞り込みなし」。
  private searchIDs(
    db: DatabaseSync,
    table: 'maps_fts' | 'apps_fts',
    idColumn: 'map_id' | 'app_id',
    query: string,
  ): string[] | null {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;
    let result: Set<string> | null = null;
    for (const term of terms) {
      const ids = new Set<string>();
      const match = ftsMatchExpression(term);
      if (match) {
        const rows = db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE ${table} MATCH ?`).all(match) as any[];
        for (const row of rows) ids.add(String(row.id));
      }
      const rows = db
        .prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE raw LIKE ? ESCAPE '\\'`)
        .all(`%${escapeLike(term)}%`) as any[];
      for (const row of rows) ids.add(String(row.id));
      if (result === null) {
        result = ids;
      } else {
        const previous: Set<string> = result;
        result = new Set([...previous].filter((id) => ids.has(id)));
      }
      if (result.size === 0) return [];
    }
    return [...(result as Set<string>)].sort();
  }

  private readDocsByIDs(
    db: DatabaseSync,
    table: 'maps' | 'apps',
    idColumn: 'map_id' | 'app_id',
    ids: string[],
    rowToDocument: (row: any) => any,
  ): any[] {
    const docs: any[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT ${idColumn}, data_json FROM ${table} WHERE ${idColumn} IN (${placeholders}) ORDER BY ${idColumn}`)
        .all(...chunk) as any[];
      docs.push(...rows.map(rowToDocument));
    }
    return docs;
  }

  async searchMaps(query: string): Promise<any[]> {
    const db = await this.getDb();
    const ids = this.searchIDs(db, 'maps_fts', 'map_id', query);
    if (ids === null) return this.readAllMaps();
    if (ids.length === 0) return [];
    return this.readDocsByIDs(db, 'maps', 'map_id', ids, mapRowToDocument);
  }

  async searchApps(query: string): Promise<any[]> {
    const db = await this.getDb();
    const ids = this.searchIDs(db, 'apps_fts', 'app_id', query);
    if (ids === null) return this.readAllApps();
    if (ids.length === 0) return [];
    return this.readDocsByIDs(db, 'apps', 'app_id', ids, appRowToDocument);
  }

  // extent = [minX, minY, maxX, maxY](メルカトル座標)。bbox交差する地図IDを返す
  async searchExtent(extent: number[]): Promise<string[]> {
    const db = await this.getDb();
    const rows = db
      .prepare(`
        SELECT k.map_id AS id
        FROM maps_rtree r JOIN maps_rtree_key k ON k.rid = r.id
        WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
        ORDER BY k.map_id
      `)
      .all(extent[0], extent[2], extent[1], extent[3]) as any[];
    return rows.map((row) => String(row.id));
  }

  // --- base maps ---

  async getTmsListOfMapID(mapID: string): Promise<any[]> {
    const items = await this.getBaseMapVisibilityOfMapID(mapID);
    return items.filter((item) => item.enabled).map((item) => item.data);
  }

  // 常時表示のユーザー上書き(base_map_always)。ビルトイン再シードの影響を受けない
  private alwaysOverrides(db: DatabaseSync): Map<string, boolean> {
    const rows = db.prepare('SELECT base_map_id, always_visible FROM base_map_always').all() as any[];
    return new Map(rows.map((row) => [String(row.base_map_id), Boolean(row.always_visible)]));
  }

  // 実効の常時表示: OSMは強制true、他は上書きがあればそれ、なければ定義のalways
  // (ビルトインではgsi/gsi_orthoのみtrue)
  private effectiveAlways(baseMapId: string, tms: any, overrides: Map<string, boolean>): boolean {
    if (FORCED_ALWAYS_BASE_MAP_IDS.has(baseMapId)) return true;
    const override = overrides.get(baseMapId);
    return override != null ? override : Boolean(tms?.always);
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
    const overrides = this.alwaysOverrides(db);

    // オプトイン方式(ADR-0006): 明示的に選択したものだけ表示(未設定=非表示)。
    // 常時表示のベースマップは選択に依らず表示され、地図単位では外せない
    const items: BaseMapVisibilityItem[] = [];
    for (const row of baseMapRows) {
      const tms = JSON.parse(row.data_json);
      const locked = this.effectiveAlways(row.map_id, tms, overrides);
      items.push({
        mapID: row.map_id,
        scope: row.scope,
        enabled: locked ? true : Boolean(visibility.get(row.map_id) ?? false),
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
      if (this.effectiveAlways(baseMapId, tms, this.alwaysOverrides(db))) return;
    }
    db.prepare(
      `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(mapID, baseMapId, enabled ? 1 : 0);
  }

  async listBaseMaps(): Promise<BaseMapCatalogItem[]> {
    const db = await this.getDb();
    const overrides = this.alwaysOverrides(db);
    const rows = db
      .prepare(`
        SELECT map_id, scope, data_json
        FROM base_maps
        ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END, sort_order, map_id
      `)
      .all() as any[];
    return rows.map((row: any) => {
      const data = JSON.parse(row.data_json);
      return {
        mapID: row.map_id,
        scope: row.scope,
        data,
        alwaysVisible: this.effectiveAlways(row.map_id, data, overrides),
        alwaysLocked: FORCED_ALWAYS_BASE_MAP_IDS.has(row.map_id),
      };
    });
  }

  async setBaseMapAlways(baseMapId: string, always: boolean): Promise<void> {
    if (FORCED_ALWAYS_BASE_MAP_IDS.has(baseMapId)) {
      throw new Error(`Base map cannot be removed from always-visible: ${baseMapId}`);
    }
    const db = await this.getDb();
    const exists = db.prepare('SELECT 1 FROM base_maps WHERE map_id = ?').get(baseMapId);
    if (!exists) throw new Error(`Unknown base map: ${baseMapId}`);
    db.prepare(
      `INSERT OR REPLACE INTO base_map_always (base_map_id, always_visible, updated_at)
       VALUES (?, ?, datetime('now'))`
    ).run(baseMapId, always ? 1 : 0);
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
    // ID空間はMaplat地図と共有(tmbs/{mapID}.* を共有するため)。既存地図のIDは拒否する
    const mapRow = db.prepare('SELECT 1 FROM maps WHERE map_id = ?').get(mapID);
    if (mapRow) {
      throw new Error(`Base map ID conflicts with a Maplat map: ${mapID}`);
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
      db.prepare('DELETE FROM base_map_always WHERE base_map_id = ?').run(baseMapId);
    }
  }

  // --- migration internals ---

  // ビルトインベースマップは起動ごとに builtin_base_maps.json(正本: KTGISカタログ)から再シードする
  private applyBuiltinBaseMapSeed(db: DatabaseSync): void {
    this.withTransaction(db, () => {
      const list = maybeJsonArray(builtinBaseMaps);
      this.upsertBaseMaps(db, 'builtin', list);
      const builtinIDs = list.map((tms) => String(tms.mapID)).filter(Boolean);
      if (builtinIDs.length > 0) {
        const placeholders = builtinIDs.map(() => '?').join(', ');
        db.prepare(`DELETE FROM base_maps WHERE scope = 'builtin' AND map_id NOT IN (${placeholders})`)
          .run(...builtinIDs);
      }
    });
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
    this.withTransaction(db, () => {
      const insert = db.prepare(
        `INSERT INTO maps (map_id, data_json, updated_at)
         SELECT ?, ?, datetime('now')
         WHERE NOT EXISTS (SELECT 1 FROM maps WHERE map_id = ?)`
      );
      for (const doc of docs) {
        if (!doc?._id) continue;
        insert.run(doc._id, JSON.stringify(normalizeMapDocument(doc)), doc._id);
      }
    });
  }

  // settings(または退避済み _settings)配下のユーザーベースマップ/個別地図の表示設定マイグレーション
  private async migrateUserBaseMaps(db: DatabaseSync): Promise<void> {
    const settingsDir = await this.resolveLegacyPath(this.folders.settingsDir, this.folders.retiredSettingsDir);
    const storeList = maybeJsonArray(SettingsService.get('tmsList'));
    if (isDefaultTmsList(storeList)) {
      storeList.length = 0;
    }

    // ファイル読み込み(非同期)を済ませてから、DB書き込みは1トランザクションで行う
    const userLists: any[][] = [];
    if (storeList.length > 0) userLists.push(storeList);
    const visibilityEntries: Array<{ mapID: string; baseMapId: string; enabled: boolean }> = [];
    if (settingsDir) {
      const userTmsListPath = path.join(settingsDir, 'tmsList.json');
      if (await fs.pathExists(userTmsListPath)) {
        userLists.push(maybeJsonArray(await fs.readJson(userTmsListPath)));
      }
      const files = await fs.readdir(settingsDir);
      for (const file of files) {
        const mapID = safeMapIDFromSpecificFile(file);
        if (!mapID) continue;
        const fileData = await fs.readJson(path.join(settingsDir, file));
        if (!fileData || typeof fileData !== 'object' || Array.isArray(fileData)) continue;
        for (const [baseMapId, enabled] of Object.entries(fileData)) {
          visibilityEntries.push({ mapID, baseMapId, enabled: Boolean(enabled) });
        }
      }
    }
    if (userLists.length === 0 && visibilityEntries.length === 0) return;

    this.withTransaction(db, () => {
      for (const list of userLists) {
        this.upsertBaseMaps(db, 'user', list);
      }
      const insertVisibility = db.prepare(
        `INSERT OR REPLACE INTO map_base_map_visibility (map_id, base_map_id, enabled, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      );
      for (const entry of visibilityEntries) {
        insertVisibility.run(entry.mapID, entry.baseMapId, entry.enabled ? 1 : 0);
      }
    });
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
