# Phase 2: poi_sources / assets バックエンド Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** POI ソースと画像アセットの正本を Write Store（maplat.sqlite）に置き、Phase 3 以降の UI が使う typed backend API（純関数 GeoJSON ロジック + service + IPC）を完成させる。

**Architecture:** Phase 1 の uid/slug/registry/revision 基盤（ADR-0007、`asset_registry` kind に `poi_source` / `asset` を追加）に載せる。POI は FeatureCollection blob + metadata columns の hybrid（ED-006-10 先行適用）。GeoJSON の純ロジック（検証・旧POI正規化・表示ID採番・`_maplatUid` 注入/剥離・export形変換）は renderer/main 双方から import できる `src/utils/poiGeoJson.ts` に置く（`langResource.ts` と同じ配置規約）。現行 PoiSourceService（electron-store + `poi-sources/{uuid}/source.geojson`）は**ゼロベース置換**し、旧ファイルはディスク上に残置（削除しない・移行もしない）。

**Tech Stack:** node:sqlite / Electron IPC typed adapter / smoke = `scripts/m9-*.mjs`（m7/m8 の vite-bundle 方式）。

**正本仕様:** `../../NextTargets/43-poi-editor-spec.md` §2 / §6 / §7、`CurrentDocs/05-glossary.md` の「旧POIオブジェクト形式」「POI layer metadata」。

---

## 設計コントラクト

### DDL 追加（SqliteDataService v2 に追記）

```sql
CREATE TABLE IF NOT EXISTS poi_sources (
  uid TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_json TEXT NOT NULL,           -- LangResource 内部形
  mode TEXT NOT NULL,                 -- 'local' | 'remote'
  url TEXT,                           -- remote のみ
  data_json TEXT NOT NULL,            -- FeatureCollection blob（editor内部形: _maplatUid 入り）
  feature_count INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assets (
  uid TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_json TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS poi_sources_fts USING fts5(uid UNINDEXED, raw UNINDEXED, words);
```

- registry kind に `'poi_source'` / `'asset'` を使用（assetIdentity の AssetKind に定義済み）。
- poi_sources FTS raw = slug + title 全言語 + 各 feature の 表示ID/name/desc テキスト（`maplat_poi_fts_raw(data_json, title_json, slug)` SQL関数を登録、トリガは maps/apps と同方式）。
- 画像バイト列は `{saveFolder}/assets/{uid}.{ext}`（43 §7 の「userData」= データフォルダの意）。DB には metadata のみ。

### `src/utils/poiGeoJson.ts`（純関数、renderer/main 共用）

```typescript
export interface PoiValidationIssue { level: 'error' | 'warning'; code: string; featureId?: string; message?: string }
export interface PoiEditorFeature extends GeoJSON.Feature<GeoJSON.Point> { id: string; properties: Record<string, unknown> } // properties._maplatUid: string

// 検証: Point-only(POI-104), lon/lat範囲, name必須(POI-107), 表示ID一意+文字種 [A-Za-z0-9_-]+ (POI-140),
// 無コンテンツwarning(POI-108), 規模warning(POI-121: >1000 features / >5MB)
export function validateFeatureCollection(fc: unknown): PoiValidationIssue[];

// 旧POIオブジェクト形式(lat/lng, lnglat, lng|longitude, image: string|array|{src,desc}) → Feature へ正規化 (glossary準拠)
export function normalizeLegacyPoi(obj: Record<string, unknown>): PoiEditorFeature;
export function normalizeLegacyPoiList(input: unknown): PoiEditorFeature[]; // 配列/FeatureCollection/単体を受容

// 表示ID採番: 既存idを尊重(文字種違反はwarning対象)、欠落分は 'p1','p2',... の未使用連番 (POI-106/134)
export function ensureDisplayIds(features: PoiEditorFeature[]): { features: PoiEditorFeature[]; assigned: string[] };

// 内部UID: properties._maplatUid が無い feature に採番。既存は維持 (POI-134)
export function ensureFeatureUids(features: PoiEditorFeature[]): PoiEditorFeature[];

// editor内部形 → export/raw表示形: _maplat* property剥離、FC.id=slug / FC.name=title交換形 (POI-133)、
// LangResource交換形collapse (ADR-0005)。
// 【重要】座標の小数7桁丸め (POI-143) は roundCoordinates:true の時のみ（= package export 経路限定）。
// raw ペイン表示は roundCoordinates:false で呼ぶこと — 丸めた表示を Apply で書き戻すと
// 「Write Store 内の値は丸めない」(43 §8) に毎回違反し、座標が静かに劣化するため。
export function toExportForm(fc: PoiEditorFC, slug: string, titleInternal: LangResource,
  options?: { roundCoordinates?: boolean }): GeoJSON.FeatureCollection;

// raw Apply 用: export形テキスト → 内部形。Feature.id で旧内部形と照合し _maplatUid を引継ぎ、新規は採番 (POI-136)
export function fromExportForm(parsed: unknown, previous: PoiEditorFeature[]): { features: PoiEditorFeature[]; issues: PoiValidationIssue[] };
```

