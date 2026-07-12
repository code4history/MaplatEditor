# Phase 1: ADR-0007 Identity基盤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全アセット（map / app / base_map、以降 poi_source / asset が続く）の正本キーを不変 Asset UID (UUIDv4) にし、ユーザー編集可能な slug をグローバル一意 namespace で分離する。既存の Map / App / Base map 編集機能のパリティを維持する。

**Architecture:** `maplat.sqlite` schema v2。各アセット表は `uid` PK + `slug` カラム、グローバル一意性は `asset_registry(uid PK, kind, slug UNIQUE)` が強制（各表と同一トランザクションで二重書き、書込ヘルパー経由のみ）。旧schema DB は起動時検出で `_maplat-v1.sqlite` へ退避し、nedb.db/settings（退避名も可）から再取込。tiles/tmbs の内部ファイル名は uid、export/download 時に slug へ解決。全 upsert は `revision` 楽観ロック。

**Tech Stack:** node:sqlite (DatabaseSync), Electron IPC (typed adapter経由), Vue 3, smoke = `scripts/m*.mjs`（vite build + electron stub、m7 が先例）。

**正本仕様:** `../../NextTargets/43-poi-editor-spec.md` §1、`../../docs/adr/0007-uuid-canonical-identity-with-global-slug.md`（Maplats メタリポジトリ側）。

**検証環境の注意（必読）:** ユーザーの実データフォルダは OneDrive 上。手元検証は `_nedb.db`→`nedb.db`、`_settings`→`settings` 復元 + 生成済み `maplat.sqlite` を `_` 接頭辞退避で行う。smoke は `.tmp-smoke/` の一時フォルダで完結させること。

---

## 設計コントラクト（全タスク共通）

### DDL (schema v2)

```sql
CREATE TABLE IF NOT EXISTS asset_registry (
  uid  TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- 'map' | 'app' | 'base_map' (| 'poi_source' | 'asset' は Phase 2)
  slug TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS maps (
  uid TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS apps (
  uid TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS base_maps (
  uid TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,            -- 'builtin' | 'user'
  sort_order INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS map_base_map_visibility (
  map_uid TEXT NOT NULL,
  base_map_uid TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (map_uid, base_map_uid)
);
CREATE TABLE IF NOT EXISTS base_map_always (
  base_map_uid TEXT PRIMARY KEY,
  always_visible INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

- FTS/R-Tree: `maps_fts(uid UNINDEXED, raw UNINDEXED, words)` / `apps_fts(uid ...)` / `maps_rtree_key(uid TEXT PK, rid)`。トリガは現行の DROP&CREATE 方式を踏襲し、raw に `new.slug` を含める（`new.slug || char(10) || maplat_map_fts_raw(new.data_json)`）。slug rename は maps/apps 行の UPDATE として実行されるためトリガで索引が追随する。
- 旧schema検出: `SELECT 1 FROM sqlite_master WHERE name='maps'` があり `pragma_table_info('maps')` に `uid` 列が無い場合 → close → `maplat.sqlite`(+`-wal`/`-shm`) を `_maplat-v1.sqlite`（衝突時 `_maplat-v1.2.sqlite`…）へリネーム → 新規作成。
- schema_migrations 既存 ID (`2026-07-04-sqlite-write-store-legacy-import` 等) はそのまま流用（新規DBで再実行される）。v2 では `OPT_IN_VISIBILITY_FLIP_ID` の一括破棄は不要になった過去互換なので、新規DBでは no-op として marker のみ記録。

### 新モジュール `electron/services/assetIdentity.ts`（純関数、Task 1 で全文実装）

```typescript
export type AssetKind = 'map' | 'app' | 'base_map' | 'poi_source' | 'asset';
export const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;
export function isValidSlug(slug: string): boolean;
export function generateUid(): string;                    // crypto.randomUUID()
export function resolveSlugCollision(desired: string, isTaken: (s: string) => boolean): string;
  // desired が空/不正なら 'untitled' に正規化 → taken なら `${base}_2`, `${base}_3`, ...
