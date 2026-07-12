# Phase 5: raw GeoJSON 双方向ペイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PoiEdit に raw GeoJSON 双方向編集ペイン（POI-136）を追加し、その前提として backend が仕様 §2.3 に違反して layer metadata を破棄しているバグを修正する。

**Architecture:** 表示は Phase 2 実装済みの `toExportForm`（export 形 = FC.id/name に slug/title、`_maplat*` 剥がし、交換形 collapse、icon 参照文法のまま）、Apply は `fromExportForm`（validate + Feature.id による UID 照合）→ session への **1 commit**（= 1 Undo、仕様 §5）。POI-141 の規模ガード超過時は read-only。

**Tech Stack:** Vue 3 / `usePoiEditSession.commit`（Phase 4）/ `src/utils/poiGeoJson.ts` の toExportForm・fromExportForm・validateFeatureCollection / smoke = m9-t3 追記 + m4-t5 追記

**正本仕様:** `../../NextTargets/43-poi-editor-spec.md` §3.3 raw ペイン項・§2.3 Layer metadata・§5（raw Apply = 1 Undo）・§6。

**前提事実（Phase 4 レビューで確定）:**
- `PoiSourceService.prepare()`（electron/services/PoiSourceService.ts:127-142 付近）が `{type, features}` のみ再構成し、FC トップレベル metadata を保存時に破棄している。§2.3 は `icon`/`selectedIcon`/`hide`（編集対象、POI-111）と `poiTemplate`/`iconTemplate`/`poiStyle`（UI なしで round-trip 保持、POI-007/111）の保存を要求 → **backend バグ**。
- §2.3 により **FC.id / FC.name は独立概念として持たない**（slug / title 由来、export 時に書き込む）。よって data_json には保存しない（raw Apply では slug/title への写像として扱う）。
- `usePoiEditSession` は既に layerMeta を保持・`toSaveFc()` で復元する（Phase 4 Task 4）。backend 修正だけで round-trip が成立する。
- `fromExportForm(parsed, previous, defaultLang?)` → `{features, issues}`（issues 非空なら適用不可）。`toExportForm(fc, slug, titleInternal, {roundCoordinates?, defaultLang?})`。座標丸めは export 専用（raw ペインでは `roundCoordinates: false` — Store の精度を劣化させない）。
- 規模閾値は poiGeoJson の `SCALE_FEATURE_COUNT`(1000) / `SCALE_BYTE_SIZE`(5MB)。validateFeatureCollection が scale-* issue を返すので判定に流用可（または定数 export）。

---

## 設計コントラクト

### Task 1: backend layer metadata round-trip（バグ修正）

`PoiSourceService.prepare()` の FC 再構成を「トップレベルの全メンバーを保持、ただし `id` / `name` は**削除**（slug/title 由来のため。保存しないことで data_json 不変条件『uid/slug を含まない』§ADR-0007 も守られる）、`type: "FeatureCollection"` と検証済み `features` は再構成」に変更する。

- 未知キー（`customMeta` 等）も保持する（POI-007 系テンプレートの将来拡張を壊さない）。
- `detail()` / `get` の返す fc にトップレベル metadata が含まれることを確認（dataJson 経由なら自動）。
- import / registerRemote / refreshRemote / cloneToLocal も同じ prepare を通るため一括で直る（確認のみ）。
- smoke: m9-t3 に「icon/selectedIcon/hide/poiTemplate/未知キーが save → get で round-trip し、id/name は保存されない」ケースを追加。

### Task 2: PoiRawPane.vue + PoiEdit 配線

```ts
// src/components/PoiRawPane.vue
props: { session: PoiEditSession; readOnly: boolean }   // readOnly = remote ソース
emits: なし（apply は session.commit を直接実行。エラーはペイン内表示）
```

- **表示**: `toExportForm(session.toSaveFc(), state.slug, state.title, { roundCoordinates: false })` を pretty JSON（2 space）で textarea に。session snapshot（shallowRef 同一性）の watch で再生成 — ただし**ユーザー編集中（ローカル dirty）は上書きしない**。「破棄して再生成」ボタンでローカル編集を捨てて最新 snapshot 表示に戻せる。
- **Apply**（ボタン。ローカル dirty かつ編集可のときのみ有効）:
  1. `JSON.parse` 失敗 → 構文エラー表示（行番号があれば添えて）、適用しない。
  2. `fromExportForm(parsed, state.features)` → `issues` 非空 → `poiSourceMessages.issueMessage` で一覧表示、適用しない（scale-* は warning なので適用は許す — validateFeatureCollection の issue を error/warning で区別。エラー系コード = geometry-not-point / coord-range / name-required / display-id-* / no-content 以外の scale-* は warning）。
  3. トップレベルの写像: `parsed.id`（string なら）→ draft.slug（`SLUG_PATTERN` 違反はエラーで適用不可。グローバル一意は保存時の Exist に委ねる）/ `parsed.name` → draft.title（normalizeLangResource）/ その他トップレベル（type/features/id/name 除く）→ draft.layerMeta 差し替え。
  4. `session.commit` **1 回**で features + slug + title + layerMeta を差し替え（= 1 Undo、仕様 §5）。適用後はローカル dirty 解除（次の snapshot から再生成表示）。
