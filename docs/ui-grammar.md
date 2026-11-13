# MaplatEditor UI 文法

説明・エラー・空状態・ダイアログ・ボタンを、どの部品でどう出すかの決まりです。新しい画面や部品を作る前に読んでください。タスクの設計書を書くときも、この文書に合わせます。この文書に反する設計書を書く場合は、先にこの文書を変えます。

- 2026-11-13 §6.2 の地図の行を「地図の上の部品は ui-map-overlay-proposal.md §4.2」に書き換え、§9.2 に `map.tool-button` の検査を足した（地図の上の UI の実装に伴う）。
- 2026-11-13 §6.3 の推定ボタンの注記の出典を【AI 設計】から人間決定（白背景の上と地図の上は形が違ってよい）に改めた。地図の上の UI の棚卸しと決まりは [ui-map-overlay-proposal.md](ui-map-overlay-proposal.md)（案 A。人間決定）。
- 2026-11-13 §6.3 の例を「キャンセル」に替え、名前が似た別の操作は置き場所の役割で形が決まる旨を追加（AppEdit の「推定」を副次の操作の形にしたため）。出典なしの追加のため【AI 設計】。§7.5 の該当の行を直した。
- 2026-11-12 読み上げ名の「項目名が空」の扱い（§2.1）を追加。出典なしの追加のため【AI 設計】。
- 2026-11-11 U1〜U7 と U3 の通知の扱いを人間が推奨どおりに決定。注記: 「違和感があれば改めて指摘する」。決定の記録は §8。
- 2026-11-11 初版。過去のタスク設計書に散らばっていた人間の決定を 1 本に集めた。
- 言葉の決まり（どの語を使うか）は [docs/i18n/editor-glossary.md](i18n/editor-glossary.md) と AGENTS.md の「UI Wording & Glossary」にある。この文書は「どの部品で出すか」を扱う。

## 0. 出典の読み方

各項目の末尾に出典を付けます。

| 印 | 意味 |
|---|---|
| **【人間決定】** | 人間が決めた。設計書の「人間決定」「人間判断」の欄や、人間検証の指摘として記録されている |
| **【人間承認の文書】** | 人間が承認した設計書の本文にある。人間決定の欄に列挙された項目ではない |
| **【AI 設計】** | AI のタスク設計で決めた。人間は個別には確かめていない |
| **【提案・未決】** | この文書で初めて書く案。人間はまだ決めていない。決定として扱わない |

出典のパスは次のとおりです。

- `docs/superpowers/…` と `docs/superpowers/state/…`: 外側のリポジトリ（NayutaProducts）の直下からのパス
- `src/…`: このリポジトリのパス

よく使う出典に略号を付けます。

| 略号 | ファイル（NayutaProducts） |
|---|---|
| T11 | `docs/superpowers/specs/2026-07-20-m12-t11-description-grammar-design.md`（説明・エラーの文法の統一） |
| T5 | `docs/superpowers/specs/2026-07-14-m11-t5-application-shell-tokens-design.md`（token・診断・ヘルプの部品） |
| T6 | `docs/superpowers/specs/2026-07-14-m11-t6-resource-list-primitives-design.md`（一覧の部品） |
| EditV1 | `docs/superpowers/specs/2026-07-14-m11-resource-edit-grammar-redesign.md`（Edit の文法。人間承認済み） |
| ListV2 | `docs/superpowers/specs/2026-07-14-m11-resource-list-grammar-redesign.md`（一覧の文法。人間承認済み） |
| T10M12 | `docs/superpowers/specs/2026-07-19-m12-t10-master-surface-unification-design.md`（一覧行と空状態の統一） |
| T10M11 | `docs/superpowers/specs/2026-07-16-m11-t10-dedup-import-design.md`（複製・削除・Import） |
| M6T9 | `docs/superpowers/specs/2026-08-06-m6-t9-provider-followups-design.md` |

## 1. 全体の原則

1. **同じ見た目なら同じ挙動にする。** 同じ `?` アイコンが場所によって違う開き方をしてはいけない。【人間決定】T5:23（v3 (b)）、T5:169、EditV1:301
2. **画面ごとの scoped CSS で、共通部品に似せた見た目を作らない。** 行・選択の表し方・空状態・範囲の操作は、共通部品を使い回す。【人間決定】T10M12:356（「最重要原則（人間再提示）」）
3. **見た目は `--editor-ui-*` token で決める。** 大きな pastel のバナー、画面固有の暗い赤枠、大きすぎる margin を新しく作らない。【人間承認の文書】EditV1:55・EditV1:77-83、T5:110
4. **部品はドメインのサービスを直接呼ばない。** adapter を挟む。【人間承認の文書】EditV1:71、ListV2 §6.1

## 2. 説明（補足説明・ヘルプ）

### 2.1 決まり

