# AppEdit改善（ソースUI/サムネイル/PWAエクスポート）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MaplatEditorのアプリ編集機能を、Viewer仕様に忠実なソースモデル（ビルトイン=文字列）、ピンポイント設定UI、tmbsサムネイル、画像アップロード、OGPメタデータ、pwa-asset-generatorを使う静的サイトエクスポートに刷新する。

**Architecture:** 共有ピュアモジュール `src/utils/appSourceModel.ts` にソース正規化/シリアライズを集約し、renderer（AppEdit.vue）と electron main（AppPreviewService / 新設AppExportService）の両方から使う。画像処理は既存依存の jimp、PWAアセット生成は pwa-asset-generator v8（Chrome不在時はjimpフォールバック）。

**Tech Stack:** Vue 3 + Bootstrap 5, Electron main (vite-plugin-electron, ESM), DuckDB文書ストア, OpenLayers 10, jimp 1.6, pwa-asset-generator 8, smoke-test方式（scripts/*.mjs, viteバンドル）

**Spec:** `docs/superpowers/specs/2026-07-03-appedit-improvements-design.md`

---

### Task 1: 共有ソースモデル `appSourceModel.ts` + smoke test

**Files:**
- Create: `src/utils/appSourceModel.ts`
- Modify: `electron/services/MaplatRuntimeKeys.ts`（共有モジュールへ移譲・再export）
- Test: `scripts/m6-app-source-model-smoke.mjs`、package.json に `"smoke:m6-app-source-model"` 追加

- [ ] **Step 1: モジュール実装**（electron非依存のピュアTS）

```ts
// src/utils/appSourceModel.ts
export type SourceRole = "maplat" | "base" | "overlay";
export type SourceKind = "maplat" | "builtin" | "tms";

export const VIEWER_BUILTIN_IDS = ["osm", "gsi", "gsi_ortho"] as const;
export const isViewerBuiltin = (mapID: string) =>
  (VIEWER_BUILTIN_IDS as readonly string[]).includes(mapID);

// Editor管理用キー: Viewer出力に含めてはならない
const EDITOR_ONLY_KEYS = new Set([
  "always", "scope", "sortOrder", "sort_order", "sourceType", "role",
  "startFrom", "previewDisabled", "previewDisabledReason", "_id", "status",
]);

export const runtimeKeyMap: Record<string, string> = { /* MaplatRuntimeKeysの内容を移動 */ };

export function normalizeRuntimeKeys<T>(value: T): T { /* 再帰keyマップ（既存実装を移動） */ }

export function stripEditorKeys(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !EDITOR_ONLY_KEYS.has(k)));
}

export interface AppSource {
  sourceType: SourceKind;
  mapID: string;
  role: SourceRole;
  startFrom?: boolean;
  label?: Record<string, string>;
  data?: Record<string, any>;   // tmsのみ
  title?: string;               // Editor表示専用
}

