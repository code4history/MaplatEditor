# M11-T8: 全文・空間検索 / App Coverage / 2カラムselector / GCP auto range

## 版情報

| 項目 | 内容 |
|---|---|
| タスクID | M11-T8 |
| 分類 | new feature |
| 依存タスク | M11-T6, M11-T7 |
| 責務 | 5一覧の全文/空間検索統合、App Coverage自動計算、2カラムselector共通化、GCP auto range |
| 版 | 3.1 (実装追従 + 状態モデル規範表追加) |
| 作成日 | 2026-07-16 |

## サブタスク構成

| ID | 名称 | 分類 | 依存 |
|---|---|---|---|
| T8-1 | SearchLayer 統合 / FTS5拡張 | adaptation | T6,T7 |
| T8-2 | Spatial search (R-Tree) 拡張 | new feature | T8-1 |
| T8-3 | App Coverage 自動計算 | new feature | T8-1 |
| T8-4 | 2カラム ResourceSelector 共通化 | adaptation | T8-1 |
| T8-5 | GCP Auto Range | new feature | T8-1 |

## 状態モデル規範

**`coverageLngLats` は手動値専用。自動計算結果をこのフィールドに書き込まない。**
この規範は App Coverage 自動計算の全実装に対して優先し、逸脱は禁止する。

| 項目 | 保持場所 | 書き込み者 | 備考 |
|---|---|---|---|
| 手動カバレッジ | `appData.coverageLngLats` | `applyAppCoverage()` (AppEdit)、`EnvelopeEditorModal` | Viewer 出力に含めない Editor-only メタデータ |
| 自動計算カバレッジ | `useAppCoverageAutoCalc.autoCoverage` (composable 内部 ref) | composable の `calc()` | テンプレートは `coverageLngLats ?? autoCoverage` で表示 |
| 地図参照UID集合 | composable 内 `mapUidsString` (JSON.stringify で watch) | appData.sources 変更検知 | 変更時のみ IPC 発火。deep watch 不使用 |
| 自動モード切替 | composable 内 `isAuto` (ref\<boolean\>) | `manualOverride()` → false, `clear()` → true | `coverageLngLats` に連動しない独立状態 |

### 逸脱検出事項（実装時に特に注意）

- `autoCoverage` 値を `coverageLngLats` に流し込む watcher/applyAppCoverage 呼び出しは **禁止**
- `coverageLngLats` がセットされていることを `isAuto` 判定に使うのは **禁止**（独立状態）
- アプリを開いただけで dirty 化 + undo 履歴汚染を引き起こす書き込みは **禁止**

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
| 差異 | apps_rtree/poi_sources_rtree 追加（既存 maps と同様に `*_rtree` + `*_rtree_key` + トリガの二層構造を踏襲）。searchExtent を全リソース対応に拡張。maplat_app_bbox UDF は coverageLngLats を mercator bbox に変換して apps_rtree に投入。 |

### T8-3: App Coverage 自動計算

| 項目 | 内容 |
|---|---|
| 参照元 | `src/views/AppEdit.vue:105,456-458` / `cont` 手動設定のみ |
| 現状 | `coverageLngLats` は手動設定のみ。自動導出ロジックなし。 |
| 差異 | 新規 composable `useAppCoverageAutoCalc` を追加。自動導出は構成地図の mercator bbox の和集合に対して +5% バッファを付与した経緯度4頂点多角形。自動値は `coverageLngLats` に書き込まず composable 内部の `autoCoverage` ref に保持。テンプレートは `coverageLngLats ?? autoCoverage` で表示。 |

### T8-4: 2カラム selector

| 項目 | 内容 |
|---|---|
| 参照元 | `AppEdit.vue:1298-1407` / `PoiReferenceEditor.vue:1-330` |
| 現状 | 2カラム layout は CSS grid で独立実装。共通 component なし。左 pane の検索は client-side 全文書。 |
| 差異 | `ResourceSelector` 共通 component を追加。slot ベースのレイアウトシェルとして機能し、`#list` / `#selected` slot で左右ペインを差し替え可能。AppEdit と PoiReferenceEditor の 2カラム grid CSS を削除し共通化。 |