| 場面 | 使う部品 | 出典 |
|---|---|---|
| 項目の補足説明（短文も長文も） | `ContextHelp`（`?` アイコン `bi-question-circle`。hover と focus で Popover が開く） | 【人間決定】T11:18（Q1 アイコン）、T11:19（Q2 長文も Popover でよい）、T5:23・T5:167-186（単一の挙動） |
| 長い概念の説明 | `ContextHelp` に `title` を付ける | 【人間決定】T5:191（v3 §8） |
| `EditorField` の項目 | `#help` slot に `<ContextHelp>` を置く（P1） | 【人間決定に基づく AI 設計】T11:35 |
| 生の `form-label` の項目・見出し | label や見出しの中、文言の直後に `<ContextHelp>` を置く（P2） | 【人間決定に基づく AI 設計】T11:36、M6T9:195-197 |
| モーダルの全体の説明 | モーダルの題の横に `<ContextHelp>` を置く | 【人間決定に基づく AI 設計】T11:40（A22/A23） |
| **ダイアログ内の選択肢の説明** | 選択肢の label の横に `<ContextHelp>` を置く | 【人間決定】`docs/superpowers/state/archive/2026-10-11-november-2026-update-cycle/state.json:12739`（OD-NOV26-EDITOR-WORDING-1021。エクスポートの小窓の「タイル」は「標準の『？』で説明」） |
| ボタンが押せない理由 | そのボタンの右に、押せないときだけ `ContextHelp` を出す。赤字（`text-danger`）にしない | 【人間判断】M6T9:32、M6T9:175-181 |
| 入力例 | placeholder に書く。placeholder には入力例しか書かない | 【人間承認の文書】EditV1:24（決定 7）、T5:192 |
| 上書きしない場合に効く値 | 選択欄の空の選択肢や placeholder に「マスタに従う（現在値）」の形で併記してよい | 【人間判断】`docs/superpowers/specs/2026-08-07-m6-t10-app-source-diff-model-design.md:555` |
| 説明の文言そのもの | 用語集に従う。データを指す名詞に「設定」を使わない（「設定」は動作、「設定ファイル」は定義の主体） | 【人間決定】state.json:12739、AGENTS.md「UI Wording & Glossary」 |

`ContextHelp` には `ariaLabel` を必ず渡します。どの項目の説明かが読み上げで分かるように、項目名を入れます。【AI 設計】M6T9:187

項目名だけ（例: 「オリジナル画像」「MCP サーバー」）では、ボタンの名前として何の説明か分からないので、説明は `t('editor_ui.help_about', { name })`（「〈項目名〉」の説明）、押せない・選べない理由は `t('editor_ui.unavailable_reason', { name })`（「〈項目名〉」を使えない理由）で包みます。項目名には、その ? が説明している項目のもの（隣のタブやボタンの名前ではないもの）を入れます。説明の文そのものを `ariaLabel` に渡している既存の箇所は、何の説明かが読み上げで分かるのでそのままにします。【AI 設計】

項目名が空のときは、その行・欄に出ている識別子（slug など）を項目名にします。識別子も無いときは、括弧を付けない文（`t('editor_ui.unavailable_reason_unnamed')`）にします。名前の無い括弧「」だけが読み上げられないのを避けるためです。【AI 設計】

### 2.2 禁止の形

次の形で説明文を画面に直書きしてはいけません。【人間決定】T11:38（R1「説明の `div.form-text.small` / `p.small.text-muted` / `small.text-muted` を全て削除」）、T11:107（AC1「form-text が存在しない（grep で 0 件）」）

- `<div class="form-text">説明</div>`、`<p class="form-text">`
- `<p class="small text-muted">説明</p>`、`<small class="text-muted">説明</small>`、`<div class="small text-muted">説明</div>`
- ダイアログの選択肢の label の下に置く説明の段落（`<label><strong>名前</strong><div class="small text-muted">説明</div></label>`）
- `EditorField` の `#help` slot に、`ContextHelp` 以外の文（`<span class="text-muted small">…</span>` など）を入れること
- `EditorField` の `hint` prop を復活させること。【人間決定】T11:22（Q4 で削除）

### 2.3 状態の表示は説明ではない

次のものは説明ではなく状態の表示なので、直書きしてかまいません。【人間決定】T11:73（D2「ステータス表示のまま現状維持」）

- 件数、ID、種別、座標などのメタデータ（例: 一覧の `{{num}} 件`、行の `mapID / scope`）
- 処理の状態（読み込み中、MCP の待ち受け状態、最後の要求の時刻など）
- 一覧の見出し・節の名前

### 2.4 常設の注意書き

取り消せない操作・ファイルサイズ・個人情報などの注意は、`DiagnosticFeedback scope="field"` の warning（黄色の三角）で常に表示します。説明は `ContextHelp` に入れます。`EditorField.hint` や説明の直書きは復活させません。【人間決定（2026-11-11、推奨どおり）】§8 U1

- 選んだときだけ効く注意は、選んだときに出す（例: 書き出しの「オリジナル画像」にチェックすると、ファイルが大きくなり写真の付帯情報を含むことがあるという warning が出る。「そのまま入れます」という説明は `ContextHelp`）。1 つの文言に説明と注意が混ざっていたら、キーを分ける。【AI 設計】
- 2026-11-11 に `ContextHelp` の説明 68 件を全数見て、ファイルサイズ・個人情報・取り消せないことの注意が入っていたのは上の 1 件だけだった。`settings.editor_api_key_notice`（公開用とは別のキーを発行する）は鍵の扱いの説明で、この 3 つには当たらないので `ContextHelp` に残した。【AI 設計】

## 3. エラー・警告

### 3.1 決まり

