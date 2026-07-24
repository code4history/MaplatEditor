<!-- SECTION 1: Header (logo, badges, title) -->
<p align="center">
  <img src="https://code4history.github.io/Maplat/page_imgs/maplat.png" alt="MaplatEditor ロゴ" width="200" />
</p>

<h1 align="center">MaplatEditor</h1>

<p align="center">
  [![CI](https://github.com/code4history/MaplatEditor/actions/workflows/build.yml/badge.svg)](https://github.com/code4history/MaplatEditor/actions/workflows/build.yml)
  [![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
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

- Maplat 古地図データを作成するデスクトップアプリ（Windows / macOS）
- 地図登録・対応点設定・タイル生成を GUI で提供
- Maplat ビューアライブラリ（`@maplat/ui` / `@maplat/core`）が消費する
  データを作成
- OpenLayers と Maplat コアライブラリを同梱 — 別途インストール不要
- オープンソース（Apache 2.0・バージョン 0.7.0 以降）— Maplat ビューア
  エコシステムのコンパニオン

<!-- SECTION 5: Quick Start -->
## クイックスタート

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

### スクリーンショット

> MapList・MapEdit 画面のスクリーンショットは準備中です。旧 Wiki チュートリアルの
> 画像は [Wiki ギャラリー](https://github.com/code4history/MaplatEditor/wiki/Gallery)
> に保存しています。

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

<!-- SECTION 6: Prerequisites -->
## 動作環境

> MaplatEditor は Electron + Vite で構築されたデスクトップアプリケーション
> です。`package.json` に `engines` フィールドはありません。下記バージョンは
> 検証済みの開発環境です。

- Node.js: v20 または v22（GitHub Actions で検証済みの LTS）
- pnpm: `>=9.0.0`（必須・本プロジェクトは pnpm を使用）

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
