# Phase 7: Map/App POI 参照 + export/preview 解決 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** POI ソースを Map / App から UID リレーションで参照できるようにし（POI-137）、preview / package export の両経路で `{poiUid}` 参照を export 形 FeatureCollection（slug/title 書込・`_maplat` 剥がし・座標7桁丸め）へ解決する（POI-117/143、EXP-106 相当）。二重参照警告（POI-142）と AID-006 逆参照の実効化を含む。**これで POI 機能が「全体として動く」= viewer で見える状態になる。**

**Architecture:** 参照の永続形は `document.pois` / map data_json の `pois` 配列内の `{ poiUid: "<uid>", cachedTitle? }` 要素（`findPoiSourceReferences` が既に `"poiUid":"<uid>"` LIKE 走査で前提化）。生 pois（URL 文字列 / FC 埋め込み）は従来通り透過。解決層は main 側の共通 util 1 箇所（preview / export / map JSON / app JSON の 4 出力点から呼ぶ）。UI は既存 PoiSourceSelector（実装済み・未マウント）を AppEdit / MapEdit に配線。**UI 刷新はしない**（4エディタ UI 統一は別タスク）。

**正本仕様:** `../../NextTargets/43-poi-editor-spec.md` §2.4（POI-137 / 逆参照 UI-108）・§6（POI-142）・§8（EXP-106 / POI-143 / EXP-111 は後続）。

**前提事実（Explore 2026-07-11、file:line は当時点）:**
- `PoiSourceSelector.vue` 実装済み・**未マウント**。選択値 = `SelectedPoiSourceRef { kind:"registered-poi-source", sourceId: uid, catalogKey: "poi-source:${uid}", mode, cachedTitle }`（registeredPoiSourceCatalog.ts:78-84）。
- AppEdit は POI を**生 JSON textarea**（`appData.poiSources: string`、AppEdit.vue:1046-1047）で編集し、保存/export/preview 時に `document.pois = JSON.parse(poiSources)`（:630/675/849）。
- MapEdit / MapEditService に pois の UI・保存経路は**無い**。ただし map data_json に `pois` があれば `requestPreviewSource`（MapEditService.ts:39-66 の `{...previewJson, ...store}`）→ AppPreviewService.ts:140 `pois: preview.pois` で**素通し透過**される（受け皿は既にある）。
- **解決層は空**: AppPreviewService.createSession:171（app JSON）と AppExportService.composeAppJson:233（app JSON）は `document.pois` を配列化して透過するだけ。map JSON 側も同様に透過のみ。
- viewer（MaplatCore normalize_pois.ts:20-65）は URL 文字列 / FC / FC 配列 / `{layerId:FC}` を全部受け、**FC.id → layer key / FC.name → layer 名**。`toExportForm` の FC.id=slug / FC.name=title と完全整合（POI-133）。
- `toExportForm` は main から import 可（PoiSourceService.ts:21-32 に同ファイル import 実績）。`roundCoordinates:true` で7桁丸め（POI-143、preview/export とも true でよい — Store は劣化しない）、`_maplat*` 剥がし・layer meta pass-through 込み。**PoiSourceService に「uid → export FC」メソッドは未実装**。
- `findPoiSourceReferences`（SqliteDataService.ts:1291-1304）は apps/maps data_json の `"poiUid":"<uid>"` を走査 — **Phase 7 で参照が書かれた瞬間に AID-006 逆参照（Phase 3 の削除確認 UI）が実効化**する。追加実装不要。
- AppEdit の警告表示手段: `result.warnings`（i18n キー配列）→ `t(key)` して showMessageBox の detail（AppEdit.vue:687-693）。**静的キーのみ**（パラメタ補間なし）。

---

## 設計コントラクト

### 参照要素の形（永続形）

