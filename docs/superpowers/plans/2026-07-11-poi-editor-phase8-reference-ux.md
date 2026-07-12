# Phase 8: POI 参照 UX 改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 7 GUI 検証のユーザーフィードバック（2026-07-11）を反映する: ①AppEdit の生POI textarea 廃止と poiSources 二重 stringify 破損の根治 ②App/Map 双方に専用「POIデータ」タブを新設し、参照の**順番変更**と**アイコン等の上書き**を UI で設定可能に ③PoiEdit の右ペインが大量 feature でフォームを潰す問題の修正 ④PoiEdit 地図マーカーに設定アイコンを反映（未設定は標準ピン）。

**ユーザー決定（原文要旨）:**
- 生POI（URL/FC 直接編集 textarea）は不要。エスケープも壊れている。
- 代わりに「POIデータの順番」「アプリ/地図でのアイコンなどの上書き」を設定できる UI を。
- メタデータ編集/ベースマップ編集タブに同居させず、**POIデータタブを追加**（App/Map とも）。
- PoiEdit: 右ペインがリストで一杯になりメタデータ編集が効かない / アイコンを変えても地図表示が変わらない（未設定時は Maplat 標準）。

**確定済みの根本原因（バグ①）:** `AppEdit.vue:446 normalizeAppDocument` が `JSON.stringify(value.poiSources || ...)` — 保存済み document の poiSources は**文字列**なので stringify のたびにエスケープが一段深くなる（読込→保存の往復で悪化）。saveApp は document に pois(配列) と poiSources(文字列) の両方を残して保存している。

---

## 設計コントラクト

### 参照要素の拡張形（永続形、resolver と対）

```jsonc
{ "poiUid": "<uuid>", "cachedTitle": "史跡",
  "icon": "builtin:defaultpin-red",      // 任意: 参照単位の上書き (POI-112 の最小形)
  "selectedIcon": "<参照文法>" }          // 任意
```
- 上書きは **resolver（poiReferenceResolver.resolvePoisArray）が解決後 FC のトップレベル icon/selectedIcon に適用**する（layer metadata 上書き。viewer の normalize_pois は layer icon を各 POI の既定として使う）。ソース側 FC に元々 icon があっても参照側の上書きが勝つ。上書き値も icon 参照文法 → 既存の icon 解決（imgs/ 書き換え + 実体同梱）を通す。
- 順番 = pois 配列の順（viewer の layer 順に直結）。UI は上下ボタンで入れ替え。

### 永続形の正規化（バグ①根治）

- **AppEdit 内部表現を配列に変更**: `appData.poiSources: string` → `appData.pois: unknown[]`（生 URL/FC 要素も配列内にそのまま保持 — UI では「外部データ」として表示のみ・削除可・編集不可）。textarea と `parsePoiSourcesArray`/invalid ガードは削除。
- **読込 heal**: normalizeAppDocument で `value.pois`（配列）優先。`value.poiSources` が文字列なら **bounded ループ（最大5回）で「parse 結果が文字列なら再 parse」**して配列に復元（今回の多重エスケープ破損の治癒）。どうしても配列にならなければ空配列 + console.warn（データは data_json に残るので破壊はしない）。
- **保存形**: document.pois = 配列のみ。**document.poiSources は保存前に削除**（二度と文字列形を書かない）。backend/resolver は pois 配列を読むので互換。
- MapEdit は既に `mapData.pois` 配列なので変更なし（タブ移設と UI 追加のみ）。

### 「POIデータ」タブ（App/Map 共通の新コンポーネント）

- `src/components/PoiReferenceEditor.vue`（新規、両エディタから利用）:
  - props: `pois: unknown[]`（v-model）+ `readOnly?`。emit で配列ごと差し替え（呼び出し側が履歴記録）。
  - 上段: **選択済み参照のリスト**（順番どおり）。各行 = cachedTitle/slug + 上下ボタン（順番変更）+ 上書き icon/selectedIcon（AssetPicker mode:'icon' + 解釈表示 + クリア。PoiAttributeForm の icon 欄部品の流用/抽出）+ 解除ボタン。生 URL/FC 要素は「外部データ」行（タイトル=URL または FC.name、順番変更・削除のみ可）。
  - 下段: **追加用の PoiSourceSelector**（既存。選択済みは除外表示 or トグルで解除も可 — 実装時に自然な方を選び記録）。