| 種類 | 出し方 | 出典 |
|---|---|---|
| 項目に結び付いたエラー | 入力欄に赤枠（`is-invalid`）を付け、その直下に赤字を出す。`DiagnosticFeedback scope="field"`（`EditorField` は `diagnostics` を内蔵） | 【人間決定】T11:21（Q3 ルール「過去決定」）、EditV1:123 |
| 項目に結び付いた警告 | 黄色の枠・黄色の文字でよい。`DiagnosticFeedback scope="field"` の severity `warning` | 【人間決定】T11:21 |
| 複数の項目にまたがる不整合 | 節やタブの上部の compact summary。`DiagnosticFeedback scope="section"` と、各項目の field 診断を併記する | 【人間承認の文書】EditV1:124 |
| 操作全般のエラー（保存・通信・一覧の取得の失敗など） | バナー。`DiagnosticFeedback scope="operation"`（保存などは `EditorActionHeader` の直下）。一覧の取得の失敗は `scope="section"` | 【人間決定】T11:21・T11:50、EditV1:125 |
| バナーに出すもの | **操作のエラーだけ**。全項目のエラーをまとめたバナーは出さない | 【人間検証の指摘】T10M11:8（v3.5 R3「全量サマリバナーを廃止し『field 診断＋バナーは操作エラーのみ』へ統一」） |
| 未入力の必須項目 | 触る前から即時に出してよい（dirty や touched で隠さない） | 【人間決定】T5:23（v3 (a)）、EditV1:304 |
| severity とアイコン | info=`bi-info-circle`、success=`bi-check-circle`、warning=`bi-exclamation-triangle`（黄色の三角）、danger=`bi-exclamation-octagon` | 【人間決定】T11:20（Q3 D7「黄色三角等許容」）。表は【AI 設計】T5:158-165 |
| 色 | 警告は黄、エラーは赤、情報は青。形は同じにし、強弱は token で表す | 【人間承認の文書】EditV1:23（決定 6）、EditV1:127 |
| 項目の文言を変えたり元に戻したら | 操作のエラー（ID の重複など）を消す | 【人間検証の指摘】T5:203（F4） |

### 3.2 例外として残すもの（人間が「現状維持」と決めたもの）

| 対象 | 現状の形 | 出典 |
|---|---|---|
| BaseMapEdit / AssetEdit のリビジョン競合 | `alert alert-warning` と、ボタン 2 個（`btn-warning` の「上書き」など） | 【人間決定】T11:23（Q5 C34/C35 現状維持）、T11:59（C45/C46） |
| 参照切れの POI の警告（PoiReferenceEditor） | カードの中で `text-warning-emphasis` | 【人間決定】T11:77（D6） |
| selector で追加できない理由（ResourceMasterRow） | 項目の横の `ContextHelp`。赤字にしない（従来の例外を廃止） | 【人間決定（2026-11-11、推奨どおり）】§8 U4 |
| IconRefField の警告バッジ | 値の表示の一部 | 【人間決定】T11:79（D8） |

### 3.3 禁止の形

- 項目のエラーや警告を `<div class="text-danger small">`、`<span class="text-danger">`、`<p class="text-warning">` で直書きすること。【人間決定】T11:21・T11:54-58
- `alert alert-danger` / `alert-warning` / `alert-success` を直書きすること（§3.2 の例外を除く）。【人間決定に基づく AI 設計】T11:57-58
- `alert()`（ブラウザの標準のもの）で失敗を知らせること。【人間決定に基づく AI 設計】T11:61（C49/C50 を DF operation へ）
- 押せない理由をエラー色で出すこと。【人間判断】M6T9:181

## 4. 空状態・読み込み失敗

| 場面 | 使う部品 | 出典 |
|---|---|---|
| master-detail の詳細ペインが空 | `ResourceEmptyState`（中央にアイコンと文言） | 【人間検証の指摘】T10M12:51-52・T10M12:309（AC7）・T10M12:356 |
| 参照選択の右ペイン（選択済みの一覧）が空 | `ResourceEmptyState`（文言は「左の一覧から〇〇を追加してください。」） | 【人間検証の指摘】T10M12:99-101（HM8〜HM10）、T10M12:257-271 |
| 開いた資源が見つからない（not found） | `ResourceEmptyState` と、`#actions` slot の戻るボタン | 【人間決定】T11:23（Q5 C47/C48）、T11:60 |
| 一覧の結果の状態（読み込み中・0 件・末尾・失敗・追加の失敗） | `ResourceResultStatus`。共通の語彙（`resource_list.*`）を使う。初回の失敗は共通のエラーと再試行、追加の失敗は取得済みの項目を残して末尾に再試行を出す | 【人間承認の文書】ListV2:156-157・ListV2:265-266 |
| 一覧の取得の失敗（selector の候補など） | `DiagnosticFeedback scope="section"` | 【人間決定に基づく AI 設計】T11:58（C41〜C44） |
| 節の中の小さな「該当なし」（例: 書誌の 1 群が空） | 1 行の `text-muted`。ペイン全体が空のときだけ `ResourceEmptyState` | 【人間決定（2026-11-11、推奨どおり）】§8 U7 |

禁止の形: `<div class="text-muted text-center py-3">該当なし</div>` のような空表示を画面ごとに作ること。【人間検証の指摘】T10M12:28・T10M12:356

## 5. 確認ダイアログとモーダル

### 5.1 いつダイアログを出すか

| 決まり | 出典 |
|---|---|
| ダイアログは**破壊的な操作と、利用者に判断させるとき**だけに使う | 【人間承認の文書】EditV1:127 |
| 破壊的な操作の確認は残し、入力・選択が無い確認はネイティブに揃える | 【人間決定（2026-11-11、推奨どおり）】§8 U3（T11:80 の確認自体を残す決定を継承） |
| 未保存の確認ダイアログ（保存・閉じるとき）は置かない。下書きを自動で保持し、復元する | 【人間承認】`docs/superpowers/reviews/2026-07-18-m12-t1-modernized-parity-audit.md:74`（ME-32） |
| 削除の確認は `DeleteConfirmDialog`（`useResourceDelete` の request・confirm・cancel）の共通の入口を使い、確認自体はネイティブに揃える | 【人間決定（2026-11-11、推奨どおり）】§8 U3 |
| `confirm()`（ブラウザの標準のもの）を使わない | 【AI 設計】T10M11:244・T10M11:289 |
| 複製は即時に保存せず、新しい下書きとして開く（確認ダイアログを挟まない） | 【人間決定】ListV2:30（決定 8） |
| エクスポートは「ボタン → 確認ダイアログ（中身を選ぶ）→ 実施」の順にする | 【AI 設計】Editor のコミット e8c8722（nov26-editor-appexport-dialog） |

