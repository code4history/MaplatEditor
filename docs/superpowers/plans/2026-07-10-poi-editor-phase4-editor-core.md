# Phase 4: POI エディタ本体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/poisources/:sourceId` を地図中心の POI エディタ（contextmenu 追加/削除・ドラッグ移動・属性フォーム・feature 一覧・Undo/Redo・revision 楽観ロック保存）に置き換え、同時に MapEdit/AppEdit/POI の保存フローを `useRevisionedAssetSave` に共通化する。

**Architecture:** Phase 2 バックエンド（`window.poiSources.get/save`、結果 union）と Phase 1 の revision 楽観ロックの上に、renderer 側だけを構築する。保存の conflict ループは新設 composable に集約（3 ビュー同時移行）。Undo は MapEdit のデバウンス deep-watch 方式ではなく、仕様 §5 の「1 Undo 単位」を `commit()` 明示 push で実装する（structural sharing）。

**Tech Stack:** Vue 3 `<script setup>` / OpenLayers（`src/libs/ol-contextmenu` 同梱版 + OL Modify）/ `UndoStack<T>`（`src/services/editorUndoStack.ts`）/ smoke = `scripts/m4-*-smoke.mjs`（vite lib ビルド unit + .vue ソースパターン）

**正本仕様:** `../../NextTargets/43-poi-editor-spec.md` §3.3（raw ペイン除く= Phase 5）/ §4 / §5 / §6。ADR-0007。

**調査済み事実（Explore 2026-07-10、file:line は当時点）:**
- 保存 conflict フロー確立版: `MapEdit.vue:2470-2560`（`Change:{oldSlug}`/`copyFromUid`/部分成功 Error{revision} 引き継ぎあり）、`AppEdit.vue:596-660`（copy フロー無し）。ダイアログは `window.dialog.showMessageBox`。
- `window.poiSources.save(uid, {slug,title,fc,expectedRevision})`（`electron.d.ts:132-142`）。結果 union は `PoiSourceService.ts:88-94`（ReadOnly あり・Error に uid/slug/revision 拡張なし）。
- 前例ゼロで新規: LangResource 言語別編集 UI / マーカー点の OL Modify ドラッグ / virtual list（依存も無し）/ html XSS 警告。
- 離脱確認はルートガードでなく goBack ボタン方式（`MapEdit.vue:2878-2890`）+ `confirm_no_save` ダイアログ。
- ol-contextmenu: `new ContextMenu({width:170, defaultItems:false})`、`open` イベントで `forEachFeatureAtPixel`→`clear()`→動的 `push()`（`MapEdit.vue:1289-1362`）。
- base map selector: `currentBaseMapID='osm'` + `setupBaseMaps()`（`MapEdit.vue:186, 2157+`、失敗時 `/tms_list.json` fallback）。
- 言語一覧: `src/utils/editorLanguages.ts` の `LANGS_MAP`（11言語）。

---

## 設計コントラクト

### `src/composables/useRevisionedAssetSave.ts`（新規、3 ビュー共用）

```ts
import { ref, type Ref } from "vue";

/** maps/apps/poi_sources 共通の保存結果 union（各画面の TResult はこれの部分集合+拡張） */
export type RevisionedSaveResult =
  | { result: "Success"; uid: string; slug: string; revision: number }
  | { result: "Exist" }
  | { result: "Invalid"; issues?: unknown }
  | { result: "ReadOnly" }
  | { result: "Error"; code?: string; message?: string; uid?: string; slug?: string; revision?: number | null }
  | { error: "revision-conflict"; current: number };

export interface RevisionedAssetSaveOptions<TResult extends RevisionedSaveResult> {
  /** IPC 送信。expectedRevision === undefined は「上書き」再送を意味する */
  send: (ctx: { uid: string | undefined; expectedRevision: number | undefined }) => Promise<TResult | null>;
  /** Success: composable が uid/revision/confirmedSlug を更新した**後**に呼ばれる（router.replace・status 更新・resetHistoryBase はここ） */
  applySuccess: (r: Extract<TResult, { result: "Success" }>) => void | Promise<void>;
  /** 「読み直す」: 編集破棄して最新版を再読込 */
  reloadFromStore: () => Promise<void>;
  isDirty: () => boolean;
  /** Exist（→onlyOne=false は各画面）/ Invalid / ReadOnly / Error の画面別処理。
   * Error に revision!=null が載る部分成功（maps のみ）は composable が uid/revision/confirmedSlug を
   * 先に取り込んでから渡す（次リトライへの引き継ぎ、MapEdit:2525-2533 の移植） */
  onFailure: (r: Exclude<TResult, { result: "Success" } | { error: "revision-conflict" }>) => void | Promise<void>;
  /** i18n キー: conflict = common.revision_conflict, discard = 各画面の confirm_no_save */
  messages: { conflict: string; discard: string };
}

export interface RevisionedAssetSaveHandle {
  uid: Ref<string | undefined>;
  revision: Ref<number | undefined>;
  confirmedSlug: Ref<string | undefined>;
  saving: Ref<boolean>; // 再入防止（二重クリック）
  /** 読込成功時に呼ぶ */
  adoptLoaded(v: { uid: string; slug: string; revision: number }): void;
  /** 保存本体。conflict → showMessageBox(読み直す/上書き) → 上書きは expectedRevision:undefined で再送、
   * 読み直すは isDirty なら discard 確認後 reloadFromStore。再帰でなくループで実装。
   * expectedRevision 省略時は revision.value（MapEdit の copy 保存は {expectedRevision:undefined} を明示） */
  performSave(initial?: { expectedRevision: number | undefined }): Promise<void>;
}

export function useRevisionedAssetSave<TResult extends RevisionedSaveResult>(
  options: RevisionedAssetSaveOptions<TResult>
): RevisionedAssetSaveHandle;
```