### T8-5: GCP Auto Range

| 項目 | 内容 |
|---|---|
| 参照元 | `MapEdit.vue:2239-2251` (`gcpLngLatBbox` インライン関数) |
| 現状 | 単一ファイルスコープの関数。composable/service 切り出しなし。 |
| 差異 | `useGcpAutoRange` composable に抽出。gcps を watch し mercator → 経緯度 bbox を自動計算。`bbox` ref で結果を公開。MapEdit.vue のインライン関数を削除し composable 経由に統合。 |

## 契約

### IPC API 拡張

| チャンネル | 引数 | 戻り値 | 備考 |
|---|---|---|---|
| `search:maps` | `{ q?: string, bbox?: [number,number,number,number], page: number, pageSize: number }` | `SearchResult<any>` | 既存 maplist:request を統一 |
| `search:apps` | 同上 | 同上 | 既存 applist:request を統一 |
| `search:poiSources` | 同上 | 同上 | 既存 poisource:list を拡張 |
| `search:baseMaps` | 同上 | 同上 | 新規 FTS5 |
| `search:imageAssets` | 同上 | 同上 | 新規 FTS5 |
| `search:extent` | `kind, bbox` | `string[]` | 空間検索（kind='map'\|'poi-source'\|'app'） |
| `search:appCoverage` | `appUid: string, mapUids?: string[]` | `{ coverageLngLats: [number,number][], maps: number } \| null` | mapUids 省略時は appUid で DB 検索、指定時は直接マップ検索 |

### Preload API 拡張

```typescript
interface SearchResult<T> {
  docs: T[];
  total: number;
  prev?: number;
  next?: number;
}

interface SearchAPI {
  maps(filter: SearchFilter): Promise<SearchResult<any>>;
  apps(filter: SearchFilter): Promise<SearchResult<any>>;
  poiSources(filter: SearchFilter): Promise<SearchResult<any>>;
  baseMaps(filter: SearchFilter): Promise<SearchResult<any>>;
  imageAssets(filter: SearchFilter): Promise<SearchResult<any>>;
  searchExtent(kind: 'map' | 'poi-source' | 'app', bbox: [number,number,number,number]): Promise<string[]>;
  appCoverage(appUid: string, mapUids?: string[]): Promise<{ coverageLngLats: [number,number][]; maps: number } | null>;
}

type SearchFilter = { q?: string; bbox?: [number,number,number,number]; page: number; pageSize: number };
```

### Composable API

```typescript
// GCP Auto Range
interface UseGcpAutoRangeOptions {
  gcps: Ref<any[]>;
  onAutoRange?: (bbox: [number,number,number,number] | null) => void;
}
interface UseGcpAutoRangeReturn {
  bbox: Ref<[number,number,number,number] | null>;
  isAuto: Ref<boolean>;
  manualOverride: (bbox: [number,number,number,number] | null) => void;
  clear: () => void;
}

// App Coverage Auto Calc
interface UseAppCoverageAutoCalcOptions {
  appDoc: Ref<Record<string, any> | null>;
}
interface UseAppCoverageAutoCalcReturn {
  autoCoverage: Ref<[number,number][] | null>;  // 自動計算結果。coverageLngLats には書かない
  isAuto: Ref<boolean>;                         // 自動モードフラグ（coverageLngLats に連動しない独立状態）
  manualOverride: (lngLats: [number,number][] | null) => void;  // 将来の UI 配線用（現在未使用）
  clear: () => void;                            // 自動モード復帰（将来の UI 配線用）
  refresh: () => void;                          // 明示的再計算（onMounted 後のロード完了時に呼ぶ）
}
```

## リアクティビティ設計

### App Coverage Auto Calc