```jsonc
// document.pois / map data_json の pois 配列の要素として混在可
{ "poiUid": "9b2b6f6e-...", "cachedTitle": "史跡" }   // 登録 POI ソース参照（Phase 7 新設）
"https://example.com/pois.geojson"                     // 生 URL（従来、透過）
{ "type": "FeatureCollection", ... }                   // 生 FC（従来、透過）
```
- `cachedTitle` は UI 表示専用（解決には使わない）。`poiUid` 以外のキーは解決時に無視。
- data_json 不変条件（ADR-0007「自分の uid/slug を含めない」）と両立: poiUid は**他アセットへのリレーション**であり対象外（findPoiSourceReferences がこれを前提に走査している）。

### main 解決層 `electron/services/poiReferenceResolver.ts`（新規）

```ts
export interface ResolvedPois { pois: unknown[]; warnings: string[] }  // warnings は i18n キー（静的）
/** pois 配列内の {poiUid} 要素を export 形 FC に置換。生要素は透過。
 * 見つからない/読めない poiUid は要素を落とし 'appedit.warn_missing_poi_source' を1回 push。 */
export async function resolvePoisArray(pois: unknown): Promise<ResolvedPois>;
```
- FC 化は新設 `PoiSourceService.exportForm(uid)`: `get(uid)` → `toExportForm(detail.fc, detail.slug, detail.title, { roundCoordinates: true })`。remote ソースも snapshot cache から同様に解決（get が返すなら追加分岐不要）。
- 呼び込み点は **4箇所**: AppPreviewService の app JSON（:171）と map JSON（:140 の `preview.pois`）、AppExportService の app JSON（composeAppJson:233）と map JSON 合成部（実装時に特定）。
- **二重参照警告（POI-142）**: app JSON + 全 map JSON を組む地点（createSession / export の統括部）で、app 側 poiUid 集合と各 map 側 poiUid 集合の積が非空なら `'appedit.warn_duplicate_poi_reference'` を warnings に1回 push（静的キー制約のため slug は含めない。将来 {key,params} 化は UI 統一タスクで）。
- warnings は既存の `result.warnings` 経路（preview / export とも AppEdit 側の t() 表示が既存）に合流。

### AppEdit 配線（POI selector マウント）

- `PoiSourceSelector` を poiSources textarea の**上**にマウント。真実の器は従来通り `appData.poiSources`（JSON 文字列）1つ:
  - 初期化: poiSources を parse し、`poiUid` を持つ要素 → `initialSelected`（SelectedPoiSourceRef 復元、cachedTitle 利用）。
  - `update:selected`: 選択集合の差分を poiSources 配列に反映（`{poiUid, cachedTitle}` 要素の追加/削除。**生要素は触らない**）→ JSON.stringify して textarea へ書き戻し（recordHistory 1回）。
  - textarea 手編集も従来通り可（上級用と説明文言を変更）。parse 不能時は selector を disabled + 警告。
- `SelectedPoiSourceRef.sourceId` ↔ `poiUid` の変換はここで行う（selector 側は変更しない）。

### MapEdit 配線（POI-137 新設）

- settings タブに同 selector をマウント。器は `mapData.pois`（配列。無ければ空）。選択差分を `{poiUid, cachedTitle}` 要素で反映（deep-watch 履歴が拾う = 既存の undo 粒度に従う）。保存は mapObject に pois が入って data_json へそのまま永続化（MapEditService 側の変更不要を確認 — save 経路が pois を落とさないこと）。
- 生要素の手編集 UI は MapEdit には作らない（透過保持のみ。必要なら将来 raw 編集で）。

### smoke

- 新規 `scripts/m10-t1-poi-reference-resolver-smoke.mjs`（behavioral、m9 系と同じ sandbox 方式）: poi_source を createLocal → app document の pois に `{poiUid}` + 生 URL + 生 FC を混在 → resolvePoisArray（または preview createSession 経由）→ ①{poiUid} が FC に置換され FC.id=slug / `_maplat*` 不在 / 座標7桁丸め ②生要素は透過 ③存在しない poiUid → 要素落ち + warning キー ④app と map の両方に同 poiUid → duplicate warning ⑤逆参照: findPoiSourceReferences が app を拾う（Phase 3 削除確認の実効化確認）。
- m5-app-editor smoke / m3 系に selector マウントのソースパターン断言を追加。

