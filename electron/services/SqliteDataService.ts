// Write Store (ADR-0001): 全ての書き込みと単一レコード読みはSQLite(maplat.sqlite)が担う。
// WALモード+busy_timeoutにより、ロック保持は書き込みトランザクション中のみとなり、
// 複数エディタインスタンスの同時利用が可能。一覧/全文/位置情報検索は
// SearchDataService(インメモリDuckDBのsqlite ATTACH)が担当する。
//
// schema v2 (ADR-0007): 全アセット(map/app/base_map)の正本キーは不変の uid (UUIDv4)。
// ユーザー編集可能な slug は asset_registry がグローバル一意性を強制する
// (全ての slug 書込は registerAsset/renameAssetSlug を経由し、アセット表と同一Txで二重書きする)。
// 全 upsert は revision による楽観ロック。旧schema(v1) の DB ファイルは起動時に
// _maplat-v1.sqlite へ退避され、レガシー入力(nedb.db/settings)から再取込される。
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
import { generateUid, isValidSlug, resolveSlugCollision, type AssetKind } from './assetIdentity';

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
  uid: string;
  mapID: string;
  scope: BaseMapScope;
  enabled: boolean;
  locked: boolean;
  data: any;
}

export interface BaseMapCatalogItem {
  uid: string;
  mapID: string;
  scope: BaseMapScope;
  data: any;
  alwaysVisible: boolean;
  alwaysLocked: boolean;
}

// 楽観ロック(ADR-0007): expectedRevision 指定時に他の書き込みが先行していた場合に投げる
export class RevisionConflictError extends Error {
  readonly kind = 'revision-conflict';
  readonly current: number;
  constructor(current: number) {
    super(`Revision conflict: current revision is ${current}`);
    this.name = 'RevisionConflictError';
    this.current = current;
  }
}

interface Folders {
  saveFolder: string;
  settingsDir: string;
  retiredSettingsDir: string;
  sqliteFile: string;
  nedbFile: string;
  retiredNedbFile: string;
}

// レガシー移行の実行結果(slugサフィックス改名・ファイルリネーム・警告)。
// {saveFolder}/migration-report-v2.json に書かれ、後続タスクでレンダラに一覧表示される
export interface MigrationReport {
  renamedSlugs: Array<{ kind: AssetKind; from: string; to: string }>;
  renamedFiles: Array<{ from: string; to: string }>;
  warnings: string[];
}

const MIGRATION_REPORT_FILE = 'migration-report-v2.json';

const LEGACY_MIGRATION_ID = '2026-07-04-sqlite-write-store-legacy-import';
const SEARCH_INDEX_BACKFILL_ID = '2026-07-04-search-index-backfill';
// 表示設定オプトイン化(ADR-0006)のv1向け一括破棄。schema v2 の新規DBには
// オプトアウト時代の行が存在し得ないため no-op だが、旧コード経路が再実行
// されないよう marker のみ記録する
const OPT_IN_VISIBILITY_FLIP_ID = '2026-07-05-opt-in-base-map-visibility';

// 常時表示から外せないベースマップ(ビューア/エディタの最終フォールバック基盤)。slug で判定
const FORCED_ALWAYS_BASE_MAP_IDS = new Set(['osm']);

const ASSET_TABLES: Partial<Record<AssetKind, string>> = {
  map: 'maps',
  app: 'apps',
  base_map: 'base_maps',
};

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
  // _id は旧API互換(slug)。uid/slug/revision は v2 の正本メタデータ
  data._id = row.slug;
  data.uid = row.uid;
  data.slug = row.slug;
  data.revision = Number(row.revision);
  return data;
}

export function appRowToDocument(row: any): any {
  const data = JSON.parse(row.data_json);
  data._id = row.slug;
  data.appID = row.slug;
  data.uid = row.uid;
  data.slug = row.slug;
  data.revision = Number(row.revision);
  return data;
}

function normalizeMapDocument(document: any): any {
  // 言語別フィールドはDB内では常にオブジェクト形 (ADR-0005)。
  // nedb移行やインポート由来のプレーン文字列(=デフォルト言語の値)もここで正規化される
  const normalized = normalizeMapLangFields({ ...document });
  delete normalized._id;
  delete normalized.mapID;
  // 行レベルのメタデータは data_json に持たせない (ADR-0007)
  delete normalized.uid;
  delete normalized.slug;
  delete normalized.revision;
  return normalized;
}