移行原則: **挙動不変**。MapEdit の `Change:`/copy 判定・tins 収集・`status` 更新は MapEdit 側の `send`/`applySuccess` クロージャに残す。ダイアログ文言・ボタン順（buttons:[reload, overwrite], cancelId:0）も現行踏襲。

### `src/composables/usePoiEditSession.ts`（新規）

```ts
import type { LangResource, PoiEditorFC, PoiEditorFeature } from "../utils/poiGeoJson";

export interface PoiEditState {
  slug: string;
  title: LangResource;
  features: PoiEditorFeature[];
  /** fc の features 以外のトップレベル（name 等 layer metadata）をそのまま保持 */
  layerMeta: Record<string, unknown>;
}

export function usePoiEditSession(): {
  state: Readonly<Ref<PoiEditState | null>>;
  selectedUid: Ref<string | null>;            // Undo 対象外
  isDirty: ComputedRef<boolean>;
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  load(detail: { slug: string; title: LangResource; fc: PoiEditorFC }): void;
  /** 仕様 §5 の 1 Undo 単位 = commit 1 回。mutate は draft（shallow copy 済み state、
   * features 配列は新配列）を書き換える。**変更する feature だけ** structuredClone し、
   * 未変更 feature はオブジェクト共有（structural sharing） */
  commit(mutate: (draft: PoiEditState) => void): void;
  addFeature(lngLat: [number, number]): string; // 表示ID自動採番(_maplatId 最大数値+1)、空属性、返り値=新 feature uid。1 commit
  removeFeature(uid: string): void;             // 1 commit
  moveFeature(uid: string, lngLat: [number, number]): void; // 1 commit（ドラッグ 1 回 / 座標入力確定）
  patchFeatureProperties(uid: string, patch: Record<string, unknown>): void; // フィールド 1 確定 = 1 commit
  undo(): void;
  redo(): void;
  markSaved(): void; // resetHistoryBase 相当（UndoStack.save() + 履歴再基準化）
  toSaveFc(): PoiEditorFC; // layerMeta + features を FC に再構成（保存・診断用）
};
```

- 内部は `UndoStack<PoiEditState>`。MapEdit のデバウンス deep-watch は**使わない**（明示 commit のみが push する）。
- 表示 ID の採番・一意判定は `src/utils/poiGeoJson.ts` の既存関数を再利用（重複実装禁止）。
- feature uid は `_maplatUid`（Phase 2 の ensureFeatureUids 済み前提。get 経由データは常に付与済み）。

### `src/components/LangResourceInput.vue`（新規、共用部品）

```ts
props: {
  modelValue: string | Record<string, string> | undefined;
  multiline?: boolean;   // desc/html 用 textarea
  warning?: string;      // html の XSS 警告文（非空値があるときのみ表示）
}
emits: ["update:modelValue"]; // change/blur 確定時のみ emit（入力毎ではない）= 1 Undo 単位
```

- タブ = `LANGS_MAP` の 11 言語。値が string の場合はデフォルト言語（ja）単一欄 + 「他言語を追加」でオブジェクト化。空文字言語は emit 時に削除（`poiGeoJson` の collapse 規約と整合）。

### `src/views/PoiEdit.vue`（新規、`PoiSourceDetail.vue` を置換）

