# Phase 6: Assets タブ + icon/image picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立 header タブとして image asset マネージャ（AID-004 最小版）を追加し、POI エディタの icon / selectedIcon / image を picker で選択できるようにする。icon 参照文法（POI-139）の resolver を registry 方式で新規実装する。

**Architecture:** backend（ImageAssetService + `window.imageAssets`）は Phase 2 で完備・露出済み — Phase 6 は (a) backend の残ハザード修正（decode サイズガード・逆参照）、(b) 参照文法 resolver（純関数 + builtin registry）、(c) UI（AssetList タブ / AssetPicker モーダル / PoiAttributeForm 差し替え）の3層。UI は既存パターン踏襲（**UI 刷新はしない** — 4エディタ UI 統一は POI 完成後の別タスク）。

**正本仕様:** `../../NextTargets/43-poi-editor-spec.md` §7（AID-004 / POI-139 / POI-117）、41-editor-grill-question-map.md AID-005/006。

**前提事実（Explore 2026-07-10、file:line は当時点）:**
- `window.imageAssets` に add/list/search/get/rename/delete/getFilePath が**露出済み**（preload.ts:180-190、channel `imageassets:*`、型 = electron.d.ts:150-177 `ImageAssetRow`/`ImageAssetSaveResult`）。IPC 追加が要るのは新設 API（findReferences / pickImageFile）のみ。
- `add` は **sourcePath（絶対パス）入力**（ImageAssetService.ts:140-）。ファイル選択ダイアログ IPC は未実装 → poisource:pickImportFile（electron/ipc/poisource.ts）と同型で `imageassets:pickImageFile` を新設。
- `getFilePath(ref)` → `file://` URL（:287-293）。一覧グリッドのサムネは file:// を `<img>` 直表示（サムネ生成はしない — 原寸表示で最小版、AppAssetService に流用可能なリサイズ実装があるが YAGNI）。
- **decode サイズガード未実装**（:127-135 が生バッファを Jimp.read に直渡し。Phase 2 メモ「大 PNG で main freeze」= 要対応）。
- **delete の逆参照チェックなし**（:260-284）。`_trash` 退避・冪等 no-op はあり。
- **`{setId}:{iconId}` resolver は完全未実装**（grep ゼロ）。pin 画像も public/ に存在しない（PoiEditMap.vue:77- にインライン SVG ピン生成器あり — builtin アイコンの種にできる）。
- PoiAttributeForm の差し込み口: template L116-137（icon/selectedIcon の text 入力、Phase 6 差し替えコメント付き）、handler `onIconChange` L417-425（picker が選んだ ref を流せばそのまま使える）。image リストは同フォームの images セクション。
- Header タブ追加: Header.vue L10-60 の `<li>` 追加 + `navigate()` L85-102 分岐 + router routes 追加（POI タブ = Phase 3 の追加例）。
- 保存先は `{saveFolder}/assets/{uid}.{ext}`（userData ではない。OneDrive ロックは既知ハザード）。

---

## 設計コントラクト

### `src/utils/iconRefs.ts`（新規、純関数 + registry）

```ts
export type IconRef =
  | { kind: "iconset"; setId: string; iconId: string }
  | { kind: "asset"; uid: string }
  | { kind: "url"; url: string };

/** POI-139 判別順序: URL パターン → 登録済み setId → UUID。該当なしは url 扱い（相対パス）。
 * `{setId}:{iconId}` の setId は [a-z][a-z0-9-]*。http/https/data/file/blob は setId 予約禁止。
 * 未登録 setId のコロン形式は { kind:"iconset" } として返し isRegisteredIconSet(setId)=false
 * → 呼び出し側が「未解決 icon set」警告を出す（URL とはみなさない、仕様 §7）。 */
export function parseIconRef(value: string): IconRef;
export function isRegisteredIconSet(setId: string): boolean;

/** registry（短期は builtin のみ。プラグイン機構は作らないが hardcode 分岐でなく registry 引き） */
export interface IconSetDef {
  setId: string;             // 'builtin'
  title: string;             // 表示名
  iconIds: string[];         // ['defaultpin', 'defaultpin-red', ...]
  /** エディタ内プレビュー URL（picker サムネ・badge 用）。export 解決（POI-117）は Phase 7 */
  previewUrl(iconId: string): string;   // => `icons/${setId}/${iconId}.svg` (public 配下)
}
export function listIconSets(): IconSetDef[];
export function formatIconRef(ref: IconRef): string;  // parse の逆（正規形へ）
```

