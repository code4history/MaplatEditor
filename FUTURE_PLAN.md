# MaplatEditor-next Future Plan

This document outlines potential future enhancements, features, and UI/UX improvements identified during the modernization of MaplatEditor to MaplatEditor-next.

## 1. Map-Specific Base Map Configuration UI
**Status**: Implemented (m11-t4 / m12-t10). The MapEdit "Select Base Maps" tab lets users
toggle which base maps are visible/available for the currently edited historical map
(`setBaseMapVisibilityForMapID`), backed by the SQLite `base_maps` table rather than
manual `tmsList.[mapID].json` editing. Legacy `tmsList.*.json` files are still read for
one-time migration of pre-existing settings.
**Previous state**: Base maps were appended via `tmsList.json` and map-specific
suppression rules were defined in `tmsList.[mapID].json`, both requiring manual JSON
file editing inside the `settings` directory.

## 2. Global Base Map Management UI
**Status**: Implemented (2026-07-02). The "ベースマップ追加" (Add Base Map) header tab opens `BaseMapList.vue`, which lets users Add/Edit/Delete user-defined TMS endpoints (stored in the SQLite `base_maps` table with `scope = 'user'`) with attribution and max-zoom fields. Preview functionality remains a future enhancement.
**Previous state**: The global list of custom base maps (`tms_list.json` in project root or `tmsList.json` in settings) was managed by manual file edits.

## 3. General UI/UX Modernization
**Current state**: The UI is being ported from a legacy Bootstrap 3/jQuery design to Vue 3/Bootstrap 5.
**Proposed improvements**:
- State management: Use Pinia for complex state sharing across components instead of heavy prop drilling or global window variables.
- Componentization: Break down monolithic files like `MapEdit.vue` into smaller, reusable components (e.g., `LayerSettings.vue`, `CoordinateEditor.vue`, `MapToolbar.vue`).

## 4. TIN計算の高速化（WASM化）
**現状**: TIN計算（Delaunay三角分割）は Electron のメインプロセス（Node.js）経由で `@maplat/tin` を実行しており、2000点超の大規模データで約7秒を要する。オリジナル実装と同等の速度ではあるが、実用的にはまだ遅い。  
**提案**: `@maplat/tin` のコア計算ロジックを WASM 化、あるいは高性能な Delaunay 実装（`d3-delaunay` + WASM ラッパー等）へ差し替えることで、大幅な高速化が見込まれる。

_Note: This document should be updated continuously as more areas for improvement are discovered during the porting process._

## 5. アプリ編集: ソース設定UIの拡張候補（2026-07-03のAppEdit改善時のスコープ外）
- mapbox / maplibre / google 系ソースタイプの専用編集UI（現状は既存データをパススルー保持するのみで、新規追加UIはない）
- 非矩形 envelope の編集（現状は矩形bbox近似のみ）
- エクスポートのZIP出力オプション、および出力後の簡易ローカルサーバでの動作確認機能
- pwa-asset-generator のダークモードスプラッシュ（appleLaunchImageDarkMode）対応

## 6. 地図原本タイル化のメモリ・実行時間（m5-t6 のスコープ外・実測あり）
**現状**: `MapUploadService.imageCutter` はタイル1枚ごとに `imageJimp.clone()` で
**原寸ビットマップ全体を複製**してから crop/resize する。複製はタイル数ぶん繰り返される。

m5-t6 の実装時に実測した値:

| 原本 | 原寸 RGBA | タイル総数 | タイル化時間 |
|---|---|---|---|
| 8000×6000（48 MP） | 約 183 MiB | 1025 | 41 秒 |
| 11000×10000（110 MP） | 約 420 MiB | 2314 | 155 秒 |

同じ実行での `process.memoryUsage()` のピークは heapUsed 88.7 MiB / external 2315.8 MiB。
Jimp のビットマップは Buffer（V8 ヒープ外）であるため V8 の old-space 上限には掛からないが、
実メモリと実行時間の観点では改善余地がある。実測トリガだった 470 MP の実画像では
1 クローンあたり約 1.75 GiB を複製することになる。

**提案**: クローンを介さず原寸ビットマップから直接タイル領域を読み出す（`crop` の対象を
複製ではなく元バッファのビューにする、またはストリーミング分割へ置き換える）。
m5-t6 はデコード設定の互換復元に閉じるスコープだったため触れていない。