- 構成: 地図ペイン（主役）+ 右カラム（属性フォーム `PoiAttributeForm.vue` / feature 一覧 `PoiFeatureList.vue`）+ ヘッダ（title/slug 編集・保存・戻る・Undo/Redo）+ 診断領域。
- 地図: MapEdit と同じ MaplatMap ラッパで単一マップ。base map selector は `setupBaseMaps()` パターンを移植（default `osm`、IPC 失敗時 `/tms_list.json`）。
- マーカー: `marker` vector layer。スタイルは SVG ピン data URI の `Icon`（選択中は色違い）。クリック=単一選択（`forEachFeatureAtPixel`、hitTolerance 5）。
- **OL Modify（新規配線）**: marker source に `Modify` + `Snap`。`modifyend` で `session.moveFeature(uid, lngLat)`（=1 Undo）。ドラッグ中の中間状態は commit しない。
- contextmenu: 空地で「POI を追加」→ `session.addFeature(座標)` + フォームへフォーカス。feature 上で「この POI を削除」。選択中 Delete キー / フォーム削除ボタンも `removeFeature`。
- キーボード: Cmd/Ctrl+Z / Shift+Z / Y + `menu:undo/redo` IPC（MapEdit `onHistoryKeydown`/`onMainProcessMessage` と同パターン。入力要素 focus 中は無視）。
- 保存: `useRevisionedAssetSave` + `window.poiSources.save(uid, {slug, title, fc: toSaveFc(), expectedRevision})`。ボタンは `!isDirty || saving` で disabled。slug 変更は `assets.checkSlug`（excludeUid）で事前チェック、`Exist` → onlyOne=false 表示。`ReadOnly`（remote）はフォーム全体を read-only 化し「ローカル複製」導線（Phase 3 の cloneToLocal）を出す。
- 離脱確認: goBack ボタンで `isDirty` → `poiedit.confirm_no_save` showMessageBox → OK で `/poisources` へ。
- 診断領域: POI-108 無コンテンツ警告（`hasContent` 全滅時）/ POI-121 規模警告（>1000 features または serialize >5MB）/ 保存 `Invalid` の issues 一覧。
- 座標直接入力: フォームの lon/lat number 入力、確定時に `±180/±90` 域外はエラー表示で commit しない（仕様 §6）。

### `src/components/PoiAttributeForm.vue` / `src/components/PoiFeatureList.vue`（新規）

- Form: 表示 ID（`[A-Za-z0-9_-]+` + ソース内一意、violation はエラーで確定不可）/ name（LangResourceInput、必須）/ desc・html（multiline。html は値があるとき `poiedit.html_xss_warning` を warning 表示、サニタイズはしない= POI-109）/ address / url / image リスト（文字列複数、追加/削除）/ icon（**短期はテキスト入力**。参照文法の picker は Phase 6 で差し替え）/ 座標入力。各フィールド確定 = `patchFeatureProperties` 1 回。
- List: フィルタ入力（表示 ID / name / desc を全言語 lowercase 部分一致）+ **自前の固定行高 windowing**（依存追加なし: rowHeight 32px、scrollTop から可視 slice + overscan 10 行、上下 spacer div）。行クリック = 選択 + 地図 pan（`view.animate`）。選択行への scroll-to-selected。「新規作成」= 地図中央に `addFeature` + フォームフォーカス。
- 旧 `PoiFeatureTable.vue` / `usePoiSourceDetail.ts` / `PoiSourceDetail.vue` は削除（router は `/poisources/:sourceId` → `PoiEdit.vue` に付け替え）。**m3-t3 smoke の PoiFeatureTable アサーションは新部品のアサーションに差し替える。**

### i18n

`poiedit.*` キー（confirm_no_save / html_xss_warning / revision 系は common 流用 / no_content_warning / size_warning / display_id_error 等）を **11 locale 全部**に追加（`public/locales/*`。既存 `mapedit.*` の訳調を踏襲）。

---

## Tasks（直列実行。各 Task 完了ごとに二段階レビュー）

### Task 1: useRevisionedAssetSave + unit smoke（TDD）
**Files:** Create `src/composables/useRevisionedAssetSave.ts`, Create `scripts/m4-t1-revisioned-save-smoke.mjs`, Modify `package.json`（`smoke:m4-t1-revisioned-save`）

- [x] smoke を先に書く: vite lib ビルド（m6-app-source-model-smoke.mjs 方式、vue はバンドル）で composable を import し、fake send/dialog で検証。`window.dialog.showMessageBox` は `globalThis.window = { dialog: { showMessageBox: fake } }` で注入。ケース: ①Success で uid/revision/confirmedSlug 更新 + applySuccess 呼出 ②Exist/Invalid/ReadOnly/Error → onFailure ③conflict→上書き(response:1)→ expectedRevision:undefined で再送→Success ④conflict→読み直す + dirty → discard 確認 OK → reloadFromStore ⑤discard キャンセル → 何もしない ⑥Error{revision:5,uid,slug} 部分成功 → 取り込み後 onFailure ⑦saving 中の再入は no-op ⑧send が null → onFailure 相当の安全終了
- [x] 実行して FAIL を確認 → 実装 → PASS
- [x] `pnpm build` GREEN
- [x] Commit: `Add useRevisionedAssetSave composable for the shared optimistic-lock save flow`（03d9000）
  - 実装メモ（Task 2/3 向け）: `messages` は契約の `{conflict, discard}` に加え **`reload`/`overwrite`（conflict ダイアログのボタンラベル、t() 済み文字列）を必須で受け取る**よう拡張した。契約のままだとボタンラベルが hardcode になり i18n の挙動不変（`t("common.reload")`/`t("common.overwrite")`）を守れないため。⑧の send null は onFailure を呼ばず安全終了（null は結果 union 外のため型的に渡せない）。

### Task 2: MapEdit を composable へ移行（挙動不変）
**Files:** Modify `src/views/MapEdit.vue`, Modify `scripts/m4-t1-revisioned-save-smoke.mjs`（必要なら）, 既存 m5/m7 系 smoke は無改変で PASS が条件