- AppEdit: タブバー（メタデータ編集/地図選択/プレビュー）に「POIデータ」タブを追加し、メタデータ編集タブ内の POI セクション（selector + textarea + 見出し）を**移設・置換**。
- MapEdit: タブバー（メタデータ/対応点/データセット/ベースマップ編集）に「POIデータ」タブを追加し、ベースマップ編集タブ内の POI カードを**移設・置換**。
- i18n: `poiref.*` を11ロケール。

### PoiEdit 右ペイン（バグ③）

- `.poi-form-area` が list に押し潰されて 0 になる（flex 0 1 auto + min-height 0 vs list flex-grow）。**フォーム優先の固定分配**に変更: `.poi-form-area { flex: 0 0 auto; max-height: 55%; overflow-auto }`（内容が少なければ小さく、多ければ 55% で内部スクロール）+ `.poi-list-area { flex: 1 1 0; min-height: 160px }`。

### PoiEdit マーカーアイコン（バグ④）

- PoiEditMap の redrawMarkers で feature の `properties.icon` を `parseIconRef` で解決し OL Icon の src に使う: iconset(登録済) → previewUrl / url → そのまま / asset(UUID) → `imageAssets.getFilePath` の file:// URL（非同期 → useAssetThumbnails 系の cache を map 側に持ち、解決後に再描画。miss 中は標準ピン）/ 未設定・未解決 → 既存の標準 SVG ピン。
- 選択中: `selectedIcon` があればそれ、無ければ既存の赤ピン（アイコン設定済み feature の選択ハイライトは「アイコン + 下部リング等の強調」ではなく selectedIcon or 赤ピン切替のまま = viewer と同じ切替意味論）。
- スタイル cache は src 文字列キー。大量 feature でも Icon インスタンスを共有。

## Tasks（直列。1=PoiEdit 修理（先に体感改善）、2=データ形とタブ、3=レビュー）

### Task 1: PoiEdit 右ペイン分配 + マーカーアイコン反映
**Files:** Modify `src/views/PoiEdit.vue`（CSS）, Modify `src/components/PoiEditMap.vue`, Modify `scripts/m4-t5-poi-edit-smoke.mjs`

- [x] 右ペイン CSS 修正（フォーム優先 55% / リスト残り。3000 feature でもフォーム操作可能）
- [x] マーカーアイコン解決（parseIconRef + asset 非同期 cache + 標準ピン fallback + selectedIcon）
- [x] smoke 断言追加 + `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Reflect assigned icons on the POI editor map and rebalance the side pane`

### Task 2: poiSources 破損根治 + POIデータタブ（App/Map）+ 参照上書き
**Files:** Create `src/components/PoiReferenceEditor.vue`, Modify `src/views/AppEdit.vue` / `MapEdit.vue`, Modify `electron/services/poiReferenceResolver.ts`（上書き適用）, Modify `src/utils/poiReferenceUi.ts`（icon/selectedIcon 保持）, Modify smoke（m5 / m4-undo-redo / m10-t1）, 11 locale

