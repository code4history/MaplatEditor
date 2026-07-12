# Preview Freeze Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ブランチ: `poi-editor`(現行)。POI Phase 2 と衝突しないスコープに限定。
> 根拠調査: 2026-07-09 root-cause 調査(本ファイル末尾「別トラック」参照)。過去修正 20b8ddc / 71b0177 / 391e47f は有効に入っており、残る凍結要因はサーバの外側(libuv スレッドプール・同期 SQLite・CPU 重処理・OneDrive)に移っている。

## Goal

MaplatEditor の「プレビューが凍る」問題のうち、**低リスク・高効果**な残存要因(仮説1・4前半・7・8)を潰す。TIN のメインプロセス同期実行(仮説2)と SQLite 全件同期パース(仮説3)は**本計画では実装せず**、別トラックの設計だけ添付する。

「凍る」の定義: OneDrive 等の遅い/脱ハイドレート状態のストレージ上でタイル burst 配信が発生したとき、(a) libuv スレッドプール(既定4)が `fs.stat`/`createReadStream` のカーネル内ブロックで枯渇し全 fs 操作が停止、(b) ブラウザの 6 コネクションが全て応答待ちになり UI 操作不能、という2段の詰まりが同時に起きる状態。

## 前提(package.json で確認済み)

- **Node**: v22.22.3。`AbortSignal.timeout()`(Node 17.3+)、`fs.createReadStream(path, { signal })`(Node 16+)いずれも利用可。
- **Electron**: `^39.8.5`。`utilityProcess`・`worker_threads` いずれも利用可(仮説2 の別トラック検討に使う)。
- **ファイル I/O**: `fs-extra`(内部 graceful-fs)。`fs-extra` の `fs.stat` は `AbortSignal` を受け付けないため、stat の期限超過は **`Promise.race` + タイマ**で表現する(`createReadStream` は `signal` オプションを使える)。
- 既存の非同期化スタイルの模範: `electron/services/MapDataService.ts:60-62`(`await fs.pathExists` + 「同期I/Oはイベントループを直列にブロックする…」コメント)。本計画の async 置換はこのコメント規約に合わせる。
- 既存の接続リーク対策の模範: `AppPreviewService.ts:186-204`(`handle` の Promise ラップ+catch で必ず res を閉じる)、`:327-349`(`sendFileIfExists` の stream/res 双方 destroy)。watchdog はこの上に積む。

## 重要な設計判断

### 1. watchdog と UV_THREADPOOL_SIZE は「補完関係」であり、単独ではどちらも不十分

- `Promise.race` による stat watchdog は、期限超過時に **HTTP レスポンスを 503 で閉じてブラウザのコネクションを解放**する。これによりブラウザ 6 接続の全滅(UI 凍結)を防ぐ。ただし **libuv スレッドを解放しない**——カーネル内でブロック中の `fs.stat` は、JS 側の Promise を reject してもカーネルが返るまでスレッドを占有し続ける。
- `UV_THREADPOOL_SIZE` の引き上げは、脱ハイドレート stat の burst が来ても**プール全体を食い潰さない余裕**を作る。ただし遅い応答そのものは速くしない。
- したがって両方入れる。**採否: UV_THREADPOOL_SIZE=16 を採用**(根拠: 既定4は OneDrive のハイドレーション遅延に対し過小、16 はメモリコスト無視できる範囲でブラウザの同時接続数6+タイル配信の余裕を確保、Electron/Chromium は独自スレッドで動くため main 側 libuv だけの調整で副作用が小さい)。

### 2. ESM の import hoisting に注意して UV_THREADPOOL_SIZE を設定する

`electron/main.ts` は ESM。ES import は**トップレベル文より先に**巡回評価されるため、`main.ts` の途中で `process.env.UV_THREADPOOL_SIZE = ...` と書いても、その時点で import 済みモジュールが評価済み=手遅れになり得る。libuv はプール初回使用時に env を読む(遅延初期化)ので、**最初の fs/dns/crypto 非同期処理より前**に設定できればよい。→ 副作用専用モジュールを作り、`main.ts` の**最初の import 文**として読み込む。

### 3. Electron に依存する `AppPreviewService` を直接 smoke できないため、純粋ヘルパを切り出す