- [x] `performSave` の conflict/部分成功/Exist/成功後処理を composable 呼び出しへ置換。`Change:`/copyFromUid/tins/status は send・applySuccess クロージャに残す。`revision`/`mapUid`/`confirmedSlug` ref は handle のものへ一本化
- [x] 反証: composable の conflict 分岐を一時的に殺す → 手動 or smoke で「上書き」経路が壊れることを確認して戻す
- [x] `pnpm build` GREEN + 既存全 smoke PASS（`ls scripts/m*-smoke.mjs` を全部）
- [x] Commit: `Migrate MapEdit save flow onto useRevisionedAssetSave`（8ff1a80）
  - 実装メモ（Task 3 向け）: ①saveMap→send への値渡しはモジュールスコープの `pendingSave` 一時変数（send は ctx.uid を使わない。copy 保存の sendUid=undefined/copyFromUid を閉じ込めるため）。AppEdit は copy 無しなので ctx.uid をそのまま使ってよい。②`messages` は表示時に t() されるよう **getter** で渡す（setup 時に t() すると言語切替後のダイアログが旧言語になるため）。③send 内で「result が falsy → 旧実装の最終 else と同じエラー通知 + return null」「Success で slug 欠落 → `slug ?? saveValue.mapID` フォールバック」を再現。④`revision` 別名は MapEdit 内に直接参照が残らず不要になった（vue-tsc の未使用エラーになる）。⑤`m4-undo-redo-smoke.mjs` の saveSuccessBlock 正規表現を applySuccess クロージャ（`applySuccess:` 〜 `reloadFromStore:`）に差し替え済み。m5-app-editor-smoke に AppEdit の保存分岐アサーションがあれば Task 3 でも同様の差し替えが要るか確認のこと。

### Task 3: AppEdit を composable へ移行（挙動不変）
**Files:** Modify `src/views/AppEdit.vue`

- [x] Task 2 と同型（copy フロー無しの単純系）。`Exist` → `onlyOne=false` を onFailure に
- [x] `pnpm build` GREEN + 既存全 smoke PASS
- [x] Commit: `Migrate AppEdit save flow onto useRevisionedAssetSave`
  - 実装メモ: AppEdit の旧実装は revision-conflict 以外の失敗（result null / result.result==='Error'）で
    console.error/dialog を出さず、テンプレートの `saveError` インライン alert（`v-if="saveError"`）に
    表示するだけだった（MapEdit の dialog 表示とは異なる）。この挙動をそのまま維持するため、
    `send` の result null 分岐と `onFailure` の else 分岐はどちらも `saveError.value = t("appedit.error_saving")`
    のみを行う（console.error/dialog なし）。`revision` は AppEdit 内で直接参照されなくなったため
    destructure から外した（vue-tsc TS6133 対策、Task 2 と同じ理由）。

### Task 4: usePoiEditSession + unit smoke（TDD）
**Files:** Create `src/composables/usePoiEditSession.ts`, Create `scripts/m4-t4-poi-edit-session-smoke.mjs`, Modify `package.json`

- [x] smoke 先行（lib ビルド unit）: ①load→isDirty=false ②addFeature が表示 ID 採番 + 1 undo ③patchFeatureProperties 1 回 = 1 undo（undo で戻る）④moveFeature/removeFeature 各 1 undo ⑤**structural sharing: 2 feature 中 1 つだけ patch した snapshot 間で、未変更 feature がオブジェクト同一（`===`）** ⑥undo→新編集で redo 履歴破棄 ⑦markSaved 後 isDirty=false・canUndo は履歴保持 ⑧toSaveFc が layerMeta を保存 ⑨MAX_HISTORY 超過で古い履歴 drop しても isDirty 整合
- [x] FAIL 確認 → 実装 → PASS、`pnpm build` GREEN
- [x] Commit: `Add usePoiEditSession with explicit one-commit-per-operation undo`
  - 実装メモ（Task 5 向け・計画書との差分）: ①`LangResource` は `poiGeoJson` に再 export が無いため `../utils/langResource` から import する（契約の import 行と異なる）。②表示 ID 採番は契約コメントの「`_maplatId` 最大数値+1」ではなく **現物 `ensureDisplayIds` の `p1,p2,...` 未使用連番規則**（既存 p1/p3 → 新規 p2。smoke case 2 で固定）。③⑦の canUndo は「履歴保持」ではなく **UndoStack.save() の現物セマンティクス通り false になる**（history を現在 snapshot 1 件へリセット。MapEdit resetHistoryBase と同一。smoke case 7 で固定）。④selectedUid は commit/undo/redo 後に現在 snapshot に無ければ自動解除（smoke case 10 で固定）。⑤slug/title 変更は専用ヘルパを設けず `commit(draft => { draft.slug = ... })` 直接方式（オブジェクトは in-place でなく**置換**で書くこと。smoke case 8 で固定）。⑥moveFeature/removeFeature/patchFeatureProperties は未知 uid で **commit しない no-op**（履歴を汚さない）。⑦`state` は shallowRef（deep reactive にすると proxy 化で structural sharing の `===` が壊れるため）。features 配列内の変更は配列ごと差し替えで通知される前提で watch すること。