| トリガー | 検知方法 | 動作 |
|---|---|---|
| appData 差し替え（load/undo/redo） | `watch(() => options.appDoc.value, …)` | 全体参照変更 → calc() 発火 |
| sources 内の mapUid 集合変更 | `watch(() => JSON.stringify(mapUids(doc)), …)` | 文字列比較で変更検知 → calc() 発火 |
| 初回ロード完了 | `onMounted` 内 `appCoverageAuto.refresh()` | 明示トリガー |
| 手動 override 設定 | `manualOverride(lngLats)` | isAuto = false, autoCoverage = lngLats |
| clear 実行 | `clear()` | isAuto = true, calc() 発火 |

### mapUids 文字列監視（deep watch 不使用）

```typescript
function mapUids(doc): string[] {
  return doc.sources
    .filter(s => s.sourceType === 'maplat')
    .map(s => s.mapUid || s.mapID || s.map_id || '')
    .filter(Boolean)
    .sort()
}
// watch(() => JSON.stringify(mapUids(doc)), calc)
```

### GCP Auto Range

| トリガー | 検知方法 | 動作 |
|---|---|---|
| GCP 配列変更 | `watch(gcps, calc, { deep: true })` | bbox 再計算 |
| 手動 override 設定 | `manualOverride(bbox)` | isAuto = false, bbox = value |
| clear 実行 | `clear()` | isAuto = true, calc() 発火 |

### testDebug ゲート（§3.2）

```typescript
// preload.ts
contextBridge.exposeInMainWorld('isE2E', Boolean(process.env.MAPLAT_E2E_ROOT))

// AppEdit.vue (renderer)
if (typeof window !== 'undefined' && (window as any).isE2E) {
  (window as any).testDebug = { appData, applyAppCoverage, appCoverageAuto };
}
```

本番ビルドでは `MAPLAT_E2E_ROOT` が未設定のため `isE2E=false`、`testDebug` は作成されない。

## ヘッダー被り検証基準（§5）

| 項目 | 値 |
|---|---|
| 検出方法 | 600px 幅でのタブ遷移後に `boundingRect` 比較 |
| 検証対象 | 隣接タブ要素間の Y 座標重なり（bottom > next.top） |
| 検証手順 | 600px 幅にリサイズ → タブ遷移 → 各タブ要素の getBoundingClientRect() → 隣接比較 |

## 受け入れ条件

| AC | 内容 | 検証手段 |
|---|---|---|
| AC1 | 5一覧全てが FTS5 全文検索できる | E2E |
| AC2 | 地図一覧が bbox 空間検索できる | E2E |
| AC3 | App Coverage 手動設定が従来通り動作する | E2E |
| AC4 | App Coverage 自動導出（地図の和集合+バッファ）が表示される | E2E |
| AC5 | 2カラム selector が共通 component で動作する | E2E |
| AC6 | Selector 左 pane が FTS5 検索 + 無限 scroll である | E2E |
| AC7 | GCP auto range が有効 GCP の bbox+5% buffer を計算する | E2E |
| AC8 | GCP auto range の手動 override → clear で auto 復帰する | E2E |
| AC9 | 既存 T1-T7 E2E が回帰しない | 全回帰 |
| AC10 | pnpm run build, vue-tsc が pass する | typecheck |
| AC11 | 600px 幅でヘッダータブが折り返さず重ならない | E2E |
| AC12 | autoCoverage 値が coverageLngLats に書き込まれない（状態モデル規範準拠） | E2E |

## Design Self-Check

- [x] 版情報整合（v3.1）
- [x] 契約一意性（IPC table, Preload API, Composable API が実装と一致）
- [x] stateファイル同期（task-state.json が最新設計版を指している）
- [x] 既存実装参照完遂
- [x] parity/adaptation 判断の正当性: T8-1/T8-4 は adaptation、残りは new feature
- [x] 状態モデル規範表 完備（coverageLngLats 手動専用の明文化）
- [x] 逸脱検出事項 完備
- [x] ゲート記述 完備（testDebug = isE2E 環境変数）
- [x] ヘッダー被り検証基準 完備（600px + boundingRect）