既存 smoke は「vite の lib ビルドで単一モジュールを ESM 化 → import して assert」する方式(例: `scripts/m6-app-source-model-smoke.mjs`)。`AppPreviewService` は `electron`(`session`)を import するためこの方式に乗らない。そこで **watchdog / セッション破棄 / タイムアウトの各ロジックを、fs や timer を注入できる純粋関数として新モジュール `electron/services/previewServing.ts` に切り出す**。これで遅い stat をフェイク注入して 503 到達時間を検証でき、TDD が成立する。`AppPreviewService` は薄いアダプタとして委譲する。

### 4. スコープ制約

- **`electron/services/SqliteDataService.ts` には一切触れない**(POI Phase 2 実装と衝突)。
- **`package.json` の `scripts` 欄には触れない**(m9系 smoke 追加中と衝突)。新規 smoke は `.mjs` を追加し、検証ゲートでは `node scripts/<name>.mjs` を直接実行する。`smoke:*` スクリプト登録は **POI Phase 2 Task 2 完了後**に別コミットで行う前提(Task 6 として末尾に残す)。
- 既存のプレビュー専用 smoke は**存在しない**(`scripts/` 確認済み)。回帰確認の近接カバレッジは `m6-app-source-model`(`composeViewerSource`/`normalizeAppSource` = `createSession` が使う)と `m5-app-editor`。ただし HTTP サーバ挙動は既存 smoke で覆えないため、新規 isolated ヘルパ smoke が主ゲート。

---

## Tasks

### Task 1: Raise libuv threadpool size for preview file serving

- [ ] libuv スレッドプールを 16 に引き上げ、ESM hoisting を回避する起動フックを追加

**Files**
- `electron/bootstrap/threadpool.ts`(新規・副作用のみ)
- `electron/main.ts`(最初の import 文として追加)

**Steps**
1. `electron/bootstrap/threadpool.ts` を作成。中身は「`process.env.UV_THREADPOOL_SIZE` が未設定なら `'16'` を設定」+ 判断根拠コメント(既定4は OneDrive ハイドレーション遅延で枯渇する旨)。既存値がある場合は尊重(上書きしない)。
2. `electron/main.ts:1` に `import './bootstrap/threadpool'` を**他のどの import よりも前**に置く。既存の `import { app, ... } from 'electron'` はその後。

**検証ゲート**
- `npx tsc --noEmit`(または `pnpm run build` の vue-tsc ステップ)が通る。
- 手動確認: 一時的に `console.log(process.env.UV_THREADPOOL_SIZE)` を `main.ts` の `app.whenReady` 内に入れて `16` が出ることを開発起動で確認 → ログは削除(コミットに含めない)。
- 回帰: 既存起動フローが壊れていない(アプリが通常起動しウィンドウが出る)。

**Commit**: `Raise libuv threadpool size for preview file serving`

---

### Task 2: Add watchdog timeout to preview file serving

- [ ] stat/read に期限を付け、超過時に 503 + res.destroy で確実にコネクションを解放する

**Files**
- `electron/services/previewServing.ts`(新規・純粋ヘルパ)
- `electron/services/AppPreviewService.ts`(`sendFileIfExists` を委譲に変更)
- `scripts/preview-serving-watchdog-smoke.mjs`(新規)

**Steps**
1. `previewServing.ts` に純粋関数 `serveFileWithWatchdog(res, filePath, deps)` を実装。`deps` は `{ stat, createReadStream, mime, statTimeoutMs, readTimeoutMs, setTimeout?, clearTimeout? }` を注入可能に。
   - stat: `Promise.race([deps.stat(filePath), rejectAfter(statTimeoutMs)])`。期限超過(`WatchdogTimeout`)を捕捉したら、**ヘッダ未送信**なので 503 を返す。戻り値は `'sent' | 'timeout' | 'not-found'` に分離(呼び出し側が「配信済み」と混同しないため)。
   - read: `deps.createReadStream(filePath, { signal: AbortSignal.timeout(readTimeoutMs) })`。abort 時は stream が `AbortError` を emit → 既存同様 `res.destroy()`(ヘッダ送信済みのためステータス変更不可)。`res.on('close')` で stream を destroy(既存踏襲)。
   - スレッド枯渇との補完関係(このタイムアウトはコネクション解放が目的でスレッド解放ではない旨)をコメントに明記。
   - 定数: `STAT_TIMEOUT_MS = 10_000`, `READ_TIMEOUT_MS = 15_000` を named export。
