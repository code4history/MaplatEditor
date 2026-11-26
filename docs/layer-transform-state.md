# 層の変換状態と MapEdit への組み込み

`useLayerTransformState<Tin, Diagnostics, Selection>(initialLayers, dependencies, initialTins?)` が主図と副層の変換状態を管理する。初期値と復元用スナップショットは先頭を `main` とし、すべての層に一意の ID を持たせる。追加時は `sub:<連番>` を採番し、復元した ID や削除した ID との重複を避ける。

## 公開の口

| 口 | 契約 |
| --- | --- |
| `initialTins?: ReadonlyMap<string, TinBuildResult<Tin \| 'worldFile', Diagnostics>>` | 初期文書の層 ID ごとに `{ tin, diagnostics? }` を渡すと、揮発状態を `ready` で始める。種のない層は `empty` から始まる。 |
| `layers`、`editGeneration`、`adoptionInProgress`、`saveWriting` | 読み取り用のリアクティブな状態。`saveWriting` は永続化コールバックの実行中に真になる。 |
| `capture(): LayerTransformSnapshot`、`getTinState(layerId): LayerTinState \| undefined` | 前者は履歴・下書き用の文書のコピー。後者は ID に対応する揮発状態。最新世代の生成中かは `pendingReq.reqGen` と現在世代の一致で判定する。 |
| `editLayer(layerId, edit): boolean`、`editLayers([{ layerId, edit }]): boolean` | GCP・対応線・外周・生成設定を更新する。一括編集では、変更のある全層を一件の履歴と一世代にまとめて再生成する。未知または重複する ID を含む入力、値が変わらない入力は `false` を返す。 |
| `changeLayerRanks(updates): boolean` | ID ごとの importance・priority をまとめて変更する。 |
| `addLayer(input, ranks?): string \| undefined`、`removeLayer(layerId, ranks?): boolean` | 副層を追加・削除する。既存層の順位の正規化を同じ履歴項目に含められる。 |
| `requestTin(layerId): Promise<boolean>` | 対象層の生成を依頼する。同じ層・世代の未完了の要求は完了を共有する。現在世代かつ現存する層への応答を受理した場合は `true` を返す。受理した失敗は `getTinState` で読める。 |
| `buildTin(request)` | 編集の依頼には層 ID・世代、採用の依頼には層 ID・採用 ID・`signal` が含まれる。どちらも `isCurrent()` で待ち行列から取り出す時点の有効性を照会できる。 |
| `startAdoption(layerId, selection): Promise<AdoptionOutcome>`、`cancelAdoption(): boolean` | 採用を開始し、確定・取消・失敗・受付拒否を返す。一時処理中の取消はシグナルを通知して結果を破棄する。反映開始から履歴確定まで取消は `false` を返す。 |
| `undo()`、`redo()`、`restoreDraft(snapshot)` | `{ restored: boolean, settled: Promise<boolean> }` を返す。文書の差し替えと再生成の依頼は同期で終わる。同じ世代で全層が `ready` になった場合に `settled` が `true` になる。操作拒否・復元先なしでは両方が `false` になる。不正な層 ID の下書きは同期でエラーになる。 |
| `save(persist): Promise<LayerTransformSaveResult>` | 全層がそろった同じ世代の `{ layers, tins }` を永続化コールバックに渡す。結果は `{ ok: true }` または `{ ok: false, reason }`。理由は採用中 `adopting`、別の保存中 `saving`、離脱後 `disposed`、準備中の世代変更 `generationChanged`、生成失敗 `buildFailed`、書き込みの例外・拒否・戻り値 `false` による `writeFailed`。生成待ちの間は編集を受け付け、書き込み中は採用中と同様に入口で編集・層操作・復元・再生成を拒否する。 |
| `dispose(): void` | 画面離脱時に呼ぶ。未確定の採用を取り消し、以後の編集・生成要求・応答を拒否する。 |