- [x] resolver: 参照要素の icon/selectedIcon を解決後 FC トップレベルへ上書き（m10-t1 に behavioral ケース: 上書きが FC.icon になり imgs/ 解決も通る）
- [x] AppEdit: 内部表現を配列化 + heal（多重エスケープ復元の behavioral smoke — 二重/三重エスケープ文字列を normalize に通して配列復元を assert）+ document.poiSources を保存前に削除 + textarea/パースガード削除
- [x] PoiReferenceEditor 新設（順番/上書き/解除/追加）+ App/Map の POIデータタブ配線（既存タブからの移設）
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Add dedicated POI data tabs with ordering and icon overrides`（①resolver+poiReferenceUi ②heal+配列化+IconRefField+PoiReferenceEditor+タブ配線 の2分割）

### Task 4: ビルトインアイコンのビューア整合（ユーザー決定 2026-07-11）
**決定**: 「Editor をビューアに合わせる + 現行 Editor の SVG ピンはボーナストラックとして残す」。
**Files:** Modify `src/utils/iconRefs.ts`, Copy `MaplatCore/parts/defaultpin.png` / `defaultpin_selected.png` → `public/icons/builtin/`, Modify `src/components/PoiEditMap.vue`, smoke 追随

- [x] builtin セット再構成（POI-126 の append-only を尊重、既存 id の参照互換を維持）:
  - `defaultpin` = **ビューアの defaultpin.png**（青バルーン。意味を「ビューア標準」に整合 — これが唯一のアート差し替え、根拠はユーザー決定）
  - `defaultpin-selected` = ビューアの defaultpin_selected.png（新規 id）
  - `defaultpin-red/green/yellow/gray` = 既存 SVG のまま（ボーナストラック）
  - `defaultpin-blue` = 旧 defaultpin の青 SVG を新 id で温存（アート選択肢を失わない）
  - previewUrl の拡張子が png/svg 混在になるので registry に per-icon ext を持てる形へ
- [x] PoiEditMap の標準ピン: 未設定 = defaultpin.png / 選択中（selectedIcon 無し）= defaultpin_selected.png（ビューアと同じ見え方。インライン SVG 標準ピンは廃止。anchor はビューアと同じ [0.5, 1] — MaplatCore/src/map_ex.ts の markerDefaultStyle / setMarker(string) で確認）
- [x] export/preview の imgs/icons 解決の拡張子対応を確認（previewUrl が per-icon ext を返し、iconSetFilePath は存在ベース・dest は path.extname(src) 追随のため resolver 本体はコメント以外無変更で png 対応）
- [x] `pnpm build` + 全 smoke GREEN → Commit: `Align the builtin icon set with the viewer default pins`

### Task 5: PoiReferenceEditor を地図選択（AppSourceEditor）と同設計に再構成（ユーザー指摘 2026-07-11）
**指摘**: 上下2段は窮屈・検索が無い。「地図選択と同じ機能なのだから同じデザイン設計を」。**プロセスガード**（新 UI は既存類似機能のデザインを厳密踏襲・選択肢があれば人間確認）は memory: design-precedent-guard に記録済み。
**Files:** Modify `src/components/PoiReferenceEditor.vue`, 参考 = AppEdit の地図選択タブ（左=検索付き一覧 / 右=選択済みカード列）

- [x] **地図選択タブの現物デザインを読み取り**、同じ2カラムレイアウト・操作体系に再構成: 左=POI ソース一覧（**検索ボックス付き**）、右=「この{アプリ/地図}の POI データ一覧」= 選択済みカード列（タイトル+slug、↑/↓/×、上書きアイコン2欄。外部データ行は説明文付き）
- [ ] MapEdit の POIデータタブ表示崩れ（ベースマップ編集と混在して見えた件）は修正着地+完全リロード後に再確認（静的にはタブ配線正常 — HMR 編集中間状態の疑い。再現するなら根因調査）
- [x] `pnpm build` + 全 smoke GREEN（既存断言の追随） → Commit: `Redesign the POI data tab to mirror the map selection layout`

#### Task 5 実装メモ（2026-07-12）

- 2カラム骨格は AppEdit `.source-editor` を厳密踏襲: grid `minmax(280px, 36%) 1fr`、左 `.source-pane border-end pe-3`（sticky 検索 + `.source-row` リスト行）、右 `.selected-pane ps-3`（`<h5>` 見出し + `.selected-source border rounded p-2 mb-2` カード列、右上 ↑/↓/× の `btn-group btn-group-sm`）。
- 左カラム = `PoiSourceSelector.vue` を本用途専用に改修（他利用箇所なしを grep 確認）: カードグリッド → 地図選択と同じ行構成（48px 枠は POI にサムネイルが無いためピン印で代替、タイトル + slug・feature数 + local/remote バッジ）。検索は `usePoiSourceList.search`（main 側 query、後着優先 loadToken）で、placeholder は既存 `poisource.search_placeholder`。行クリック = 追加、追加済みは no-op + 「追加済み」バッジ（`addMapSource` と同じ挙動。解除は右カラムの ×）。ページング（一覧はページング API のため）は下部に維持。
- 右カラムのカード副行（地図選択の slug 表示に対応）: 参照要素の slug は永続形 `{poiUid, cachedTitle}` に無いため、表示専用に `window.poiSources.get(uid)` で遅延解決・キャッシュ（解決前/失敗は uid フォールバック）。永続形は変更しない。
- 見出しは `headingKey` prop で差し替え（AppEdit=`poiref.selected_list_app` / MapEdit=`poiref.selected_list_map`）。i18n 整理（11ロケール）: `selected_list`/`add_sources` 廃止、`selected_list_app`/`selected_list_map`/`added`/`external_note` 追加、`empty` を「左の一覧から」へ更新。
- 品質修正の維持: `pickerOpen` 集約 expose（MAJOR-1）と `entryKey` の uid+occurrence 安定 key（MINOR-2）は新テンプレートでもそのまま。`update:pois` 契約・`applyPoiSelection`/`extractPoiRefs` 経路も不変（AppEdit/MapEdit は heading-key 追加のみ）。
- smoke 追随: m5（2カラムグリッド/source-pane/selected-pane/↑↓× btn-group/headingKey/検索/追加済みバッジ/pickerOpen・entryKey 維持）、m3-t4（toggleSelect → addSource + 追加済み no-op + 検索）、m4-undo-redo（MapEdit の heading-key）。

### Task 6: アプリエクスポートを ZIP 出力に統一（ユーザー指示 2026-07-11）
**指示**: 「アプリ出力が指定フォルダへの直接出力になっている。地図エクスポートと同様 zip 出力に。その辺も既存と合わせて」。
**Files:** Modify `electron/services/AppExportService.ts`, 出力先ダイアログの現物（ipc/appedit or service 内）, `scripts/m10-t1-poi-reference-resolver-smoke.mjs` 追随

- [x] **地図 ZIP ダウンロード（mapedit:download / composeDownloadMapJson + AdmZip）の現物 UX を読解して踏襲**: showSaveDialog で `{appID}.zip` を既定名に指定 → 一時ディレクトリ（`app.getPath('temp')` 配下 mkdtemp）に現行どおりパッケージ構成（per-file 進捗は維持）→ AdmZip で zip 化（zip 追加もファイル単位で進捗に織り込む）→ `writeZip(保存先)` → 一時ディレクトリを finally で削除。旧フォルダ上書き確認は showSaveDialog のネイティブ確認へ委譲
- [x] 進捗 total = コピー units + zip units + 固定ステップ（zip units はパッケージ完成後に ProgressReporter.extendTotal で確定補正。zip 中は `appedit.export.zipping` ×11ロケール + `(n/m)` 表示でバーが動き続ける）
- [x] m10-t1 の export 出力アサーションを zip 展開（AdmZip）経由に追随（dialog stub を showSaveDialog 化、検証強度は維持）
- [x] `pnpm build` + 全 smoke GREEN (33/33) → Commit: `Package app exports as a single zip like map downloads`

#### Task 6 最終レビュー修正メモ（2026-07-12）

Phase 8 最終レビューの指摘のうち、以下を修正（MAJOR-1 は既知制限として据え置き）。

- **既知制限（MAJOR-1、未対応）**: zip 化が `AdmZip`（メモリ上にファイル全体を蓄積してから `writeZipPromise` で書き出す非ストリーミング実装）のままであることは変更していない。大容量アプリ（多数の高解像度タイル等）ではメモリ使用量が package 総サイズに比例して増える。ストリーミング zip 化（`archiver` 等への置き換え）は `mapedit:download`（`electron/ipc/mapedit.ts`）の同型実装と合わせて後続タスクで対応する。
- **[MAJOR-2] zip フェーズのイベントループ解放**: `electron/services/AppExportService.ts` の `addLocalFile` ループ（350行目台）に、50ファイルごとに `await new Promise<void>(resolve => setImmediate(resolve))` を追加。`writeZip` は adm-zip 0.5.17 に `writeZipPromise`（内部で `toAsyncBuffer` を使用）が実在することを現物確認し、同期の `writeZip` から `await zip.writeZipPromise(tmpZipPath)` へ置き換えた。型宣言が手書きの `electron/vendor.d.ts` にしかないため `writeZipPromise` のシグネチャを追加した。
- **[MINOR-1] 完了表示の順序**: zip 追加ループ中は進捗の引数を `Math.min(progressState.step, finalTotal - 1)` でクランプして 100% に到達させないようにし、`writeZipPromise` + `fs.move` の完了後に `reporter.update(finalTotal)` を呼んで初めて 100%/`appedit.export.done` を送るよう順序を入れ替えた。
- **[MINOR-2] tmp 書き→move**: `writeZipPromise` の書き込み先を `outDir` と同じ temp 配下の `${outDir}.zip`（staging）にし、成功後 `fs.move(tmpZipPath, zipFilePath, { overwrite: true })` でユーザー選択先へ移動する（`mapedit:download`:220 と同方式）。`finally` で `outDir` に加えて `tmpZipPath` も削除するため、途中失敗時はユーザーの選択先はもちろん staging zip も残らない。
- **[MINOR-3] エラー時の進捗モーダル残留**: `ProgressReporter`（`electron/utils/ProgressReporter.ts`）に `fail(msgOverride)` を追加。`update()` の throttle/endMsg 優先ロジックを経由せず、`percent:100` + エラー専用テキストを即時送信する。`AppExportService.exportApp` の `catch` で `reporter?.fail('appedit.export.failed')` を呼び、App.vue 側の既存の閉条件（`percent >= 100` で OK 有効化）を利用してモーダルを閉じられる状態にする（成功文言 `appedit.export.done` は出さない）。i18n キー `appedit.export.failed` を11ロケール（de/en/es/fr/id/ja/ko/th/vi/zh/zh-TW）に追加。
  - 同型の残留を `mapedit:download` 側（呼び出し元 `src/views/MapEdit.vue` の `exportMap`）でも確認: `mapedit:download` の IPC ハンドラは例外時に reject するだけで、呼び出し側の `try` に `catch` が無く `finally { unsubscribe() }` のみだったため、`modalFinish` が呼ばれずモーダルが閉じられない状態で残留していた。既存の失敗パターン（`result` が Success/Canceled 以外のとき `modalFinish(t('mapedit.export_error'))`）に倣い `catch` を追加して同じ文言で締めるよう修正。
- ゲート: `pnpm build` GREEN、全 smoke 33/33 GREEN（m10-t1 の export 検証も新しい完了順序＝writeZip+move 後に 100% で PASS）。
- Commit: `Make app export zipping non-blocking and fail-safe`

### Task 3: 品質レビュー + 仕様反映
- [x] Phase 8 差分の品質レビュー → 修正（MAJOR3+MINOR: picker 中キー抑止の MapEdit 展開 / heal 上限撤廃+失敗警告 / アイコンロード失敗フォールバック / 行 key 安定化 — 修正コミットは Task 4/5 と同時期に着地）
- [ ] Task 4/5 完了後に再レビュー（差分大のため）→ 43 仕様更新: §2.4 参照上書き（POI-112 最小形）+ 順番、§3.2 POIデータタブ・生POI textarea 廃止・ビルトイン=ビューア整合（親リポジトリでコミット）
- [ ] 人間テスト手順を本ファイル末尾に追記

#### Task 3 修正メモ（品質レビュー指摘の着地記録）

- **MAJOR-1 (picker 表示中のグローバルキー抑止漏れ)**: `src/components/PoiReferenceEditor.vue` に `iconFieldRefs`/`selectedIconFieldRefs`（v-for 内 template ref、2N 個の IconRefField、52/61行目で ref 付与）を集約する `pickerOpen` computed を追加し `defineExpose({ pickerOpen })`（193-201行目）。`src/views/MapEdit.vue` の PoiReferenceEditor に `ref="poiRefEditor"` を付与（3583行目）、`poiRefEditor` の宣言（701行目）、`onHistoryKeydown`（725行目）と `onMainProcessMessage`（746行目）の先頭に `if (poiRefEditor.value?.pickerOpen) return;` を追加（PoiEdit.vue の既存パターンと同じコメント書式）。AppEdit.vue はグローバル keydown/onMainProcessMessage リスナーを持たないため変更不要（確認のみ）。
- **MAJOR-2 (heal() の深さ上限撤廃 + 失敗時UI警告)**: `src/utils/poiSourcesHeal.ts` の `MAX_REPARSE_DEPTH` を 5→100 に変更し、各 reparse step が文字列長を厳密に減らすため停止保証がある旨のコメントを追加（9-15行目）。`healPoisValue`/`healAppDocumentPois` の戻り値を `{ pois, failed }` 形へ変更（18-46行目）。`src/views/AppEdit.vue` に `poiHealFailed` ref を追加（231行目）、`normalizeAppDocument` 内で heal 結果を反映（455/457行目）、POIデータタブに `v-if="poiHealFailed"` の `alert-warning` を追加（1231行目、i18n キー `appedit.poi_heal_failed`）。i18n キーは `public/locales/{vi,ja,zh,zh-TW,de,ko,id,fr,es,en,th}/translation.json` の `appedit` 名前空間に `warn_duplicate_poi_reference` の直後で追加（全11ロケール）。`scripts/m5-app-editor-smoke.mjs` に 6段エスケープ復元ケースと戻り値形状変更後のアサーションを追加。
- **MAJOR-3 (icon 読み込み失敗フォールバック)**: `src/components/PoiEditMap.vue` に `iconLoadOkCache`/`iconLoadInFlight` + `requestIconLoadCheck`（`new Image()` による preload チェック、requestAssetSrc と同じ非同期パターン）を追加。`iconRefStyle` は builtin (`resolved.pinShaped`) 以外の src についてチェック未完了/失敗時に標準ピンへフォールバックし、成功/失敗確定時に `scheduleIconRedraw()` を呼ぶ。builtin は同梱静的アセットのためチェック対象外（コメントで理由明記）。`scripts/m4-t5-poi-edit-smoke.mjs` の Part 6 に onerror ハンドラ・pinShaped 除外のソースパターン断言を追加。
- **MINOR-2 (v-for key の index 混入)**: `src/components/PoiReferenceEditor.vue` の `entryKey` を `ref:${uid}#${occurrence}`（同一 uid の配列内出現順、並べ替えでも安定）へ変更。生要素（uid なし）は同一性判定不能のため `raw:${index}` のまま。参照行と外部データ行は同一 v-for のため別途の修正は不要。
- **MINOR-3 (PoiAttributeForm の :key=uid 調査)**: `src/components/PoiAttributeForm.vue:10` の `<div v-else :key="uid ?? ''">` は 200行目の `</div>` まで属性フォーム全体を包んでおり、134-143行目の IconRefField ×2（icon/selectedIcon）を完全に内包していることを確認。uid 変化（選択切替）で Vue がこの subtree を remount するため、IconRefField は内部の `input` ref を `props.modelValue` から再初期化した状態で生成し直され、watch の発火有無に依存しない。レビュー指摘（watch 不発火による古い入力残留）は既に remount で解消済みと判断し、**コード変更なし**。
- **MINOR-4 (空文字列 pois の握り潰し)**: `src/utils/poiSourcesHeal.ts` の `healPoisValue` で空文字列 (trim後 `""`) を `[]`（成功）ではなく `null`（失敗）として返すよう変更（19-21行目）。`healAppDocumentPois` はこれを受けて `poiSources` へのフォールバックを試み、それも失敗すれば `failed: true` を返す。`scripts/m5-app-editor-smoke.mjs` に空文字列失敗ケースと `pois` 空文字列→`poiSources` フォールバックのケースを追加。