### 5.2 ダイアログの中身

| 要素 | 決まり | 出典 |
|---|---|---|
| 選択肢（ラジオ・チェック）の説明 | label の横に `ContextHelp`。label の下に段落を置かない | 【人間決定】state.json:12739（「タイル」は標準の「？」で説明） |
| モーダル全体の補足説明 | 題の横に `ContextHelp` | 【人間決定に基づく AI 設計】T11:40 |
| ダイアログの本文（何を判断させるか。例: 「この地図から生成済みのタイルセットが見つかりました。更新するものを選ぶか…」） | 本文の 1 段落は直書きしてよい。選択肢の説明は `ContextHelp` | 【人間決定（2026-11-11、推奨どおり）】§8 U2 |
| 押せない理由（例: 何も選んでいないと「エクスポート」が押せない） | ボタンの横に `ContextHelp`。赤字にしない | 【人間決定（2026-11-11、推奨どおり）】§8 U4（M6T9 に統一） |
| 入力の検証エラー | §3 と同じ（field / section の `DiagnosticFeedback`） | 【人間決定】T11:21 |

### 5.3 ネイティブのダイアログとアプリ内のモーダル

確認は Electron の `window.dialog.showMessageBox` に揃えます。アプリ内のモーダルは入力や選択がある場合だけに使います。通知だけのダイアログは成功・失敗とも `DiagnosticFeedback scope="operation"` に移します。【人間決定（2026-11-11、推奨どおり）】§8 U3・U3 付随

実装の形【AI 設計】:

- 通知は `useOperationNotice().notifyOperation()` で出し、`OperationNotice`（`EditorActionHeader` の直下。ヘッダーの無い画面は `App.vue` の予備の置き場）がバナーにする。閉じるボタンで消せる。
- 通知は画面遷移で消える（query だけの変更は遷移に数えない）。成功の通知を別の画面へ持ち越さない。
- 遷移を越えて残すのは、呼び出し側が `keepAcrossNavigation: true` を明示したときだけで、次の遷移を 1 回だけ越える。使うのは、失敗を知らせて一覧へ戻す操作（`MapEdit.vue` の IIIF の取り込みで預かりを受け取れなかったとき・配信先が使えないとき）の 2 か所だけ。
- 保存・書き出し・取り込み・対応点の試しのクリックなど、操作を始めるときに前の通知を消す（`clearOperationNotice`）。前の成功と今回の失敗が並ばないように、また前の失敗が次の成功の後まで残らないようにする。保存は `useRevisionedAssetSave` の `onStart` で消す。
- 同じ操作を繰り返す場面（対応点の試しのクリック、アプリのプレビューの描き直し）は、通知に出どころ（`origin`）を付け、`clearOperationNotice(出どころ)` で自分の通知だけを消す。下書きの復元の警告や書き出しの結果など、ほかの操作の通知は消さない【AI 設計】。
- 通知を出した直後に path の変わる遷移をする操作は、遷移を済ませてから通知を出す（例: POI のソースの初回の保存）。
- 処理の進み具合を出す `ProgressModal`（`operation-progress-dialog`）は、アプリ内のモーダルのまま残す。入力も選択も無いが、通知ではなく、実行中は閉じられず終わったら閉じる進捗の表示なので、ネイティブのダイアログにもバナーにも移さない。【AI 設計】
- 確認の部品（`DeleteConfirmDialog`・`DraftConflictDialog`）は呼び出し側の入口を変えず、中でネイティブのダイアログを出す。ダイアログを出せなかったときは、壊さない側（`cancelId` と同じ）を選ぶ。

## 6. ボタンの種類と色

### 6.1 人間が決めたこと

| 決まり | 出典 |
|---|---|
| 5 つの一覧の新規の入口は、白背景・平坦・青字の outline の `＋ 新規追加` に揃える（`btn-outline-primary`）。文言・見た目・DOM の位置を共通にする | 【人間決定】ListV2:23（決定 1）、T6:124（T6-AC2） |
| Import は共通の secondary slot に置き、対応する形式がある Map / POI / App だけに出す | 【人間決定】ListV2:31（決定 9） |
| 一覧の項目の操作は `⋮` メニューに集める。右クリックと `Shift+F10` も同じメニューを開く。並びは「複製」「削除」。操作が 1 つも無い項目には `⋮` を出さない | 【人間決定】ListV2:29-30（決定 7・8）。空のメニューの扱いは【AI 設計】T6:75（D4改） |
| ページのボタンは置かず、無限スクロールにする | 【人間決定】ListV2:27（決定 5） |
| Slug の一意性を手で確かめるボタンは置かない | 【人間決定】EditV1:20（決定 3） |
| 範囲の自動設定に「GCP から設定」のような専用のボタンを置かない | 【人間承認の文書】EditV1:163 |
| master-detail（ベースマップ・アセット）のヘッダーに「< 一覧へ」を置かない。route で移る画面（地図・アプリ・POI）には置く | 【人間決定】T5:23（v3 (c)）、EditV1:303 |
| `?` の trigger は `btn btn-link p-0` と `bi-question-circle`（中立の色） | 【人間決定】T11:18。class は【AI 設計】T5:179 |
| リビジョン競合のボタン（`btn-warning`）は今のまま | 【人間決定】T11:59 |

### 6.2 役割ごとの使い分け

次の表に揃えます。ダイアログのボタンは通常の大きさとし、`btn-sm` を使いません。【人間決定（2026-11-11、推奨どおり）】§8 U5・U6

