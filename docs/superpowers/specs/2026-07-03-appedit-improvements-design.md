# AppEdit 改善設計: ソース設定UI・サムネイル・PWAエクスポート

日付: 2026-07-03
対象: MaplatEditor（新実装）アプリ編集機能

## 背景 / 問題点

1. **ビルトインベースマップの扱いが誤っている**: Viewer（@maplat/core）は `sources` 配列の要素が文字列 `"osm"` / `"gsi"` / `"gsi_ortho"` のときだけ内蔵定義 `baseDict` を解決する（`source_ex.ts` の `mapSourceFactory`）。オブジェクト形式で `mapID: "osm"` と書いても内蔵定義とマージされず壊れる。現在のAppEditはビルトインもオブジェクト（url無し）で出力しており誤り。
2. **ソース詳細設定が「JSON丸ごと編集」**: 何を設定すべきかが吟味されておらず、Editor管理用キー（`always` 等）がアプリ設定に漏れる。Maplat地図は map.json 側が正で、アプリ側は label 等の最小オーバーライドのみが正しい。TMS/WMTSのベースマップ/オーバーレイは逆にアプリ設定内で完結させる（かなりの項目がある）。
3. **サムネイルが変**: `tiles/{mapID}/0/0/0.jpg`（ズーム0タイル）を流用している。正しくはデータフォルダの `tmbs/{mapID}.jpg`（Maplat地図）。非ビルトインのbase/overlayはサムネイルが無いので 52x52 正方形画像のアップロードを要求する。
4. **PWA画像生成が無い**: エクスポート時に `pwa-asset-generator` で favicon / ホーム画面アイコン / apple splash を生成すべき。プレビューでは不要。
5. **アップロードUIが無い**: サムネイル・512x512アイコン元画像・スプラッシュ画像。
6. **OGP用メタデータ**: index.html に埋め込む description / keywords / 公開URL の設定欄。
7. **アプリのエクスポート機能自体が未実装**（静的サイト一式の書き出し）。

## 用語の区別（重要）

- **Viewerビルトイン**: `osm` / `gsi` / `gsi_ortho` の3つのみ。アプリJSONには**素の文字列**として出力。label等の編集不可（Viewer内蔵定義を使う）。
- **Editorカタログ（TMS定義）**: `base_maps` テーブル（builtin scope = tms_list.json 由来、user scope = ユーザ定義）。`always` / `scope` / `sort_order` は**Editor管理用キー**であり、Viewer/アプリ設定には出力しない。
- **アプリ内TMSソース**: カタログから取り込んだ時点でアプリ文書にコピーされ、以後アプリ側で全項目を編集する（url, attr, zoom, envelope 等）。カタログとは独立。

## データモデル

`AppSource` を次の形に再定義（DBはドキュメント丸ごとJSONなのでマイグレーションはロード時正規化で行う）:

```ts
type SourceRole = "maplat" | "base" | "overlay";
interface AppSource {
  sourceType: "maplat" | "builtin" | "tms";
  mapID: string;
  role: SourceRole;              // builtin は常に "base"
  startFrom?: boolean;
  label?: Record<string, string>; // maplat / tms のみ編集可
  data?: TmsSourceData;           // tms のみ。Viewerに渡る形（camelCase）
  title?: string;                 // 表示用（Editor内のみ、出力しない）
}
interface TmsSourceData {
  url: string;
  title?: Record<string,string> | string;
  attr?: Record<string,string> | string;
  minZoom?: number;
  maxZoom?: number;
  thumbnail?: string;             // "tmbs/{mapID}_menu.jpg"
  // overlay のみ:
  mercatorXShift?: number;
  mercatorYShift?: number;
  envelopeLngLats?: [number, number][];  // 4隅 (矩形)
  [key: string]: unknown;         // 既存データの未知キーはパススルー保持
}
```