2. `AppPreviewService.sendFileIfExists` を `serveFileWithWatchdog` への委譲に置換(`fs.stat`/`fs.createReadStream`/`mimeTypes` を注入)。戻り値の意味を既存呼び出し(`sendFile`, `servePackageAsset`)に合わせて保つ——timeout 時は `sendFile` 側で二重に 404/503 を書かないよう、`serveFileWithWatchdog` が既に res を閉じた場合はそれ以上書かない。
3. smoke: フェイク `stat`(11 秒相当で解決/never)を注入し、`statTimeoutMs` を短縮(例 20ms)して「期限内に res が 503 で終了し、`stat` の遅延完了後もレスポンスを二重に書かない」ことを assert。read watchdog も、遅い readable を流して `res.destroy` が呼ばれることを assert。`res` はモック(`writeHead`/`end`/`destroy`/`on` を記録するスタブ)。

**検証ゲート**
- `node scripts/preview-serving-watchdog-smoke.mjs` が pass。
- `npx tsc --noEmit` が通る。
- 手動(可能なら): 開発起動でプレビューを開き、通常タイルが従来どおり配信される(watchdog が正常系を壊さない)。

**Commit**: `Add watchdog timeout to preview file serving`

---

### Task 3: Evict stale preview sessions and guard storage purge

- [ ] 新セッション作成時に旧セッションを破棄(直近2件保持)し、`purgePreviewStorage` にタイムアウトガードを付ける

**Files**
- `electron/services/previewServing.ts`(`evictSessions`, `withTimeout` を追加)
- `electron/services/AppPreviewService.ts`(`prepare`/`purgePreviewStorage`)
- `scripts/preview-session-eviction-smoke.mjs`(新規)

**Steps**
1. `previewServing.ts` に純粋関数 `evictSessions(sessions: Map<string, unknown>, keep: number): string[]` を追加。挿入順(Map の順序保証)で古い順に `keep` 件を残して残りを delete、削除した token 配列を返す。
2. `previewServing.ts` に `withTimeout<T>(promise, ms, onTimeout)` を追加(`Promise.race` ベース。期限超過で `onTimeout` を呼び resolve/継続。ハングした clearStorageData で prepare をブロックしないため)。
3. `AppPreviewService.prepare`: `this.sessions.set(token, ...)` の直後に `evictSessions(this.sessions, 2)` を呼び、返った旧 token をログ出力(必要なら将来のリソース解放フックに使えるようコメント)。`keep=2` は「直近プレビュー + 生成中」を保持しメモリ蓄積を止める根拠。
4. `AppPreviewService.purgePreviewStorage`: `session.defaultSession.clearStorageData(...)` を `withTimeout(..., 5000, () => log)` で包み、期限超過時は警告ログのみで prepare を継続。既存 try/catch は維持。
5. smoke: `evictSessions` に 4 件入れた Map を渡し、直近2件だけ残り古い2 token が返ることを assert。`withTimeout` は never-resolve promise に短い ms を与え `onTimeout` が呼ばれ resolve されることを assert。

**検証ゲート**
- `node scripts/preview-session-eviction-smoke.mjs` が pass。
- `npx tsc --noEmit` が通る。
- 手動(可能なら): プレビューを 3 回連続で開き、`this.sessions.size` が 2 を超えないことを DevTools/ログで確認。

**Commit**: `Evict stale preview sessions and guard storage purge`

---

### Task 4: Cache serialized preview JSON per session

- [ ] セッション作成時に app/maps/manifest/HTML を一度だけ直列化してキャッシュし、リクエスト毎の `JSON.stringify` を廃止する

**Files**
- `electron/services/AppPreviewService.ts`(`PreviewSession` 型、`createSession`、`handlePreview`、`renderHtml`)
- `scripts/preview-json-cache-smoke.mjs`(新規・可能なら)

**Steps**
1. `PreviewSession` 型に事前直列化フィールドを追加: `serializedApp: string`、`serializedMaps: Record<string, string>`、`serializedManifest: string`、`html: string`。
2. `createSession` で `app`/各 `maps[k]`/`manifest` を作った直後に一度だけ `JSON.stringify` してキャッシュ。`renderHtml` が `JSON.stringify(session.viewerOption)` をリクエスト毎に行っている(`:243`)ため、HTML も `createSession` 内(または初回のみ遅延生成)で組み立ててキャッシュ。
3. `handlePreview` の JSON 応答分岐(`:215` apps、`:216` maps、`:217` pwa manifest)を「事前直列化文字列をそのまま `res.end` する」新メソッド `sendPreparedJson(res, str)` に置換。`maps` の未知キーは `'{}'` を返す。root HTML 分岐(`:209`)は `session.html` を返す。
4. 汎用 `sendJson`(`:351-354`)は preview 経路から使われなくなるなら削除、他経路で使うなら残す(grep で確認して判断)。