| 役割 | class | 今の主な使用例 |
|---|---|---|
| ダイアログ・画面の主な操作（実行・保存・エクスポート・適用） | `btn btn-primary` | エクスポートの小窓 3 つ、`PoiMergeImportDialog`、`ExportKeyPromptModal` |
| 破壊的な操作の確定（削除・値が消える切り替え） | `btn btn-danger` | `DeleteConfirmDialog`、`PoiContentModeEditor` |
| 取り消し・戻る・副次の操作 | `btn btn-outline-secondary` | 多くのダイアログの「キャンセル」 |
| 値を消す（範囲・ホーム位置のクリア、行の削除） | `btn btn-outline-danger`（ダイアログでは左端 `me-auto`） | `EnvelopeEditorModal`、`HomePositionEditorModal` |
| 入口の操作（新規追加・追加・選択） | `btn btn-outline-primary` | `＋ 新規追加`（人間決定）ほか |
| 地図の上に重ねる道具（ボタン・表示の切り替え・情報） | [ui-map-overlay-proposal.md](ui-map-overlay-proposal.md) §4.2 の白い札（`map-tool`）。地図の上の部品はこの文書の他の行ではなく §4.2 に従う | MapEdit の推定・ホーム位置のボタン |
| ダイアログのボタンの並び | 左から「（値のクリア）」「キャンセル」「主な操作」 | ほぼ全部のダイアログ |

### 6.3 禁止の形

【人間決定（2026-11-11、推奨どおり）】§8 U5・U6

- 同じ操作に違う見た目を使うこと（例: 同じ「キャンセル」が、あるダイアログでは `btn-outline-secondary`、別のダイアログでは `btn-secondary`）。
  - 名前が似ていても別の操作なら、形は置き場所の役割（§6.2）で決まる。MapEdit の「推定」（GCP からホーム位置を推定する、地図の上に重ねる道具）は地図の道具の形、AppEdit の「推定」（地図の範囲からホーム位置を推定する、入力欄の横のボタン）は隣の「地図で指定」と同じ副次の操作の形（`btn btn-sm btn-outline-secondary`）にする。【人間決定（2026-11-13）】白背景の上と地図の上は形が違ってよい。地図の上の UI 同士の決まりは [ui-map-overlay-proposal.md](ui-map-overlay-proposal.md) の案 A（【人間決定（2026-11-13）】）
- ダイアログの「キャンセル」に `btn-secondary`（塗り）を使うこと。

## 7. 違反の棚卸し（2026-11-11、origin/master 7893dc4）

`src/` を grep と目視で調べました。`DesktopRegisteredMapSelector.vue` は参照されていない古いコードなので数えていません（T5:54 で対象外と記録済み）。このファイルは 2026-11-11 のレビュー（Minor 7）で消しました。

> **2026-11-11 に直しました。** この節の違反は、§8 の決定どおりに直しました。直さずに残したものは、出典つきで許可リスト `docs/ui-grammar.allowlist.json` に入れています（§9）。表は直す前の記録として残します。
> 表と違う直し方をしたもの: 7.1 の #19「接続の手順」は説明ではなく URL の項目名なので、`ContextHelp` に入れず、他の項目と同じく左の列の項目名にしました。同じ行の #14（127.0.0.1 で登録する注意）は、コピーのボタンの横の `ContextHelp` にしました。

### 7.1 説明の直書き

**A. 決まりに反する（§2.2）: 14 件・7 ファイル**

| # | 場所 | 形 | キー |
|---|---|---|---|
| 1 | `src/views/PoiEdit.vue:279` | ダイアログの選択肢の下の `div.small.text-muted` | `poiio.format_geojson_desc` |
| 2 | `src/views/PoiEdit.vue:293` | 同上 | `poiio.format_csv_desc` |
| 3 | `src/views/PoiEdit.vue:307` | 同上 | `poiio.format_json_desc` |
| 4 | `src/views/PoiEdit.vue:322` | ダイアログの `form-text` | `poiio.export_option_images_help` |
| 6 | `src/components/PoiMergeImportDialog.vue:103` | 選択肢の下の `p.small.text-muted` | `poiio.import_overwrite_note` |
| 7 | `src/components/PoiMergeImportDialog.vue:148` | ダイアログの `p.small.text-muted` | `poiio.import_geojson_hint` |
| 8 | `src/components/PoiAttributeForm.vue:243` | `form-text` の入力例 | `poiedit.directgo_examples` |
| 9 | `src/components/PoiAttributeForm.vue:257` | `div.small.text-muted` | `poiedit.directgo_preview_note` |
| 10 | `src/components/basemap/BaseMapEdit.vue:324` | `p.form-text.small.text-muted` | `basemap.modal.style_maplibre_hint` |
| 11 | `src/components/mapedit/IiifBindingPanel.vue:8` | `p.small.text-muted` | `iiif_metadata.help` |
| 12 | `src/components/mapedit/IiifBindingPanel.vue:60` | `p.small.text-muted` | `iiif_metadata.recopy_help` |
| 13 | `src/views/Settings.vue:309` | `p.form-text` | MCP の外部向けの注意（`mcpNotice`） |
| 14 | `src/views/Settings.vue:439` | `p.form-text` | `settings.mcp_recommend_loopback` |
| 15 | `src/components/mapedit/MercTileSetModal.vue:116` | `EditorField` の `#help` slot に `span.text-muted.small` | `merc.modal_attr_help` |

**B. U1〜U7 の決定を適用する箇所: 8 件**