`editGeneration` は全層で共通。世代違いで生成応答を破棄するとき、層が現存し、揮発状態の待ち印がその要求のままなら最新世代で要求し直す。採用中は採用ロックの解除まで持ち越す。すでに別の要求や採用・復元の結果に置き換わっている場合はその状態を使う。これにより順位の変更などでも生成中の層だけが引き継がれる。接続側は待ち行列から依頼を取り出した時点で `isCurrent()` を呼び、`false` の依頼は計算を始めず Promise を reject して完了させる。`isCurrent` は接続側で評価し、worker・IPC への入力には文書データを渡す。

## 読み込み・ラジオ・保存

- `extractCompiledTins` が保存済みの `compiledTins` を文書から取り出す。読み込み時は保存上の層順を ID に対応づけ、保存された変換形から意図を復元し、各層の compiled の生成設定を優先する。compiled 側に無い設定は地図全体の値や既定値で補う。旧形式の下書きも同じ形に補完する。
- `seedTinObjects` に相当する処理で、利用できる compiled を `setCompiled` 相当で読み込み、診断があれば合わせてモデルの `initialTins` に渡す。`tooLessGcps` や `compiledRequired` などの文字列は従来どおり未計算として扱う。初回表示は `ready` の層を描画し、種がなく生成が必要な層だけを依頼する。`reloadFromStore` でも同じ初期化を使い、旧モデルを `dispose()` して新しい文書と種を入れたモデルへ差し替える。
- 「外周」の `vertexMode` と「エラー」の `strictMode` は地図全体に効く。ラジオの表示値を主図の `buildOptions` から読み、ユーザー操作を受ける setter からだけ、変更する設定を全層の `buildOptions` に入れる `editLayers` を一度呼ぶ。他方の設定と `yaxisMode` は各層の値を引き継ぐ。新規副層には主図の `strictMode`・`vertexMode` を初期値として渡す。
- 設定の正本はモデル内の層ごとの `buildOptions`。Undo・Redo・下書き復元による表示値の変化は読み取り側に伝わる。既存の `watch(strictMode)`・`watch(vertexMode)` による `mapData` への書き戻しや再編集は setter に置き換える。保存コールバックでは同じ世代の `layers` の主図から地図全体の `strictMode`・`vertexMode` を書き出し、各層の結果は `tins` から書き出す。未編集で種付け済みの層は元の compiled を保持し、B が C へ降格した層は C の結果を保存する。

## 復元の呼び出し順

1. メニュー・キー操作・画面の入口で `adoptionInProgress` と `saveWriting` を確認する。通過したら、保留中の履歴を確定してから W1 に入る。履歴アダプターは `canUndo()`・`canRedo()` を確認し、ポインタを一度だけ動かして復元先の層スナップショットを返す。対応する地図メタデータも同じ履歴項目から取得する。
2. W1 の同期の区間で `undo()`・`redo()`・`restoreDraft(snapshot)` を呼ぶ。文書の差し替えは呼び出し中に終わる。`restored` が真なら、続けて同じ W1 の区間で地図メタデータ、選択中の層、編集用の一時状態を反映する。モデルから画面への反映と復元時の watcher は、履歴登録やモデルへの書き戻しを起こさずに処理する。
3. W1 は Vue の watcher が処理される次の tick で解除する。`settled` は W1 の中で待たない。既存のタイル URL の再導出・タイルソースの同期はメタデータを復元した後に行い、派生値の書き戻しに抑止が必要なら、その反映の区間に掛ける。描画は表示対象の層と世代を確認してから更新する。`settled` が必要な処理は W1 の外で待つ。
4. 下書き復元時は `draftLifecycle.apply` から同じ順で層とメタデータを反映する。新しく読み込む文書の `resetHistoryBase` は、モデルと地図メタデータをそろえた後に保留中の履歴タイマーを破棄し、`capture()` を含むスナップショットで基点を初期化する。いずれも基点の作成に三角網の完了を待つ必要はない。