```

### SqliteDataService 新API（シグネチャ契約）

```typescript
// registry（全ての slug 書込はこの2つを経由。asset表側 slug と同一トランザクションで更新）
private registerAsset(db, kind: AssetKind, uid: string, slug: string): void;      // INSERT registry
private renameAssetSlug(db, kind: AssetKind, uid: string, slug: string): void;    // UPDATE registry + asset表 slug

async isSlugAvailable(slug: string, excludeUid?: string): Promise<boolean>;       // registry 1クエリ
async findMap(uid: string): Promise<any | null>;            // 返却 document に uid / slug / revision を含める
async findMapBySlug(slug: string): Promise<any | null>;
async createMap(slug: string, document: any): Promise<{ uid: string }>;           // uid採番+registry+行INSERT
async upsertMap(uid: string, slug: string, document: any, expectedRevision?: number): Promise<{ revision: number }>;
  // ON CONFLICT(uid) DO UPDATE ... WHERE revision = expectedRevision（指定時）。
  // 更新0行なら RevisionConflictError を throw。slug 変更を含む場合 renameAssetSlug を同Txで実行。
async deleteMap(uid: string): Promise<void>;                                      // registry 行も同Txで削除
// apps / base_maps も同型 (createApp/upsertApp/... , base_maps は scope 引数維持)
export class RevisionConflictError extends Error { kind = 'revision-conflict'; current: number; }
```

- `isMapIdAvailable` / `isAppIdAvailable` は削除し、IPC は `asset:checkSlug` (`{ slug, excludeUid? }`) 1本に統合。preload は `window.assets.checkSlug()`、旧 `window.mapedit.checkID` / `window.appedit.checkID` は撤去（呼び出し側同時更新）。
- 楽観ロック UI: 保存失敗時に `{ error: 'revision-conflict' }` を renderer へ返し、確認ダイアログ「他のウィンドウで更新されています: 読み直す / 上書き」（i18n key `common.revision_conflict_reload` / `common.revision_conflict_overwrite`）。上書きは expectedRevision なしで再送。

### レガシー移行 (v2)

1. builtin base maps seed（KTGIS catalog）: uid 採番、slug = builtin ID。**最初に registry へ登録**（clean slug を確保）。
2. `migrateNeDB`: 各 doc に uid 採番、slug = `resolveSlugCollision(旧_id, registry照会)`。suffix が付いた場合 report に `{kind:'map', from, to}` を追加。
3. `migrateUserBaseMaps`: 同様。per-map visibility は slug→uid 解決して `map_base_map_visibility(map_uid, base_map_uid)` へ。
4. **tiles/tmbs リネーム**: `tmbs/{旧id}.jpg` → `tmbs/{uid}.jpg`、`tiles/{旧id}/` → `tiles/{uid}/`（存在するもののみ、失敗は warning として report へ）。
5. report: `{saveFolder}/migration-report-v2.json` に `{ renamedSlugs: [...], renamedFiles: [...], warnings: [...] }` を書き、renderer へ `app:migrationReport` を send。App.vue で一覧モーダル表示（一度きり）。

### uid/slug の使い分け（renderer 契約）

- ルーティング・IPC 引数・app sources 参照・visibility はすべて **uid**（`/mapedit?uid=...` 等）。
- フォームの「地図ID」「アプリID」欄は **slug** 編集欄になる（ラベル・i18n 据え置き、新規時のみ自由入力＋既存編集でも変更可に変わる）。変更時は `assets.checkSlug` 再チェック（既存の checkID ボタン UX 踏襲、excludeUid=自分）。
- `AppSource.mapID` フィールドは `mapUid` へ改名（appSourceModel.ts、AppEdit selector、AppExportService）。保存済み app JSON 内も uid 参照で保存。
- export/download (`AppExportService.exportApp`, `mapedit:download`) は uid→slug 解決して `maps/{slug}.json` / `tmbs/{slug}.jpg` / `tiles/{slug}/` / `apps/{slug}.json` を出力し、app JSON 内の source 参照も slug で書く（viewer 互換維持）。

---

## Tasks

### Task 1: assetIdentity 純関数モジュール + smoke

**Files:** Create `electron/services/assetIdentity.ts`, Create `scripts/m8-t1-asset-identity-smoke.mjs`, Modify `package.json` (scripts に `smoke:m8-t1-asset-identity` 追加)

- [ ] Step 1: `scripts/m8-t1-asset-identity-smoke.mjs` を作成（m7 と同じ vite build 方式は不要 — 純関数なので `vite build` で単独エントリをバンドルし assert。シナリオ: `isValidSlug('abc_-1')===true`, `isValidSlug('a#b')===false`, `isValidSlug('日本語')===false`, `generateUid()` が UUIDv4 形式かつ毎回異なる, `resolveSlugCollision('map', s=>['map','map_2'].includes(s))==='map_3'`, `resolveSlugCollision('', ()=>false)==='untitled'`, `resolveSlugCollision('あ', ()=>false)==='untitled'`）
- [ ] Step 2: 実行して FAIL を確認（モジュール未実装）
- [ ] Step 3: `assetIdentity.ts` を実装
- [ ] Step 4: `pnpm smoke:m8-t1-asset-identity` → PASS
- [ ] Step 5: Commit `feat: add asset identity helpers (uid/slug, ADR-0007)`

> **実行時アメンド (2026-07-09)**: Task 2 と Task 3 は migrateNeDB を介して不可分のため統合して1サブエージェントで実装する。ビルド緑の維持は「呼び出し側の最小修正」ではなく **slug 引数の互換ラッパー**（`// 互換ラッパー` コメント付き、Task 5-7 で呼び出し側 uid 化後に撤去）で行い、本タスクでは src/（renderer）に触れない。migration report の初回表示モーダル（App.vue + i18n）は Task 5 に移動。