---

## Tasks（直列。各 Task 完了ごとに検証、最後に品質レビュー）

### Task 1: main 解決層 + export/preview 4点接続（TDD）
**Files:** Create `electron/services/poiReferenceResolver.ts`, Modify `electron/services/PoiSourceService.ts`（exportForm）, Modify `electron/services/AppPreviewService.ts` / `AppExportService.ts`, Create `scripts/m10-t1-poi-reference-resolver-smoke.mjs`, Modify `package.json`, i18n `appedit.warn_missing_poi_source` / `warn_duplicate_poi_reference` ×11ロケール

- [x] m10-t1 smoke 先行（①〜⑤、FAIL 確認）
- [x] 実装 → PASS + `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Resolve registered POI references in preview and export output`

### Task 2: AppEdit に POI selector をマウント
**Files:** Modify `src/views/AppEdit.vue`, Modify `scripts/m5-app-editor-smoke.mjs`（or m3-t4）, i18n 追加分

- [x] 設計コントラクト通り（poiSources 文字列を単一の真実に、selector⇄JSON 双方向、生要素透過、parse 不能時 disabled）
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Mount the POI source selector in the app editor`

### Task 3: MapEdit に POI selector を追加（POI-137）
**Files:** Modify `src/views/MapEdit.vue`, smoke 追加, i18n 追加分

- [x] settings タブに selector、`mapData.pois` へ差分反映、保存経路で pois が落ちないこと（mapedit save → 再読込の behavioral 確認を smoke か手順で）
  - 保存経路の実修正: `electron/utils/store_handler.ts` の keys 配列に `"pois"` 追加 + `HistMapStore` に `pois?: unknown[]`（histMap2Store / store2HistMap の両方向が同じ keys を使うため1箇所で両方向解決。coreLogic 分岐は ret=store の in-place なので元々保持）
  - behavioral: 新規 `scripts/m10-t3-mapedit-pois-save-smoke.mjs`（save → data_json / request 再読込で pois 保持、pois 無し保存でキーが生えない）— 修正前 FAIL を確認してから修正 → PASS
  - 共有 util: AppEdit ローカルの poiUidOf/復元/差分反映/samePoiSelection を `src/utils/poiReferenceUi.ts` に抽出（配列 in/out の純関数）。AppEdit は JSON 文字列⇄配列層のみ残して置換
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Add the POI source selector to the map editor`

### Task 4: 品質レビュー + 修正 + 締め
- [ ] Phase 7 差分の品質レビュー（二段目）→ 指摘修正 commit → 全ゲート再実行
- [x] 品質レビュー指摘 M2/M4/M5 修正（M1 icon 解決は別タスクのため未着手）:
  - M2: `electron/ipc/mapedit.ts` の `mapedit:download` 経路に `composeDownloadMapJson` を新設し、
    `resolvePoisArray` で pois の `{poiUid}` 参照を export 形 FC へ解決してから ZIP 出力するよう修正
    (viewer 互換, AppExport/AppPreview と統一)。IPC 戻り値は既存の `'Success'|'Canceled'` 文字列契約を
    renderer 未配線のまま維持し、warnings は `console.warn` に留めた（renderer 表示配線は本タスクの
    スコープ外・別途判断）。`scripts/m10-t3-mapedit-pois-save-smoke.mjs` に behavioral ケース④を追加
    (FAIL→PASS を確認済み)。
  - M4: `electron/services/poiReferenceResolver.ts` と `src/utils/poiReferenceUi.ts` の `poiUidOf` を
    UUID 形状 (`StorageAdapter.UUID_PATTERN` と同形、大小文字非区別) のみ参照として扱うよう変更。
    非 UUID の `poiUid` は生要素として透過し missing 警告の対象にもしない
    (`SqliteDataService.findPoiSourceReferences` の走査対象が UUID のみであることと対称)。
    `scripts/m10-t1-poi-reference-resolver-smoke.mjs` に非 UUID 透過・重複 uid 解決のケース⑧⑨を追加
    (FAIL→PASS を確認済み)。`scripts/m5-app-editor-smoke.mjs` の静的コード検査アサーションも新規約に更新。
  - M5: `AppExportService.ts` の app pois 取得式 (`document.pois ?? parseJsonArray(document.poiSources)`)
    を、preview 側と同じ `normalizeJsonArray(document.pois || document.poiSources)` に統一。
    共通ヘルパを新設 `electron/utils/jsonArray.ts` に抽出し、AppExportService/AppPreviewService
    双方の重複実装を除去して1本化した。