- 正規化（ロード時）: 旧形式の `source.data` から Editor専用キー（`always`, `scope`, `sortOrder`, `sort_order`）を除去。snake_case キーは `normalizeRuntimeKeys` で camelCase 化（core の `normalizeArg` は snake_case を例外送出で拒否するため必須）。`mapID` が osm/gsi/gsi_ortho かつ maptype が base 系なら `sourceType: "builtin"` に矯正。文字列ソース（レガシーapp JSON）も builtin として取り込む。
- 出力（プレビュー/エクスポート共通のシリアライザ `composeViewerSources()`）:
  - builtin → 文字列 `"osm"` 等
  - maplat → `{ mapID, label }`（プレビューは `settingFile` 付与、エクスポートは Viewer 既定の `maps/{mapID}.json` に任せる）
  - tms → `{ mapID, maptype: "base"|"overlay", ...data, label }`

## ソース設定UI（ピンポイント）

「詳細設定(JSON)」textarea を廃止し、role別フォームに置換:

| 項目 | maplat | builtin | tms base | tms overlay |
|---|---|---|---|---|
| label（言語別） | ✎ | 表示のみ | ✎ | ✎ |
| title（言語別） | – | – | ✎ | ✎ |
| attr（言語別） | – | – | ✎ | ✎ |
| url（{z}/{x}/{y}, {-y}対応） | – | – | ✎ | ✎ |
| minZoom / maxZoom | – | – | ✎ | ✎ |
| サムネイル | tmbs自動 | 内蔵画像 | 52x52アップロード | 52x52アップロード |
| mercatorXShift / YShift | – | – | – | ✎ |
| envelopeLngLats | – | – | – | ✎ 数値4値 + 地図ポップアップ |
| startFrom | ○ | ○ | ○ | ○ |
| base/overlay切替 | – | – | ○ | ○ |

- envelope UI: 経緯度範囲（西/南/東/北）の数値入力と、「地図で指定」ボタン → モーダルに OpenLayers 地図（OSM）を表示し、矩形の描画（`Draw` + `createBox`）/ 変形（`Modify`… 実装簡略化のため「再描画」方式でも可）で bbox を指定。保存時に4隅の `envelopeLngLats`（反時計回り [[W,S],[E,S],[E,N],[W,N]]）へ変換。既存データが非矩形の場合は bbox に近似して編集（設計上の割り切り）。
- mapbox / maplibre / google 系ソースタイプの専用UIは今回スコープ外（既存データはパススルー保持し壊さない）。

## サムネイル

- **Maplat地図**: `saveFolder/tmbs/{mapID}.jpg` を使用。`AppDataService.getMapThumbnail` / `StorageAdapter.listMaps` のズーム0タイル参照を tmbs 参照へ変更（無ければ従来のズーム0タイルへフォールバック）。
- **Viewerビルトイン3種**: @maplat/core 同梱の `parts/osm.jpg` `gsi.jpg` `gsi_ortho.jpg` をエディタ資産にコピーして一覧に表示。
- **tmsソース**: 52x52 正方形画像のアップロードを要求。正方形でない場合はエラー、52x52超は Electron `nativeImage` で 52x52 に縮小して `saveFolder/tmbs/{mapID}_menu.jpg` に保存（Viewer のフォールバック規約 `./tmbs/{mapID}_menu.jpg` と一致するため、アプリJSONの `thumbnail` は `tmbs/{mapID}_menu.jpg` を明示設定）。

## アップロード（新IPC `appassets:*`）

| 種別 | 保存先 | 検証 |
|---|---|---|
| TMSサムネイル | `saveFolder/tmbs/{mapID}_menu.jpg` | 正方形必須 → 52x52化 |
| スプラッシュ | `saveFolder/img/{ファイル名}` | 画像であること（サイズ自由） |
| PWAアイコン元画像 | `saveFolder/pwa/{appID}_icon.png` | 512x512 PNG（正方形→512化を許容） |

`appSettings.splash` はファイル名、`manifestSettings.iconSource` は `pwa/{appID}_icon.png` を記録。既存の `httpSettings.iconSource`（テキスト入力）は manifest 設定内のアップロードUIに置換。