// 任意の保存形（レガシー文字列 / 旧AppEdit形 / 新形）→ AppSource
export function normalizeAppSource(raw: any): AppSource;
// bbox [w,s,e,n] ⇄ envelopeLngLats 4隅 [[w,s],[e,s],[e,n],[w,n]]
export function bboxToEnvelope(bbox: [number, number, number, number]): [number, number][];
export function envelopeToBbox(lngLats: [number, number][]): [number, number, number, number] | null;
// 空文字言語を落とした label オブジェクト（全部空なら undefined）
export function compactLangObject(value?: Record<string, string>): Record<string, string> | undefined;
// AppSource → Viewer出力（builtin=文字列 / maplat={mapID,label(+settingFile)} / tms=data展開）
export function composeViewerSource(
  source: AppSource,
  options?: { settingFilePrefix?: string }
): string | Record<string, unknown>;
```

`normalizeAppSource` 仕様:
- `raw` が文字列 → `{ sourceType: "builtin", mapID: raw, role: "base" }`（ビルトインID以外の文字列もbuiltin扱いせず `tms` にせよ…ではなく、ビルトインID以外はurl無しの不完全tmsとして `{sourceType:"tms", mapID, role:"base", data:{}}`）
- オブジェクト: `mapID` がビルトインIDかつ maptype/role が base系 → builtin。旧 `sourceType:"maplat"` または `maptype:"maplat"` / `noload` → maplat。それ以外 → tms（`role` は `maptype==="overlay"` または旧roleから）。
- tmsの `data` は `normalizeRuntimeKeys` + `stripEditorKeys` を通す。`label` はトップレベルへ吸い上げ（`data.label` は残さない）。

`composeViewerSource` 仕様:
- builtin → `source.mapID`（文字列）
- maplat → `{ mapID, label? }`、`settingFilePrefix` 指定時は `maptype:"maplat"`, `settingFile: prefix + mapID + ".json"` を付与
- tms → `{ ...stripEditorKeys(normalizeRuntimeKeys(data)), mapID, maptype: role==="overlay"?"overlay":"base", label? }`。`minZoom`/`maxZoom`等が `undefined`/`null`/`""` のキーは削除。

- [ ] **Step 2: `MaplatRuntimeKeys.ts` を再exportに変更**

```ts
export { normalizeRuntimeKeys } from '../../src/utils/appSourceModel';
```

- [ ] **Step 3: smoke test 作成・実行**

`scripts/m6-app-source-model-smoke.mjs`（既存 m5 smoke と同じ vite build パターンで `src/utils/appSourceModel.ts` をバンドルして assert）。ケース:
1. `normalizeAppSource("osm")` → builtin / `composeViewerSource` → `"osm"`
2. 旧形式 `{sourceType:"base-map", mapID:"osm", data:{mapID:"osm", always:true,...}}` → builtin → `"osm"`（alwaysが消える）
3. tms overlay（snake_case `envelopLngLats`, `always` 混入）→ data正規化で `envelopeLngLats` になり `always` 除去、compose結果に `maptype:"overlay"`
4. maplat + label → `{mapID, label}` のみ / settingFilePrefix指定で settingFile付与
5. `bboxToEnvelope([139,35,140,36])` → `[[139,35],[140,35],[140,36],[139,36]]`、`envelopeToBbox` が逆変換
6. compose結果に `sourceType`/`role`/`startFrom` キーが無いこと

Run: `pnpm run smoke:m6-app-source-model` → PASS

- [ ] **Step 4: Commit** `feat: add shared app source model with viewer-faithful serialization`

---

### Task 2: プレビュー修正（AppPreviewService + AppEdit正規化）

**Files:**
- Modify: `electron/services/AppPreviewService.ts`
- Modify: `src/views/AppEdit.vue`（normalizeSource/createPreviewDocument/addBaseMapSource/addMapSource）

- [ ] **Step 1: AppPreviewService.createSession を composeViewerSource ベースに書換**
  - sources: `normalizeAppSource` → builtinは文字列のままpush。maplatは `composeViewerSource(s,{settingFilePrefix:"maps/"})` + `thumbnail: "tmbs/{mapID}.jpg"`、session.maps へ従来どおり preview JSON 格納（`thumbnail` は相対 `tmbs/{mapID}.jpg` に変更、`toHttpAsset` は tiles url のみに適用）。tmsは `composeViewerSource` 結果（http(s) URLはそのまま、thumbnailは相対のまま）。
  - `handlePreview` にルート追加:

```ts
if (rest[0] === 'tmbs') return this.serveDataFile('tmbs', rest.slice(1), res);
if (rest[0] === 'img') return this.serveDataFile('img', rest.slice(1), res);
```

```ts
private serveDataFile(folder: 'tmbs' | 'img', segments: string[], res: http.ServerResponse) {
  const saveFolder = SettingsService.get('saveFolder') as string;
  const resolved = path.resolve(path.join(saveFolder, folder, ...segments));
  if (!resolved.startsWith(path.resolve(path.join(saveFolder, folder)))) return this.sendText(res, 403, 'Forbidden');
  this.sendFile(res, resolved);
}
```

- [ ] **Step 2: AppEdit.vue の normalizeSource を appSourceModel.normalizeAppSource 利用に置換**、`addBaseMapSource` はビルトインID→ `sourceType:"builtin"`、それ以外→ `sourceType:"tms"`（`data` はstrip済コピー）。`createPreviewDocument` は sources をそのまま渡す（mainで compose するため rendererでの maptype 加工を削除）。
- [ ] **Step 3: `pnpm run build`（vue-tsc + vite）成功確認**
- [ ] **Step 4: Commit** `fix: emit viewer builtins as bare strings and strip editor keys in preview`

---

### Task 3: サムネイル修正（tmbs参照 + ビルトイン画像 + basemaps一覧enrich）

**Files:**
- Modify: `electron/services/MapDataService.ts:81-90`（listMapsのimage）
- Modify: `electron/services/AppDataService.ts` `getMapThumbnail`
- Modify: `electron/ipc/settings.ts` `basemaps:list`（thumbnailUrl付与）
- Create: `src/assets/img/osm.jpg` `gsi.jpg` `gsi_ortho.jpg`（`node_modules/@maplat/core/parts/` からコピー）
- Modify: `src/views/AppEdit.vue`（basemap一覧・選択済カードのサムネ表示）, `src/views/BaseMapList.vue`（任意: 一覧サムネ）

- [ ] **Step 1: tmbs優先ロジック** 両サービス共通:

```ts
const tmb = path.join(saveFolder, 'tmbs', `${mapID}.jpg`);
if (fs.existsSync(tmb)) return `file://${tmb.split(path.sep).join('/')}`;
// フォールバック: 従来のズーム0タイル
```

- [ ] **Step 2: `basemaps:list` の各itemに `thumbnailUrl` を付与**（builtin3種はrendererのバンドル画像に任せるためnull、その他は `tmbs/{mapID}_menu.jpg` があれば file:// URL）
- [ ] **Step 3: AppEdit.vue** basemap一覧の `B`/`U` 文字ブロックを `<img>`（builtin: バンドル画像 / thumbnailUrl / no_image）に置換。選択済ソースカードにもサムネ表示。
- [ ] **Step 4: build確認 + Commit** `fix: use tmbs thumbnails for maps and builtin basemap images`

---

### Task 4: アップロードIPC（52x52サムネ / スプラッシュ / 512アイコン）

**Files:**
- Create: `electron/services/AppAssetService.ts`
- Create: `electron/ipc/appassets.ts`（`registerAppAssetHandlers`）
- Modify: `electron/main.ts`（handler登録）, `electron/preload.ts`, `src/electron.d.ts`

- [ ] **Step 1: AppAssetService 実装**（jimp 1.x: `import { Jimp } from 'jimp'`）

```ts
class AppAssetService {
  // 共通: dialogで画像選択 → Jimp.read → 検証・加工 → saveFolder配下へ保存
  async uploadTmsThumbnail(win, mapID): Promise<{err?:string; path?:string; fileUrl?:string}>
  // 正方形必須(err:'NotSquare')、52x52に resize、tmbs/{mapID}_menu.jpg (JPEG q90)
  async uploadSplash(win): Promise<{err?:string; splash?:string; fileUrl?:string}>
  // 画像ならOK。ファイル名sanitizeして img/ へコピー（既存名は上書き）
  async uploadPwaIcon(win, appID): Promise<{err?:string; path?:string; fileUrl?:string}>
  // 正方形必須・512未満はerr:'TooSmall'、512x512 PNGで pwa/{appID}_icon.png
  fileUrlFor(relPath): string | null  // saveFolder相対→file://（存在チェック付き）
}
```

- [ ] **Step 2: IPC/preload/型**

```ts
// preload
contextBridge.exposeInMainWorld('appAssets', {
  uploadTmsThumbnail: (mapID) => ipcRenderer.invoke('appassets:upload-tms-thumbnail', mapID),
  uploadSplash: () => ipcRenderer.invoke('appassets:upload-splash'),
  uploadPwaIcon: (appID) => ipcRenderer.invoke('appassets:upload-pwa-icon', appID),
  fileUrl: (relPath) => ipcRenderer.invoke('appassets:file-url', relPath),
});
```

- [ ] **Step 3: build確認 + Commit** `feat: add app asset upload IPC (thumbnail/splash/pwa icon)`

---

### Task 5: ピンポイントソース設定UI + envelope地図エディタ

**Files:**
- Create: `src/components/AppSourceEditor.vue`（role別フォーム; AppEdit.vueの選択済カード内容を移設）
- Create: `src/components/EnvelopeEditorModal.vue`（OL地図bboxエディタ）
- Modify: `src/views/AppEdit.vue`（details/JSON textarea削除、コンポーネント接続）
- Modify: `public/locales/ja/translation.json` `public/locales/en/translation.json`

- [ ] **Step 1: EnvelopeEditorModal.vue**
  - props: `modelValue: [number,number][] | null`, `visible: boolean`; emits: `update:modelValue`, `close`
  - OL `Map` + OSM XYZ + Vector層。`Draw`(type:'Circle', geometryFunction: `createBox()`)で矩形描画→既存図形をクリアして置換。確定時 extent→`bboxToEnvelope`。既存値があれば `envelopeToBbox` でPolygon表示し `fit`。
- [ ] **Step 2: AppSourceEditor.vue** — props `source: AppSource`, `currentLang`, `appID`; emits `change`（recordHistory用）。表示内容は設計spec の表どおり:
  - maplat: label入力のみ
  - builtin: 「ビューア内蔵定義を使用（設定項目なし）」の説明テキスト + 内蔵サムネ
  - tms: label/title/attr（現在言語のtext input）、url、minZoom/maxZoom、サムネアップロード（`window.appAssets.uploadTmsThumbnail(mapID)` → 成功で `source.data.thumbnail = path`）
  - overlay追加: mercatorXShift/YShift（number, step 0.01）、envelope数値4欄（W/S/E/N, `envelopeToBbox`で表示・変更で`bboxToEnvelope`書き戻し）+「地図で指定」→ EnvelopeEditorModal
- [ ] **Step 3: AppEdit.vue から `source_advanced` textarea・`updateSourceData` を削除**し `<AppSourceEditor>` を組み込み。base/overlay切替(select)・opacity入力・startFromラジオは既存のまま維持。
- [ ] **Step 4: i18n追加**（ja例; enも対で追加）

```json
"source_title": "地図タイトル", "source_attr": "帰属表示", "source_url": "タイルURL ({z}/{x}/{y}, {-y}可)",
"min_zoom": "最小ズーム", "max_zoom": "最大ズーム",
"mercator_x_shift": "メルカトルXシフト", "mercator_y_shift": "メルカトルYシフト",
"builtin_source_note": "ビューア内蔵のベースマップです。設定はビューア側定義を使用します。",
"thumbnail": "サムネイル", "upload": "アップロード",
"thumbnail_note": "52x52の正方形画像を指定してください。",
"error_not_square": "正方形の画像を指定してください。",
"error_too_small": "512x512以上の画像を指定してください。",
"envelope": "表示領域(経緯度)", "envelope_west": "西", "envelope_south": "南", "envelope_east": "東", "envelope_north": "北",
"envelope_pick": "地図で指定", "envelope_clear": "クリア",
"envelope_modal_title": "表示領域を指定", "envelope_modal_help": "ドラッグで矩形を描画してください。", "confirm": "確定"
```

- [ ] **Step 5: build確認 + Commit** `feat: pinpoint per-role source settings UI with envelope map editor`

---

### Task 6: メタデータ/OGP + アップロードUI組込み

**Files:**
- Modify: `src/views/AppEdit.vue`（AppDocument: `keywords`, `siteUrl` 追加。splash/iconアップロードボタン、httpSettings.iconSource撤去→manifestSettings.iconSource移行、manifest_icons textarea撤去）
- Modify: `public/locales/{ja,en}/translation.json`

- [ ] **Step 1: モデル**: `AppDocument` に `keywords: string` `siteUrl: string`。normalize時に旧 `httpSettings.iconSource` → `manifestSettings.iconSource` 移行。`manifestSettings.iconsJson` 廃止（normalize/saveから削除、既存icons配列は無視して良い—エクスポートで再生成）。
- [ ] **Step 2: UI**: metadataタブに keywords(text) / siteUrl(url) 追加。app設定の splash テキスト入力の横に「アップロード」ボタン+プレビュー画像（`appAssets.fileUrl('img/'+splash)`）。manifestセクションに icon アップロード+プレビュー（512x512, `manifestSettings.iconSource`）。
- [ ] **Step 3: i18n**: `"keywords": "キーワード(カンマ区切り)"`, `"site_url": "公開URL"`, `"site_url_note": "エクスポート時のcanonical/manifestに使用"`, `"splash_preview": "スプラッシュ画像"`, `"manifest_icon_source": "PWAアイコン元画像(512x512)"` など。
- [ ] **Step 4: build確認 + Commit** `feat: OGP metadata fields and image upload UI`

---

### Task 7: エクスポート機能（AppExportService + pwa-asset-generator）

**Files:**
- Create: `electron/services/AppExportService.ts`
- Modify: `electron/ipc/apps.ts`（`appedit:export`）, `electron/preload.ts`, `src/electron.d.ts`
- Modify: `src/views/AppEdit.vue`（エクスポートボタン: `!isDirty && onlyOne` 時のみ有効）
- Modify: `package.json`（`pwa-asset-generator@^8.1.5` 追加; `pnpm add pwa-asset-generator`）
- Modify: `vite.config.ts` main.rollupOptions.external に `'pwa-asset-generator'` 追加（puppeteer系のバンドル回避）
- Modify: `electron-builder.config.cjs`（asarUnpack等が必要なら; 最低限 node_modules 同梱確認）

- [ ] **Step 1: サービス骨格**（進捗は既存 `ProgressReporter` + `app:taskProgress`）

```ts
async exportApp(win: BrowserWindow, document: any): Promise<{result:string; outDir?:string; warnings:string[]}> {
  // 1) 出力先選択（showOpenDialog openDirectory）→ outDir = join(selected, appID)
  //    既存なら showMessageBox で上書き確認 → fs.emptyDir
  // 2) apps/{appID}.json: composeViewerApp(document)
  //    { appName, lang, description?, splash?, keywords除外, fakeGps..., homePosition, defaultZoom,
  //      startFrom, sources: sources.map(s => composeViewerSource(s)), pois }
  //    ※ description/appName は compactLangObject、siteUrl/keywords はapp JSONに含めない(index.html用)
  // 3) maplat各ソース: DB文書(store形式)から _id/status/url_ を除去し maps/{mapID}.json、
  //    tiles/{mapID} を copy、tmbs/{mapID}.jpg を copy
  // 4) tmsソースの thumbnail (tmbs/{id}_menu.jpg) copy、splash → img/ copy
  // 5) assets: previewAssetRoot から maplat_ui.css/maplat_ui.umd.js/assets配下 → assets/、
  //    olPackageRoot/dist/ol.js → assets/ol.js、enableCache時 service-worker.js → ルート
  // 6) PWA(pwaManifest時): generatePwaAssets() → manifest icons + htmlMeta
  // 7) index.html: renderIndexHtml(document, htmlMeta)
}
```

- [ ] **Step 2: PWA生成**

```ts
import { generateImages } from 'pwa-asset-generator';
private async generatePwaAssets(outDir, appID, iconPath, splashPath, backgroundColor) {
  const pagDir = path.join(outDir, 'pwa', appID);
  const common = { log: false, pathOverride: `pwa/${appID}`, background: backgroundColor, type: 'png' as const };
  const icons = await generateImages(iconPath, pagDir, { ...common, iconOnly: true, favicon: true, mstile: true, opaque: false, maskable: true });
  const splash = await generateImages(splashPath || iconPath, pagDir, { ...common, splashOnly: true });
  return { icons: icons.manifestJsonContent, htmlMeta: { ...icons.htmlMeta, ...splash.htmlMeta } };
}
// 呼び出し側で try/catch: 失敗時は jimp で manifest-icon-192/512 生成 + 最小限リンク、warnings に
// 'appedit.export.pwa_fallback' を積む
```

- [ ] **Step 3: index.html テンプレート**（legacy naramap.html 準拠のOGP + preview同等のviewer起動）

```
<title>, meta description/keywords, og:title/og:description/og:image(img/{splash}), twitter:card summary,
siteUrl時: canonical + alternate hreflang(ja/en) + og:url,
pwaManifest時: link manifest pwa/{appID}_manifest.json + htmlMeta(favicon/appleTouchIcon/appleLaunchImage/msTile),
assets/maplat_ui.css, assets/ol.js, assets/maplat_ui.umd.js,
option = { appid: appID, pwaManifest, overlay, enableHideMarker, enableBorder, enableCache, stateUrl,
           enableShare, mapboxToken?, googleApiKey? } + URLクエリ上書きループ（legacy互換）,