- [x] 品質レビュー指摘 M1 修正 (icon 参照文法の出力時解決, POI-117):
  - **解決層**: `electron/services/poiReferenceResolver.ts` に icon 解決を統合 (`resolvePoisArray` の
    内部で、置換後 FC と生 FC の双方の layer metadata + 全 feature properties の icon/selectedIcon を
    走査)。判別は `src/utils/iconRefs.ts` の `parseIconRef`/`listIconSets` (registry) に委ねる。
    iconset (登録済み setId + 既知 iconId + 実体あり) → `imgs/icons/{setId}/{iconId}.{ext}`、
    asset UUID (assets テーブル + 実体あり) → `imgs/{slug}.{ext}`、URL/相対パスは無変更、
    未登録 setId・未知 iconId・不在 asset は**原文維持 + `appedit.warn_unresolved_icon` 1回**
    (11ロケール追加)。戻り値に `files: {src, dest}[]` (dest キーで重複を畳む) を追加。
    builtin 実体は `public/icons`→`dist/icons`→パッケージ相対の候補配列で解決
    (AppPreviewService の previewAssetRoot 方式踏襲、traversal ガード付き `iconSetFilePath` を export)。
  - **viewer の URL 解決基準の確認**: MaplatCore の `setMarker` (index.ts) は icon 文字列をそのまま
    OpenLayers `Icon({src})` に渡すため、相対 URL は**ページ URL 基準**で解決される。
    export は index.html と同階層に `imgs/` をコピー、preview はセッション URL が
    `/preview/{token}/` (末尾スラッシュ) のためセッション配下に `imgs/` ルートを配信すれば
    **相対 `imgs/...` のままで両経路とも成立** (絶対 URL 化は不要)。
  - **preview**: `AppPreviewService.handlePreview` に `imgs/` ルートを追加
    (`imgs/icons/...` = iconSetFilePath 経由の同梱実体 / `imgs/{slug}.{ext}` = DB slug 引き→
    `{saveFolder}/assets/{uid}.{ext}`、ext が record と一致する場合のみ配信)。
  - **export**: `AppExportService` が app/全 map の解決 files を dest キーで集約し
    `outDir/imgs/...` へコピー。
  - **download**: `composeDownloadMapJson` が files も返し、`mapedit:download` が ZIP の
    zip ルート相対 `imgs/...` に `zip.addLocalFile` で同梱 (既存 targets 配列方式のまま追加可能
    だったため縮退不要 — ファイル同梱まで実施)。
  - TDD: `scripts/m10-t1-poi-reference-resolver-smoke.mjs` に ⑩ (preview の imgs URL を実 fetch し
    200 + SVG/画像バイト) ⑪ (export 出力に imgs 実体 + JSON 参照一致) ⑫ (未登録 `maki:bank` は
    原文維持 + unresolved 警告1回) ⑬ (Write Store data_json は参照文法のまま) を先行追加し
    FAIL→実装→PASS を確認。
- [x] 人間テスト手順を本ファイル末尾に追記（下記 19〜26）
- [x] 引き継ぎ書更新（POI 機能全体完成 → GUI 実機確認 → UI 統一タスクへ。2026-07-11）

## UI 統一タスクへの繰り越し（Phase 7 品質レビューより）

