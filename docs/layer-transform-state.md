# 層の変換状態と MapEdit への組み込み

`useLayerTransformState<Tin, Diagnostics, Selection>(initialLayers, dependencies)` が主図と副層の変換状態を管理する。初期値と復元用スナップショットは先頭を `main` とし、すべての層に一意の ID を持たせる。追加時は `sub:<連番>` を採番し、復元した ID や削除した ID との重複を避ける。保存用の地図 JSON から読み込む場合は、保存された変換の形と compiled から意図と三つの生成設定（`strictMode`・`vertexMode`・`yaxisMode`）を初期化する。旧形式の下書きも組み込み側で同じ形へ補完する。

## 公開の口

| 口 | 契約 |
| --- | --- |
| `layers`、`editGeneration`、`adoptionInProgress` | 読み取り用のリアクティブな状態。 |
| `capture(): LayerTransformSnapshot`、`getTinState(layerId): LayerTinState \| undefined` | 前者は履歴・下書き用のコピー。後者は ID に対応する揮発状態。未完の要求では `pendingReq.reqGen` と現在世代の一致を見て進行中か判定する。 |
| `editLayer(layerId, edit): boolean` | GCP・対応線・外周・三つの生成設定を部分更新し、履歴一件と再生成を開始する。 |
| `changeLayerRanks(updates): boolean` | ID ごとの importance・priority をまとめて変更する。 |
| `addLayer(input, ranks?): string \| undefined`、`removeLayer(layerId, ranks?): boolean` | 副層を追加・削除する。既存層の順位の正規化を同じ履歴項目に含められる。 |
| `requestTin(layerId): Promise<boolean>` | 対象層を再生成し、現在世代かつ現存する層への応答を受理したら `true`。受理した失敗は `getTinState` で読める。 |
| `startAdoption(layerId, selection): Promise<AdoptionOutcome>`、`cancelAdoption(): boolean` | 採用を開始し、確定・取消・失敗・受付拒否を返す。一時処理中の取消はシグナルを通知して結果を破棄する。反映が始まると履歴確定まで採用中の状態を保つ。 |
| `undo()`、`redo()`、`restoreDraft(snapshot)`（各 `Promise<boolean>`） | 層の状態を戻し、全層の再生成の応答を待つ。下書き復元後の履歴基点は呼び出し側で初期化する。 |
| `save(persist): Promise<boolean>` | 全層の生成がそろった同じ世代の `{ layers, tins }` を永続化コールバックへ渡す。準備中に世代が変わる場合や生成要求自体が失敗した場合は保存を中断する。永続化コールバックの戻り値 `false` は保存失敗として扱う。 |
| `dispose(): void` | 画面離脱時に呼ぶ。未確定の採用を取り消し、以後の生成応答を破棄する。 |

## 注入口と既存コードの対応

| 既存の入口 | 組み込み時の対応 |
| --- | --- |
| `updateTin`、`tinObject`、`tinResultUpdate` | 呼び出し時に層 ID を確定して `requestTin` へ渡す。`buildTin(request)` に worker・IPC を接続し、`request.layer` の `gcps`・`edges`・`bounds`・`intent`・`buildOptions` を使う。三つの設定は `resolveTinBuildOptions` に渡す。A はモデルが `'worldFile'` を返す。worker の compiled と診断を別に受け取り、現編集層の受理結果から描画を更新する。通常編集で保存可能な `tooLessGcps` 等の結果は `tin` で返し、通信失敗や採用を拒否すべき生成エラーは reject に変換する。 |
| GCP・対応線・外周・生成設定の編集 | ドラッグ、数値入力、CSV、対応線編集などの入口から `editLayer` に一括更新を渡す。UI が非同期に入力を集める場合は、確定時にも層 ID と採用ロックを確認する。 |
| `addSubMap`、`removeSubMap`、`upImportance`・`downImportance`・`upPriority`・`downPriority` | `addLayer`・`removeLayer`・`changeLayerRanks` に接続する。削除確認前に層 ID を控え、確認後に同じ ID を使う。順位の変更量は ID ごとにまとめる。 |
| `WATCHED_FIELDS`、`captureHistoryState`、`commitHistorySnapshot` | `capture()` を既存の地図メタデータと合わせて履歴・下書きに入れる。`history.commit(snapshot)` を `commitHistorySnapshot` へつなぎ、モデルが明示記録する項目の変更から別の履歴登録を起こさない。外周、点列、意図、生成設定の正本はモデルに寄せる。 |
| `performUndo`、`performRedo`、`restoreHistoryState`、`draftLifecycle.apply` | `undo`・`redo` を経由させる。履歴アダプターは未確定の変更を確定してから `UndoStack` のポインタを動かし、復元先の層スナップショットを返す。地図メタデータの反映とタイルソースの同期は既存の復元処理が担当し、下書きの層は `restoreDraft` へ渡す。 |
| CRS 採用、キーボード・メニュー操作 | `prepareAdoption(copy, selection, signal)` で候補を検証し、一時コピー上の座標変換・往復検査を済ませる。`history.withoutHistoryAsync(apply)` を既存の `withoutHistoryAsync('adopt-crs', apply)` につなぐ。モデルは抑止下で一括反映し、解除を待って履歴を一件記録する。採用開始時に入力欄のフォーカスを外し、`App.vue` のネイティブテキスト Undo への経路を閉じる。画面側の編集・保存確認・再推定・メニューの入口でも採用中を確認する。 |
| `saveMap`、`saveMapAfterConfirm`、`onBeforeUnmount` | 保存確認後に `save` を呼び、そのコールバック内で既存の永続化へ渡す。採用と保存は互いの開始を抑止する。B が C に降格した層は `tins` にある C の結果で書き出す。離脱時は `dispose()` を呼ぶ。 |