## Self-Review 済み確認事項

- 参照上書きは POI-112（スコープ外とされていた metadata override）の最小形 = icon/selectedIcon のみ。desc 等のフル override descriptor は引き続き後続。
- 生 URL/FC 要素は「表示 + 順番変更 + 削除」のみ（編集 UI は作らない — 生編集ニーズは POI ソース化 or 将来の raw で）。
- findPoiSourceReferences の走査は `"poiUid":"<uuid>"` LIKE のままで互換（上書きキーが増えても poiUid 形は不変）。
- data_json から poiSources 文字列を消すのは新規保存分から（既存行は読込 heal が吸収、次回保存で消える）。
## Phase 8 人間テスト手順（GUI 実機。要・完全リロード）

B（品質レビュー修正分）:
- B1. MapEdit「POIデータ」タブが単独で正しく表示される（ベースマップ編集との混在が解消。再現するなら根因調査へ）
- B2. MapEdit の POIデータタブで picker を開いたまま Cmd+Z → 裏で undo が走らない
- B3. icon 欄に壊れた URL（typo）→ マーカーが消えずに標準ピンで表示され続ける
- B4. 以前エスケープ崩れが出ていた himejiapp を開く → POIデータタブに参照が正しく復元（復元不能なら警告表示）
- B5. 参照カードの ↑↓ 直後も入力途中の上書きアイコン欄が消えない