5 は説明（「そのまま入れます」）を `ContextHelp` に、ファイルサイズと写真の付帯情報の注意を、オリジナル画像を選んだときの field warning に分ける（2026-11-11 のレビューで A から移した。初めは注意ごと `ContextHelp` に入れていた）。16・17 は field warning、18・19 は `ContextHelp` へ移す。20・21 は判断の本文として許可。22 は節内の 1 行の空表示として許可。

| # | 場所 | 中身 | 適用する決定 |
|---|---|---|---|
| 5 | `src/views/MapEdit.vue:4885` | ダイアログの `form-text`。説明とファイルサイズ・写真の付帯情報の注意が 1 文に入っている（`mapedit.export_option_originals_note`。`_help` と `_warning` に分けた） | U1 |
| 16 | `src/components/basemap/BaseMapEdit.vue:411` | 置換した画像は保存・元に戻すの対象外という注意（`editor_ui.thumbnail_immediate_note`） | U1 |
| 17 | `src/views/MapEdit.vue:5195` | 同上（同じキー） | U1 |
| 18 | `src/views/MapEdit.vue:5153` | 写せなかったときの代わりの手の案内（エラーの直後。`iiif_metadata.recopy_failed_help`） | U1 |
| 19 | `src/views/Settings.vue:440` | 接続の手順の URL（`settings.mcp_docs_link`） | U1 |
| 20 | `src/components/mapedit/MercTileSetModal.vue:82` | ダイアログの本文の段落（`merc.modal_select_description`） | U2 |
| 21 | `src/components/editor-ui/ExportKeyPromptModal.vue:52` | ダイアログの本文の段落（`appedit.export_key_prompt_description`） | U2 |
| 22 | `src/components/basemap/BaseMapEdit.vue:72` | 種別を選ぶ前の案内（`basemap.kind.select_prompt`） | U7 |

16・17 は `docs/superpowers/specs/2026-08-10-m19-t12-thumbnail-replace-persistence-parity-design.md:671`、5 は `docs/superpowers/specs/2026-10-11-nov26-m6-t8-task-design.md:74` の AI 設計が、表示のしかたを指定していました。T11 の決まりを知らないまま設計されたものです。

**C. 違反ではない（状態・件数・メタデータ・見出し）**: `form-text` と `text-muted` の残りの約 50 件。例: `src/views/Settings.vue:338`（最後の要求の時刻）、`src/components/basemap/BaseMapMasterList.vue:42`（件数）、`src/views/AppEdit.vue:1847`（ID と役割）、`src/components/mapedit/IiifImportDialog.vue:28`（見出し）。

> 依頼の時点では「form-text 等が 13 ファイルで約 21 件」と見積もられていました。この表は、状態の表示（C）を除き、form-text 以外の段落と `#help` slot の誤用（15）を加えたため、数が違います。

### 7.2 エラー・警告の直書き（§3.3）: 12 件

| # | 場所 | 形 | 本来の形 |
|---|---|---|---|
| 1 | `src/views/Settings.vue:208` | `div.text-warning.small`（キーの重複の警告 Google） | DF field warning |
| 2 | `src/views/Settings.vue:234` | 同上（Mapbox） | DF field warning |
| 3 | `src/views/Settings.vue:347` | `div.text-danger.small`（ポートが使用中） | DF section/operation |
| 4 | `src/views/Settings.vue:354` | 同上（待ち受けの失敗） | DF section/operation |
| 5 | `src/views/Settings.vue:385` | 同上（ポート番号が不正） | DF field と入力欄の `is-invalid` |
| 6 | `src/views/Settings.vue:432` | 同上（コピーの失敗） | DF operation |
| 7 | `src/views/MapEdit.vue:4887` | ダイアログの `div.text-danger.small`（何も選んでいない） | 押せない理由として `ContextHelp`（U4） |
| 8 | `src/components/mapedit/IiifImportDialog.vue:25` | `p.text-danger.small` | DF section |
| 9 | `src/components/PoiMergeImportDialog.vue:90` | `p.text-danger.fw-bold`（読めないファイル） | DF section |
| 10 | `src/components/resource-list/RecentSearchChips.vue:41` | `span.text-danger` | DF operation |
| 11 | `src/views/PoiEdit.vue:119` | `alert alert-success` の直書き（取り込みの結果） | DF operation（success） |
| 12 | `src/App.vue:97` | 起動時のモーダルの `p.text-warning`（移行の警告の件数） | DF section warning |

参考（成功の通知）: `src/views/Settings.vue:429` はコピーの成功を `form-text` で出しています。

違反ではないもの（§3.2 の例外と共通部品）: `src/components/basemap/BaseMapEdit.vue:36`、`src/components/assets/AssetEdit.vue:35`、`src/components/PoiReferenceEditor.vue:90,122,129,136`、`src/components/resource-list/ResourceMasterRow.vue:24`、`src/components/resource-list/ResourceResultStatus.vue:12`、`src/components/resource-list/DeleteConfirmDialog.vue:20`。

### 7.3 ダイアログ

| 種類 | 件数 | 場所 |
|---|---|---|
| ブラウザ標準の `confirm()` | 1 | `src/composables/useAssetDraftBadges.ts:26` |
| `showMessageBox` の通知だけ（ボタン 1 個。EditV1:127 に照らすと対象外の使い方。U3） | 22 | `src/views/AppEdit.vue:288,1228,1237,1245,1427`、`src/views/MapEdit.vue:183,919,2436,2457,2528,2930,2934,2950,4488,4815`、`src/views/PoiEdit.vue:602,1052,1062,1128,1134,1146`、`src/views/Settings.vue:701` |
| `showMessageBox` の確認（ボタン 2 個以上。今は決まりの範囲内。方式は U3） | 22 | `src/components/assets/AssetEdit.vue:541,586`、`src/components/basemap/BaseMapEdit.vue:963,999`、`src/composables/useRevisionedAssetSave.ts:95,108`、`src/views/AppEdit.vue:502,534,1097,1110,1133`、`src/views/MapEdit.vue:4035,4069,4162,4273,4286,4342,4525,4798`、`src/views/PoiEdit.vue:650,670,986` |
| 画面に直書きしたアプリ内モーダル（共通の枠の部品が無い） | 3 | `src/views/PoiEdit.vue:254`、`src/views/MapEdit.vue:4857`、`src/views/AppEdit.vue:1953`（エクスポートの 3 つの小窓。中身はほぼ同じ） |