Maplat(=window.MaplatUi).createObject(option)
```

- manifest JSON: `{ name, short_name, background_color, theme_color, display, start_url, scope, icons }`。`siteUrl` があれば start_url=siteUrl / scope=siteUrlパス、無ければ `./`。
- [ ] **Step 4: IPC/preload/ボタン接続**（実行中はProgressModal表示; 既存 `app:taskProgress` 購読を流用）
- [ ] **Step 5: `pnpm add pwa-asset-generator` → build確認**
- [ ] **Step 6: Commit** `feat: static site export with pwa-asset-generator icon/splash generation`

---

### Task 8: 検証

- [ ] **Step 1:** `pnpm run build`（vue-tsc型チェック含む）成功
- [ ] **Step 2:** `pnpm run smoke:m6-app-source-model` ほか既存smoke（m5-app-editor 等、変更影響分）PASS
- [ ] **Step 3:** 手動: `pnpm run dev` でAppEditを開き、(a) builtin+tms overlay+maplat混在アプリのプレビュー表示、(b) envelope地図指定UI、(c) サムネ表示、(d) エクスポート出力を `npx serve` で起動し表示確認
- [ ] **Step 4:** Commit（残差分）+ FUTURE_PLAN.md へスコープ外項目（mapbox/google専用UI等）追記

## Self-Review結果
- Spec coverage: ビルトイン文字列化(T1,2)/ピンポイントUI(T5)/envelope UI(T5)/サムネ(T3,4)/アップロード(T4,6)/OGP(T6,7)/エクスポート+PAG(T7) — 全要件にタスクあり
- 型整合: `AppSource`/`composeViewerSource`/`bboxToEnvelope` の名称・シグネチャはT1定義をT2/T5/T7で参照
- プレースホルダ: コード断片は実装時に確定する箇所を含むが、入出力仕様・検証条件・ファイルパスはすべて明記