## プレビュー修正（AppPreviewService）

- `composeViewerSources()` を使用（builtin=文字列、Editor専用キー除去、camelCase）。
- 追加ルート: `/preview/{token}/tmbs/*` → `saveFolder/tmbs`、`/preview/{token}/img/*` → `saveFolder/img`。maplat ソースの `thumbnail` は `tmbs/{mapID}.jpg` の相対参照に変更（file://→local-file 変換をやめる）。
- pwa-asset-generator はプレビューでは実行しない（現状どおり manifest JSON のみ）。

## OGP / メタデータ

AppDocument に追加: `keywords: string`（カンマ区切り、任意）、`siteUrl: string`（公開URL、任意）。
description は既存の多言語フィールドを流用。エクスポート時の index.html に `meta name=description` / `og:title` / `og:description` / `og:image`（スプラッシュ画像、無ければアイコン）/ `twitter:card` / `keywords` を埋め込み、`siteUrl` 設定時は `canonical` / `alternate hreflang` / manifest の `start_url`・`scope` にも反映。未設定時は相対 `./`。

## エクスポート（新機能 AppExportService）

AppEdit ヘッダに「エクスポート」ボタン。フォルダ選択ダイアログ → `{選択先}/{appID}/` に静的サイト一式を書き出し:

```
index.html                     … テンプレート生成（OGP・PWAメタ・Viewer起動script）
apps/{appID}.json              … composeViewerSources() による正規アプリJSON
maps/{mapID}.json              … Maplat地図ごと（histMap2Store 出力 = 地図ZIPと同形式）
tiles/{mapID}/…                … タイルコピー
tmbs/{mapID}.jpg, {tmsID}_menu.jpg
img/{splash}
pwa/{appID}_manifest.json      … pwaManifest 有効時
pwa/{appID}/…                  … pwa-asset-generator 生成物（icons / apple splash / favicon / mstile）
assets/maplat_ui.css, maplat_ui.umd.js, ol.js, locales/…
service-worker.js              … enableCache 有効時
```

- **pwa-asset-generator (v8)** を `generateImages()` API で2回実行:
  1. アイコン: source=512アイコン元画像, `{ iconOnly: true, favicon: true, mstile: true, pathOverride: "pwa/{appID}", background: manifest.backgroundColor }`
  2. スプラッシュ: source=スプラッシュ画像（無ければアイコン元画像）, `{ splashOnly: true, background: manifest.backgroundColor, pathOverride: "pwa/{appID}" }`
  - 戻り値 `manifestJsonContent` を manifest の `icons` に、`htmlMeta` を index.html の head に反映。
  - PAG は Chrome/Chromium が必要（puppeteer-core + chrome-launcher でシステムChrome検出）。失敗時はエクスポートを中断せず、`nativeImage` で 192/512 アイコンのみ縮小生成し、警告を返す（graceful degradation）。
- 進捗は `ProgressReporter` で通知。既存出力先がある場合は上書き確認。
- viewer起動オプション（index.html内）: `appid`, `pwaManifest`, `overlay`, `enableHideMarker`, `enableBorder`, `enableCache`, `stateUrl`, `enableShare`, `mapboxToken`, `googleApiKey`（http設定から）。

## スコープ外

- mapbox/maplibre/google ソースタイプの専用編集UI
- 非矩形 envelope の編集（bbox 近似）
- manifest icons JSON の手編集UI（生成に置換して廃止）
- SaaS版への反映

## テスト方針

- ユニット: sources正規化/シリアライズ（builtin文字列化・Editor専用キー除去・camelCase・レガシー文字列ソース取込）、envelope bbox⇄4隅変換、index.html/manifest生成のスナップショット的検証。
- 手動: プレビュー（builtin+overlay+maplat混在、サムネイル表示、envelope反映）、エクスポート出力を静的サーバで起動して確認。
