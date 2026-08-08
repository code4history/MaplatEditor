// Search Layer (ADR-0001/0003): 一覧・全文・位置情報検索を担当する。
// Write Store(SQLite)のFTS5(日本語はIntl.Segmenterで分かち書き)+R-Tree索引を使う。
// 索引はmaps/appsへの書き込みトリガで同一トランザクション更新されるため、
// 書き込み直後の検索反映(read-your-writes)が構造的に保証される。
//
// m18-t8(2026-08-09): DuckDB経路(インメモリDuckDB + sqlite拡張のREAD_ONLYライブATTACH)を撤去した。
// 撤去理由:
//   (1) 2026-07-04以降、既定から外れて休眠していた(node:sqliteとsqlite拡張の2つの独立した
//       SQLite実装が同じWAL共有メモリ(-shm)をmmapし、クラウド同期フォルダ上でSIGBUSクラッシュ)
//   (2) 実装がDuckDB固有の能力を一切使っていなかった。全件SELECTしてJS側でfilterするだけで、
//       FTSも空間SQLも未使用。既定のSQLite経路(FTS5+R-Tree)のほうが高機能だった
//   (3) DuckDBのnode-apiパッケージがasarの108MBを占めていた(実測。node_modules内で単独最大)
// 将来DuckDB側のSQLが必要になった場合は、ADR-0001が示すsnapshotアタッチ方式で新規に設計する。
import SqliteDataService, {
  type AppListResult,
  type MapListResult,
} from './SqliteDataService';

export type { AppListResult, MapListResult } from './SqliteDataService';




function paginate(rawDocs: any[], page: number, pageSize: number): MapListResult {
  // pageSize<=0 は全件取得(ページネーションなし)
  if (pageSize <= 0) {
    return { docs: rawDocs, prev: false, next: false, total: rawDocs.length };
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
    total: rawDocs.length,
  };
  if (pageUpdate !== undefined) result.pageUpdate = pageUpdate;
  return result;
}

class SearchDataService {
  // m18-t8: DuckDB接続をここで保持していたが撤去した。現在このクラスは状態を持たない。
  // reset() は公開APIとして残す — MapDataService.switchDataFolder() が
  // SqliteDataService.reset() と対で呼んでおり、シグネチャ互換を保つため。
  // 実体を持たなくなったので何もしない（データフォルダ切替時の実状態リセットは
  // 直後に呼ばれる SqliteDataService.reset() が担う）。
  async reset(): Promise<void> {
    // no-op（保持する状態が無い）
  }

  async listMaps(query: string = '', page: number = 1, pageSize: number = 20): Promise<MapListResult> {
    const rawDocs = await SqliteDataService.searchMaps(query);
    return paginate(rawDocs, page, pageSize);
  }

  async listApps(query: string = '', page: number = 1, pageSize: number = 20): Promise<AppListResult> {
    const rawDocs = await SqliteDataService.searchApps(query);
    return paginate(rawDocs, page, pageSize);
  }

  async searchExtent(extent: number[], kind: 'map' | 'poi-source' | 'app' = 'map'): Promise<string[]> {
    return SqliteDataService.searchExtent(extent, kind);
  }
}

export default new SearchDataService();