function normalizeAppDocument(document: any): any {
  const normalized = normalizeRuntimeKeys(document);
  delete normalized._id;
  delete normalized.appID;
  delete normalized.uid;
  delete normalized.slug;
  delete normalized.revision;
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
    let db = new DatabaseSync(sqliteFile);
    // 旧schema(v1: maps.uid 列なし)のDBは書き換えずに退避し、新規v2 DBを作って
    // レガシー入力から再取込する(DBは未公開のため in-place migration は行わない)
    if (this.hasV1Schema(db)) {
      db.close();
      await this.retireV1Database(sqliteFile);
      db = new DatabaseSync(sqliteFile);
    }
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

  private hasV1Schema(db: DatabaseSync): boolean {
    const mapsTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'maps'")
      .get();
    if (!mapsTable) return false;
    const uidColumn = db
      .prepare("SELECT 1 FROM pragma_table_info('maps') WHERE name = 'uid'")
      .get();
    return uidColumn == null;
  }

  private async retireV1Database(sqliteFile: string): Promise<void> {
    const dir = path.dirname(sqliteFile);
    let to = path.join(dir, '_maplat-v1.sqlite');
    let suffix = 2;
    while (await fs.pathExists(to)) {
      to = path.join(dir, `_maplat-v1.${suffix}.sqlite`);
      suffix++;
    }
    await fs.move(sqliteFile, to, { overwrite: false });
    // WAL/SHM は退避先のDBとは無関係になるため削除する(retire後に本体だけ読む分には不要)
    await fs.remove(`${sqliteFile}-wal`);
    await fs.remove(`${sqliteFile}-shm`);
    console.log(`[SqliteDataService] Retired v1-schema database to ${to}`);
  }

  // 複数書き込みを1コミットに束ねる。node:sqliteは同期実行のため、コミット(fsync)を
  // 行数分繰り返すとメインプロセスのイベントループ(=プレビューHTTPサーバ等)が長時間停止する。
  // BEGIN IMMEDIATE で書き込みロックを先頭で取得する: 遅延BEGINだと read→write 昇格
  // (registerAssetの事前SELECT→INSERT等)が複数インスタンス並走時にリトライ不能な
  // SQLITE_BUSY_SNAPSHOT になりうるが、先頭取得なら busy_timeout=5000 で直列化できる
  private withTransaction<T>(db: DatabaseSync, fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
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
      CREATE TABLE IF NOT EXISTS asset_registry (
        uid  TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS maps (
        uid TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        data_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS apps (
        uid TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        data_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS base_maps (
        uid TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS map_base_map_visibility (
        map_uid TEXT NOT NULL,
        base_map_uid TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (map_uid, base_map_uid)
      );
      CREATE TABLE IF NOT EXISTS base_map_always (
        base_map_uid TEXT PRIMARY KEY,
        always_visible INTEGER NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    this.applySearchIndexSchema(db);
    // builtin base maps を最初に登録し、レガシー取込より先に clean slug を確保する (ADR-0007)
    this.applyBuiltinBaseMapSeed(db);

    // オプトイン化(ADR-0006)の一括破棄は v1 schema 向け。v2 新規DBでは no-op として marker のみ記録
    const visibilityFlipped = db
      .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
      .get(OPT_IN_VISIBILITY_FLIP_ID);
    if (!visibilityFlipped) {
      db.prepare('INSERT OR REPLACE INTO schema_migrations (id) VALUES (?)').run(OPT_IN_VISIBILITY_FLIP_ID);
    }

    // レガシー移行は初回のみ。退避アーカイブ(_nedb.db/_settings)は残り続けるため、
    // 「入力ファイルの有無」ではなく「移行を実際に実行するか」で進捗通知を判定する
    const alreadyMigrated = db
      .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
      .get(LEGACY_MIGRATION_ID);
    if (alreadyMigrated) return;

    const notifyProgress = await this.hasLegacyMigrationInputs();
    const report: MigrationReport = { renamedSlugs: [], renamedFiles: [], warnings: [] };
    try {
      if (notifyProgress) sendMigrationProgress('database.migrating', 0);
      if (notifyProgress) sendMigrationProgress('database.migrating_legacy_maps', 25, '(1/3)');
      const nedbDocs = await this.loadLegacyMapDocs();
      if (notifyProgress) sendMigrationProgress('database.migrating_legacy_basemaps', 50, '(2/3)');
      const baseMapInputs = await this.loadLegacyBaseMapInputs();
      // DB書き込みは marker まで含めて1トランザクション(途中失敗時の部分取込を防ぐ)
      const mapIdToUid = this.withTransaction(db, () => {
        const imported = this.importLegacyMaps(db, nedbDocs, report);
        this.importLegacyBaseMaps(db, baseMapInputs, imported, report);
        db.prepare('INSERT OR REPLACE INTO schema_migrations (id) VALUES (?)').run(LEGACY_MIGRATION_ID);
        return imported;
      });
      // 以降のファイル操作はDBコミット後のベストエフォート: marker はコミット済みのため、
      // ここで throw すると一時的な失敗(OneDriveのファイルロック等)により退避もreportも
      // 以後の起動で永久にスキップされてしまう。失敗は warning として report に残す
      await this.renameLegacyMapFiles(mapIdToUid, report);
      if (notifyProgress) sendMigrationProgress('database.archiving_legacy_files', 75, '(3/3)');
      try {
        await this.retireLegacyDataFiles();
      } catch (e: any) {
        const warning = `legacy input retirement failed: ${e?.message ?? e}`;
        report.warnings.push(warning);
        console.warn(`[SqliteDataService] ${warning}`);
      }
      // report は移行を実際に実行した時のみ書く(退避アーカイブだけが残る2回目以降の起動では書かない)。
      // report 自体の書き込み失敗も migrate() を失敗させない(移行本体はコミット済みのため)
      if (notifyProgress) {
        try {
          await fs.writeJson(path.join(this.folders.saveFolder, MIGRATION_REPORT_FILE), report, { spaces: 2 });
        } catch (e) {
          console.error('[SqliteDataService] failed to write migration report', e);
        }
      }
      if (notifyProgress) sendMigrationProgress('database.migrated', 100, '(3/3)');
    } catch (e) {
      if (notifyProgress) sendMigrationProgress('database.migration_failed', 100);
      throw e;
    }
  }

  // 全文検索(FTS5)/位置情報検索(R-Tree)の索引スキーマとトリガ。
  // maps/appsへの書き込み(経路を問わず)でトリガが発火し、JSトークナイザで
  // 分かち書きした全文索引とbbox索引が同一トランザクション内で更新される。
  // raw には slug も含める(slug rename は行UPDATEなのでトリガで索引が追随する)。
  private applySearchIndexSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS maps_fts USING fts5(uid UNINDEXED, raw UNINDEXED, words);
      CREATE VIRTUAL TABLE IF NOT EXISTS apps_fts USING fts5(uid UNINDEXED, raw UNINDEXED, words);
      CREATE VIRTUAL TABLE IF NOT EXISTS maps_rtree USING rtree(id, min_x, max_x, min_y, max_y);
      CREATE TABLE IF NOT EXISTS maps_rtree_key (
        uid TEXT PRIMARY KEY,
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
        DELETE FROM maps_fts WHERE uid = new.uid;
        INSERT INTO maps_fts(uid, raw, words)
          VALUES (new.uid,
                  new.slug || char(10) || maplat_map_fts_raw(new.data_json),
                  maplat_tokenize(new.slug || ' ' || maplat_map_fts_raw(new.data_json)));
        DELETE FROM maps_rtree WHERE id IN (SELECT rid FROM maps_rtree_key WHERE uid = new.uid);
        DELETE FROM maps_rtree_key WHERE uid = new.uid;
        INSERT INTO maps_rtree_key(uid, rid)
          SELECT new.uid, new.rowid WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
        INSERT INTO maps_rtree(id, min_x, max_x, min_y, max_y)
          SELECT new.rowid,
                 json_extract(maplat_map_bbox(new.data_json), '$[0]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[2]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[1]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[3]')
          WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
      END;

      CREATE TRIGGER maps_search_au AFTER UPDATE ON maps BEGIN
        DELETE FROM maps_fts WHERE uid IN (old.uid, new.uid);
        INSERT INTO maps_fts(uid, raw, words)
          VALUES (new.uid,
                  new.slug || char(10) || maplat_map_fts_raw(new.data_json),
                  maplat_tokenize(new.slug || ' ' || maplat_map_fts_raw(new.data_json)));
        DELETE FROM maps_rtree WHERE id IN (SELECT rid FROM maps_rtree_key WHERE uid IN (old.uid, new.uid));
        DELETE FROM maps_rtree_key WHERE uid IN (old.uid, new.uid);
        INSERT INTO maps_rtree_key(uid, rid)
          SELECT new.uid, new.rowid WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
        INSERT INTO maps_rtree(id, min_x, max_x, min_y, max_y)
          SELECT new.rowid,
                 json_extract(maplat_map_bbox(new.data_json), '$[0]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[2]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[1]'),
                 json_extract(maplat_map_bbox(new.data_json), '$[3]')
          WHERE maplat_map_bbox(new.data_json) IS NOT NULL;
      END;

      CREATE TRIGGER maps_search_ad AFTER DELETE ON maps BEGIN
        DELETE FROM maps_fts WHERE uid = old.uid;
        DELETE FROM maps_rtree WHERE id IN (SELECT rid FROM maps_rtree_key WHERE uid = old.uid);
        DELETE FROM maps_rtree_key WHERE uid = old.uid;
      END;

      CREATE TRIGGER apps_search_ai AFTER INSERT ON apps BEGIN
        DELETE FROM apps_fts WHERE uid = new.uid;
        INSERT INTO apps_fts(uid, raw, words)
          VALUES (new.uid,
                  new.slug || char(10) || maplat_app_fts_raw(new.data_json),
                  maplat_tokenize(new.slug || ' ' || maplat_app_fts_raw(new.data_json)));
      END;

      CREATE TRIGGER apps_search_au AFTER UPDATE ON apps BEGIN
        DELETE FROM apps_fts WHERE uid IN (old.uid, new.uid);
        INSERT INTO apps_fts(uid, raw, words)
          VALUES (new.uid,
                  new.slug || char(10) || maplat_app_fts_raw(new.data_json),
                  maplat_tokenize(new.slug || ' ' || maplat_app_fts_raw(new.data_json)));
      END;

      CREATE TRIGGER apps_search_ad AFTER DELETE ON apps BEGIN
        DELETE FROM apps_fts WHERE uid = old.uid;
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
        INSERT INTO maps_fts(uid, raw, words)
          SELECT uid,
                 slug || char(10) || maplat_map_fts_raw(data_json),
                 maplat_tokenize(slug || ' ' || maplat_map_fts_raw(data_json))
          FROM maps;
        INSERT INTO maps_rtree_key(uid, rid)
          SELECT uid, rowid FROM maps WHERE maplat_map_bbox(data_json) IS NOT NULL;
        INSERT INTO maps_rtree(id, min_x, max_x, min_y, max_y)
          SELECT rowid,
                 json_extract(maplat_map_bbox(data_json), '$[0]'),
                 json_extract(maplat_map_bbox(data_json), '$[2]'),
                 json_extract(maplat_map_bbox(data_json), '$[1]'),
                 json_extract(maplat_map_bbox(data_json), '$[3]')
          FROM maps WHERE maplat_map_bbox(data_json) IS NOT NULL;
        INSERT INTO apps_fts(uid, raw, words)
          SELECT uid,
                 slug || char(10) || maplat_app_fts_raw(data_json),
                 maplat_tokenize(slug || ' ' || maplat_app_fts_raw(data_json))
          FROM apps;
        INSERT OR REPLACE INTO schema_migrations (id) VALUES ('${SEARCH_INDEX_BACKFILL_ID}');
        COMMIT;
      `);
    }
  }

  // --- asset registry (ADR-0007) ---
  // 全ての slug 書込はこの2つを経由し、アセット表側の書込と同一トランザクションで行う

  private registerAsset(db: DatabaseSync, kind: AssetKind, uid: string, slug: string): void {
    if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
    const taken = db.prepare('SELECT uid FROM asset_registry WHERE slug = ?').get(slug) as any;
    if (taken) throw new Error(`Slug already in use: ${slug}`);
    db.prepare('INSERT INTO asset_registry (uid, kind, slug) VALUES (?, ?, ?)').run(uid, kind, slug);
  }

  private renameAssetSlug(db: DatabaseSync, kind: AssetKind, uid: string, slug: string): void {
    if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
    const taken = db.prepare('SELECT uid FROM asset_registry WHERE slug = ?').get(slug) as any;
    if (taken && taken.uid !== uid) throw new Error(`Slug already in use: ${slug}`);
    const updated = db.prepare('UPDATE asset_registry SET slug = ? WHERE uid = ? AND kind = ?').run(slug, uid, kind);
    // registry行が無い/kind不一致はアセット表とregistryのドリフト。黙って進めず失敗させる
    if (Number(updated.changes) !== 1) {
      throw new Error(`Asset registry drift: no ${kind} registry row for uid ${uid} (renaming to "${slug}")`);
    }
    const table = ASSET_TABLES[kind];
    if (table) {
      db.prepare(`UPDATE ${table} SET slug = ?, updated_at = datetime('now') WHERE uid = ?`).run(slug, uid);
    }
  }

  private slugTaken(db: DatabaseSync, slug: string): boolean {
    return db.prepare('SELECT 1 FROM asset_registry WHERE slug = ?').get(slug) != null;
  }

  private registryUid(db: DatabaseSync, kind: AssetKind, slug: string): string | null {
    const row = db.prepare('SELECT uid FROM asset_registry WHERE slug = ? AND kind = ?').get(slug, kind) as any;
    return row ? String(row.uid) : null;
  }

  async isSlugAvailable(slug: string, excludeUid?: string): Promise<boolean> {
    const db = await this.getDb();
    const row = db.prepare('SELECT uid FROM asset_registry WHERE slug = ?').get(slug) as any;
    if (!row) return true;
    return excludeUid != null && String(row.uid) === excludeUid;
  }

  // --- maps / apps 共通CRUD内部実装 ---

  private createDocRow(db: DatabaseSync, kind: 'map' | 'app', slug: string, dataJson: string): string {
    const table = ASSET_TABLES[kind]!;
    const uid = generateUid();
    this.withTransaction(db, () => {
      this.registerAsset(db, kind, uid, slug);
      db.prepare(
        `INSERT INTO ${table} (uid, slug, data_json, revision, updated_at)
         VALUES (?, ?, ?, 1, datetime('now'))`
      ).run(uid, slug, dataJson);
      if (kind === 'map') this.adoptProvisionalVisibility(db, uid, slug);
    });
    return uid;
  }

  private upsertDocRow(
    db: DatabaseSync,
    kind: 'map' | 'app',
    uid: string,
    slug: string,
    dataJson: string,
    expectedRevision?: number,
  ): number {
    const table = ASSET_TABLES[kind]!;
    return this.withTransaction(db, () => {
      const existing = db.prepare(`SELECT slug, revision FROM ${table} WHERE uid = ?`).get(uid) as any;
      if (!existing) {
        this.registerAsset(db, kind, uid, slug);
        db.prepare(
          `INSERT INTO ${table} (uid, slug, data_json, revision, updated_at)
           VALUES (?, ?, ?, 1, datetime('now'))`
        ).run(uid, slug, dataJson);
        if (kind === 'map') this.adoptProvisionalVisibility(db, uid, slug);
        return 1;
      }
      const currentRevision = Number(existing.revision);
      if (expectedRevision != null && currentRevision !== expectedRevision) {
        throw new RevisionConflictError(currentRevision);
      }
      if (String(existing.slug) !== slug) {
        this.renameAssetSlug(db, kind, uid, slug);
      }
      const where = expectedRevision != null ? 'WHERE uid = ? AND revision = ?' : 'WHERE uid = ?';
      const params: any[] = expectedRevision != null ? [slug, dataJson, uid, expectedRevision] : [slug, dataJson, uid];
      const result = db.prepare(
        `UPDATE ${table}
         SET slug = ?, data_json = ?, revision = revision + 1, updated_at = datetime('now')
         ${where}`
      ).run(...params);
      if (Number(result.changes) === 0) {
        const now = db.prepare(`SELECT revision FROM ${table} WHERE uid = ?`).get(uid) as any;
        throw new RevisionConflictError(Number(now?.revision ?? 0));
      }
      return currentRevision + 1;
    });
  }

  // 未保存の地図slug宛に置かれた暫定表示設定(map_uid=slug)を、地図作成時にuidキーへ引き継ぐ
  private adoptProvisionalVisibility(db: DatabaseSync, uid: string, slug: string): void {
    db.prepare(
      `DELETE FROM map_base_map_visibility
       WHERE map_uid = ? AND base_map_uid IN
         (SELECT base_map_uid FROM map_base_map_visibility WHERE map_uid = ?)`
    ).run(slug, uid);
    db.prepare('UPDATE map_base_map_visibility SET map_uid = ? WHERE map_uid = ?').run(uid, slug);
  }

  // --- maps ---

  async findMap(uid: string): Promise<any | null> {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT uid, slug, data_json, revision FROM maps WHERE uid = ?')
      .get(uid) as any;
    return row ? mapRowToDocument(row) : null;
  }

  async findMapBySlug(slug: string): Promise<any | null> {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT uid, slug, data_json, revision FROM maps WHERE slug = ?')
      .get(slug) as any;
    return row ? mapRowToDocument(row) : null;
  }

  async createMap(slug: string, document: any): Promise<{ uid: string }> {
    const db = await this.getDb();
    const uid = this.createDocRow(db, 'map', slug, JSON.stringify(normalizeMapDocument(document)));
    return { uid };
  }

  async upsertMap(uid: string, slug: string, document: any, expectedRevision?: number): Promise<{ revision: number }> {
    const db = await this.getDb();
    const revision = this.upsertDocRow(
      db, 'map', uid, slug, JSON.stringify(normalizeMapDocument(document)), expectedRevision
    );
    return { revision };
  }

  async deleteMap(uid: string): Promise<void> {
    const db = await this.getDb();
    this.withTransaction(db, () => {
      db.prepare('DELETE FROM maps WHERE uid = ?').run(uid);
      db.prepare('DELETE FROM asset_registry WHERE uid = ?').run(uid);
      db.prepare('DELETE FROM map_base_map_visibility WHERE map_uid = ?').run(uid);
    });
  }

  // 互換ラッパー: Phase1 Task5-7 で呼び出し側を uid 化した後に撤去 (plan 2026-07-08)
  async upsertMapBySlug(slug: string, document: any): Promise<{ uid: string; revision: number }> {
    const existing = await this.findMapBySlug(slug);
    if (existing) {
      const { revision } = await this.upsertMap(existing.uid, slug, document);
      return { uid: existing.uid, revision };
    }
    const { uid } = await this.createMap(slug, document);
    return { uid, revision: 1 };
  }

  // 互換ラッパー: Phase1 Task5-7 で呼び出し側を uid 化した後に撤去 (plan 2026-07-08)
  async deleteMapBySlug(slug: string): Promise<void> {
    const existing = await this.findMapBySlug(slug);
    if (existing) await this.deleteMap(existing.uid);
  }

  // 互換ラッパー: Phase1 Task5-7 で呼び出し側を uid 化した後に撤去 (plan 2026-07-08)
  async isMapIdAvailable(mapID: string): Promise<boolean> {
    return this.isSlugAvailable(mapID);
  }

  async readAllMaps(): Promise<any[]> {
    const db = await this.getDb();
    const rows = db
      .prepare('SELECT uid, slug, data_json, revision FROM maps ORDER BY slug')
      .all() as any[];
    return rows.map(mapRowToDocument);
  }

  // --- apps ---

  async findApp(uid: string): Promise<any | null> {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT uid, slug, data_json, revision FROM apps WHERE uid = ?')
      .get(uid) as any;
    return row ? appRowToDocument(row) : null;
  }

  async findAppBySlug(slug: string): Promise<any | null> {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT uid, slug, data_json, revision FROM apps WHERE slug = ?')
      .get(slug) as any;
    return row ? appRowToDocument(row) : null;
  }

  async createApp(slug: string, document: any): Promise<{ uid: string }> {
    const db = await this.getDb();
    const uid = this.createDocRow(db, 'app', slug, JSON.stringify(normalizeAppDocument(document)));
    return { uid };
  }

  async upsertApp(uid: string, slug: string, document: any, expectedRevision?: number): Promise<{ revision: number }> {
    const db = await this.getDb();
    const revision = this.upsertDocRow(
      db, 'app', uid, slug, JSON.stringify(normalizeAppDocument(document)), expectedRevision
    );
    return { revision };
  }

  async deleteApp(uid: string): Promise<void> {
    const db = await this.getDb();
    this.withTransaction(db, () => {
      db.prepare('DELETE FROM apps WHERE uid = ?').run(uid);
      db.prepare('DELETE FROM asset_registry WHERE uid = ?').run(uid);
    });
  }

  // 互換ラッパー: Phase1 Task5-7 で呼び出し側を uid 化した後に撤去 (plan 2026-07-08)
  async upsertAppBySlug(slug: string, document: any): Promise<{ uid: string; revision: number }> {
    const existing = await this.findAppBySlug(slug);
    if (existing) {
      const { revision } = await this.upsertApp(existing.uid, slug, document);
      return { uid: existing.uid, revision };
    }
    const { uid } = await this.createApp(slug, document);
    return { uid, revision: 1 };
  }

  // 互換ラッパー: Phase1 Task5-7 で呼び出し側を uid 化した後に撤去 (plan 2026-07-08)
  async deleteAppBySlug(slug: string): Promise<void> {
    const existing = await this.findAppBySlug(slug);
    if (existing) await this.deleteApp(existing.uid);
  }

  // 互換ラッパー: Phase1 Task5-7 で呼び出し側を uid 化した後に撤去 (plan 2026-07-08)
  async isAppIdAvailable(appID: string): Promise<boolean> {
    return this.isSlugAvailable(appID);
  }

  async readAllApps(): Promise<any[]> {
    const db = await this.getDb();
    const rows = db
      .prepare('SELECT uid, slug, data_json, revision FROM apps ORDER BY slug')
      .all() as any[];
    return rows.map(appRowToDocument);
  }

  // --- search (FTS5 / R-Tree) ---

  // 各検索語: FTS5トークン一致(分かち書き後の単語AND) ∪ raw部分一致(従来の部分文字列検索の互換)。
  // 複数語はAND(積集合)。戻り値 null は「検索語なし=絞り込みなし」。
  private searchUids(
    db: DatabaseSync,
    table: 'maps_fts' | 'apps_fts',
    query: string,
  ): string[] | null {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;
    let result: Set<string> | null = null;
    for (const term of terms) {
      const uids = new Set<string>();
      const match = ftsMatchExpression(term);
      if (match) {
        const rows = db.prepare(`SELECT uid AS id FROM ${table} WHERE ${table} MATCH ?`).all(match) as any[];
        for (const row of rows) uids.add(String(row.id));
      }
      const rows = db
        .prepare(`SELECT uid AS id FROM ${table} WHERE raw LIKE ? ESCAPE '\\'`)
        .all(`%${escapeLike(term)}%`) as any[];
      for (const row of rows) uids.add(String(row.id));
      if (result === null) {
        result = uids;
      } else {
        const previous: Set<string> = result;
        result = new Set([...previous].filter((id) => uids.has(id)));
      }
      if (result.size === 0) return [];
    }
    return [...(result as Set<string>)].sort();
  }

  private readDocsByUids(
    db: DatabaseSync,
    table: 'maps' | 'apps',
    uids: string[],
    rowToDocument: (row: any) => any,
  ): any[] {
    const docs: any[] = [];
    for (let i = 0; i < uids.length; i += 500) {
      const chunk = uids.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT uid, slug, data_json, revision FROM ${table} WHERE uid IN (${placeholders}) ORDER BY slug`)
        .all(...chunk) as any[];
      docs.push(...rows.map(rowToDocument));
    }
    return docs;
  }

  async searchMaps(query: string): Promise<any[]> {
    const db = await this.getDb();
    const uids = this.searchUids(db, 'maps_fts', query);
    if (uids === null) return this.readAllMaps();
    if (uids.length === 0) return [];
    return this.readDocsByUids(db, 'maps', uids, mapRowToDocument);
  }

  async searchApps(query: string): Promise<any[]> {
    const db = await this.getDb();
    const uids = this.searchUids(db, 'apps_fts', query);
    if (uids === null) return this.readAllApps();
    if (uids.length === 0) return [];
    return this.readDocsByUids(db, 'apps', uids, appRowToDocument);
  }

  // extent = [minX, minY, maxX, maxY](メルカトル座標)。bbox交差する地図のslugを返す
  // (レンダラ互換: 呼び出し側のuid化はPhase1 Task5で行う)
  async searchExtent(extent: number[]): Promise<string[]> {
    const db = await this.getDb();
    const rows = db
      .prepare(`
        SELECT m.slug AS id
        FROM maps_rtree r
        JOIN maps_rtree_key k ON k.rid = r.id
        JOIN maps m ON m.uid = k.uid
        WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
        ORDER BY m.slug
      `)
      .all(extent[0], extent[2], extent[1], extent[3]) as any[];
    return rows.map((row) => String(row.id));
  }

  // --- base maps ---
  // 内部キーはuid。公開APIはレンダラ互換のためslug(mapID)を受け取り、内部で解決する
  // (呼び出し側のuid化はPhase1 Task7で行う)

  async getTmsListOfMapID(mapID: string): Promise<any[]> {
    const items = await this.getBaseMapVisibilityOfMapID(mapID);
    return items.filter((item) => item.enabled).map((item) => item.data);
  }

  // 常時表示のユーザー上書き(base_map_always)。ビルトイン再シードの影響を受けない
  private alwaysOverrides(db: DatabaseSync): Map<string, boolean> {
    const rows = db.prepare('SELECT base_map_uid, always_visible FROM base_map_always').all() as any[];
    return new Map(rows.map((row) => [String(row.base_map_uid), Boolean(row.always_visible)]));
  }

  // 実効の常時表示: OSM(slug判定)は強制true、他は上書き(uidキー)があればそれ、なければ定義のalways
  // (ビルトインではgsi/gsi_orthoのみtrue)
  private effectiveAlways(slug: string, uid: string, tms: any, overrides: Map<string, boolean>): boolean {
    if (FORCED_ALWAYS_BASE_MAP_IDS.has(slug)) return true;
    const override = overrides.get(uid);
    return override != null ? override : Boolean(tms?.always);
  }

  private findBaseMapBySlug(db: DatabaseSync, slug: string, scope?: BaseMapScope): any | null {
    if (scope) {
      return db
        .prepare('SELECT uid, slug, scope, sort_order, data_json FROM base_maps WHERE slug = ? AND scope = ?')
        .get(slug, scope) as any;
    }
    return db
      .prepare('SELECT uid, slug, scope, sort_order, data_json FROM base_maps WHERE slug = ?')
      .get(slug) as any;
  }

  // 地図の表示設定キー: 保存済みの地図はuid、未保存の地図はslugを仮キーとして使う
  // (地図の初回保存時に adoptProvisionalVisibility がuidキーへ引き継ぐ)
  private visibilityRowsForMapSlug(db: DatabaseSync, mapSlug: string): Map<string, boolean> {
    const mapUid = this.registryUid(db, 'map', mapSlug);
    const rows = db
      .prepare('SELECT map_uid, base_map_uid, enabled FROM map_base_map_visibility WHERE map_uid IN (?, ?)')
      .all(mapSlug, mapUid ?? mapSlug) as any[];
    const visibility = new Map<string, boolean>();
    // slug仮キーの行 → uidキーの行の順で上書き(uidキー優先)
    for (const row of rows.filter((r) => String(r.map_uid) === mapSlug)) {
      visibility.set(String(row.base_map_uid), Boolean(row.enabled));
    }
    if (mapUid) {
      for (const row of rows.filter((r) => String(r.map_uid) === mapUid)) {
        visibility.set(String(row.base_map_uid), Boolean(row.enabled));
      }
    }
    return visibility;
  }

  async getBaseMapVisibilityOfMapID(mapID: string): Promise<BaseMapVisibilityItem[]> {
    const db = await this.getDb();
    const baseMapRows = db
      .prepare(`
        SELECT uid, slug, scope, sort_order, data_json
        FROM base_maps
        ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END, sort_order, slug
      `)
      .all() as any[];
    const visibility = this.visibilityRowsForMapSlug(db, mapID);
    const overrides = this.alwaysOverrides(db);

    // オプトイン方式(ADR-0006): 明示的に選択したものだけ表示(未設定=非表示)。
    // 常時表示のベースマップは選択に依らず表示され、地図単位では外せない
    const items: BaseMapVisibilityItem[] = [];
    for (const row of baseMapRows) {
      const tms = JSON.parse(row.data_json);
      const locked = this.effectiveAlways(String(row.slug), String(row.uid), tms, overrides);
      items.push({
        uid: String(row.uid),
        mapID: String(row.slug),
        scope: row.scope,
        enabled: locked ? true : Boolean(visibility.get(String(row.uid)) ?? false),
        locked,
        data: tms,
      });
    }
    return items;
  }

  async setBaseMapVisibilityForMapID(mapID: string, baseMapId: string, enabled: boolean): Promise<void> {
    const db = await this.getDb();
    const base = this.findBaseMapBySlug(db, baseMapId);
    if (!base) {
      console.warn(`[SqliteDataService] setBaseMapVisibilityForMapID: unknown base map ${baseMapId}`);
      return;
    }
    const tms = JSON.parse(base.data_json);
    if (this.effectiveAlways(String(base.slug), String(base.uid), tms, this.alwaysOverrides(db))) return;
    // 未保存の地図はslugを仮キーに置く(初回保存時にuidキーへ引き継がれる)
    const mapKey = this.registryUid(db, 'map', mapID) ?? mapID;
    db.prepare(
      `INSERT OR REPLACE INTO map_base_map_visibility (map_uid, base_map_uid, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(mapKey, base.uid, enabled ? 1 : 0);
  }

  async listBaseMaps(): Promise<BaseMapCatalogItem[]> {
    const db = await this.getDb();
    const overrides = this.alwaysOverrides(db);
    const rows = db
      .prepare(`
        SELECT uid, slug, scope, data_json
        FROM base_maps
        ORDER BY CASE scope WHEN 'builtin' THEN 0 ELSE 1 END, sort_order, slug
      `)
      .all() as any[];
    return rows.map((row: any) => {
      const data = JSON.parse(row.data_json);
      return {
        uid: String(row.uid),
        mapID: String(row.slug),
        scope: row.scope,
        data,
        alwaysVisible: this.effectiveAlways(String(row.slug), String(row.uid), data, overrides),
        alwaysLocked: FORCED_ALWAYS_BASE_MAP_IDS.has(String(row.slug)),
      };
    });
  }

  async setBaseMapAlways(baseMapId: string, always: boolean): Promise<void> {
    if (FORCED_ALWAYS_BASE_MAP_IDS.has(baseMapId)) {
      throw new Error(`Base map cannot be removed from always-visible: ${baseMapId}`);
    }
    const db = await this.getDb();
    const base = this.findBaseMapBySlug(db, baseMapId);
    if (!base) throw new Error(`Unknown base map: ${baseMapId}`);
    db.prepare(
      `INSERT OR REPLACE INTO base_map_always (base_map_uid, always_visible, updated_at)
       VALUES (?, ?, datetime('now'))`
    ).run(base.uid, always ? 1 : 0);
  }

  // originalMapID: 既存ユーザーベースマップの改名時に旧slugを渡す。
  // uidが正本キーになったため、改名しても表示設定(map_base_map_visibility)と
  // 常時表示設定(base_map_always)の付け替えは不要(旧v1のカスケードは撤去済み)。
  // 衝突検査はasset_registryのグローバル一意性に一本化(旧grandfathering不要:
  // レガシーのID重複はマイグレーション時にslugサフィックスで解消される)
  async saveUserBaseMap(tms: any, originalMapID?: string): Promise<void> {
    const slug = String(tms?.mapID ?? '').trim();
    if (!slug) throw new Error('mapID is required');
    const db = await this.getDb();
    const sourceSlug = String(originalMapID ?? '').trim() || slug;
    const existing = this.findBaseMapBySlug(db, sourceSlug, 'user');

    if (existing) {
      const renaming = sourceSlug !== slug;
      this.withTransaction(db, () => {
        if (renaming) this.renameAssetSlug(db, 'base_map', String(existing.uid), slug);
        db.prepare(
          `UPDATE base_maps SET slug = ?, data_json = ?, updated_at = datetime('now') WHERE uid = ?`
        ).run(slug, JSON.stringify({ ...tms, mapID: slug }), existing.uid);
      });
      return;
    }

    const next = db
      .prepare(`SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM base_maps WHERE scope = 'user'`)
      .get() as any;
    const sortOrder = Number(next.next_order);
    this.withTransaction(db, () => {
      const uid = generateUid();
      // slug衝突(ビルトイン/Maplat地図/アプリ含むグローバルnamespace)はregisterAssetが拒否する
      this.registerAsset(db, 'base_map', uid, slug);
      db.prepare(
        `INSERT INTO base_maps (uid, slug, scope, sort_order, data_json, revision, updated_at)
         VALUES (?, ?, 'user', ?, ?, 1, datetime('now'))`
      ).run(uid, slug, sortOrder, JSON.stringify({ ...tms, mapID: slug }));
    });
  }

  async deleteUserBaseMap(baseMapId: string): Promise<void> {
    const db = await this.getDb();
    const existing = this.findBaseMapBySlug(db, baseMapId, 'user');
    if (!existing) return;
    this.withTransaction(db, () => {
      this.deleteBaseMapRow(db, String(existing.uid));
    });
  }

  private deleteBaseMapRow(db: DatabaseSync, uid: string): void {
    db.prepare('DELETE FROM base_maps WHERE uid = ?').run(uid);
    db.prepare('DELETE FROM asset_registry WHERE uid = ?').run(uid);
    db.prepare('DELETE FROM map_base_map_visibility WHERE base_map_uid = ?').run(uid);
    db.prepare('DELETE FROM base_map_always WHERE base_map_uid = ?').run(uid);
  }

  // --- migration internals ---

  // ビルトインベースマップは起動ごとに builtin_base_maps.json(正本: KTGISカタログ)から再シードする。
  // 既存行はビルトインID(通常 slug=data_json.mapID=カタログID)でマッチしてuidを維持し、
  // 新規のみuid採番+registry登録する(シードはレガシー取込より先に走るため、
  // ビルトインは常にclean slugを確保する)。data_json.mapID は常に slug と一致させる
  private applyBuiltinBaseMapSeed(db: DatabaseSync): void {
    this.withTransaction(db, () => {
      const list = maybeJsonArray(builtinBaseMaps);
      const findByBuiltinId = db.prepare(
        `SELECT uid, slug FROM base_maps WHERE scope = 'builtin' AND json_extract(data_json, '$.mapID') = ?`
      );
      const update = db.prepare(
        `UPDATE base_maps SET sort_order = ?, data_json = ?, updated_at = datetime('now') WHERE uid = ?`
      );
      const insert = db.prepare(
        `INSERT INTO base_maps (uid, slug, scope, sort_order, data_json, revision, updated_at)
         VALUES (?, ?, 'builtin', ?, ?, 1, datetime('now'))`
      );
      // 今回のシードで維持/作成した行のuid。カタログから外れた行の判定に使う
      // (data_json.mapID での判定は、slugサフィックス時に自分自身を消してしまうため不可)
      const seededUids = new Set<string>();
      for (let index = 0; index < list.length; index++) {
        const tms = list[index];
        const builtinId = String(tms?.mapID ?? '');
        if (!builtinId) continue;
        const existing = findByBuiltinId.get(builtinId) as any;
        if (existing) {
          // 既存行は data_json.mapID = slug の不変条件を保って内容を更新する
          update.run(index, JSON.stringify({ ...tms, mapID: String(existing.slug) }), existing.uid);
          seededUids.add(String(existing.uid));
          continue;
        }
        const uid = generateUid();
        // 通常はclean slug=ビルトインID。万一先取りされていた場合のみサフィックスで回避する
        // (サフィックスされた行は次回起動でカタログIDと再マッチできず作り直しになるが、
        //  「新規ビルトイン追加より前にユーザーがそのIDを先取りしていた」場合のみの縮退)
        const slug = resolveSlugCollision(builtinId, (s) => this.slugTaken(db, s));
        this.registerAsset(db, 'base_map', uid, slug);
        insert.run(uid, slug, index, JSON.stringify({ ...tms, mapID: slug }));
        seededUids.add(uid);
      }
      // カタログから外れたビルトインは行・registry・関連設定ごと削除する
      const staleRows = db
        .prepare(`SELECT uid FROM base_maps WHERE scope = 'builtin'`)
        .all() as any[];
      for (const row of staleRows) {
        if (!seededUids.has(String(row.uid))) {
          this.deleteBaseMapRow(db, String(row.uid));
        }
      }
    });
  }

  // nedb.db(または退避済み _nedb.db)のMaplat地図ドキュメントを読み込む
  private async loadLegacyMapDocs(): Promise<any[]> {
    const nedbFile = await this.resolveLegacyPath(this.folders.nedbFile, this.folders.retiredNedbFile);
    if (!nedbFile) return [];
    const store = new Datastore({ filename: nedbFile, autoload: true });
    return await new Promise<any[]>((resolve, reject) => {
      store.find({}).sort({ _id: 1 }).exec((err: any, documents: any[]) => {
        if (err) reject(err);
        else resolve(documents);
      });
    });
  }

  // レガシー地図の取込(ADR-0007): uid採番 + slug=旧_id(衝突時サフィックス→report記録)。
  // 戻り値は 旧ID→uid の対応(表示設定の解決とtiles/tmbsリネームに使う)
  private importLegacyMaps(db: DatabaseSync, docs: any[], report: MigrationReport): Map<string, string> {
    const mapIdToUid = new Map<string, string>();
    const insert = db.prepare(
      `INSERT INTO maps (uid, slug, data_json, revision, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'))`
    );
    for (const doc of docs) {
      if (!doc?._id) continue;
      const oldId = String(doc._id);
      if (mapIdToUid.has(oldId)) continue;
      const slug = resolveSlugCollision(oldId, (s) => this.slugTaken(db, s));
      if (slug !== oldId) report.renamedSlugs.push({ kind: 'map', from: oldId, to: slug });
      const uid = generateUid();
      this.registerAsset(db, 'map', uid, slug);
      insert.run(uid, slug, JSON.stringify(normalizeMapDocument(doc)));
      mapIdToUid.set(oldId, uid);
    }
    return mapIdToUid;
  }

  // tiles/tmbs の内部ファイル名を uid へ揃える(ADR-0007)。DBコミット後に実行し、
  // 個々の失敗は移行を止めず report.warnings に記録する
  private async renameLegacyMapFiles(mapIdToUid: Map<string, string>, report: MigrationReport): Promise<void> {
    const { saveFolder } = this.folders;
    const moveIfExists = async (fromRel: string, toRel: string) => {
      const from = path.join(saveFolder, fromRel);
      const to = path.join(saveFolder, toRel);
      try {
        if (!(await fs.pathExists(from))) return;
        if (await fs.pathExists(to)) {
          report.warnings.push(`rename skipped (destination exists): ${fromRel} -> ${toRel}`);
          return;
        }
        await fs.move(from, to, { overwrite: false });
        report.renamedFiles.push({ from: fromRel, to: toRel });
      } catch (e: any) {
        report.warnings.push(`rename failed: ${fromRel} -> ${toRel} (${e?.message ?? e})`);
      }
    };
    for (const [oldId, uid] of mapIdToUid) {
      // サムネイル正本は tmbs/{id}.jpg だが、取り込み元によっては png/jpeg もありうる
      for (const ext of ['jpg', 'jpeg', 'png']) {
        await moveIfExists(`tmbs/${oldId}.${ext}`, `tmbs/${uid}.${ext}`);
      }
      await moveIfExists(`tiles/${oldId}`, `tiles/${uid}`);
    }
  }

  // settings(または退避済み _settings)配下のユーザーベースマップ/個別地図の表示設定を読み込む
  private async loadLegacyBaseMapInputs(): Promise<{
    userLists: any[][];
    visibilityEntries: Array<{ mapID: string; baseMapId: string; enabled: boolean }>;
  }> {
    const settingsDir = await this.resolveLegacyPath(this.folders.settingsDir, this.folders.retiredSettingsDir);
    const storeList = maybeJsonArray(SettingsService.get('tmsList'));
    if (isDefaultTmsList(storeList)) {
      storeList.length = 0;
    }

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
    return { userLists, visibilityEntries };
  }

  // レガシーのユーザーベースマップ/表示設定の取込(ADR-0007):
  // ベースマップはuid採番 + slug=旧ID(衝突時サフィックス→report記録)。
  // 表示設定は旧IDを地図uid/ベースマップuidへ解決し、どちらかが不明なら警告して読み飛ばす
  private importLegacyBaseMaps(
    db: DatabaseSync,
    inputs: { userLists: any[][]; visibilityEntries: Array<{ mapID: string; baseMapId: string; enabled: boolean }> },
    mapIdToUid: Map<string, string>,
    report: MigrationReport,
  ): void {
    const { userLists, visibilityEntries } = inputs;
    if (userLists.length === 0 && visibilityEntries.length === 0) return;

    const baseIdToUid = new Map<string, string>();
    const next = db
      .prepare(`SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM base_maps WHERE scope = 'user'`)
      .get() as any;
    let sortOrder = Number(next.next_order);
    const insert = db.prepare(
      `INSERT INTO base_maps (uid, slug, scope, sort_order, data_json, revision, updated_at)
       VALUES (?, ?, 'user', ?, ?, 1, datetime('now'))`
    );
    const update = db.prepare(
      `UPDATE base_maps SET data_json = ?, updated_at = datetime('now') WHERE uid = ?`
    );
    for (const list of userLists) {
      for (const tms of list) {
        const oldId = String(tms?.mapID ?? '');
        if (!oldId) continue;
        const known = baseIdToUid.get(oldId);
        if (known) {
          // 複数入力(electron-store設定とsettings/tmsList.json)に同一IDがある場合は後勝ちで内容更新
          const knownSlug = (db.prepare('SELECT slug FROM base_maps WHERE uid = ?').get(known) as any)?.slug;
          update.run(JSON.stringify({ ...tms, mapID: knownSlug }), known);
          continue;
        }
        const slug = resolveSlugCollision(oldId, (s) => this.slugTaken(db, s));
        if (slug !== oldId) report.renamedSlugs.push({ kind: 'base_map', from: oldId, to: slug });
        const uid = generateUid();
        this.registerAsset(db, 'base_map', uid, slug);
        insert.run(uid, slug, sortOrder++, JSON.stringify({ ...tms, mapID: slug }));
        baseIdToUid.set(oldId, uid);
      }
    }

    const insertVisibility = db.prepare(
      `INSERT OR REPLACE INTO map_base_map_visibility (map_uid, base_map_uid, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    );
    for (const entry of visibilityEntries) {
      const mapUid = mapIdToUid.get(entry.mapID)
        ?? (db.prepare('SELECT uid FROM maps WHERE slug = ?').get(entry.mapID) as any)?.uid;
      // ベースマップは旧ID優先(取込時サフィックスの影響を受けない)、次にslug(ビルトイン等)
      const baseUid = baseIdToUid.get(entry.baseMapId)
        ?? (this.findBaseMapBySlug(db, entry.baseMapId)?.uid as string | undefined);
      if (!mapUid || !baseUid) {
        const warning =
          `legacy visibility skipped (unknown ${!mapUid ? 'map' : 'base map'}): ` +
          `${entry.mapID} / ${entry.baseMapId}`;
        report.warnings.push(warning);
        console.warn(`[SqliteDataService] ${warning}`);
        continue;
      }
      insertVisibility.run(String(mapUid), String(baseUid), entry.enabled ? 1 : 0);
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
