# M11-T8: 全文・空間検索 / App Coverage / 2カラムselector / GCP auto range

## 版情報

| 項目 | 内容 |
|---|---|
| タスクID | M11-T8 |
| 分類 | new feature |
| 依存タスク | M11-T6, M11-T7 |
| 責務 | 5一覧の全文/空間検索統合、App Coverage自動計算、2カラムselector共通化、GCP auto range |
| 版 | 2 (Minor指摘反映) |
| 作成日 | 2026-07-16 |

## サブタスク構成

| ID | 名称 | 分類 | 依存 |
|---|---|---|---|
| T8-1 | SearchLayer 統合 / FTS5拡張 | adaptation | T6,T7 |
| T8-2 | Spatial search (R-Tree) 拡張 | new feature | T8-1 |
| T8-3 | App Coverage 自動計算 | new feature | T8-1 |
| T8-4 | 2カラム ResourceSelector 共通化 | adaptation | T8-1 |
| T8-5 | GCP Auto Range | new feature | T8-1 |

## 既存実装参照

### T8-1: SearchLayer 統合

| 項目 | 内容 |
|---|---|
| 参照元 | `electron/services/SearchDataService.ts:1-178` / `SqliteDataService.ts:996-1106` |
| 現状 | FTS5 は maps/apps/poi_sources のみ。base_maps/assets は FTS5 対象外。SearchDataService は listMaps/listApps のみ提供。 |
| 差異 | base_maps/assets の FTS5 追加。SearchDataService に統合 list/search メソッド追加。 |

### T8-2: Spatial search 拡張

| 項目 | 内容 |
|---|---|
| 参照元 | `SqliteDataService.ts:1765-1778` (`searchExtent`) |
| 現状 | R-Tree は maps のみ。apps/poi_sources は空間インデックスなし。searchExtent は maps slug 配列のみ返す。 |
| 差異 | apps_rtree/poi_sources_rtree 追加（既存 maps と同様に `*_rtree` + `*_rtree_key` + トリガの二層構造を踏襲）。searchExtent を全リソース対応に拡張。 |

### T8-3: App Coverage 自動計算

| 項目 | 内容 |
|---|---|
| 参照元 | `src/views/AppEdit.vue:105,456-458` / `cont` 手動設定のみ |
| 現状 | `coverageLngLats` は手動設定のみ。自動導出ロジックなし。 |
| 差異 | 新規 composable `useAppCoverageAutoCalc` を追加。自動導出（構成地図の bbox に対して +5% のバッファを付与した4頂点多角形を coverageLngLats に適用する） + override + clear を実装。 |

### T8-4: 2カラム selector

| 項目 | 内容 |
|---|---|
| 参照元 | `AppEdit.vue:1298-1407` / `PoiReferenceEditor.vue:1-330` |
| 現状 | 2カラム layout は CSS grid で独立実装。共通 component なし。左 pane の検索は client-side 全文書。 |
| 差異 | `ResourceSelector` 共通 component + adapter パターンに統一。左 pane 検索を FTS5 経由に。 |

### T8-5: GCP Auto Range

| 項目 | 内容 |
|---|---|
| 参照元 | `MapEdit.vue:2239-2251` (`gcpLngLatBbox` インライン関数) |
| 現状 | 単一ファイルスコープの関数。composable/service 切り出しなし。 |
| 差異 | `useGcpAutoRange` composable に抽出。bbox 自動計算 + 手動 override + clear。 |

## 契約

### IPC API 拡張

| チャンネル | 引数 | 戻り値 | 備考 |
|---|---|---|---|
| `search:maps` | `{ q?: string, bbox?: [number,number,number,number], page: number, pageSize: number }` | `SearchResult<any>` | 既存 maplist:request を統一 |
| `search:apps` | 同上 | 同上 | 既存 applist:request を統一 |
| `search:poiSources` | 同上 | 同上 | 既存 poisource:list を拡張 |
| `search:baseMaps` | 同上 | 同上 | 新規 FTS5 |
| `search:imageAssets` | 同上 | 同上 | 新規 FTS5 |
| `search:appCoverage` | `{ appUid: string }` | `{ coverageLngLats: [number,number][], maps: number } \| null` | App Coverage 自動導出 (Info#2) |

### Preload API 拡張

```typescript
interface SearchResult<T> {
  docs: T[];
  total: number;
  prev?: number;
  next?: number;
}

interface SearchAPI {
  list<T>(kind: SearchKind, filter: ResourceListFilter, page: number, pageSize: number): Promise<SearchResult<T>>;
  searchExtent<T>(kind: SearchKind, bbox: [number,number,number,number]): Promise<string[]>;
}
type SearchKind = 'map' | 'app' | 'poi-source' | 'base-map' | 'image-asset';
```

### Composable API

```typescript
// GCP Auto Range
interface UseGcpAutoRangeOptions {
  onAutoRange: (bbox: [number,number,number,number] | null) => void;
}
interface UseGcpAutoRangeReturn {
  bbox: Ref<[number,number,number,number] | null>;
  isAuto: Ref<boolean>;
  manualOverride: (bbox: [number,number,number,number] | null) => void;
  clear: () => void;
}

// App Coverage Auto Calc
interface UseAppCoverageAutoCalcOptions {
  appDoc: Ref<AppDocument>;
}
interface UseAppCoverageAutoCalcReturn {
  autoCoverage: Ref<[number,number][] | null>;
  isAuto: Ref<boolean>;
  manualOverride: (lngLats: [number,number][] | null) => void;
  clear: () => void;
}
```

## リアクティビティ設計

| トリガー | 影響 | 備考 |
|---|---|---|
| GCP 編集 | auto range bbox 再計算 (triggerRef) | watch で GCP 配列変更検出 |
| App 地図追加/削除 | auto coverage 再計算 (triggerRef) | watch appData.sources |
| 手動 override 設定 | isAuto = false, auto 追従停止 | |
| clear 実行 | isAuto = true, 再計算開始 | |

## 受け入れ条件

| AC | 内容 | 検証手段 |
|---|---|---|
| AC1 | 5一覧全てが FTS5 全文検索できる | E2E |
| AC2 | 地図一覧が bbox 空間検索できる | E2E |
| AC3 | App Coverage 手動設定が従来通り動作する | E2E |
| AC4 | App Coverage 自動導出（地図の和集合+バッファ）が明示範囲なし時に適用される | E2E |
| AC5 | 2カラム selector が共通 component で動作する | E2E |
| AC6 | Selector 左 pane が FTS5 検索 + 無限 scroll である | E2E |
| AC7 | GCP auto range が有効 GCP の bbox+5% buffer を計算する | E2E |
| AC8 | GCP auto range の手動 override → clear で auto 復帰する | E2E |
| AC9 | 既存 T1-T7 E2E が回帰しない | 全回帰 |
| AC10 | pnpm run build, vue-tsc が pass する | typecheck |

## Design Self-Check

- [x] 版情報整合
- [x] 契約一意性
- [x] stateファイル同期（task-state.json が最新設計版を指している）
- [x] 既存実装参照完遂
- [x] parity/adaptation 判断の正当性: T8-1/T8-4 は adaptation（既存 FTS5 / 2カラムの統一）、残りは new feature
