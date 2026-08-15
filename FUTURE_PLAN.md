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

**m19-t6 で解消済み（2026-08-09）。**

**旧状態**: `MapUploadService.imageCutter` はタイル1枚ごとに `imageJimp.clone()` で
**原寸ビットマップ全体を複製**してから crop/resize していた。複製はタイル数ぶん繰り返され、
コストは `タイル数 × 原寸` ∝ 面積² だった（旧 Electron 版 `backend/src/mapupload.js:123` から
引き継いだ形であり、移植時の劣化ではない）。

**対処**: m19-t6 で `cropRegionBitmap`（原寸バッファから矩形だけを行単位で取り出す純関数）へ
置き換えた。`crop` の分岐条件（`x===0 && w===width` ならバッファの view）をそのまま保つため、
**出力タイルはバイト単位で変わらない**（`pnpm smoke:m19-t6-tile-cut-clone-reduction` が
実 `imageCutter` の出力と旧経路の出力を全ファイル sha256 で突き合わせる）。
あわせて、デコード後に不要となる圧縮元バッファの参照を落とすようにした。

抽出ステップのみの A/B（4096×4096・341 タイル・同一プロセス／同一入力。上記 smoke が毎回再計測する）:

| 指標 | 旧（clone + crop） | 新（cropRegionBitmap） | 比 |
|---|---|---|---|
| 所要時間 | 4602 ms | 84 ms | 54.8 倍 |
| 抽出のための新規確保 累計 | 22,080.0 MiB | 256.0 MiB | 86.3 倍 |
| 抽出時のピーク live（会計値） | 144.0 MiB | 80.0 MiB | 0.556 |

**注意**: 所要時間の行は最終確認実行の値（task-state の `AC-P1` と同じ実行）であり、
**実行機と負荷に依存する観測値**である。同一実装でも 設計時 2660 → 54 ms（49.6 倍）/
実装中 2911 → 59 ms（49.3 倍）/ レビュアー実測 3085 → 65 ms / 最終確認 4602 → 84 ms（54.8 倍）
と幅が出る。∴ この行の絶対値を基準に使ってはならない。合否は smoke が毎回再計測する比
（しきい値 5 倍）で決まる。下 2 行は会計値であり実行間で決定的で、設計時実測とも完全一致する。

end-to-end のタイル化時間（`pnpm smoke:m5-t6-large-image-decode-limits` の観測値）:

| 原本 | 原寸 RGBA | タイル総数 | タイル化時間（m5-t6 時点の記録） | タイル化時間（m19-t6 後の実測） |
|---|---|---|---|---|
| 8000×6000（48 MP） | 約 183 MiB | 1025 | 41 秒 | **29.7 秒** |
| 11000×10000（110 MP） | 約 420 MiB | 2314 | 155 秒 | **57.1 秒** |

**注意**: 旧側の記録は実行機・実行時期が異なる（同じ 48 MP に対し本表の 41 秒と
`scripts/m5-t6-large-image-decode-limits-smoke.mjs` ヘッダの約 65 秒という 1.6 倍の食い違いがある）。
∴ 上表の end-to-end 列は**観測記録**であって合否のしきい値ではない。m19-t6 の受け入れ条件は
同一プロセス A/B の 3 指標のほうである。

**残る余地**: end-to-end の残りは resize / JPEG エンコード / タイルごとの 1 ms スリープ / IPC が
占める。抽出は面積²で効いていたため画素数が増えるほど比が大きくなるはずだが、
**470 MP の実画像での end-to-end は未実測**である（デコードだけで約 8 分かかるため smoke に載せていない）。
デコード時間そのものの短縮は §6.2 のとおり別問題として残る。

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

## 8. smoke 56本に残る `@duckdb` の esbuild external 指定（m18-t8 のスコープ外）

**現状**: `scripts/` 配下の **56ファイル**（`grep -rl "@duckdb" scripts/ | wc -l` 実測）が esbuild の
`external` に `'@duckdb/node-api'` / `'@duckdb/node-bindings'` / `/^@duckdb\/node-bindings-.*/` を
列挙している。m18-t8 で依存そのものを撤去したため、これらは**不活性な no-op** になった。

**なぜ m18-t8 で触らなかったか**: 56ファイルを一括編集すると、安全確認のため同数の smoke 再実走が
必要になり、費用対効果が悪い。指定が残っていても実害はない（存在しないモジュール名を external に
挙げても esbuild は何もしない）。

**提案**: 別途まとめて機械置換し、代表的な smoke を数本走らせて確認する。放置しても壊れないが、
削除済みの依存を参照する死んだ設定は後続の読み手を惑わせる。

## 9. merc の実行時タイル URL 導出が2実装で並立している（m22-t1 のスコープ外）

**現状**: merc ベースマップの実行時タイル URL（`{saveFolder}/merc/{uid}/{z}/{x}/{y}.png`）を
組み立てる実装が **2箇所**ある。

| # | 実装 | 宛先 | percent-encoding |
|---|---|---|---|
| a | `electron/utils/mercBaseMapTileUrl.ts` の `deriveMercBaseMapTileUrl`（m22-t1 で新設） | IPC の item レベル `url_` → `MapEdit.vue` / `PoiEditMap.vue` の `mapSourceFactory` | **あり**（`file-url` を通す） |
| b | `src/components/basemap/BaseMapEdit.vue:1031-1039` の `overlayTms`（m6-t8 §3.10） | `EnvelopeEditorModal.vue:131` の `new XYZ({ url: props.overlayTms.url })`（`mapSourceFactory` を経ない）と `BaseMapEdit.vue:1194` の `window.appAssets.generateTmsThumbnail(...)` | **なし**（`` `file://${dataFolderPath.value}/merc/${document.value.uid}/{z}/{x}/{y}.png` `` の文字列連結） |

宛先レイアウトは a と b で**完全に同一**である。差分は percent-encoding の有無のみで、
b は保存フォルダのパスに空白や非 ASCII を含む環境で a と別の URL を作る
（m5-t3 が地図側で排したのと同型の劣化。**実害は未検証・未報告**）。

**なぜ m22-t1 で統合しなかったか**: a の純関数は `node:path` と `file-url` に依存し、
renderer バンドルへは載せられない。∴ 統合するには次のいずれかが要る。

- (i) 新規 IPC チャネルを設けて renderer から a を呼べるようにする
- (ii) `BaseMapEdit` が自分の item を IPC カタログ（`basemaps:list` の `url_`）から引いて使う
- (iii) 純関数を renderer 互換へ書き直し、main / renderer の双方から import する

いずれも FOSS4G 会期直前に新しい面を足す変更であり、m22-t1 の症状（GCP 編集画面での merc 無表示）
とは**別経路**で症状の解消には不要である。また m22-t1 が新設する側は `file-url` を通すため、
本タスクによって既存の状態が悪化することはない（並立が残るだけである）。

**提案**: 会期後に (i)〜(iii) のいずれかで統合し、あわせて b の percent-encoding 未適用を解消する。
恒久指示「同一扱いの処理は共通実装へ寄せる」に対する**放棄ではなく延期**である
（m22-t1 設計書 §3.6・人間ゲート G-7）。