（`PoiEditorFC` = `FeatureCollection` + editor内部メタ。LangResource 型・normalize/compact は `src/utils/langResource.ts` の既存実装を再利用し、**重複実装しない**。）

### SqliteDataService 追加 API

maps/apps と同じ factored ヘルパー（createDocRow/upsertDocRow 系）を kind 拡張して実装:

```typescript
async createPoiSource(slug: string, input: { title: LangResource; mode: 'local'|'remote'; url?: string; dataJson: string; featureCount: number }): Promise<{ uid: string }>;
async findPoiSource(uid: string): Promise<PoiSourceRecord | null>;      // uid/slug/title/mode/url/data_json/feature_count/revision
async findPoiSourceBySlug(slug: string): Promise<PoiSourceRecord | null>;
async upsertPoiSource(uid: string, slug: string, input: {...}, expectedRevision?: number): Promise<{ revision: number }>; // RevisionConflictError 共用
async deletePoiSource(uid: string): Promise<void>;
async listPoiSources(): Promise<PoiSourceSummary[]>;                     // blob は返さない(一覧軽量化)
async searchPoiSources(query: string): Promise<PoiSourceSummary[]>;      // FTS
// assets も同型 (createAsset/findAsset/upsertAssetMeta/deleteAsset/listAssets/searchAssets)
```

### PoiSourceService v2（electron/services/PoiSourceService.ts 全面置換）

- `list({query,page,pageSize})` / `get(uid)`（内部形FCを返す）/ `createLocal({slug,title})`（空FC）/ `save(uid,{slug,title,fc,expectedRevision})`（poiGeoJson.validate → エラー時保存拒否、feature_count更新。title は保存/import/登録の全経路で `normalizeLangResource` を通し内部形を強制 — ADR-0005）/ `delete(uid)`（参照チェック: apps/maps の data_json を LIKE '%"poiUid"%' 相当で走査する `findPoiSourceReferences(uid)` を提供 — Phase 7 で参照が書かれるまで常に空。AID-006 の cleanup 本体は Phase 7）
- `importFile({slug,title,filePath})`: `.geojson`/`.json` を読み、FeatureCollection または 旧POI形式を `normalizeLegacyPoiList`+`ensureDisplayIds`+`ensureFeatureUids` で内部形化して保存。Point以外含む→エラー返却（取込拒否、POI-104）
- `registerRemote({slug,title,url})`: fetch → validate → 成功時のみ登録（data_json にはfetch結果のスナップショットをcacheとして保存、mode='remote'）。`refreshRemote(uid)` で明示再取得（POI-118）。remote は save 不可（read-only、editorで clone 誘導）
  - 【仕様からの意図的逸脱の明示】43 §2.1 の「session memory cache」ではなく**DB永続スナップショット**を採る。理由: POI-118 の「network failure 時は cache で degraded 表示」を再起動を跨いで満たせる上位互換。cache 件数は登録 remote ソース数で有界なので LRU (POI-124) は Phase 7 送りのまま。ただし fetch 結果にも POI-121 閾値チェックを適用し、5MB 超は warning、極端なサイズ（例 50MB 超）は登録拒否のガードを入れる