### Task 5: PoiEdit 骨格 + LangResourceInput + ルート切替
**Files:** Create `src/views/PoiEdit.vue`, Create `src/components/LangResourceInput.vue`, Modify `src/router/index.ts`, Delete `src/views/PoiSourceDetail.vue` / `src/components/PoiFeatureTable.vue` / `src/composables/usePoiSourceDetail.ts`, Modify `scripts/m3-t3-poi-source-manager-smoke.mjs`, Create `scripts/m4-t5-poi-edit-smoke.mjs`, Modify `package.json`, 11 locale へ `poiedit.*` 追加

- [x] PoiEdit: 読込（`poiSources.get(route.params.sourceId)`→ adoptLoaded + session.load）/ title・slug 編集（checkSlug excludeUid）/ 保存（useRevisionedAssetSave）/ goBack 離脱確認 / ReadOnly 表示 / 診断領域。地図・フォーム・一覧は次 Task のプレースホルダ**ではなく**この時点では未マウント（テンプレートに存在しない）こと — 中途半端な空 UI を出さない
- [x] m3-t3 から PoiFeatureTable アサーションを除去し、m4-t5 に PoiEdit 配線アサーション（useRevisionedAssetSave / usePoiEditSession / confirm_no_save / checkSlug excludeUid / ReadOnly 分岐）を追加
- [x] `pnpm build` GREEN + m3-t3 / m4-t5 / m2-t3 PASS（全 m*-smoke PASS で確認）
- [x] Commit: `Replace the POI detail screen with the PoiEdit editor skeleton`（156642a）
  - 実装メモ（Task 6 向け・計画書との差分）:
    ①PoiSourceList の ISSUE_CODE_KEYS/issueMessage + Error code→キー写像は `src/utils/poiSourceMessages.ts` へ移設（PoiEdit と共用、挙動不変）。診断・保存失敗文言は poisource.errors.* を流用し、新設キーは `poiedit.*` 13 個（confirm_no_save / no_slug / slug_available / add_other_languages / success_save / error_saving / save_issues / not_found / read_only_notice / clone_to_local / clone_failed / no_content_warning / size_warning。11 locale 追加済み）。
    ②旧 PoiSourceDetail 専用の locale キー群 `poisource.detail.*` / `poisource.feature_table.*` は全 11 locale から削除した。
    ③route 名は `PoiSourceDetail` → `PoiEdit`（Header.vue の isPoiSection も追随）。route param 変化の watcher は `next === saveHandle.uid.value` なら再読込しない（保存後の router.replace 対策）。cloneToLocal 後は router.push で新 uid へ遷移し、この watcher が再読込する。
    ④POI-108/121 の診断は `validateFeatureCollection(session.toSaveFc())` を computed で流用（hasContent は非 export のため直接判定しない）。Task 6 で feature 変更が入っても editState (shallowRef) 差し替えで再評価される。
    ⑤LangResourceInput は契約に加え `disabled?: boolean` を持つ（ReadOnly 用には現状未使用: readOnly 時は plain text 表示に切替）。emit は @change のみ（m4-t5 smoke が @input 不使用を固定）。
    ⑥slug は @input で checkSlug(excludeUid) 自動チェック（token guard、PoiSourceList 方式）+ @change で session.commit（1 Undo）。undo/redo による state.slug 変化は watcher で入力欄へ逆同期。
    ⑦キーボード undo/redo + menu:undo/redo IPC は MapEdit の onHistoryKeydown/onMainProcessMessage を移植済み。Task 6 の地図操作ハンドラはこれらと衝突しないよう入力 focus 判定を再利用すること。

### Task 6: 地図ペイン（base map + マーカー + contextmenu + ドラッグ + 選択）
**Files:** Modify `src/views/PoiEdit.vue`（規模次第で `src/components/PoiEditMap.vue` に分離可）, Modify `scripts/m4-t5-poi-edit-smoke.mjs`