### Task 2: schema v2 + asset_registry + 旧schema退避 + revision付きCRUD（service層のみ）

**Files:** Modify `electron/services/SqliteDataService.ts`（migrate/DDL/トリガ/CRUD 全面）, Create `scripts/m8-t2-identity-store-smoke.mjs`, Modify `package.json`

- [ ] Step 1: smoke シナリオを書く（m7 の electron stub 方式を流用）:
  - (a) 空フォルダ → getDb → `createMap('sample', doc)` → `findMap(uid)` が uid/slug/revision=1 を返す
  - (b) `isSlugAvailable('sample')===false`、`isSlugAvailable('sample', uid)===true`（自分除外）
  - (c) `upsertMap(uid,'renamed',doc,1)` 成功 → registry も 'renamed'。`upsertMap(uid,'renamed',doc,1)` を再送すると RevisionConflictError
  - (d) `createApp('sample', ...)` は slug衝突（map が保持）で失敗すること（グローバル namespace）
  - (e) 旧schema DB（maps(map_id...) を持つファイル）を置いて getDb → `_maplat-v1.sqlite` が生成され新DBが v2 schema
  - (f) `searchMaps('renamed')` が slug でヒット（FTS raw に slug が入っている）
- [ ] Step 2: FAIL 確認
- [ ] Step 3: SqliteDataService を v2 へ実装（本計画の DDL / API 契約どおり。base_maps builtin seed も uid/slug 化）
- [ ] Step 4: smoke PASS + `pnpm build`（vue-tsc）が通ること（renderer 側は Task 4-7 までコンパイル互換を壊す場合、この時点では旧API を残した二枚看板にせず、**呼び出し側の最小修正まで本タスクに含めてビルド緑を維持**する — ただし UI 挙動の完全対応は後続タスク）
- [ ] Step 5: Commit `feat: schema v2 — uid-canonical identity with global slug registry`

### Task 3: レガシー移行 v2（uid採番・slug衝突suffix・tiles/tmbsリネーム・report）