- `cloneToLocal(uid, {slug,title})`: remote → local 複製
- IPC channel は `poisource:*` を維持しつつ引数を uid/slug 契約へ刷新。preload `window.poiSources` / electron.d.ts 型も刷新。旧 `poi-sources.json`・`poi-sources/` ディレクトリは**読みも消しもしない**

### ImageAssetService（electron/services/ImageAssetService.ts 新規）

- `add({slug,title,sourcePath})`: バイト列を `{saveFolder}/assets/{uid}.{ext}` へコピー（atomic tmp-rename）、mime/寸法は既存の画像処理依存（MapEditService のサムネイル生成が使うライブラリを再利用; 新規依存を足さない）で取得
- `list()/search(query)/get(uid)/rename(uid,{slug,title,expectedRevision})/delete(uid)`（削除はファイルも削除…ではなく `assets/_trash/{uid}.{ext}` へ退避。ユーザーデータは即時物理削除しない）
- `getFileUrl(uid)`: renderer 表示用のパス/URL（既存の tmbs 表示と同じ経路に合わせる）
- IPC `assets:*` + preload `window.imageAssets` + d.ts

## Tasks

### Task 1: poiGeoJson 純関数モジュール + smoke（TDD）
**Files:** Create `src/utils/poiGeoJson.ts`, Create `scripts/m9-t1-poi-geojson-smoke.mjs`, Modify `package.json`
- [ ] smoke 先行作成: validate(Point以外エラー/範囲/name必須/表示ID重複/文字種/無コンテンツwarning/1001件warning)、旧POI正規化(lat+lng / lnglat / lng+latitude / image文字列・配列・{src,desc} / url・address透過)、ensureDisplayIds(既存尊重+連番採番+一意)、ensureFeatureUids(維持+採番)、toExportForm(_maplat剥離/FC.id=slug/FC.name交換形/7桁丸め/交換形collapse)、fromExportForm(id照合でuid引継ぎ・新規採番・issues)
- [ ] FAIL確認 → 実装 → PASS → `pnpm build` 緑 → Commit `Add shared POI GeoJSON logic (validation, legacy normalization, export forms)`

### Task 2: Write Store poi_sources / assets テーブル + CRUD + FTS
**Files:** Modify `electron/services/SqliteDataService.ts`, Create `scripts/m9-t2-poi-store-smoke.mjs`, Modify `package.json`
- [x] smoke: create/find/rename(registry同期)/revision conflict/delete(registry掃除)/グローバルslug衝突(map vs poi_source)/searchPoiSources が feature name でヒット/listが blob を含まない/assets 同型
- [x] FAIL確認 → 実装 → PASS + 既存 m7/m8 smoke 回帰 PASS + build 緑 → Commit `Add poi_sources and assets tables to the write store`
  - 完了 (2026-07-09, commit 06657b4)。二段レビュー承認済(仕様準拠: 反証プローブ7本通過・不変条件6項目確認 / 品質: Approved)。
  - 設計判断: createDocRow/upsertDocRow の kind 拡張ではなく saveUserBaseMap 前例の専用ヘルパー方式(列構成が異なるため。upsert のロック分岐構造は upsertDocRow と同型を維持)。レビュアも妥当と判定。
  - Minor 積み残し(Phase 7 以降の任意改善): searchAssets が title_json 生JSONへのLIKE(言語コード等で偽陽性可能)、mode 列に CHECK 制約なし(maps/apps と同慣習)、searchPoiSources のチャンク取得が readDocsByUids と約15行重複。