**検証ゲート**
- `node scripts/preview-json-cache-smoke.mjs` が pass(`createSession` 相当を切り出せない場合は、直列化キャッシュ生成関数を `previewServing.ts` に薄く抽出して単体テスト。抽出しない判断なら、この smoke は省略し typecheck + 手動確認をゲートにする旨を明記)。
- `npx tsc --noEmit` が通る。
- 手動: プレビュー起動 → タイル操作中に `apps/{token}.json`・`maps/*.json` が従来と同一内容で返る(DevTools Network で比較)。

**Commit**: `Cache serialized preview JSON per session`

---

### Task 5: Replace sync fs calls in app-list and basemap hot paths

- [ ] アプリ一覧描画・ベースマップ一覧・削除経路の同期 fs を async 化(仮説7)。スコープは下記4箇所に限定し、他ファイルの同期 fs は掃かない

**Files**
- `electron/ipc/settings.ts:48-66`(`basemaps:list`)
- `electron/services/AppAssetService.ts:234-244`(`fileUrlFor`)+ 呼び出し元 `electron/ipc/appassets.ts:28`、`electron/services/AppDataService.ts:59,64`
- `electron/services/AppDataService.ts:40-53`(`getMapTile:45`)
- `electron/services/MapDataService.ts:109-127`(`deleteMap` の existsSync 群)

**Steps**
1. `basemaps:list`: `items.map((item) => {...})` を `Promise.all(items.map(async (item) => {...}))` に変更し、`fs.existsSync(thumbPath)`/`fs.existsSync(legacyPath)` を `await fs.pathExists(...)` に置換。`MapDataService:60-62` のコメント規約に合わせ「同期I/Oはイベントループをブロックするため非同期化(遅いストレージ対策)」を付す。
2. `AppAssetService.fileUrlFor`: `async fileUrlFor(relPath): Promise<string | null>` 化し、`fs.existsSync`+`fs.statSync` を `await fs.pathExists` + `await fs.stat` に置換。呼び出し元3箇所を `await` に更新(`appassets.ts:28` の ipc ハンドラは `async` 化、`AppDataService.ts:59,64` は既に async 文脈)。
3. `AppDataService.getMapTile:45`: `fs.existsSync(thumbFolder)` → `await fs.pathExists(thumbFolder)`。
4. `MapDataService.deleteMap`: `:109`/`:114`/`:119` の `fs.existsSync` → `await fs.pathExists`(delete 経路の3箇所のみ。スコープ厳守)。
5. **仮説7の対象外**(`AppExportService`/`PoiSourceService`/`DataUploadService`/`SettingsService`/`resourceAssets`)は今回触らない(ホットパス外)。

**検証ゲート**
- `node scripts/m5-app-editor-smoke.mjs` と `node scripts/m6-app-source-model-smoke.mjs` が pass(近接回帰)。ベースマップ系は `node scripts/m5-basemap-catalog-smoke.mjs`。
- `npx tsc --noEmit` が通る(`fileUrlFor` の Promise 化で呼び出し元の型エラーが出ないこと)。
- 手動: アプリ一覧・ベースマップ一覧が従来どおりサムネイル付きで表示され、地図削除が正常に動く。

**Commit**: `Replace sync fs calls in app-list and basemap hot paths`

---

### Task 6(登録のみ・POI Phase 2 Task 2 完了後): Register preview hardening smoke scripts

- [ ] Phase 2 Task 2 完了確認後、Task 2〜4 で追加した `.mjs` を `package.json` の `smoke:*` に登録する

**Files**: `package.json`(scripts 欄)

**Steps**: `smoke:preview-serving-watchdog` / `smoke:preview-session-eviction` / `smoke:preview-json-cache` を追加。**Phase 2 Task 2 が未完なら着手しない**(scripts 欄の競合回避)。

**検証ゲート**: `pnpm run smoke:preview-serving-watchdog` 等が pass。

