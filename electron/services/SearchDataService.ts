// Search Layer (ADR-0001/0003): 一覧・全文・位置情報検索を担当する。
// 既定はWrite Store(SQLite)のFTS5(日本語はIntl.Segmenterで分かち書き)+R-Tree索引。
// 索引はmaps/appsへの書き込みトリガで同一トランザクション更新されるため、
// 書き込み直後の検索反映(read-your-writes)が構造的に保証される。
// DuckDB経路(インメモリDuckDB + sqlite拡張のREAD_ONLYライブATTACH + JSフィルタ)も
// 温存しているが、node:sqliteとsqlite拡張の2つの独立したSQLite実装が同じ
// WAL共有メモリ(-shm)をmmapする構成となり、クラウド同期フォルダ上でSIGBUS
// クラッシュの実績があるため既定では使用しない(ADR-0001の追記参照)。
// DuckDB経路の再有効化: 環境変数 MAPLAT_SEARCH_ENGINE=duckdb
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import SqliteDataService, {
  appRowToDocument,
  mapRowToDocument,
  type AppListResult,
  type MapListResult,
} from './SqliteDataService';

export type { AppListResult, MapListResult } from './SqliteDataService';

const ATTACH_ALIAS = 'write_store';

// 遅延評価(呼び出しごと)にして、テストや再起動なしの切り替え検証を可能にする
function activeSearchEngine(): 'sqlite' | 'duckdb' {
  return process.env.MAPLAT_SEARCH_ENGINE === 'duckdb' ? 'duckdb' : 'sqlite';
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

function paginate(rawDocs: any[], page: number, pageSize: number): MapListResult {
  // pageSize<=0 は全件取得(ページネーションなし)
  if (pageSize <= 0) {
    return { docs: rawDocs, prev: false, next: false };
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

class SearchDataService {
  private connection: DuckDBConnection | null = null;
  private attachedFile: string | null = null;
  private extensionUnavailable = false;

  async reset(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.disconnectSync();
      } catch {
        // noop
      }
    }
    this.connection = null;
    this.attachedFile = null;
    this.extensionUnavailable = false;
  }

  // DuckDB経路が有効な場合のみ、Write Storeをアタッチ済みのDuckDB接続を返す。
  // それ以外(既定のsqliteモード、拡張が使えない環境)はnullを返しWrite Store直読みになる。
  private async getConnection(): Promise<DuckDBConnection | null> {
    if (activeSearchEngine() !== 'duckdb') return null;
    if (this.extensionUnavailable) return null;
    const sqliteFile = SqliteDataService.databaseFile;
    // Write Store側のファイル作成/マイグレーションを先に済ませる
    await SqliteDataService.getDb();
    if (this.connection && this.attachedFile === sqliteFile) return this.connection;

    await this.reset();
    try {
      const instance = await DuckDBInstance.create(':memory:');
      const connection = await instance.connect();
      await connection.run(`ATTACH '${sqliteFile.replace(/'/g, "''")}' AS ${ATTACH_ALIAS} (TYPE sqlite, READ_ONLY)`);
      this.connection = connection;
      this.attachedFile = sqliteFile;
      return connection;
    } catch (e) {
      console.error('[SearchDataService] DuckDB sqlite attach failed; falling back to Write Store scan', e);
      this.extensionUnavailable = true;
      this.connection = null;
      this.attachedFile = null;
      return null;
    }
  }

  private async readAllMapDocs(): Promise<any[]> {
    const connection = await this.getConnection();
    if (!connection) return SqliteDataService.readAllMaps();
    const reader = await connection.runAndReadAll(
      `SELECT uid, slug, data_json, revision FROM ${ATTACH_ALIAS}.maps ORDER BY slug`
    );
    return (reader.getRowObjectsJson() as any[]).map(mapRowToDocument);
  }

  private async readAllAppDocs(): Promise<any[]> {
    const connection = await this.getConnection();
    if (!connection) return SqliteDataService.readAllApps();
    const reader = await connection.runAndReadAll(
      `SELECT uid, slug, data_json, revision FROM ${ATTACH_ALIAS}.apps ORDER BY slug`
    );
    return (reader.getRowObjectsJson() as any[]).map(appRowToDocument);
  }

  async listMaps(query: string = '', page: number = 1, pageSize: number = 20): Promise<MapListResult> {
    if (activeSearchEngine() !== 'duckdb') {
      const rawDocs = await SqliteDataService.searchMaps(query);
      return paginate(rawDocs, page, pageSize);
    }
    let rawDocs = await this.readAllMapDocs();
    if (query && query.trim()) {
      rawDocs = rawDocs.filter((doc) =>
        ['title', 'officialTitle', 'description'].some(attr => checkLocaleAttr(doc[attr], query))
      );
    }
    return paginate(rawDocs, page, pageSize);
  }

  async listApps(query: string = '', page: number = 1, pageSize: number = 20): Promise<AppListResult> {
    if (activeSearchEngine() !== 'duckdb') {
      const rawDocs = await SqliteDataService.searchApps(query);
      return paginate(rawDocs, page, pageSize);
    }
    let rawDocs = await this.readAllAppDocs();
    if (query && query.trim()) {
      rawDocs = rawDocs.filter((doc) =>
        ['title', 'description', 'keywords'].some(attr => checkLocaleAttr(doc[attr], query)) ||
        checkLocaleAttr(doc.appName, query) ||
        checkLocaleAttr(doc.manifestSettings?.name, query) ||
        checkLocaleAttr(doc.manifestSettings?.shortName, query) ||
        new RegExp(query.trim(), 'i').test(doc.appID || doc._id || '')
      );
    }
    return paginate(rawDocs, page, pageSize);
  }

  async searchExtent(extent: number[]): Promise<string[]> {
    if (activeSearchEngine() !== 'duckdb') {
      return SqliteDataService.searchExtent(extent);
    }
    const docs = await this.readAllMapDocs();
    return docs
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
}

export default new SearchDataService();
