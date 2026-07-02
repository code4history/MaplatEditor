# MaplatEditor-next Future Plan

This document outlines potential future enhancements, features, and UI/UX improvements identified during the modernization of MaplatEditor to MaplatEditor-next.

## 1. Map-Specific Base Map Configuration UI
**Current state**: Base maps are appended via `tmsList.json` and map-specific suppression rules are defined in `tmsList.[mapID].json`. Both currently require manual JSON file editing inside the `settings` directory.
**Proposed improvement**: 
- Create a dedicated UI panel (e.g., in `MapEdit.vue` or a new `Settings.vue` tab) to let users visually toggle which base maps should be visible/available for the currently edited historical map.
- Migrate this configuration storage from standalone JSON files to the main database (e.g., NeDB or its successor) to ensure data integrity and easier querying.

## 2. Global Base Map Management UI
**Status**: Implemented (2026-07-02). The "ベースマップ追加" (Add Base Map) header tab opens `BaseMapList.vue`, which lets users Add/Edit/Delete user-defined TMS endpoints (stored in the DuckDB `base_maps` table with `scope = 'user'`) with attribution and max-zoom fields. Preview functionality remains a future enhancement.
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