- builtin セット実体: `public/icons/builtin/defaultpin.svg` + 色違い4種（blue=defaultpin / red / green / yellow / gray。PoiEditMap のインライン SVG 生成器と同型のピン。POI-126 の version 管理は「iconIds 追加のみ・既存 id の意味を変えない」規約コメントで担保）。
- UUID 判定は既存の UUID-shape gate と同じ正規表現（SqliteDataService の判定と揃える。renderer 側に既存があれば再利用）。

### backend 追加（Task 1）

- **decode サイズガード**: `ImageAssetService.add` — `bytes.length > IMAGE_ASSET_MAX_BYTES`（20MB）なら Jimp.read せず `{result:'Error', code:'invalid-request', message:'payload-too-large'}`。decode 後 `width*height > 100_000_000`（1億px）も同様に拒否（減圧爆弾対策）。定数 export。
- **findReferences(uid)**: SqliteDataService に `findAssetReferences(uid)` — poi_sources の data_json を LIKE `%"<uid>"%`（UUID-shape guard 付き、findPoiSourceReferences と同パターン）で検索し `{poiSources: {uid, slug, title}[]}` を返す。icon/selectedIcon/image のどこで参照されていても文字列一致で拾える（uid は UUID で誤爆しない）。
- **pickImageFile**: `imageassets:pickImageFile` IPC（dialog.showOpenDialog、画像拡張子フィルタ png/jpg/jpeg/webp/gif/svg、キャンセル→null。poisource:pickImportFile と同型）。
- preload `window.imageAssets` に findReferences / pickImageFile を追加、electron.d.ts 更新。

### `src/views/AssetList.vue` + ルート + Header タブ（Task 3）

- PoiSourceList の MapList-mirror パターン踏襲: 検索（window.imageAssets.search）+ サムネイルグリッド（file:// を `<img loading="lazy">`、壊れた画像は no_image.png fallback）+ 追加（pickImageFile → slug/title 入力モーダル、slug は title から自動提案 + checkSlug 可用性、Phase 3 と同じ流儀）+ rename（slug/title 編集、revision 楽観ロック → 保存結果 union 分岐）+ 削除（findReferences → 参照一覧を確認ダイアログに表示して AID-006 の BM-121-A 同型、_trash 退避は backend 既存）+ 逆参照表示。
- route `/assets`（name: AssetList）、Header に Assets タブ（POI タブと同じ方法、isAssetSection）。
- i18n `assetlist.*` を11ロケール。

### `src/components/AssetPicker.vue`（Task 4）

- モーダル。タブ3つ: **Icon set**（listIconSets → グリッド、previewUrl サムネ）/ **Assets**（imageAssets.search + グリッド）/ **URL**（テキスト入力）。選択で `select(ref: string)` を emit（iconset → `{setId}:{iconId}`、asset → uid、URL → そのまま）。
- 用途フラグ `mode: 'icon' | 'image'`: image 用途では Icon set タブを出さない（image は参照文法対象外、asset uid か URL）。
- PoiAttributeForm: icon/selectedIcon の text 入力を「現在値の解釈表示（parseIconRef → iconset はサムネ+ID、asset は slug 解決表示、URL は短縮表示、未登録 setId は警告 badge）+ 選択ボタン + クリア + 手入力 fallback（text 入力も残す — 参照文法直書きは引き続き可）」に差し替え。選択結果は既存 `onIconChange` 経路へ。image リストの各行にも picker ボタン（mode:'image'）。readOnly 連動。

---

## Tasks（直列。各 Task 完了ごとに検証、最後に品質レビュー）

### Task 1: backend ハードニング + 新 IPC（TDD） — 完了 2026-07-10
**Files:** Modify `electron/services/ImageAssetService.ts`, Modify `electron/services/SqliteDataService.ts`（findAssetReferences）, Modify `electron/ipc/assets-images.ts`, Modify `electron/preload.ts` / `src/electron.d.ts`, Modify `scripts/m9-t4-image-asset-smoke.mjs`