### Task 3: PoiSourceService v2 + IPC 刷新
**Files:** Rewrite `electron/services/PoiSourceService.ts`, Modify `electron/ipc/poisource.ts`, `electron/preload.ts`, `electron/electron.d.ts`, Create `scripts/m9-t3-poi-service-smoke.mjs`, Modify `package.json`, Update `scripts/m3-t1〜t4` smoke（旧契約assert群を新契約へ）
- [x] smoke: createLocal→get→save(検証エラーで拒否/正常でrevision++)→importFile(GeoJSON/旧POI/Point以外拒否)→registerRemote(モックHTTPサーバ or file:// fetch stub)→refreshRemote→cloneToLocal→delete。旧 poi-sources.json が存在しても無視され壊れないこと
- [x] FAIL確認 → 実装 → PASS(+m3系更新PASS) + build 緑 → Commit `Rebuild POI source backend on the write store`
- 注: renderer(src/views/PoiSource*.vue)が旧APIを呼んでいる箇所は**コンパイルが通る最小修正のみ**（画面はPhase 3で全面再構築）。ビルドを壊さないなら一時的に旧画面から新APIへの薄い読替えで可。
  - 完了 (2026-07-10)。smoke は使い捨て node:http サーバ (127.0.0.1 ephemeral port) で registerRemote/refreshRemote/degraded-cache/POI-121 閾値(テスト用閾値注入)まで実測。結果 union は maps/apps と同形 + 'Invalid'(検証エラー拒否, issues付き) / 'ReadOnly'(remote save 拒否)。uid-or-slug 解決は SqliteDataService.findPoiSourceByRef に追加(findMapByRef と同規則)。参照走査は SqliteDataService.findPoiSourceReferences(`"poiUid":"<uid>"` LIKE 走査、Phase 7 まで常に空)。旧 poiValidation.ts/.mjs は削除(m3-t1 を新契約の形状検査へ刷新)。PoiSourceSummary/Record に updatedAt を追加(一覧行に必要なため Task 2 API の互換拡張)。旧 validateRemote/saveLocal channel は save/importFile/refreshRemote/cloneToLocal/findReferences へ刷新。
  - fast-follow (2026-07-10, 品質レビュー指摘対応): ①upsertPoiSource の行不在時 INSERT を廃止し PoiSourceNotFoundError を投げる — refreshRemote が fetch を跨いで existing を保持する間の並行 delete で削除済みソースが revision=1 復活し registry slug を再占有する race を封鎖 (smoke l4、旧実装で FAIL を falsify 済み)。②fetchRemote を stream 逐次読みへ変更し累積バイトが remoteMaxBytes 超過で abort — chunked 応答は content-length 事前チェックを素通りし text() は判定前に全量バッファするため (smoke l3、falsify 済み)。③Error 結果に機械可読 code ('network'|'http-status'|'parse'|'not-found'|'invalid-request'|'internal') を追加 (Phase 3 の POI-118 degraded 表示/remote-gone affordance 用)。④findPoiSourceReferences に UUID 形状ガード (LIKE メタ文字による偽参照防止)。

### Task 4: ImageAssetService + IPC
**Files:** Create `electron/services/ImageAssetService.ts`, Create `electron/ipc/assets-images.ts`（`asset:checkSlug` と衝突しない channel 名 `imageassets:*`）, Modify `electron/preload.ts`, `electron/electron.d.ts`, `electron/main.ts`, Create `scripts/m9-t4-image-asset-smoke.mjs`, Modify `package.json`
- [x] smoke: add(実PNG fixtureをtempに生成)→list/search→rename(slug衝突拒否)→delete(_trash退避)→getFileUrl。mime/寸法メタ取得
- [x] FAIL確認 → 実装 → PASS + build 緑 → Commit `Add image asset storage backed by the write store`
  - 完了 (2026-07-10, commit 4f86af2)。バイトは `{saveFolder}/assets/{uid}.{ext}` へ atomic tmp-rename(`{dest}.tmp` へコピー→`fs.move(overwrite:false)`)で書く。mime/width/height は AppAssetService のサムネイル生成と同じ jimp (`Jimp.read`) で抽出し、バイト自体は再エンコードせず素コピー(元画質保持)。デコード不能(非画像/未対応形式)は `{result:'Error', code:'invalid-request'}` で拒否。delete はDB行削除後、実体を物理削除せず `assets/_trash/{uid}.{ext}`(衝突時は数値サフィックス)へ退避。
  - Task 2 の `AssetRecord`/`listAssets`/`searchAssets`/`findAsset`/`findAssetBySlug` に `updatedAt` を追加(一覧行に必要 — PoiSourceSummary/Record と同じ理由による Task 2 API の互換拡張)。house rule 通り `findAssetByRef`(UUID形状ガード+slugフォールバック、findMapByRef/findPoiSourceByRef と同規則)を SqliteDataService に追加。
  - getFilePath(uid-or-slug 参照 → `file://` URL)は AppAssetService.fileUrlFor と同じ形(existence+isFile チェック→`file://` + パス区切り正規化)に揃えた。設計コントラクトの `getFileUrl` という名も検討したが、本タスクの実行指示が一貫して `getFilePath` を使っていたためそちらを採用(挙動は同じ)。
  - fast-follow (2026-07-10, 仕様レビュー指摘対応, commit 4d1689f): upsertAssetRow の行不在時 INSERT を廃止し AssetNotFoundError (PoiSourceNotFoundError と同型の sibling) を投げる — rename の事前チェックと書込の間の並行 delete で削除済みアセットが revision=1 復活し registry slug を再占有する race を封鎖 (Task 3 fast-follow ① 412954e の assets 版)。smoke に race シナリオ (j) を追加し、旧実装で FAIL (rename が Success/revision=1 の復活を返すこと) を falsify 済み。ImageAssetService.mapWriteError が Error{code:'not-found'} へ写像。
  - fast-follow (2026-07-10, 品質レビュー指摘対応, commit f24dc95): ①add() の fs エラーと decode 失敗を分離 — fs.readFile を先行させ ENOENT → 'not-found'、EACCES/EBUSY 等(OneDrive ロックは既知ハザード) → 'internal' とし、'invalid-request'(恒久的な響き)は decode 失敗のみに限定。byteSize は読取バッファの length を正とし、保存もそのバッファを atomic tmp-rename で書く(stat/copy との TOCTOU 排除)。②smoke (j) の race 注入を isSlugAvailable フックから upsertAssetMeta フック(delete → 本来の書込へ委譲)へ付け替え — rename の事前チェック順序が変わっても not-found ガードを直撃し続ける。

### Task 5: 統合検証
- [x] 全 smoke (m1〜m9) PASS / `pnpm build` 緑 / `pnpm smoke:m2-t3-prohibit-raw-ipc` PASS
- [x] 完了メモを本ファイル末尾へ
  - 完了 (2026-07-10)。フル smoke スイート 24 本(m1-electron-storage-adapter=macOS opt-in timeout, m2-electrobun-poc=別ランタイム を除外)全 PASS、`pnpm build`(vue-tsc + vite ×3)緑。Phase 2 バックエンド(poiGeoJson 純関数 / poi_sources・assets テーブル / PoiSourceService v2 / ImageAssetService)完了。UI は未着手(Phase 3 以降)。
  - **Phase 3+ への引継ぎ(Phase 2 レビューで確認済みの積み残し)**: ①Phase 6 の画像 picker 実装前に ImageAssetService の jimp デコード前サイズガード必須(大 PNG 同期デコードで main プロセス凍結 — 品質レビュー Important#2)。②NotFoundError 3兄弟(PoiSource/Asset、次に maps 系移行時)の単一クラス統合を次のコピペ発生時に実施。③add() の DB 先行・ファイル後失敗時の復旧導線(delete→再add)を Assets タブ UI に用意。④POI-118 の degraded/remote-gone 表示は Task 3 の Error code 体系を使う。⑤searchAssets の title_json 生 LIKE 偽陽性・searchPoiSources のチャンク取得重複は任意改善。

## Self-Review
- 43 §2.1（hybrid格納/remote read-only+cache/明示再取得）、§6（validation表）、§7（assets保存: バイトはfs・メタはDB）、POI-104/106/107/108/118/121/133/134/136/140/143 に対応タスクあり。AID-006 cleanup と逆参照の実体・LRU上限(POI-124)は参照が生まれる Phase 7 で実装（本Phaseは参照走査APIの器まで）。
- 型契約は Task 1 の poiGeoJson 型を Task 3 が、Task 2 の Record 型を Task 3/4 が共有。RevisionConflictError は Phase 1 実装を再利用。