C（アイコン整合）:
- C1. 未設定 POI のエディタ表示・プレビュー表示が両方ともビューア標準の青バルーンで一致（選択時は selected バルーン）
- C2. icon picker の builtin に「defaultpin（バルーン）/ defaultpin-selected / ボーナス色ピン5種」の7つが並び、既存保存済みの builtin 参照（緑ピン等）が壊れていない
- C3. 標準ピンのサイズ感（旧 26x36 SVG → 24x48 PNG）とクリック当たり判定に違和感がないか

D（POIデータタブ2カラム + ZIP export）:
- D1. POIデータタブが地図選択と同じ2カラム + 検索付き（App/Map 両方）。左右が独立スクロール、狭い窓での折返し
- D2. 検索・ページングを跨いでも「追加済み」バッジと選択状態が整合
- D3. 順番変更 ↑↓ が preview のレイヤ順に反映
- D4. 削除済み POI ソースの参照カードが uid 表示で残り、× で解除できる
- D5. アプリエクスポートが {appID}.zip の保存ダイアログ → 進捗バーがコピー中もzip圧縮中も動き続け、テキストに地図slug (n/m) → 完了表示は zip 完成後 → 展開して index.html から動く
- D6. **最大級のアプリ（大型地図複数）で export を1本通し、メモリ膨張と所要時間を観察**（AdmZip インメモリ既知制限の実地確認）
- D7. export をディスク容量不足等で失敗させた場合（可能なら）: 進捗モーダルが閉じられる + 保存先に壊れた zip が残らない

