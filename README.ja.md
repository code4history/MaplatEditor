<!-- SECTION 1: Header (logo, badges, title) -->
<p align="center">
  <img src="https://code4history.github.io/Maplat/page_imgs/maplat.png" alt="MaplatEditor ロゴ" width="200" />
</p>

<h1 align="center">MaplatEditor</h1>

<p align="center">
  <a href="https://github.com/code4history/MaplatEditor/actions/workflows/build.yml"><img src="https://github.com/code4history/MaplatEditor/actions/workflows/build.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
</p>

<!-- SECTION 2: Elevator Pitch -->
## MaplatEditor について

MaplatEditor は [Maplat](https://github.com/code4history/Maplat) 古地図ビューア
向けのデスクトップデータ作成ツールです。地図登録・対応点設定・タイル生成・
Maplat ビューアライブラリ（`@maplat/ui` / `@maplat/core`）が消費するアプリ
データの組み立てを GUI で提供します。Windows / macOS で動作します。

MaplatEditor は Apache License 2.0（バージョン 0.7.0 以降）のオープンソース
プロジェクトです。npm には公開していません（`package.json` で `private: true`）。
バイナリは GitHub Releases から配布しています。

<!-- SECTION 3: Language switch link -->
**[英語版はこちら / Read this document in English](README.md)**

<!-- SECTION 4: Key Features -->
## 主な特徴

### 地図・アプリデータ作成の基本

- Maplat 古地図データを作成するデスクトップアプリ（Windows / macOS）
- 地図登録・対応点（GCP）設定・タイル生成を GUI で提供し、住所検索
  （geocoder）や GCP・アプリソースからの位置/ズーム自動推定にも対応
- 対応線を右クリックすると対応点を中間に追加して線を2分割でき、旧公開版の
  操作感を復元
- アプリ編集ではベースマップ・POI ソースの選択、ソース別設定（ビルトイン/
  TMS/WMTS）、存在範囲の描画、PWA/OGP メタデータ（アイコン・スプラッシュ
  画像・キーワード・正規URL）を設定可能
- Maplat ビューアライブラリ（`@maplat/ui` / `@maplat/core`）が消費する
  データを作成。OpenLayers と Maplat コアライブラリを同梱 —
  別途インストール不要

### 地図のメタデータ

- すべての地図は必須の**タイトル**（一覧のカード名と編集画面ヘッダに
  表示）と任意の**表示ラベル**（ビューアの地図切替に表示する短い名称）を
  持つ。旧版にあった15文字の文字数制限は撤廃されており、タイトルが
  空でないことのみが必須
- 表示ラベルは書き出し時の `map.json` に `label` として出力される

### アプリの配信設定

- 新規アプリの既定値は PWA オフ・タイルキャッシュオフ・マーカー一覧UI
  オン。既存アプリと取り込みアプリは保存済みの値を維持する（値が欠落
  しているキーは1.0以前の既定値 — PWA オン・キャッシュオン・マーカー
  一覧UIオフ — へ補完される）。タイルキャッシュは PWA が有効な間だけ
  有効にでき、PWA をオフにするとキャッシュも自動でオフになる
- アプリが地図を参照する際、アプリ側から上書きできるのは地図の
  **表示ラベル**だけで、その他の地図属性はすべて地図自身の値が使われる

### POI エディタ

- 地図上で POI（ポイント・オブ・インタレスト）を直接追加・移動・削除で
  き、多言語対応の名前/説明/HTML/住所/URL/アイコンを編集。変更は
  Undo/Redo（Cmd/Ctrl+Z、Shift+Cmd/Ctrl+Z または Y）に対応
- 標準・HTML・外部ページの3種類のコンテンツモードに対応し、
  `maplat-asset:<uid>` 形式の参照でアップロード済みアセットをインライン
  画像として挿入可能
- 「アセット」タブで共有画像を管理（検索・リネーム・参照確認付き削除）で
  き、icon/selectedIcon/image 欄と同じピッカー（アイコンセット/アセット/
  URL）から選択
- 「Raw」トグルで GeoJSON を直接編集可能（Apply 1回が Undo 1ステップ）。
  1000 feature 超または 5MB 超のソースはパフォーマンスのため読み取り専用
  に切り替わる
- リモート（登録済み）POI ソースは読み取り専用で、「ローカルへ複製」操作
  で編集可能なローカルコピーを作成
- 管理下の POI ソースはそれぞれ自身のレイヤ メタデータ（レイヤ アイコン・
  レイヤ 選択中アイコン。POI ソース自身の編集画面で設定）を持ち、そのソース
  の既定のアイコン・選択時アイコンとして使われる
- 地図・アプリから参照する POI ソースには、参照ごとの上書き（タイトル・
  アイコン・選択時アイコン・「既定で非表示」）を設定可能。「既定で非表示」は
  POI ソース自体を変更せずに、その地図/アプリを開いたときだけ当該レイヤを
  非表示で開始する（利用者は表示に切り替え可能）ため、同じソースをある
  アプリでは表示、別のアプリでは非表示、と出し分けられる。この上書きは
  上記のレイヤ メタデータと同じ属性名（アイコン・選択時アイコン）を使うが
  階層が異なる — レイヤ アイコン/レイヤ 選択中アイコンはそのソース自身の
  既定値であり、参照ごとのアイコン・選択時アイコンの上書きはその地図/
  アプリだけで既定値を置き換える
- 地図・アプリの `pois` には6通りの過去形式を受け付ける: URL 文字列、
  インラインの FeatureCollection、FeatureCollection の配列、旧形式 POI
  オブジェクトの配列、旧レイヤ名キー辞書、レイヤ参照（ラッパー）
  （`{ layer, hide?, title?, icon?, selectedIcon? }`）。管理下 POI ソース
  参照が使うレイヤ参照（ラッパー）が正の形式で、他の5形式は後方互換の
  ために残る旧形式
- 地図・アプリ内に定義された旧形式の inline POI（pois 配列の埋め込み要素）
  はそのまま保全され、POI データタブにビューアのレイヤ単位のペインとして、
  項目数と2種のバッジ（「地図内定義POI」/「外部URL参照」）つきで読み取り
  専用表示。明示操作「GeoJSONへ変換」はレイヤごとに1個（単層の配列は全体
  を1回で、複層の一覧は FeatureCollection カードごとに1回で変換）で、元
  データを変更せずに編集可能な POI ソースの下書きへ変換できる。埋め込み
  データが残っている間は同じ一覧に GeoJSON POI ソースを追加できない
  （確認つき削除、または変換してから削除）

### 資源管理

- 5種類の一覧（地図/アプリ/POI/ベースマップ/アセット）はすべて無限
  スクロールに対応し、全文検索は5種類全て、絞り込み範囲による検索は
  地図・POI・ベースマップ・アプリで利用可能
- 地図・アプリ・POI ソース一覧では、strict エラー、地図/ベースマップ/
  POI/アセット参照欠損、未対応のアプリ POI 形式を診断バッジで表示。
  保存・プレビュー・書き出しと同じ検査結果を使う
- ベースマップ・アセットの編集は左一覧/右編集の master-detail 画面（旧
  モーダル編集から変更）で、選択中の項目は URL に反映されるため直接
  リンクできる
- すべての編集画面で識別子（Slug）は入力と同時に自動確認され、
  「一意性確認」ボタンの操作は不要。地図の Slug 変更は「同一地図の改名」
  として扱われ、コピーまたは移動の確認は不要になった
- 複製・削除（参照元一覧つき）はすべての資源種別で共通の一覧メニューから
  実行可能。インポートは地図・POI ソースの一覧で利用可能

### 下書きとデータ安全性

- 編集内容は数秒間隔でローカル下書きとして自動保存され、再度開いたときに
  復元される。アップロードした地図画像もアプリ管理の下書き領域に保持され
  るため、OS の再起動や一時領域の清掃を跨いでも失われない。保存時に新しい
  リビジョンと競合した場合はダイアログで解決できる
- 地図・アプリ・POI・ベースマップ・アセットはすべて「保存するまで
  作成されない」という同じ挙動に統一されており、破棄された新規下書きは
  実データフォルダに書き込まれず、一覧に「下書きカード」として表示され
  再開または破棄できる（破棄すると下書きの画像領域も解放される）
- データフォルダを切り替えると、未保存の下書き（下書きカードとステージング
  タイル）はすべて破棄される。保存済みデータには影響しない。下書きは
  アプリ全体で保持され、データフォルダ間を移動することはない
- 地図を削除すると、原本画像は即時削除ではなく OS のゴミ箱へ移動する
  （Electron の `shell.trashItem` を使用）。誤って削除した場合も OS の
  標準操作（Finder の「戻す」等）で原本画像を取り出せる
- アップグレード後の初回起動時、データフォルダを現行形式へ自動移行する
  （レガシーデータ取込・サムネイル生成・原本のUUID化）。既存
  データは削除されず、詳細は[動作環境](#動作環境)を参照
- MaplatEditor は同時に1インスタンスのみ起動し、2つ目を起動しようとする
  と新規ウィンドウの代わりに既存ウィンドウが前面化する
- 地図画像の取り込みには JPEG の展開上限がある。設定ページの「JPEG
  展開メモリ上限」「JPEG 解像度上限」は既定で空欄になっており、空欄時は
  画像ごとに必要量が自動判定される。数値を入力すると、その値は自動判定値
  の**上限（キャップ）**として扱われる（このアプリが扱える範囲を超える
  値は自動的に切り下げられる）。自動判定した必要量が設定した上限を超える
  画像は取り込み前に判定され、**必要量・現在の設定値・設定すべき推奨値を
  示すエラー**が表示される。100 MP を超える大きな画像では、デコードに
  数分かかり開始後は中断できないため、取り込み前に確認ダイアログも表示
  される。これらは伸長時の暴走を防ぐための算術的なしきい値であり、
  **実際のメモリを予約する値ではない**（引き上げても物理メモリが足りなけ
  れば取り込みは失敗する）

### エクスポートとインポート

- アプリは単一の ZIP（`{appID}.zip`）として書き出され、有効化時は静的な
  PWA 対応ビルド（マニフェスト・アイコン・スプラッシュ画像）も含められる。
  各地図・ベースマップソースはインライン定義ではなく `settingFile`
  （`maps/<slug>.json`）で参照され、アプリが使うベースマップにも地図と
  同様の `maps/<slug>.json` が書き出される
- POI ソースは GeoJSON、画像参照を含む場合は ZIP パッケージとして書き
  出され、内部の画像参照が自動解決された状態でインポートし直せる
- 地図は ZIP として書き出され、地図定義・タイル・通常/512px サムネイルに
  加え、POI レイヤを `pois/` ディレクトリの `*.geojson` ファイルとして
  参照画像とともに同梱する — POI データは常に地図定義から外部ファイルと
  して切り出され、レイヤ参照（ラッパー）で参照される。この ZIP を取り込む
  と、それらのレイヤは管理下の POI ソースとして復元される
- 取り込む地図の ID が既存のものと重複する場合、取り込みは失敗せず、
  空いている ID（`{ID}-2`、`{ID}-3` …）へ自動的に振り直される。既存の
  地図は上書きされず、別の地図として増える。ID は地図・アプリ・POI
  ソース・画像アセットを通じて一意であるため、同じ規則がすべての
  取り込みに適用される
- 対応点エラーが未解消の地図はプレビューできない（書き出しは可能）。その
  ような地図を含むアプリ、または存在しない（削除済み等の）地図を参照する
  アプリは、問題を解消するまで保存・プレビュー・書き出しがブロックされる

### サムネイルと多言語対応

- 地図・ベースマップ・アプリの512px高精細サムネイルはアップロード時に
  自動生成され、既存データはアップグレード後の初回起動時に補完生成される
- 地図・ベースマップ・アプリは512pxサムネイルに加えて52pxアイコンも保持
  する。サムネイル管理パネルから両方を手動で置換でき（**512pxを置換…**
  / **52pxを置換…**）、**512pxから52pxも作成する**が既定でオンのため
  512px の置換1回で両方が更新される。ベースマップでは **存在範囲から
  生成** が同じ切り出しから512pxサムネイルと52pxアイコンを同時に生成
  する。ビルトインベースマップはサムネイルの置換・生成ができない
- サムネイルの置換は保存や「元に戻す」の対象外である — 置換した画像は
  すぐにファイルへ反映される。元に戻すには、もう一度置換する
- UI は11言語に対応: 英語・日本語・ドイツ語・韓国語・ベトナム語・
  簡体字中国語・繁体字中国語・フランス語・スペイン語・タイ語・
  インドネシア語。英語・日本語以外の9言語は機械翻訳であり、人間による
  品質検証は未実施
- オープンソース（Apache 2.0・バージョン 0.7.0 以降）— Maplat ビューア
  エコシステムのコンパニオン

### 設定とアプリケーションメニュー

- 設定画面のタブは**基本設定**と**ベースマップ設定**の2つ（旧オリジナル
  地図設定の3つ目のタブは廃止済み）
- 配布用（パッケージ済み）ビルドではアプリケーションメニューに**開発**
  メニューが表示されない。ソースから起動した場合や E2E テスト実行時には
  従来どおり表示される
- About ウィンドウの著作権表記は ADR-0011 に準拠し
  （`Copyright 2019-2026 Kohei Otsuka, Code for History / Nayuta, Inc.`）、
  バージョン表記はハードコードではなく実行中のアプリから動的に取得される

<!-- SECTION 5: Quick Start -->
## クイックスタート

<!-- release-pinned:start -->
> リリース依存情報（ADR-0012）。下記バージョン `0.7.0` は現在の
> リリースです。リリースごとに更新してください。

### ダウンロード

MaplatEditor はデスクトップインストーラーとして GitHub Releases から配布して
います。

| プラットフォーム | ダウンロード |
|---|---|
| Windows (x64) | [MaplatEditor-Windows-0.7.0-x64-Setup.exe](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-Windows-0.7.0-x64-Setup.exe) |
| macOS (Apple Silicon) | [MaplatEditor-Mac-0.7.0-arm64.dmg](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-Mac-0.7.0-arm64.dmg) |
| macOS (Intel x64) | [MaplatEditor-Mac-0.7.0-x64.dmg](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-Mac-0.7.0-x64.dmg) |

> 全アセット一覧（Linux AppImage・Windows arm64 含む）とリリースノートは
> [v0.7.0 リリースページ](https://github.com/code4history/MaplatEditor/releases/tag/v0.7.0)
> を参照してください。
<!-- release-pinned:end -->

### スクリーンショット

> MapList・MapEdit 画面の現行版スクリーンショットは、旧 Wiki チュートリアルの
> 画像とともに [Wiki ギャラリー](https://github.com/code4history/MaplatEditor/wiki/Gallery)
> に掲載しています。

### 開発

#### セットアップ
リポジトリをクローンし依存関係をインストールします。

```bash
git clone https://github.com/code4history/MaplatEditor.git
cd MaplatEditor
pnpm install
```

#### 開発サーバー
ホットリロード付きの開発サーバーを起動します。

```bash
pnpm dev
```

#### デスクトップインストーラーのビルド

```bash
pnpm build         # Vite アプリをビルド
pnpm dist          # 現在の OS 向けデスクトップインストーラーをビルド
pnpm dist:mac      # macOS（universal）
pnpm dist:win      # Windows
pnpm dist:linux    # Linux
```

### キーボードショートカット

| ショートカット | 操作 |
|---|---|
| Cmd/Ctrl+S | 保存 |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z または Cmd/Ctrl+Y | Redo |

地図/アプリ/POI の各エディタと POI 地図編集ペインで共通です。

<!-- SECTION 6: Prerequisites -->
## 動作環境

> MaplatEditor は Electron + Vite で構築されたデスクトップアプリケーション
> です。`package.json` に `engines` フィールドはありません。下記バージョンは
> 検証済みの開発環境です。

- Node.js: v20 または v22（GitHub Actions で検証済みの LTS）
- pnpm: `>=9.0.0`（必須・本プロジェクトは pnpm を使用）

> **注記**: アップグレード後の初回起動時、MaplatEditor はデータフォルダ
> を現行形式へ自動的に移行します（レガシーデータ取込・サムネイル生成・
> 原本のUUIDファイル名への変更）。既存の地図データが削除され
> ることはなく、各段階は中断されても安全に再実行されます。この初回起動
> は通常より時間がかかる場合があります。

<!-- 既知の制限: 11節テンプレートには含まれない節だが、MaplatEditor 固有
     の注記として追加（m14-t2 タスク設計 §5 #4 の判断を記録）。 -->
## 既知の制限

- 対応点エラーが未解消の地図はプレビューできません（地図自体の書き出しは
  可能です）。そのような地図を含むアプリ、または存在しない（削除済み等の）
  地図を参照するアプリは、問題を解消するまで保存・プレビュー・書き出しが
  できません。
- 削除した地図の原本画像は OS のゴミ箱へ移動します。ゴミ箱の管理
  （戻す・空にする）は他のファイルと同様に OS と利用者に委ねられます。
  ゴミ箱から「戻す」で復元されるのは画像ファイルのみで、地図そのものが
  MaplatEditor の一覧に復活するわけではありません。
- 英語・日本語以外に追加された9言語は機械翻訳であり、人間による品質検証
  は未実施です。
- インターフェースは OS がダークモードの場合でも、現状ライトモード固定
  で表示されます。

<!-- SECTION 7 Peer Dependencies: 省略（OpenLayers は通常の dependency として同梱） -->

<!-- SECTION 8: Ecosystem / Related Repositories -->
## エコシステム

MaplatEditor は [Code for History](https://github.com/code4history) が運営する
Maplat エコシステムの一部です。全容は下記エコシステム図を参照してください。

📖 **エコシステム図** — *（図は現在外部非公開の計画リポジトリに保持して
います。下記の姉妹リポジトリ表が公開版の代替です）*

### 姉妹リポジトリ

| リポジトリ | ライセンス | npm | 役割 |
|---|---|---|---|
| [Maplat](https://github.com/code4history/Maplat) | Apache 2.0 | `@maplat/ui` | メインビューア |
| [MaplatCore](https://github.com/code4history/MaplatCore) | Apache 2.0 | `@maplat/core` | コアライブラリ |
| [MaplatTin](https://github.com/code4history/MaplatTin) | Apache 2.0 | `@maplat/tin` | TIN 変換 |
| [MaplatTransform](https://github.com/code4history/MaplatTransform) | Apache 2.0 | `@maplat/transform` | 座標変換 |
| [MaplatEditor](https://github.com/code4history/MaplatEditor) | Apache 2.0 | — | データ作成ツール（デスクトップ） |
| [Chuci](https://github.com/code4history/Chuci) | MIT | `@c4h/chuci` | マルチメディアスワイパー/ビューアコンポーネント |
| [Quyuan](https://github.com/code4history/Quyuan) | MIT | `@c4h/quyuan` | GeoJSON テンプレート抽出ツール |
| [Weiwudi](https://github.com/code4history/Weiwudi) | MIT | `@c4h/weiwudi` | タイルキャッシュ用 Service Worker |

> MaplatEditor は上記ビューアライブラリが描画する地図・POI を作成する
> データ作成ツールです。Maplat エコシステムはエンドツーエンド:
> MaplatEditor で作成し、いずれかのビューアライブラリで公開、という流れになります。

<!-- SECTION 9: Nayuta links -->
## リンク

| 対象 | リンク | 用途 |
|---|---|---|
| プロジェクト情報・機能紹介・事例 | <https://www.maplat.jp/> | 製品サイト |
| 支援企業・案件問い合わせ | <https://www.nayuta-inc.co.jp/> | コーポレートサイト（那由多社） |

> ADR-0013: Apache ライセンスのリポジトリ（本リポジトリ）は両サイトへリンクします。
> MIT ライセンスの姉妹リポジトリ（Weiwudi / Quyuan / Chuci）へは那由多社リンクを置きません。
> 英語ページへ遷移する場合は `/en/` を付与してください（例: `https://www.maplat.jp/en/`）。

<!-- SECTION 10: License -->
## License

Apache License 2.0 — 詳細は [LICENSE](LICENSE) を参照。

```
Copyright 2019-2026 Kohei Otsuka, Code for History / Nayuta, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