- **規模ガード（POI-141）**: 表示対象が 1000 feature 超 or serialize 5MB 超 → textarea を readOnly + `poiedit.raw_size_guard` 通知（表示はする。地図・フォーム編集は通常どおり）。remote ソース（props.readOnly）も readOnly。
- **レイアウト**: PoiEdit 中央カラム下部の折りたたみペイン（ヘッダにトグルボタン `poiedit.raw_pane`。開くと地図の下に高さ ~40% で出現。地図が主役の原則維持）。閉じている間は表示再生成を止める（大規模 FC の JSON.stringify を毎 commit 走らせない）。
- **slug 欄との整合**: raw Apply で slug が変わったらヘッダ slug 欄も追随（session.state 由来なら自動。checkSlug を再実行）。
- i18n: `poiedit.raw_pane / raw_apply / raw_discard / raw_dirty_notice / raw_parse_error / raw_size_guard` 等を11ロケール。
- smoke: m4-t5 に Part 9（PoiRawPane 存在 + toExportForm/fromExportForm 配線 + commit 1回 + 規模ガード + readOnly + ipcRenderer 不使用）。

### Task 3: 統合検証 + 品質レビュー

- 全ゲート + Phase 5 差分の品質レビュー（二段目）→ 指摘修正。
- 人間テスト手順を本ファイル末尾に追記（raw 表示⇄フォーム編集の相互反映 / Apply 1 回 = Undo 1 回 / Feature.id 維持で UID が保たれる（表示 ID 変更なしの往復で選択が維持）/ 構文エラー・validation エラーで適用不可 / 1000件超で read-only）。

---

## Tasks

### Task 1: backend layer metadata round-trip
**Files:** Modify `electron/services/PoiSourceService.ts`, Modify `scripts/m9-t3-poi-service-smoke.mjs`

- [x] m9-t3 に round-trip ケース追加（先に書いて FAIL 確認 → 修正 → PASS）
- [x] prepare() 修正（id/name 削除・他トップレベル保持）
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Preserve POI layer metadata through save round-trips`（0b5e144）

### Task 2: PoiRawPane + 配線
**Files:** Create `src/components/PoiRawPane.vue`, Modify `src/views/PoiEdit.vue`, Modify `scripts/m4-t5-poi-edit-smoke.mjs`, 11 locale

- [x] 設計コントラクト通り実装（表示 / Apply 4 手順 / 規模ガード / 折りたたみ / i18n / smoke Part 9）
- [x] `pnpm build` GREEN + 全 smoke PASS
- [x] Commit: `Add the bidirectional raw GeoJSON pane to PoiEdit`

### Task 3: 統合検証 + 品質レビュー
- [x] 全ゲート再実行 + Phase 5 差分品質レビュー → 指摘修正 commit `c8bda69`（MAJOR: id 欠落 Apply 素通り→fromExportForm 内 ensureDisplayIds + display-id-assigned warning / stale Apply 通知 / 保存中 Apply の slug 欄乖離ガード / FC.id 非 string エラー化）→ 全ゲート GREEN（2026-07-10）
- [x] 人間テスト手順追記（下記）

## Phase 5 人間テスト手順（GUI 実機。Phase 4 手順の続き）

13. **raw 表示**: エディタで「Raw」トグル → export 形 JSON が表示される（`_maplat*` プロパティなし、FC.id=slug、FC.name=title）。フォームで name を変更 → raw 表示が追随。
14. **Apply 1回=Undo 1回**: raw で feature の name と FC.id（slug）を書き換えて Apply → 地図・フォーム・slug 欄すべて反映 → Cmd+Z 1回で **全部**（slug 含む）元に戻る。
15. **エラー系**: JSON を壊して Apply → 構文エラー表示・適用されない。座標に 999 → validation エラーで適用不可。`"id": 123`（数値）→ エラー。feature から `"id"` を消して Apply → 自動採番の警告が出て適用される。
16. **stale 警告**: raw を1文字編集 → 地図でピンをドラッグ → raw ペインに「エディタ側が更新されています」警告。「破棄して再生成」で最新に戻る。
17. **規模ガード**: 1000件超のソースで raw を開く → read-only 表示 + 通知。地図・フォーム編集は可能なまま。
18. **layer metadata 往復**: raw で FC トップレベルに `"hide": true` を足して Apply → 保存 → 再読込 → raw に `"hide": true` が残っている（Phase 5 Task 1 の backend 修正確認）。

## Self-Review 済み確認事項

- §3.3「Apply = validate → Feature.id 照合 → 1 undo push / 失敗時 apply 不可」「規模ガードで read-only」「表示は export 形・icon 参照文法のまま」を Task 2 が全てカバー。
- 座標丸め（POI-143）は package export 限定 — raw ペインは `roundCoordinates: false`（Phase 2 決定の踏襲）。
- `parsed.id` → slug 写像は §2.3「FC.id = slug」の双方向読み。グローバル一意チェックを Apply 時にしないのは仕様 §6（slug 重複 = 保存不可）の検証点が保存であるため。
- Phase 4 繰り越しのうち本 Phase で扱うのは layerMeta のみ。image 空行 UX・ロケール parity 恒久化・route token は引き続き繰り越し。