### 7.4 空状態（§4）

| 場所 | 中身 | 判定 |
|---|---|---|
| `src/components/PoiAttributeForm.vue:4` | POI を選んでいないときの詳細ペイン | 違反（詳細ペインの空は `ResourceEmptyState`） |
| `src/components/assets/AssetMasterList.vue:33` | 一覧が 0 件 | 違反の候補（`ResourceResultStatus` の共通の語彙と別の文言） |
| `src/components/AssetPicker.vue:83` | 選べるアセットが 0 件 | 違反の候補（同上） |
| `src/components/basemap/BaseMapMasterList.vue:63` | 自分のベースマップの節が空 | U7 |
| `src/components/mapedit/IiifMetadataTable.vue:14` | 書誌の 1 群が空 | U7 |
| `src/components/ResourceSelector.vue:9` | 選択済みが空のときの既定の表示（slot の既定の中身） | 要確認（呼び出し側が slot を上書きしていれば表に出ない） |

### 7.5 ボタンの class のばらつき

`class` 属性に `btn` を含む要素 176 個の内訳（`:class` の動的な指定は含まない）:

| class | 個数 |
|---|---:|
| `btn-sm` | 101 |
| `btn-outline-secondary` | 75 |
| `btn-primary` | 25 |
| `btn-outline-primary` | 24 |
| `btn-group` | 14 |
| `btn-light` | 12 |
| `btn-outline-danger` | 10 |
| `btn-link` | 8 |
| `btn-secondary` | 5 |
| `btn-close` | 4 |
| `btn-warning` | 2 |
| `btn-danger` | 2 |
| `btn-outline-info` | 1 |

§6.2 の決定から外れるもの:

| 場所 | 形 | 決定との差 |
|---|---|---|
| `src/components/AssetPicker.vue:130` | キャンセルが `btn-secondary` | outline-secondary でない |
| `src/components/EnvelopeEditorModal.vue:306` | 同上 | 同上 |
| `src/components/HomePositionEditorModal.vue:127` | 同上 | 同上 |
| `src/components/ProgressModal.vue:34` | 閉じる（OK）が `btn-secondary` | `src/App.vue:101` の OK は `btn-primary`。同じ「OK」で色が違う |
| `src/views/AppEdit.vue:1723` | 「ホーム位置を推定」が `btn-outline-info` | 隣の「地図で指定」と形が違う。MapEdit の推定は別の操作（GCP から推定）。2026-11-13 に `btn-outline-secondary` へ直した |
| `src/views/MapEdit.vue:5542` | タイルの生成が `btn-secondary` | 主な操作なら primary |
| `src/views/Settings.vue:160,279,377,398,412,421` | `btn-light border`（6 個） | 設定の画面だけの形 |
| `src/components/resource-list/DeleteConfirmDialog.vue:25,30`、`src/components/PoiContentModeEditor.vue:41,49` | ダイアログのボタンが `btn-sm` | 他のダイアログは通常の大きさ（U6） |
| `src/components/editor-ui/DraftConflictDialog.vue:18` | 下書きを捨てる操作が `btn-outline-secondary` | 捨てる操作を中立の色で出している（U5） |

## 8. 人間決定の記録（2026-11-11）

出典: 本作業の人間指示（2026-11-11）。U1〜U7 と U3 付随はすべて推奨（★）どおりに決定。人間の注記は「違和感があれば改めて指摘する」。未決事項はありません。

| # | 人間決定（2026-11-11、推奨どおり） |
|---|---|
| U1 | (b) 注意だけは `DiagnosticFeedback scope="field"` の warning で常設。説明は `ContextHelp` |
| U2 | (a) 判断を求める本文の 1 段落は直書き可。選択肢の説明は `ContextHelp` |
| U3 | (a) 確認はネイティブに統一。アプリ内モーダルは入力・選択がある場合だけ |
| U3 付随 | (1) 通知だけの 22 件は成功・失敗とも `DiagnosticFeedback scope="operation"` に移す |
| U4 | (a) 押せない・選べない理由はすべて `ContextHelp`。赤字にしない |
| U5 | (a) §6.2 のボタンの役割と class を採用 |
| U6 | (a) ダイアログのボタンは通常の大きさに統一 |
| U7 | (a) ペイン全体が空なら `ResourceEmptyState`。節の中の空は 1 行の `text-muted` |

## 9. 機械で検査する規則

用語集の検査（`scripts/editor-glossary-check.mjs`・`pnpm smoke:editor-glossary`・CI の smoke）と同じ形で、`scripts/editor-ui-grammar-check.mjs` を実装しました（`pnpm smoke:editor-ui-grammar`。検査器そのものの試験は `pnpm smoke:editor-ui-grammar-fixtures`）。

### 9.1 仕組み