- [x] m9-t4 にケース追加（先に FAIL 確認）: 巨大バイト（21MB ダミー）→ invalid-request / findAssetReferences が icon 参照・image 参照の poi_source を拾い、非参照は拾わない / UUID 形でない ref は空
- [x] 実装（サイズガード・findAssetReferences・pickImageFile IPC・preload/d.ts）
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Harden image assets with decode guards and reverse references`
  - 判断: pickImageFile のフィルタから svg を除外(Jimp が SVG をデコードできず add が invalid-request で拒否するため — pick できても必ず失敗する形式をダイアログに出さない)。
  - 追記（Task 5 品質レビュー MAJOR-1）: webp も同じ理由でフィルタから除外。Jimp 1.6 は webp decode 非対応で、実機で "Mime type image/webp does not support decoding" を確認済み（@jimp/wasm-webp 導入は本 Phase 対象外）。

### Task 2: iconRefs resolver + builtin セット（TDD） — 完了 2026-07-10
**Files:** Create `src/utils/iconRefs.ts`, Create `public/icons/builtin/*.svg`（5種）, Create `scripts/m6-t2-icon-refs-smoke.mjs`, Modify `package.json`

- [x] unit smoke 先行（lib ビルド）: 判別順序（`https://…`→url / `builtin:defaultpin`→iconset / UUID→asset / `foo:bar`→iconset+未登録 / `data:image/…`→url / 相対パス→url / `http:x` は setId 予約で url）/ formatIconRef 往復 / listIconSets に builtin
- [x] FAIL 確認 → 実装 → PASS + `pnpm build` GREEN
- [x] Commit: `Add the POI icon reference grammar resolver with a builtin icon set`
  - 追加で固定したエッジケース: 大文字始まり setId（`Builtin:defaultpin`）は文字種違反 → url 扱い / `builtin:`（iconId 空）も url 扱い（iconId 必須）/ UUID は大文字小文字を区別しない（SqliteDataService の UUID_PATTERN 準拠）。

### Task 3: Assets タブ — 完了 2026-07-10
**Files:** Create `src/views/AssetList.vue`, Modify `src/router/index.ts` / `src/components/Header.vue`, Create `scripts/m6-t3-asset-list-smoke.mjs`, Modify `package.json`, 11 locale

- [x] 設計コントラクト通り（検索/グリッド/追加/rename/削除+逆参照）。smoke はソースパターン方式（imageAssets API 配線・findReferences before delete・checkSlug・ipcRenderer 不使用・Header/router 配線）
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Add the image asset manager tab`
  - 判断: rename の revision-conflict は「読み直す/上書き」の選択 UI を作らず、モーダルを閉じて一覧再読込 + 通知に留めた（rename は slug/title のみで再読込後すぐやり直せる — 一覧画面の軽量版として妥当）。rename の title 編集は表示中の言語キーのみ書き戻し、他言語エントリは保持（LangResource 内部形の欠落防止）。i18n の件数系変数は i18next の複数形解決を踏まないよう `count` でなく `num` を使用。

### Task 4: AssetPicker + PoiAttributeForm 差し替え — 完了 2026-07-11
**Files:** Create `src/components/AssetPicker.vue`, Create `src/composables/useAssetThumbnails.ts`, Modify `src/views/AssetList.vue`, Modify `src/components/PoiAttributeForm.vue`, Modify `scripts/m4-t5-poi-edit-smoke.mjs` / `scripts/m6-t3-asset-list-smoke.mjs`, 11 locale

- [x] 設計コントラクト通り（3タブ picker / icon 欄の解釈表示+選択+手入力 fallback / image 行 picker / 未登録 setId 警告 / readOnly）
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Wire the asset picker into the POI attribute form`
  - 判断: AssetList の search + token ガード + getFilePath サムネ解決は `useAssetThumbnails` composable に抽出して AssetPicker と共用（AssetList は同時置換・挙動不変）。これに伴い m6-t3 smoke の list/search/getFilePath/loadToken 検証は composable 側へ追随（add/rename/delete/findReferences/pickImageFile は AssetList 本体のまま）。
  - 判断: asset 参照の解釈表示は imageAssets.get + getFilePath の非同期解決のため後着優先トークンで古い応答を破棄。get の IPC 例外も「未存在 asset」警告に落とす（解釈表示は警告表示のみで commit 経路に影響しない）。
  - 判断: 登録済み set の未知 iconId は previewUrl の `<img @error>` でサムネ非表示に留める（仕様 §7 の警告対象は未登録 setId のみ）。

### Task 5: 品質レビュー + 修正 — 完了 2026-07-11
- [x] Phase 6 差分の品質レビュー（二段目）→ 指摘修正 commit → 全ゲート再実行
- [ ] 人間テスト手順を本ファイル末尾に追記

指摘と対応（MAJOR 2件・MINOR 3件・補強 1件）:
- MAJOR-1: `electron/ipc/assets-images.ts` の pickImageFile フィルタから `webp` を除去（Jimp 1.6 は webp decode 不可。実機で "Mime type image/webp does not support decoding" を確認済み）。
- MAJOR-2: picker 表示中はグローバルキー（undo/redo/Delete/menu:undo/redo）を抑止する。`PoiAttributeForm.vue` が `pickerOpen` を defineExpose し、`PoiEdit.vue` の `onHistoryKeydown`/`onDeleteKeydown`/`onMainProcessMessage` が先頭でガード。加えて `onPickerSelect` の image 分岐で `picker.imageIndex` の範囲外を console.warn + no-op に。
- MINOR-1: `src/utils/iconRefs.ts` の `parseIconRef` で `scheme://...`（`rest.startsWith("//")`）は setId 判定より先に url 判定するよう順序修正（`ftp://`/`s3://` 等の予約外 scheme を setId 誤認しないように）。
- MINOR-2: `AssetPicker.vue`/`AssetList.vue`/`PoiSourceList.vue` の Escape ハンドラ先頭に `if (event.isComposing) return;` を追加（IME 変換取り消しの誤爆防止）。
- MINOR-3: `IconSetDef.title`（ハードコード "Builtin"）を `titleKey`（`poiedit.picker.set_builtin`）へ変更、11 locale に追加（既存の `applist.base_map_scopes.builtin` と同じ訳語を再利用）。
- 補強: `exceedsPixelLimit(width, height): boolean` を `ImageAssetService.ts` から純関数 export に切り出し、`add` はそれを呼ぶ形にリファクタ（挙動不変）。m9-t4 に境界値ユニットテスト（10000×10000=false / 10000×10001=true）+ ソースパターン断言を追加。
- 繰り越し（MINOR-4、未対応）: decode 前のヘッダ寸法先読み（Jimp.read せずに width/height を得て伸長爆弾ガードをさらに前倒しする）は本 Phase 対象外。次回、画像処理まわりに触る Phase で検討する。
- Commit: `Harden the asset picker and icon resolver per Phase 6 quality review`

## Self-Review 済み確認事項

- §7 の「Assets タブは独立 header タブ / image asset のみ / 一覧・追加・削除・逆参照 / picker 共用」「resolver は registry 引きで hardcode 分岐禁止 / 未登録 setId は警告 / 予約 scheme」「blob 内は参照文法のまま・export 解決は Phase 7（POI-117）」を全てカバー。
- Phase 2 引き継ぎ①（jimp サイズガード required before picker）= Task 1。③（add の DB-first/file-fail 回復導線）= rename/delete が既存なので AssetList のエラー表示で「削除→再追加」を案内する文言のみ（Task 3 に含める）。②（NotFoundError 兄弟統合）は次のコピー時なので本 Phase 対象外。
- アイコンのエディタ地図への描画反映（feature の icon に応じたピン差し替え）は §3.3 に要求がなく **スコープ外**（viewer preview で確認する。Phase 7 の export 解決後に viewer で見える）。
- 削除ガードは「参照表示 + 確認」（AID-006 の BM-121-A 同型）であり、参照ありでも削除自体は可能（POI 側は未解決 asset として警告になる — 未解決表示は picker の解釈表示が担う）。