**Commit**: `Register preview hardening smoke scripts`

---

## 別トラック(本計画では実装しない・設計のみ)

### 仮説2: TIN 計算のメインプロセス退避

**現状**: `@maplat/tin` の `updateTinAsync()` は内部同期(確認済み)。呼び出し点は `MapEditService.ts:114`(`createCompiledFromGcps`)、`store_handler.ts:102-104,144-147`(setCompiled+addIndexedTin・ソース毎)、`ipc/mapedit.ts:88-101`(`mapedit:updateTin` → `createTinFromGcpsAsync`)。GCP 数×ソース数に比例してメインプロセスがブロックする。

**選択肢**:
- **A. `utilityProcess`(Electron ネイティブ)**: Electron 39 で利用可。main とライフサイクル連動、`MessagePort` 通信。`@maplat/tin` を子で読み込み GCP/edges を渡して compiled を返す。プロセス境界で完全隔離(クラッシュしても main を巻き込まない)。起動コストは1回。
- **B. `worker_threads`**: 同一プロセス内スレッド。起動が軽い。ただし `@maplat/tin` がネイティブ/非スレッドセーフ依存を持たないか要確認。データは構造化クローンで渡す。

**推奨**: A(`utilityProcess`)。Electron 標準経路で main のイベントループから確実に切り離せる。影響範囲: `ipc/mapedit.ts` の `updateTin` と `MapEditService`/`store_handler` の compiled 生成を「ワーカへの非同期 RPC」に差し替え。プレビュー生成(`MapEditService.ensurePreviewCompiled` 経由)が最大の受益点。**着手条件**: 本計画(Task 1-5)完了後、独立に。TDD は「フェイクワーカを注入した RPC ラッパの単体 smoke」で成立させる。

### 仮説3: SQLite ページング化 + DB の userData 移設

**現状**: `SqliteDataService.ts:1050-1056` `searchMaps('')` → `readAllMaps` → 全行 `data_json` を同期パース。**POI Phase 2 が同ファイルを改修中のため本計画では触れない。**

**方針(Phase 2 完了後)**: (1) `readAllMaps` の全件同期パースを LIMIT/OFFSET ページングへ、(2) DB 実体を saveFolder(OneDrive 配下になり得る)から `app.getPath('userData')` へ移設し、ハイドレーション遅延を DB アクセスから切り離す。移設はマイグレーション設計が必要なため独立マイルストーン。

---

## Self-Review

- **スコープ遵守**: `SqliteDataService.ts` 不触(Task 5 は `AppDataService`/`MapDataService`/`settings`/`AppAssetService` のみ)。`package.json` scripts は Task 6 まで不触、それも Phase 2 Task 2 待ちを明記。
- **仮説カバレッジ**: 仮説1=Task1+2、仮説4前半=Task4、仮説7=Task5、仮説8=Task3。仮説2/3 は別トラック設計のみ。
- **1タスク=1コミット粒度**: 各タスクに Files/Steps/検証ゲート/英語命令形コミットメッセージを付与。
- **TDD/回帰**: Electron 依存を避けるため純粋ヘルパを `previewServing.ts` に切り出し、fs/timer 注入で smoke 可能に。既存プレビュー smoke が無いことを確認し、近接 smoke(m5/m6)を回帰ゲートに指定。
- **既存パターン踏襲**: 20b8ddc 系の「Promise ラップ+必ず res を閉じる」「stream/res 双方 destroy」の上に watchdog を積み、async 置換は `MapDataService:60-62` のコメント規約に合わせる。
- **API 前提確認**: Node 22.22.3 / Electron 39.8.5 を確認し `AbortSignal.timeout`・`createReadStream({signal})`・`utilityProcess` の可用性を明記。fs-extra が signal 非対応の stat には `Promise.race` を使う点も明記。
- **既知の落とし穴**: (a) ESM import hoisting で UV_THREADPOOL_SIZE が手遅れになる問題 → 最初の import の副作用モジュールで回避。(b) watchdog はコネクション解放が目的でスレッド解放ではない → だから UV_THREADPOOL_SIZE と両輪、という補完関係を明記。
- **未解決リスク**: Task 4 の JSON キャッシュ smoke は `createSession` が Electron 依存のため、直列化部を薄く抽出できない場合は typecheck+手動確認に格下げする旨を条件付きで記載(実装時に判断)。