- [x] setupBaseMaps 移植（osm default・fallback）→ マーカー描画（features 変更で再描画、選択スタイル）→ クリック選択 → contextmenu（追加/削除）→ **Modify+Snap で点ドラッグ、modifyend=moveFeature 1 回**（modifystart→end で座標が実際に変わった時のみ commit）→ Delete キー → 地図 pan API（一覧から使う `panTo(uid)`）
- [x] smoke に contextmenu / Modify / moveFeature 配線アサーション追加
- [x] `pnpm build` GREEN + m4 系 smoke PASS（全 m*-smoke PASS で確認）
- [x] Commit: `Wire the PoiEdit map pane with contextmenu editing and drag-move`
  - 実装メモ（Task 7/8 向け・計画書との差分）:
    ①地図は `src/components/PoiEditMap.vue` に分離した（PoiEdit 肥大化防止）。props は
    `session`（PoiEditSession をそのまま渡す。生成後不変）と `readOnly`。`panTo(uid)` /
    `fitInitialView()` を defineExpose（PoiEdit 側の `mapPane` ref 経由。Task 8 の一覧行クリックは
    `session.selectedUid` を書くだけで PoiEditMap の watch が選択スタイル + 画面外 pan を行うので、
    明示 pan が要る場合のみ `mapPane.value?.panTo(uid)` を呼ぶ）。
    ②Modify と再描画の競合対策: `modifyActive` フラグでドラッグ中の `redrawMarkers()`（source.clear）を
    抑制。modifyend で「座標が session と実際に異なる→ moveFeature（watch が全再描画）/ 変わらない→
    redrawMarkers() で canonical 位置へ戻す」の二経路に必ず到達するため取りこぼしなし。
    ③base map 一覧は `window.baseMaps.list()` の alwaysVisible のみ（POI-132 Always-Visible 適用。
    地図単位の visibility は POI ソースに無い）→ 失敗/空なら `/tms_list.json`（always 優先）→
    ハードコード osm/gsi/gsi_ortho。切替は select（LayerSwitcher 不使用、Undo 対象外）。
    ④座標は MapEdit 踏襲で経緯度 6 桁丸め（addFeature/moveFeature とも）。moveFeature の
    「実際に変わった」判定は丸め後の値と session 現値の比較。
    ⑤Delete キーは PoiEdit 側 window keydown（`isInputTarget` を onHistoryKeydown と共有）。
    Task 7 のフォーム内 input/textarea focus 中は Delete/undo/redo とも無視される（contentEditable も）。
    ⑥ReadOnly は `modify.setActive(false)` + `contextmenu.disable()`（watch で動的追随。
    cloneToLocal 遷移で writable になったら自動で有効化）。クリック選択と pan/zoom は ReadOnly でも可。
    ⑦i18n 追加キーは `poiedit.context_add` / `poiedit.context_delete`（11 locale）。
    ⑧OL feature の uid は property `_maplatUid`（`map.setMarker(coord, {_maplatUid}, style, 'marker')`）。
    marker layer/source は MaplatMap 組み込みのもの（`getSource('marker')`）を使用。

### Task 7: 属性フォーム
**Files:** Create `src/components/PoiAttributeForm.vue`, Modify `src/views/PoiEdit.vue`, Modify `scripts/m4-t5-poi-edit-smoke.mjs`

- [x] 設計コントラクト通り（表示 ID 一意エラー / name 必須 / html XSS 警告 / image リスト / icon テキスト / 座標入力の域外エラー）。確定粒度 = blur/change で patch 1 回
- [x] `pnpm build` GREEN + smoke PASS（XSS 警告・表示 ID 一意のアサーション追加）
- [x] Commit: `Add the POI attribute form with per-field undo granularity`（7352b74）
  - 実装メモ（Task 8 向け・計画書との差分）:
    ①エラー文言は新キーを増やさず `poisource.errors.display_id_charset / display_id_duplicate /
    name_required / coord_range` を再利用（issueMessage の保存時文言と同一に揃うため）。
    文字種正規表現は `poiGeoJson.DISPLAY_ID_PATTERN` を export 化して再利用（重複実装なし）。
    新設 i18n は `poiedit.*` 14 個（select_poi / display_id / name / desc / html / address / url /
    images / add_image / icon / selected_icon / coordinates / html_xss_warning / delete_poi、11 locale）。
    座標ラベルは `mapedit.longitude/latitude` を流用。
    ②image は POI-110 の string | array | {src,desc} object を全受容。書き戻しは
    「0件 = undefined（保存時 JSON round-trip で削除）/ 1件 = 元が配列でなければ単数形維持 /
    それ以外 = 配列」。object entry は src のみ編集し他キー（desc 等）を保持。
    ③エラー時 non-commit はローカル入力バッファ方式: 表示 ID / 座標は v-model バッファ +
    @change で検証し、違反時はエラー ref のみ立てて commit しない（欄は入力値のまま）。
    name は LangResourceInput の emit 値が空なら commit しない。バッファは「選択 feature の
    snapshot オブジェクト同一性」の watch で再初期化（structural sharing 前提 =
    当 feature が実際に変わった commit / undo/redo でのみ発火）。選択切替は :key="uid" remount で
    LangResourceInput 内部状態ごと破棄。
    ④**新規追加フォーカスは PoiEdit の `mapSession` wrapper 経由**: `addFeature` を包んで
    nextTick 後に `attrForm.focusName()` を呼ぶ。PoiEditMap には wrapped session を渡している。
    **Task 8 の一覧「新規作成」も必ずこの mapSession（wrapper）の addFeature を使うこと**
    （生 session.addFeature ではフォーカスが飛ばない）。
    ⑤右カラムは `.poi-side-pane`（固定幅 340px、border-start、overflow-auto）。Task 8 の
    feature 一覧は同カラム内の上下分割か、フォーム下部への追加かをレイアウト判断すること
    （地図が主役の比率は維持）。
    ⑥表示 ID は Feature.id のため patchFeatureProperties でなく `session.commit()` 直接
    （feature を structuredClone して id 差し替え、1 commit = 1 Undo）。
    ⑦**2026-07-11 ユーザー決定でポリシー変更**: エラー値も commit（表現不可能な入力を除く）。
    理由 = Undo の直感（エラー入力後の Undo は直前の OK 値に戻るべき）。上記③の
    「エラー時 non-commit」は廃止: 座標域外（±180/±90 外だが両方有限数値）・表示 ID の
    文字種違反/重複・name 空も commit して Undo 履歴に積み、保存側で堰き止める
    （PoiEdit の liveErrors ライブ表示 + 保存ボタン disabled + backend Invalid）。
    非 commit のまま残すのは表現不可能な入力のみ: 座標欄の空/非数値（geometry に入れられない）
    と表示 ID の空（保存時に backend ensureDisplayIds が自動採番し markSaved 後に DB と
    session が乖離するため。Phase 5 M1 と同型のバグ類型）。インラインエラーの判定源は
    ローカルバッファから committed 値の computed へ変更（undo/redo でエラー表示が正しく再現）。