**Files:** Modify `electron/services/SqliteDataService.ts`（migrateNeDB/migrateUserBaseMaps/retire）, Modify `electron/services/MapDataService.ts`・`electron/services/MapEditService.ts`（tmbs/tiles を uid パスに）, Create `scripts/m8-t3-legacy-migration-smoke.mjs`, Modify `package.json`, Modify `src/App.vue`（migrationReport モーダル）, Modify `public/locales/ja/translation.json`・`public/locales/en/translation.json`

- [ ] Step 1: smoke シナリオ: nedb.db(2件: `tatebayashi`, `morioka`) + settings(tmsList.json 1件 user basemap `tatebayashi` ←mapと衝突) + `tmbs/tatebayashi.jpg` + `tiles/tatebayashi/0/0/0.png` を用意 → getDb → maps 2行に uid/slug、basemap slug が `tatebayashi_2`、report JSON に renamedSlugs 1件、`tmbs/{uid}.jpg`・`tiles/{uid}/` が存在し旧パスが無い。退避名入力(`_nedb.db`/`_settings`)でも同結果
- [ ] Step 2: FAIL 確認
- [ ] Step 3: 実装（migration は withTransaction、ファイルリネームは commit 後・失敗は report warnings）
- [ ] Step 4: smoke PASS。`pnpm smoke:m7-sqlite-write-store` も v2 前提に更新して PASS（m7 の期待値修正はこのタスクの一部）
- [ ] Step 5: Commit `feat: legacy migration assigns uids, global slugs, renames tiles/tmbs`

### Task 4: checkSlug IPC 統合（preload / d.ts / ipc / adapter）

**Files:** Modify `electron/preload.ts`, `electron/electron.d.ts`, `electron/ipc/mapedit.ts`, `electron/ipc/apps.ts`, `electron/adapters/ElectronStorageAdapter.ts`, Create `electron/ipc/assets.ts`（`asset:checkSlug`）, Modify `electron/main.ts`（handler 登録）

- [ ] Step 1: `asset:checkSlug` handler + `window.assets.checkSlug({slug, excludeUid})` を実装、旧 `mapedit:checkID` / `appedit:checkID` を削除
- [ ] Step 2: `scripts/m2-t3-prohibit-raw-ipc-smoke.mjs`（raw IPC 禁止 lint smoke）と `pnpm build` が通る
- [ ] Step 3: Commit `feat: unify slug availability check via asset:checkSlug`

### Task 5: Map 編集経路の uid/slug 化（MapList / MapEdit / download）

**Files:** Modify `src/views/MapList.vue`, `src/views/MapEdit.vue`, `src/router/index.ts`（`/mapedit?uid=`）, `electron/ipc/mapedit.ts`（request/save/download を uid 引数に）, `electron/services/MapEditService.ts`

- [ ] Step 1: MapList → uid で遷移、一覧サムネイルは uid パス
- [ ] Step 2: MapEdit: 読み込みは uid、mapID 欄 = slug 編集（既存でも編集可、変更時 checkSlug(excludeUid)、`onlyOne` の disabled を撤去）、保存は `{uid, slug, document, expectedRevision}`、revision-conflict ダイアログ、新規作成は createMap
- [ ] Step 3: `mapedit:download` は uid 受け取り→ zip 内は `maps/{slug}.json`・`tmbs/{slug}.jpg`・`tiles/{slug}/`
- [ ] Step 4: `pnpm build` 緑 + 手動確認手順を PR ノートに記載（一覧→開く→slug変更→保存→再読込→download zip の中身）
- [ ] Step 5: Commit `feat: map editing addresses assets by uid with editable slug`

### Task 6: App 編集経路の uid/slug 化（AppList / AppEdit / appSourceModel / export）

**Files:** Modify `src/views/AppList.vue`, `src/views/AppEdit.vue`, `src/models/appSourceModel.ts`（`mapID`→`mapUid`）, `electron/services/AppDataService.ts`, `electron/services/AppExportService.ts`, `electron/ipc/apps.ts`