- `.vue` の template を `@vue/compiler-sfc` で AST にして調べる。正規表現の grep は、属性の並びや改行の違いで取りこぼすので使わない。
- 結果は用語集と同じく `<file>:<line> <ruleId> <hit>` の形で出し、JSON の報告も書く。
- **許可リスト** `docs/ui-grammar.allowlist.json` を置く。1 件ごとに `rule`・`file`・`testid` または i18n キー・`reason`・出典（人間決定の場所）を書く。行番号では照合しない（行がずれても効き、キーが変われば切れる）。glob や一括の免除は認めない。消すものが無い許可は警告にする（用語集の例外と同じ）。
- **ラチェット**: 今回の修正後は未許可の違反 0 件を基準にし、違反が増えたら CI を落とす。残す例外には個別の出典を必須とする。

### 9.2 検査できる決まり

| ruleId | 検査 | 根拠 | 許可リストの例 |
|---|---|---|---|
| `help.form-text` | `class` に `form-text` を持つ要素 | T11 AC1（0 件） | 状態の表示（`Settings.vue` の最後の要求の時刻）は `testid` で許可 |
| `help.muted-text` | `small` や `text-muted` を持つ要素の中身が `t('…')` だけで、キーが `_help`・`_note`・`_desc`・`_hint`・`_examples`・`_notice`・`_description` で終わる | T11 R1 | 判断の本文（§8 U2） |
| `help.key-outside-contexthelp` | 上の接尾辞のキーが `ContextHelp` の `text`・`title` 以外で使われる（template の全部の `t()` の呼び出しを集める） | T11 R1 | なし |
| `help.slot-misuse` | `EditorField` の `#help` slot の中に `ContextHelp` 以外の要素がある | T11 P1 | なし |
| `help.aria-label` | `ContextHelp` に `ariaLabel` が無い（型でも検出されるが、空文字も検出する） | M6T9 §3.5 | なし |
| `diag.inline-text` | `text-danger`・`text-warning` の要素の中身が文言（`*` の必須マークや `ResourceActionMenu` の破壊的な項目の色は除く） | T11 Q3 ルール | §3.2 の例外（`PoiReferenceEditor` など） |
| `diag.raw-alert` | `class` に `alert` を持つ要素 | T11 R3 | `BaseMapEdit` と `AssetEdit` の競合（C45/C46） |
| `dialog.native-browser` | `confirm(`・`alert(`・`prompt(` の呼び出し（`.vue` と `.ts`） | T11 C49/C50、T10M11 | なし |
| `dialog.notify-only` | `showMessageBox`（`window.dialog.showMessageBox` と自前の wrapper の `showMessageBox(...)`）の `buttons` が 1 個。`buttons` を書かないもの（Electron では OK 1 個）も 1 個とみなす。`buttons` や引数を変数で渡すなど数の分からないものも違反とし、許可リストで個別に通す（文言のキーの無い呼び出しは `args:<引数の書き方>` をキーにする） | EditV1:127 | ボタンの数が保存済みかで変わる書き出しの確認（`editor_ui.export_dirty_prompt`）と、`useRevisionedAssetSave` の wrapper の中継（§5.1） |
| `dialog.ad-hoc-modal` | 共通の部品以外で `class="modal …"` を直書きする | §1.2・§5.3 | 入力・選択を伴う既存の部品を個別に許可 |
| `empty.ad-hoc` | `text-center` と `text-muted` を持つ要素の中身が、キーに `empty`・`no_`・`not_found`・`select_` を含む `t()` だけ | T10M12 | 節内の空表示（§8 U7） |
| `button.variant` | 役割の分からない `btn-*` の組み合わせ（例: ダイアログの footer のキャンセルが `btn-secondary`） | §8 U5・U6 | — |
| `map.tool-button` | 地図の上に重ねる道具のボタン（`map-overlay-tools` の中の `button`）に `map-tool` が無い、または `aria-label` か `title` が無い | [ui-map-overlay-proposal.md](ui-map-overlay-proposal.md) §4.2（案 A） | — |

### 9.3 検査できないこと（レビューで見る）

- 地図の上の OpenLayers 既定・取り込みの部品の札の見た目と読み上げ名は JS・CSS 側で付けるため template の検査に出ない（`src/utils/mapOverlayTools.ts` と `src/assets/scss/map-overlay.scss` をレビューで見る）
- 文言が説明か状態の表示か（キーの名前で推し量るだけ）
- 新しい部品が共通部品の見た目を scoped CSS でまねているか（T10M12:356）
- 同じ操作に同じ見た目を使っているか（操作の同一性は機械には分からない）

### 9.4 置き場所

- CI: `scripts/ci/run-smokes.mjs` は `package.json` の `smoke:*` を全数実行するので、`smoke:editor-ui-grammar` と `smoke:editor-ui-grammar-fixtures` は足すだけで CI に載る（済み）
- 検査の報告 `editor-ui-grammar-report.json` を CI の artifact に上げる（済み。`.github/workflows/test.yml` の smoke ジョブの Upload UI grammar report。同 workflow は用語集の検査の正本側なので、locale を変える PR と一緒には変えない（用語集の関門 1。AGENTS.md「UI Wording & Glossary」））
- AGENTS.md の「UI Grammar」の節からこの文書へ案内する。用語集の節と並べる（済み）
- タスク設計書の雛形に「この画面の説明・エラー・空状態・ダイアログ・ボタンは ui-grammar.md のどの行に従うか」の欄を足す（外側のリポジトリの nayuta-designer スキル。このリポジトリの外なので未着手）

## 10. この文書を変えるとき

- 人間が決めたことを書き足すときは、**出典（ファイル:行）**を付ける。出典が無いものは【提案・未決】と書く。
- 人間が決めたら、本文の規則と §8 の決定記録を更新する。
- 決まりを変えたら §7 の棚卸しと §9 の検査の案も合わせて直す。