### Task 8: feature 一覧（フィルタ + windowing + 選択同期）
**Files:** Create `src/components/PoiFeatureList.vue`, Modify `src/views/PoiEdit.vue`, Modify `scripts/m4-t5-poi-edit-smoke.mjs`

- [x] 自前 windowing（依存追加禁止）+ フィルタ + 行クリック選択&pan + scroll-to-selected + 新規作成ボタン
- [x] `pnpm build` GREEN + smoke PASS（全 m*-smoke PASS で確認）
- [x] Commit: `Add the filtered windowed POI feature list with selection sync`
  - 実装メモ（Task 9 向け・計画書との差分）:
    ①一覧は右カラム内でフォームの下に上下分割: `.poi-form-area`（flex: 0 1 auto、min-height 0、
    overflow-auto = 内容高さ基準で必要時のみ縮んで内部スクロール）+ `.poi-list-area`
    （flex: 1 1 auto、min-height 180px = 残り高さ）。右カラム 340px 固定は不変。
    ②windowing: ROW_HEIGHT 32px（CSS の .poi-feature-row height と二重定義、変更時は両方）、
    OVERSCAN 10 行、viewport 高さは ResizeObserver 追随、上下 spacer div。行 = 表示 ID
    （等幅・max-width 7em）+ name（localizeTitle、現在言語）+ 座標 4 桁概略。
    ③フィルタ: allRows で searchText（表示 ID + name/desc の全言語値の lowercase 連結）を
    前計算し部分一致。snapshot（shallowRef）差し替えでのみ再構築、表示専用で session 非干渉。
    ④選択/新規作成の実行責務は PoiEdit: @select → selectedUid 書き込み + `mapPane.panTo(uid)`
    明示 pan（可視範囲内でも pan する。PoiEditMap 側 watch の panToIfOffscreen と重複するが
    同一座標へのアニメーションで実害なし）。@create → PoiEditMap に新設 expose の
    `getCenterLngLat()`（view center → EPSG:4326、6 桁丸め）で地図中央を取り
    **mapSession.addFeature**（wrapper: name 自動フォーカス）+ selectedUid 書き込み。
    ⑤scroll-to-selected は selectedUid watch + マウント時。可視範囲外のときのみ
    el.scrollTop 直接設定（アニメーションなし）、フィルタで非表示ならスクロールしない。
    ⑥i18n 追加キーは `poiedit.filter_placeholder / add_poi / feature_count`（11 locale。
    feature_count は `{{filtered}} / {{total}}` 補間で全 locale 共通）。

### Task 9: 統合検証
**Files:** なし（検証のみ。発見事項の修正 commit は可）

- [x] `pnpm build` + **全 smoke** PASS（2026-07-10、29本。注: `ls | while read` は rtk の出力加工で壊れるため `for f in scripts/m*-smoke.mjs` グロブで実行するのが正）
- [x] バックエンド往復（createLocal → save → get → conflict）は Phase 2 の m9-t2/t3 smoke が既にカバー。renderer UI の流し試験は Electron 実機が必要なため人間テスト手順として下記に記録
- [x] Phase 4 全体品質レビュー（二段レビュー第二段）→ 指摘修正 `beb9aba`（MAJOR: MapEdit pendingSave の finally null 化レース / PoiEdit 保存中編集の markSaved 誤クリーン化 / macOS Backspace / 経度 wrap + 偽 commit 防止 / aria-label / poisource・common キーの9ロケールバックフィル）→ 全ゲート再実行 GREEN（2026-07-10）。**残るは人間テスト手順（下記12項目）の GUI 実機確認のみ**

---

## Phase 4 人間テスト手順（GUI 実機）

前提: `pnpm dev` 等で Editor を起動し、POI タブへ。