- [ ] Step 1: AppEdit: appID 欄 = slug、sources selector は uid 参照（表示は slug/title）、保存 revision 楽観ロック
- [ ] Step 2: AppExportService: uid→slug 解決で `apps/{slug}.json` / `maps/{slug}.json` / `tmbs/{slug}.*` / `tiles/{slug}/` を出力、app JSON 内 sources の参照は slug（viewer互換）。`pois` 文字列フィールドは現状維持（Phase 7 で置換）
- [ ] Step 3: `pnpm smoke:m6-app-source-model` / `pnpm smoke:m5-app-editor` を v2 期待値に更新して PASS
- [ ] Step 4: Commit `feat: app editing/export uses uid refs with slug resolution`

### Task 7: Base map 経路の uid 化（BaseMapList / visibility / rename簡素化）

> **追記 (2026-07-09, Task2+3レビューより)**: 未保存 map 向けの暫定 slug キー visibility 行（SqliteDataService の provisional visibility adoption）は、放棄された未保存 map の行が同 slug を再利用する将来の map に継承され得る。visibility API を uid ネイティブ化する本タスクで、暫定行の TTL ないし採用時クリーンアップを入れること。

**Files:** Modify `src/views/BaseMapList.vue`, `electron/services/SqliteDataService.ts`（saveUserBaseMap の rename cascade 削除 — uid 不変なので visibility/always の付け替え不要に）, `electron/ipc/basemaps.ts`（存在すれば; チャンネルは agent 報告の `basemaps:save-user`）

- [x] Step 1: saveUserBaseMap を `{uid?, slug, tms}` に変更（uid なし=新規）。旧 grandfathering ロジックは registry 一意性チェックに置換
- [x] Step 2: visibility / always API は uid 引数に。MapEdit 内の base map selector 追随
- [x] Step 3: `pnpm smoke:m5-basemap-catalog` を v2 期待値に更新して PASS、`pnpm build` 緑
- [x] Step 4: Commit `Key base maps and visibility by uid with icon path migration`
  - 追記対応: 暫定表示設定は `slug:` sentinel キー化(既存行はマーカー `2026-07-09-provisional-visibility-slug-prefix` で一括付け替え) + 採用時のuidキー移動 + 起動時7日TTL掃除
  - 追加: ベースマップアイコンを tmbs/{uid}.{ext} へ移行(マーカー `2026-07-09-base-map-icon-uid-paths`、apps 内 TMS ソースの thumbnail 参照も追随)。エクスポートは uid 名アイコンを slug 名へ解決して出力
  - 判断: ベースマップの expectedRevision 楽観ロックは見送り(小さな設定オブジェクト+単一モーダルUIのため last-write-wins。revision カウンタ自体は更新毎に加算)

### Task 8: 統合検証

- [ ] Step 1: 全 smoke (`m1`〜`m8`) を実行し全 PASS（旧前提のものは期待値更新）
- [ ] Step 2: `pnpm build`（vue-tsc + vite）緑
- [ ] Step 3: 実データ相当の手動シナリオ（.tmp-smoke に nedb コピーで再現）: 移行→一覧表示→地図開閉→slug rename→app 作成→export 出力物の viewer 互換確認（apps/*.json が slug 参照であること）
- [ ] Step 4: Commit（残差分）+ Phase 1 完了メモを本ファイル末尾に記録

## Self-Review 結果

- 仕様カバレッジ: 43 §1 の全項目（UID/slug/グローバルnamespace/再migration/衝突suffix+report/tmbs uid化/チェック共通化）にタスク対応あり。revision 楽観ロック（AID-005）は T2(service)+T5/T6(UI)。migration report 初回表示（AID-003）は T3。
- 型整合: `checkSlug({slug, excludeUid})` / `upsertX(uid, slug, doc, expectedRevision)` / `RevisionConflictError` を全タスクで統一。
- 未決細部は実装者判断（i18n 文言、ダイアログ部品の再利用元）。