- **Undo ポリシーの全エディタ統一（ユーザー決定 2026-07-11）**: 「エラー値も Undo 履歴に積み、保存/エクスポート側で堰き止める」を Map/BaseMap/Poi/App 共通原則とする。POI 属性フォームは対応済み。MapEdit/AppEdit（deep-watch 方式）と BaseMap 系のフィールド検証に「エラー時非 commit」の同型が残っていないか棚卸しし、あれば揃える。

- **M3**: POI ソース削除後に map/app へ残る dangling `{poiUid}` 参照を GUI から解除できない（selector はカタログ在庫のみ表示。AppEdit は textarea で除去可、MapEdit は手段なし）。selector に「選択中だがカタログに無い参照」カード（cachedTitle 表示・解除のみ可）を追加するのが対応案。
- 二重参照警告（POI-142）の表出は仕様の「App editor diagnostics」でなく preview/export 時のワンショットダイアログ（静的 i18n キー制約とセットの縮退。{key,params} 化と diagnostics パネル常設は UI 統一で）。
- preview の PreviewSession Map が増え続ける既存リーク（Phase 7 の退行ではない）。
- MapEdit settings タブの POI selector は表示時即 fetch（遅延マウント検討）。

## Phase 7 人間テスト手順（GUI 実機。Phase 4 の 1〜12・Phase 5 の 13〜18 の続き）

19. **App から参照**: AppEdit の設定に「POIソース」selector が出る → POI ソースを選択 → 下の生 JSON textarea に `{"poiUid": "...", "cachedTitle": ...}` が入る → 選択解除で消える（textarea 内の生 URL/FC 要素は不変）→ 保存。
20. **preview で見える**: 19 の app をプレビュー → 地図上に POI マーカーが表示され、クリックで name 等が出る。icon picker で builtin/asset アイコンを設定した POI は**そのアイコン画像**で表示される。
21. **Map から参照（POI-137）**: MapEdit の settings タブに「POIソース」selector → 選択 → 保存 → 再読込で選択が維持されている → その地図を含む app のプレビューで地図側 POI も表示される。
22. **export 検証**: app を export → 出力の apps/*.json・maps/*.json の pois が FeatureCollection 展開済み（`poiUid` キーなし・`_maplat*` なし・座標小数7桁以下・FC.id=slug）→ `imgs/icons/builtin/*.svg` / `imgs/{slug}.{ext}` が実在し JSON の icon 参照がそれらを指す。
23. **二重参照警告**: 同じ POI ソースを app 共通と配下 map の両方から参照 → preview/export 実行時に警告ダイアログ。
24. **missing 警告**: textarea に存在しない UUID の `{poiUid}` を手書き → preview で「参照先が見つからない」警告 + その要素は出力に出ない。
25. **削除確認（AID-006 実効化）**: app/map から参照されている POI ソースを一覧から削除 → 確認ダイアログに参照元 app/map が列挙される。
26. **地図 ZIP ダウンロード**: POI 参照付き地図をダウンロード → ZIP 内 map JSON の pois が FC 展開済みで、imgs/ にアイコン実体が同梱されている。

## Self-Review 済み確認事項

- §2.4「Map/App 双方から UID リレーション参照」「export 時に `pois/{slug}.geojson` 相当の参照を解決（normalize_pois 互換）」— viewer が FC 埋め込みを直接受けるため、**別ファイル `pois/{slug}.geojson` に書き出す代わりに FC 埋め込みで解決**する（normalize_pois 互換の範囲内。ファイル分離は EXP-111 の外部 URL 取り込みと合わせて後続で検討可 — 判断根拠: 出力先ファイル管理を増やさない最小実装）。
- POI-143 の丸めは toExportForm(roundCoordinates:true) が担う。raw ペイン（false）とは呼び分け済み。
- EXP-111（外部 URL POI の package 取り込み checklist）と EXP-102（POI draft の未保存検出）は本 Phase のスコープ外（後続）。
- AID-006 は findPoiSourceReferences + Phase 3 削除確認 UI が既にあるため、参照が書かれることで自動的に実効化（Task 1 smoke ⑤で確認）。