1. **作成と一覧**: 「ローカル作成」でタイトル `テストPOI` を入力 → slug が空のまま（日本語は候補なし）なので `test-poi` を手入力 → 可用性 OK → 作成 → 一覧に出る → 行クリックでエディタへ遷移。
2. **地図編集**: 右クリック→「POIを追加」で 3 点追加（表示 ID が p1,p2,p3 と自動採番、追加のたび name 入力へフォーカス）→ ピンをドラッグ移動 → クリックで選択切替（ピン色が変わる）→ 選択中に Delete キーで削除。
3. **Undo/Redo**: Cmd+Z を操作回数分 → すべて 1 操作ずつ戻る（追加/移動/削除/フィールド確定が各 1 単位）→ Cmd+Shift+Z で進む → メニューの Undo/Redo でも同じ。
4. **属性フォーム**: name を空にして確定 → エラーで確定されない（undo 履歴も増えない）→ 表示 ID を `p1` と重複させる/`#` を入れる → 同様にエラー → html タブに値を入れる → XSS 警告が出る → 座標に 200 を入れる → 域外エラー。
5. **一覧ペイン**: フィルタに name の一部 → 絞り込み + 件数表示（n / total）→ 地図でピンをクリック → 一覧の該当行がハイライトされ、画面外なら自動スクロール → 一覧の「POIを追加」→ 地図中央に追加され name にフォーカス。
6. **保存と離脱確認**: 編集ありで「<<」→ 破棄確認が出る（Cancel で残留）→ 保存 → 成功後は保存ボタン disabled → 「<<」で確認なしに一覧へ。
7. **revision conflict**: 同じソースを 2 ウィンドウ（または 2 インスタンス）で開き、両方で編集 → 先に A を保存 → B を保存 → 「読み直す / 上書き」ダイアログ。読み直す→ B の編集が破棄され A の内容に。上書き→ B の内容で確定。
8. **remote ReadOnly**: リモート登録したソースを開く → フォーム・地図編集が無効（pan/zoom/選択は可）→ 「ローカルへ複製」→ 複製が編集可能で開く。
9. **回帰（Task 2/3 の移行影響）**: MapEdit で地図を保存（成功・slug 変更・conflict）、AppEdit でアプリを保存 — 従来と同じダイアログ・挙動であること。
10. **大量データ**: 1000 feature 級の GeoJSON をインポート → 一覧のスクロールが軽い（DOM 行数が可視+20行程度）→ 規模警告が診断領域に出る。
11. **Undo 粒度（レビュー補強）**: ピンをドラッグ1回 → Cmd+Z 1回で完全に戻る（2回必要なら粒度退行）。remote ソースで Delete キー・ドラッグが効かないこと。
12. **保存中の編集**: ~~大きめのソースで保存クリック直後に Cmd+Z を連打 → 保存成功後も undo 分が dirty 表示のまま残る~~ → **2026-07-11 に方式変更**: 保存クリック → 応答が返るまで半透明オーバーレイ（「保存中…」スピナー）が出て編集操作が全面抑制されること。オーバーレイ解除後に通常編集へ戻ること（大きめのソースだと一瞬視認できる。速すぎて見えない場合は正常）。

## Phase 4 品質レビューからの繰り越し（Phase 5+ で決着）

- **layerMeta round-trip の契約齟齬（INFO、Phase 5 ブロッカー候補）**: usePoiEditSession は fc トップレベル（features 以外）を layerMeta として保持・復元するが、backend `PoiSourceService.prepare()` が `{type, features}` のみ再構成するため保存で破棄され、get で返る fc に layer metadata は存在しない。**Phase 5 raw ペイン（FC 全体の双方向編集）の前に、仕様 §5「layer metadata 変更も 1 Undo」と合わせて保存仕様を決める**こと（保存する→prepare 修正 / 保存しない→session から layerMeta を落とし仕様を明記）。
- image リストの未確定空行が同一 feature への別 commit（reinitBuffers）で消える（UX 軽微）。
- `i18next.language` が computed の反応的依存にならず、言語切替後の name 表示が次の snapshot まで残る（既存画面と同型、許容）。
- ロケールキーの機械照合を恒久 smoke 化する提案（今回のレビューは手動照合。既存 editor-locale-parity の NG 解消 = 9ロケール×約48キーの既存欠落バックフィルは別タスク）。
- route watcher に load 世代 token なし（現状の遷移経路は cloneToLocal のみで実害なし。deep-link 追加時に要 token）。
- アプリ終了・Header タブ遷移が離脱確認を通らない件は全エディタ共通の既存課題（ED-003-12 系、仕様 §5 注記済み）。

---

## Self-Review 済み確認事項

- 仕様 §3.3 の raw ペインは Phase 5、icon picker 差し替えは Phase 6（このプランでは icon=テキスト入力が正）。
- §5 の「slug・title 変更も 1 Undo」— PoiEdit ヘッダの title/slug 編集も `commit()` 経由にすること（Task 5 実装時の注意）。
- §6 の二重参照警告（POI-142）は App editor 側 = Phase 7 スコープ。
- 型名 `PoiEditorFC`/`PoiEditorFeature`/`LangResource` は `src/utils/poiGeoJson.ts` の既存 export に合わせる（実装時に現物確認。無い名前を発明しない）。
- `window.poiSources`（S 大文字）・route param は `:sourceId`。