## その他の既存の入口

| 既存の入口 | 組み込み時の対応 |
| --- | --- |
| `updateTin`、`tinObject`、`tinResultUpdate` | 呼び出し時に層 ID を確定する。生成が必要な層は `requestTin` を呼び、`ready` の層は受理済み結果を描画する。`buildTin(request)` から worker・IPC へ、`request.layer` の `gcps`・`edges`・`bounds`・`intent`・`buildOptions` を使って接続する。A はモデルが `'worldFile'` を返す。worker の compiled と診断は別の値として受け取り、通信失敗や採用を拒否すべき生成エラーは reject に変換する。通常編集で保存可能な `tooLessGcps` 等の応答は `tin` に入れる。 |
| GCP・対応線の編集、`watch(gcps)`、`watch(edges)` | ドラッグ、数値入力、CSV、対応線編集などの書き込み元から、必要な点列と対応線を一度の `editLayer` に渡す。従来の深い watcher での再生成はモデルが開始する。画面に残す監視は描画・表示の同期を担当する。入力を非同期で取得する場合は、確定時にも層 ID とロックを確認する。 |
| `boundsModifyEnd` | 画像座標に直した外周を、確定した層 ID の `editLayer(layerId, { bounds })` に渡す。 |
| `watch(currentEditingLayer)` | 表示中の層 ID を求め、モデルから GCP・対応線・外周を表示し、編集用の一時状態を初期化する。生成済みならその結果で描画し、未計算なら `requestTin` に依頼する。選択変更に伴う表示の代入からモデルの編集を呼ばない。 |
| `addSubMap`、`removeSubMap`、`upImportance`・`downImportance`・`upPriority`・`downPriority` | `addLayer`・`removeLayer`・`changeLayerRanks` に接続する。削除確認前に層 ID を控え、確認後に同じ ID を使う。順位の変更量は ID ごとにまとめる。 |
| `WATCHED_FIELDS`、`captureHistoryState`、`commitHistorySnapshot` | `capture()` を地図メタデータと合わせて履歴・下書きに入れる。`history.commit(snapshot)` を `commitHistorySnapshot` へつなぎ、モデルが明示記録する項目の変更から別の履歴登録を起こさない。 |
| CRS 採用、キーボード・メニュー操作 | `prepareAdoption(copy, selection, signal)` で一時コピー上の座標変換・往復検査を済ませる。`history.withoutHistoryAsync(apply)` を既存の `withoutHistoryAsync('adopt-crs', apply)` につなぎ、解除後に履歴を一件記録する。採用の開始前に入力欄のフォーカスを外し、`App.vue` のネイティブテキスト Undo への経路を閉じる。画面側の編集・保存確認・再推定・メニューの入口でもロックを確認する。 |
| `saveMap`、`saveMapAfterConfirm`、`onBeforeUnmount` | 保留中の履歴確定や保存確認のダイアログより先にロックを確認する。保存確認後に `save` を呼び、そのコールバック内で既存の永続化へ渡す。離脱時は `dispose()` を呼ぶ。 |

`resolveTinBuildOptions` の所在は J6-T1b の `jan27/j6-t1b-projection-paths:src/utils/tinOptions.ts`。呼び出しは `resolveTinBuildOptions(layer, layerBuildOptions, intent)`。第 1 引数は `crs`・`worldFile` などの層直下の鍵と、利用する場合は `compiled` を持つ層のオブジェクト。旧 V2 層には `crs` 鍵を付けず、採用済みの層は現在の意図に合う値を渡す。第 2 引数には対象層の `buildOptions`（`strictMode`・`vertexMode`・`yaxisMode`）、第 3 引数には `intent.setup` を渡す。worker・Electron IPC・比較のプレビューは解決済みの設定で生成する。