## 追記: GUI 検証フィードバック対応 (2026-07-12)

2026-07-12 の GUI 検証フィードバック3件を実装した (意味単位で3コミット):

1. **D1 発展: 参照単位のタイトル上書き** — 参照要素の永続形に `title` (LangResource) を追加
   `{ poiUid, cachedTitle?, icon?, selectedIcon?, title? }`。resolver (poiReferenceResolver) が
   解決後 FC の `name` を交換形 (compactLangResource collapse = toExportForm と同形) で
   ソース側より優先して上書き。UI は参照カードに LangResourceInput の上書きタイトル欄
   (空クリアで title キー削除 = 上書き解除)。カード表示タイトルも上書き優先 (localizeTitle)。
   i18n `poiref.override_title` ×11。m10-t1 behavioral ⑰。
2. **D3 ブロッカー: マーカー一覧トグル** — AppEdit の特殊UI/HTTP機能トグル群に
   `enableMarkerList` チェックボックスを追加 (enableShare/enableBorder と同経路:
   document.httpSettings → AppPreviewService/AppExportService の viewerOption)。
   既定 false (viewer 既定に合わせ、既存アプリの出力不変)。enableHideMarker は既存配線済み
   のため m5 に断言のみ追加。i18n `appedit.marker_list_ui` ×11。m10-t1 behavioral ⑱。
3. **D4 発展: 削除済み参照カードのエラー表示** — PoiReferenceEditor の slug 遅延解決で
   `window.poiSources.get(uid)` が null (IPC 成功 + not-found 確定) を返した参照カードに
   border-warning + bg-warning-subtle と文言 `poiref.missing_source` (×11) を表示。
   IPC 一時失敗 (reject) は警告にしない。× 解除・↑↓ は従来通り。m5 に断言追加。
