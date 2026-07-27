# 概念解説（日本語）

MaplatEditor の背景: Maplat エコシステムでの役割・生成するデータ形式・
他の Maplat ライブラリとの関係。

## 目次

- [MaplatEditor が果たす役割](#maplateditor-が果たす役割)
- [生成するデータ形式](#生成するデータ形式)
- [MaplatTin / MaplatTransform との関係](#maplattin--maplattransform-との関係)
- [Maplat ビューアとの関係](#maplat-ビューアとの関係)
- [OpenLayers の同梱](#openlayers-の同梱)
- [関連項目](#関連項目)

---

## MaplatEditor が果たす役割

MaplatEditor は Maplat ビューアエコシステムの**デスクトップデータ作成ツール**
です。Electron + Vite アプリで Windows / macOS で動作します。古地図画像と
対応点（GCP）を受け取り、[Maplat](https://github.com/code4history/Maplat)
ビューアが消費するデータファイルを生成します。

MaplatEditor は **npm には公開していません**（`package.json` で `private: true`）。
バイナリは GitHub Releases から配布しています。

## 生成するデータ形式

MaplatEditor は主に2種類のデータを生成します:

- **地図データ** — `maps/{mapID}.json` に配置。古地図画像と現代地図
  （Web メルカトル・SRID:3857）間の座標対応を定義します。人間が編集可能な
  **標準形式**（`gcps` を持つ）または事前計算済みの **コンパイル形式**
  （`compiled` を持つ）のいずれかです。
- **アプリデータ** — `apps/{appID}.json` に配置。複数の地図ソース・POI 定義・
  アプリレベルの設定（ホーム位置・デフォルトズーム・テスト用疑似 GPS 等）を
  まとめます。
- **POI データ** — GeoJSON 形式で管理されます。POI ソースは通常の GeoJSON
  としてエクスポートされ、画像参照を含む場合はフィーチャーコレクションと
  画像を一緒に含む ZIP パッケージとしてエクスポートされます。ZIP を
  インポートすると、内部の画像参照は自動的にローカルアセットへ解決されます。
  なお、古い地図・アプリのデータでは POI が地図・アプリのドキュメント内に
  直接埋め込まれている場合があります（旧形式の inline `pois` 要素）。
  MaplatEditor はこれらを無変更のまま保全し、明示的で非破壊の
  「GeoJSONへ変換」操作で内容を新しい編集可能な POI ソースの下書きへ
  複製できます。地図・アプリの POI ソース参照への移行は、ユーザーが自分の
  ペースで行えます。
- **アップロードされた原本ファイル** — ユーザーがアップロードした画像
  （地図画像・POI/アプリのアセット）の原本は `originals/<uid>.<ext>` に、
  ユーザー向けの slug ではなくアップロード時に採番される UUID で命名されて
  保存されます。これにより、リソースを後で改名してもディスク上のファイル名は
  安定します。この命名規則が導入される前からの既存の slug 命名ファイルは、
  改名されずそのまま残置されます（非破壊）。
- **リソース診断** — 地図・アプリ・POI ソースの各一覧には、エディタや
  preview/export と同じ検証・解決ヘルパーから導いた UI 専用バッジが付きます。
  黄色の warning バッジは、POI 参照欠損、アセット実体欠損、ベースマップ
  サムネイル行欠損、またはアプリ `pois` の未対応形式を示します。赤い danger
  バッジは、`strict_error` の地図データや、アプリの保存・preview・
  エクスポートを拒否させる地図参照エラーを示します。これらのバッジは
  `maps/*.json`、`apps/*.json`、POI GeoJSON には書き出されず、現在の
  ローカルデータベースとファイル状態を一覧時点で要約するものです。

これらの形式のスキーマ詳細は
[Maplat Wiki Concepts ページ](https://github.com/code4history/Maplat/wiki/Concepts)
を参照してください（MaplatEditor はビューアが消費するのと同じ形式を生成します）。

## MaplatTin / MaplatTransform との関係

MaplatEditor は内部で Maplat 座標変換スタックを使用します:

- [`@maplat/tin`](https://github.com/code4history/MaplatTin) — ユーザーが
  配置した GCP から TIN 変換を解きます。
- [`@maplat/transform`](https://github.com/code4history/MaplatTransform) —
  タイル生成・コンパイル済みデータ生成のための前処理ユーティリティ。

ユーザーが「保存」をクリックすると、MaplatEditor は GCP セットに対して
`@maplat/tin` の `updateTin()` を実行し、`strict_status` を確認し、
`getCompiled()` で結果を直列化してコンパイル済み地図データファイルへ書き出します。

`strict_status` が `strict_error` のコンパイル済み地図は、地図データとしての
エクスポートは可能ですが、プレビューはできず、その地図を参照するアプリは
保存・preview・エクスポート時に拒否されます。赤いリソース一覧バッジはこの
同じゲート条件を使うため、ユーザーがアプリエディタを開いたりエクスポートを
開始したりする前に問題を確認できます。

## Maplat ビューアとの関係

MaplatEditor が生成したデータは
[Maplat](https://github.com/code4history/Maplat)（`@maplat/ui`）と
[MaplatCore](https://github.com/code4history/MaplatCore)（`@maplat/core`）が
消費します。ビューアはアプリ JSON を読み込み、コンパイル済み地図データから
TIN 変換を初期化し、同相重ね合わせ保証を持つ古地図描画を行います。

これが Maplat エコシステムの「エンドツーエンド」です:

1. **作成** — MaplatEditor で（GCP 配置・タイル生成・アプリ設定）
2. **公開** — データファイルを静的ホスティング・CDN 等へ配置
3. **描画** — `@maplat/ui`（またはカスタム統合なら `@maplat/core`）で描画

## OpenLayers の同梱

`@maplat/core` や `@maplat/ui` では OpenLayers がユーザーが別途インストール
すべき **peer dependency** ですが、MaplatEditor は `package.json` の通常の
`dependency` として OpenLayers (`ol`) を同梱します。これは MaplatEditor が
エンドユーザー向けデスクトップアプリであり、npm の peer dependency を管理
しなくても使えるようにするためです。

同じ理由で、MaplatEditor の README には **Peer Dependencies** 節がなく、
`docs/api/` ディレクトリもありません — UI アプリであり、公開 API を持つ
ライブラリではないためです。

---

**[英語版はこちら / Read this page in English](Concepts)**

## 関連項目

- [Home](Home)
- [Tutorials.ja](Tutorials.ja) — MaplatEditor で地図を作成する手順
- [FAQ.ja](FAQ.ja)
- [Maplat Wiki Concepts](https://github.com/code4history/Maplat/wiki/Concepts) — データ形式スキーマ
- [MaplatTin Wiki](https://github.com/code4history/MaplatTin/wiki) — TIN 理論
- [README](../blob/master/README.ja.md)
