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

### 6.1 取り込みの中断（キャンセル）導線 — m5-t8 のスコープ外

m5-t8 は取り込み前に所要時間の確認プロンプトを出すようにしたが、**一度始めた取り込みを
途中で止める導線は無い**。確認文言にも「開始すると途中で取り消せません」と明記している。

進行中のタイル化を安全に止めるには、`imageCutter` のタイル生成ループへ中断点を設け、
中断時の staging dir の後始末（部分的に書かれたタイルの扱い）を決める必要がある。
フロー構造の変更を伴うため m5-t8 では扱わず、高速化（m16）と同じ機会に検討する。

### 6.2 デコード所要時間は内容依存（m5-t8 の実測）

上表のタイル化時間は合成した平坦画像のものであり、**デコード時間のほうは内容に強く依存する**。

| 画像 | 内容 | デコード時間 | s/MP |
|---|---|---|---|
| 470 MP progressive（実測トリガの実画像） | 実写スキャン | 469 秒 | 1.00 |
| 110 MP baseline（合成・ほぼ平坦） | 合成 | 8.5 秒 | 0.077 |

**13 倍の開きがある。** ∴ 合成フィクスチャで測った係数を実写の見積もりへ持ち込んではならない。
m5-t8 の確認プロンプトが所要時間の**分数を表示しない**のはこのためである。

## 7. basemap_icons_512 の読み出し実装（m6-t4a のスコープ外）

**現状**: m6-t4a で `public/basemap_icons_512/{google_roadmap,google_satellite,google_hybrid,
google_terrain,mapbox,maplibre}.png` を新規配置したが、これを読み出す詳細プレビュー UI は
どこにも実装されていない。google/mapbox/maplibre は `builtin_base_maps.json` に登場せず
`thumbnail512` フィールド自体を持たないため、`resolveBaseMapListImage`
（`resourceImageResolver.ts:140`）にも512px分岐が無い。約2.6MBの参照されないアセットが
配置されるのみで、活用されるまで孤児化する。

**スコープの実際の大きさ（2026-08-06 実装レビューで判明）**: 上記6ファイルは氷山の一角で、
`public/basemap_icons_512/` ディレクトリ全体は **335ファイル・約117MB**（`du -sh` 実測）。
`electron/builtin_base_maps.json` の各エントリが持つ `thumbnail512` フィールド自体
（329件、`grep -c` 実測）は `src/`・`electron/` の `.ts`/`.vue` を全数 grep しても読み手が
一件も存在しない（`thumbnail512` という同名の別機能＝`MapEdit.vue`/`AppExportService.ts` の
登録地図512pxサムネイルとは無関係）。`pnpm build` の `dist/basemap_icons_512/` にもこの
117MBがそのまま同梱される。

**追加提案（人間指摘・2026-08-06）**: 512px を活かす UI の設計と併せて、画像圧縮
（PNG最適化・WebP化・遅延ロード等）を検討する。117MBは配布物サイズに直接効くため、
UI設計より前に「そもそも335ファイル全部を512pxで持つ必要があるか」を再検討する価値がある。

**提案**: 一覧行ホバー時またはクリック時の拡大プレビュー等、512px を活かす UI を後続タスクで
設計する。あわせて画像圧縮・配布サイズ削減の要否も同タスクで検討する。
