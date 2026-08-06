import fs from 'fs-extra';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { session } from 'electron';
import SettingsService from './SettingsService';
import MapEditService from './MapEditService';
import MapPurposeService from './MapPurposeService';
import { normalizeRuntimeKeys } from './MaplatRuntimeKeys';
import { resolveResourceAsset, isUnderFolder } from '../utils/resourceAssets';
import { readAppDocumentPois } from '../../src/utils/appPoisFormat';
import SqliteDataService from './SqliteDataService';
import {
  collectPoiUids,
  hasSharedPoiUid,
  iconSetFilePath,
  mergeWarnings,
  externalizePoisArray,
  createPoiExternalizationContext,
  DUPLICATE_POI_REFERENCE_WARNING,
} from './poiReferenceResolver';
import {
  composeViewerSource,
  hasViewerBasemapSource,
  normalizeAppSource,
  type AppSource,
} from '../../src/utils/appSourceModel';
import { resolveAppLocalizedMetadata } from '../../src/utils/appLocalizedMetadata';
import { localizeTitle } from '../../src/utils/langResource';
import { UUID_PATTERN } from '../adapters/StorageAdapter';
import { detectRequiredProviderGl, renderProviderGlCdnTags } from './providerGlCdn';
import { requiresProviderKey } from '../../src/utils/baseMapEditorDocument';
import {
  resolvePreviewKey,
  resolveStartFromViewerMapID,
  PROVIDER_KEY_MISSING_WARNING,
  type ProviderKeyKind,
} from './providerKeyResolution';

type PreviewSession = {
  token: string;
  app: any;
  maps: Record<string, any>;
  // m6-t5: viewer 向け sources（compose 済み）。GL CDN 判定は maps ではなくこちらを見る
  // （maps には maplat ソースしか入らず、basemap の mapbox/maplibre を検出できない）
  viewerSources: Array<Record<string, unknown> | string>;
  // M4-T3: pois/<name>.geojson の実体。キーはファイル名 ('kyoto-poi.geojson')。
  // export が outDir/pois/ へ書き出すのと同じ内容を、preview はメモリから配信する
  poiDocuments: Record<string, unknown>;
  manifest: any;
  viewerOption: any;
  // POI 参照解決の警告 (静的 i18n キー)。prepare の返り値経由でレンダラの t(key) 表示に載せる
  warnings: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..', '..');
const uiPackageRoot = findExistingPath([
  path.resolve(appRoot, 'node_modules/@maplat/ui'),
  path.resolve(__dirname, '..', 'node_modules/@maplat/ui'),
]);
const olPackageRoot = findExistingPath([
  path.resolve(appRoot, 'node_modules/ol'),
  path.resolve(__dirname, '..', 'node_modules/ol'),
]);
const previewAssetRoot = findExistingPath([
  path.resolve(appRoot, 'public/preview'),
  path.resolve(appRoot, 'dist/preview'),
  path.resolve(__dirname, '..', 'public/preview'),
  path.resolve(__dirname, '..', 'dist/preview'),
  path.resolve(__dirname, '..', 'preview'),
]);
const LOCAL_FILE_PREFIX = '/local-file/';
const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

class AppPreviewService {
  private server: http.Server | null = null;
  private port: number | null = null;
  private sessions = new Map<string, PreviewSession>();
  // M1-T6 (d-3): prepare / shutdown を直列化する operation queue。
  // prepare は :95 の await assertViewerRuntimeAllowed で最初に制御を手放すため、
  // 進行中の prepare へ shutdown が割り込むと ensureServer が旧サーバの close 完了前に
  // listen して EADDRINUSE となり、走査ループが preferred+1 へ漂流する(実測)。
  // 直列化しておけば「stop 開始後に完了した prepare の server/session を古い stop が
  // 消さない」も書き方の偶然ではなく構造として保証される。
  private opChain: Promise<unknown> = Promise.resolve();

  // 直前の操作が reject しても鎖を切らない(prepare は strict_error で日常的に失敗する)。
  // 呼び出し元へは元の Promise をそのまま返すので reject の伝播は変わらない
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(op, op);
    this.opChain = run.catch(() => undefined);
    return run;
  }

  // M4-T3: maplat-asset:<UID> の実体パス解決 (private resolveAssetPath) は撤去した。
  // これは resolveAssetRefsInFcForPreview へ渡す callback 専用で、POI の asset 解決が
  // externalizePoisArray の export 形 (imgs/{slug}.{ext}) へ統一されたことで唯一の用途を失い、
  // noUnusedLocals に掛かるため残せない。実体は
  // {saveFolder}/assets/{uid}.{ext} の存在確認だけなので、必要になれば容易に再生できる
  // (poiReferenceResolver.resolveIconValue が同じ解決を持つ)。

  async prepare(document: any): Promise<{ url: string; port: number; warnings: string[] }> {
    return this.enqueue(() => this.prepareInner(document));
  }

  private async prepareInner(document: any): Promise<{ url: string; port: number; warnings: string[] }> {
    // M13-T1 (§2.7): strict_error / missing map を含む maplat 参照はプレビュー起動を拒否する
    // (AC-T1-2)。ensureServer() (サーバー起動) / purgePreviewStorage() (ストレージ削除)
    // という副作用が始まる前に判定する
    await MapPurposeService.assertViewerRuntimeAllowed(
      MapPurposeService.collectMaplatMapRefs(document), 'app-preview'
    );
    await this.ensureServer(Number(document.httpSettings?.previewPort || 0) || undefined);
    await this.purgePreviewStorage();
    // M1-T6 (c): token は Date.now() 由来だとエントロピーが実質ミリ秒時刻のみで、
    // appID の列挙 + 起動時刻の推測で当てられた。randomUUID の 122bit を足す。
    // appID 接頭辞は URL 形状とログの可読性のために残す
    const token = `${sanitizeId(document.appID || 'preview')}-${randomUUID()}`;
    const previewSession = await this.createSession(token, document);
    // M1-T6 (d-1): プレビューは AppEdit.vue:1567 の単一 iframe で、同時に2セッションが
    // 必要になる経路がない。旧 token を残すと有効な入口が増え続けるだけなので失効させる
    this.sessions.clear();
    this.sessions.set(token, previewSession);
    return {
      // m6-t6 hotfix H-B: Google/Mapbox の HTTP リファラー制限は一般に localhost を許可し
      // 127.0.0.1 を許可しない運用が実情のため、返却 URL を localhost へ揃える（人間検証 H-4）。
      // listen() の bind アドレス(127.0.0.1)とは独立で、127.0.0.1 到達性はそのまま維持する
      // (isAllowedHost/isAllowedOrigin は既に localhost/127.0.0.1 双方を許可済み)
      url: `http://localhost:${this.port}/preview/${token}/`,
      port: this.port!,
      warnings: previewSession.warnings,
    };
  }

  // プレビューごとにWeiwudi(SWタイルキャッシュ)の地図登録とキャッシュを完全に消す。
  // Weiwudiの登録(IndexedDB「Weiwudi」のmapSetting)とタイル実体(Weiwudi_{mapID})、
  // ServiceWorker登録、CacheStorageをオリジン単位で削除する。
  // レンダラのDevToolsからは旧トークンのSWがIndexedDBを掴んだままで消せないため、
  // Electronメイン側のclearStorageDataで行う
  private async purgePreviewStorage(): Promise<void> {
    if (!this.port) return;
    try {
      const storages: Array<'indexdb' | 'serviceworkers' | 'cachestorage'> =
        ['indexdb', 'serviceworkers', 'cachestorage'];
      // m6-t6 hotfix H-B/N-1: 返却 URL は localhost だが、H-B 適用前の 127.0.0.1 オリジンにも
      // 過去のプレビュー由来ストレージ(Weiwudi タイルキャッシュ等)が残っている可能性があるため、
      // アップグレード後もその旧オリジン分が永久に purge 対象外へ落ちないよう両方を消す
      await session.defaultSession.clearStorageData({ origin: `http://localhost:${this.port}`, storages });
      await session.defaultSession.clearStorageData({ origin: `http://127.0.0.1:${this.port}`, storages });
    } catch (e) {
      console.error('[AppPreviewService] failed to purge preview storage', e);
    }
  }

  private async ensureServer(preferredPort?: number) {
    if (this.server && this.port) return;
    const preferred = preferredPort || Number(SettingsService.get('previewPort') || 41781);
    for (let port = preferred; port < preferred + 50; port += 1) {
      try {
        await this.listen(port);
        SettingsService.set('previewPortActive', port);
        return;
      } catch (e: any) {
        if (e?.code !== 'EADDRINUSE') throw e;
      }
    }
    throw new Error('appedit.preview.server_unavailable');
  }

  private listen(port: number) {
    return new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private async createSession(token: string, document: any): Promise<PreviewSession> {
    const maps: Record<string, any> = {};
    const documentLang = document.lang || 'ja';
    // POI 参照解決 (Phase 7): app pois の {poiUid} 集合。map 側との積が非空なら二重参照警告 (POI-142)
    const warnings: string[] = [];
    const appPoisRaw = readAppDocumentPois(document).pois;
    const appPoiUids = collectPoiUids(appPoisRaw);
    let duplicateReference = false;
    const normalizedSources: AppSource[] = (Array.isArray(document.sources) ? document.sources : [])
      .map((raw: any) => normalizeAppSource(raw, documentLang));
    // m6-t6 (§3.1): 鍵が3段とも解決できない provider ソースは、この時点で除外する。
    // 除外後の previewableSources を entries 組み立て・hasViewerBasemapSource・startFrom 解決の
    // すべてで使い回すことで、除外が overlay/startFrom 判定へ正しく反映される（設計レビュー M3/M4/M5）
    const previewableSources: AppSource[] = normalizedSources.filter((source) => {
      const kind = source.data?.kind as ProviderKeyKind | undefined;
      if (!requiresProviderKey(kind)) return true;
      if (resolvePreviewKey(kind as ProviderKeyKind, document.httpSettings, SettingsService)) return true;
      mergeWarnings(warnings, [PROVIDER_KEY_MISSING_WARNING[kind as ProviderKeyKind]]);
      return false;
    });
    const entries = await Promise.all(previewableSources.map(async (source: AppSource) => {
      if (source.sourceType === 'maplat') {
        // uid正準参照 (ADR-0007)。旧保存形のslug参照もrequestPreviewSourceが解決する。
        // Viewer向けmapID(maps/{...}.json のキー)は解決済みslug
        const preview = await MapEditService.requestPreviewSource(source.mapUid);
        const viewerMapID = String(preview.mapID || source.mapUid);
        const label = source.label || preview.title || viewerMapID;
        // M4-T3: pois の外部ファイル化は Promise.all の後段で逐次に行う (外部化コンテキストを
        // app / map で共有するため、並行更新だと連番採番が非決定になる)。ここでは生値のまま置く
        const rawMapPois = preview.pois;
        // サムネイル実体はuidパス (ADR-0007)。preview serverの tmbs/ 経路で配信される
        const thumbnail = `tmbs/${preview.uid || viewerMapID}.jpg`;
        maps[viewerMapID] = this.toHttpAsset(normalizeRuntimeKeys({
          ...preview,
          mapID: viewerMapID,
          maptype: 'maplat',
          label,
          title: preview.title || label,
          thumbnail,
          url: preview.url || preview.url_,
          pois: rawMapPois,
        }), token);
        const composed = composeViewerSource(source, {
          settingFilePrefix: 'maps/',
          lang: documentLang,
          maplatMapID: viewerMapID,
        }) as Record<string, unknown>;
        composed.thumbnail = thumbnail;
        return { source, viewerMapID, composed, rawMapPois };
      }
      // builtin → 素の文字列 / tms → Editor専用キー除去済みオブジェクト
      return { source, viewerMapID: source.mapUid, composed: composeViewerSource(source, { lang: documentLang }) };
    }));

    // M4-T3: POI の外部ファイル化 (export と同一形式)。app / map で1つのコンテキストを共有し、
    // 同じ POI ソースを両方が参照しても pois/<name>.geojson は1ファイルへ畳む。
    // ctx を触る区間は逐次 — Promise.all の中で並行に更新すると連番採番が非決定になる
    const poiCtx = createPoiExternalizationContext();
    for (const entry of entries) {
      // M4-T4: 生の Array.isArray ではなく共通の readAppDocumentPois を通す（export 側と同一の
      // 是正）。単独形の地図で POI が preview から丸ごと落ちるのを塞ぐ
      const mapPois = readAppDocumentPois({ pois: (entry as { rawMapPois?: unknown }).rawMapPois }).pois;
      if (mapPois.length === 0) continue;
      if (!duplicateReference && hasSharedPoiUid(collectPoiUids(mapPois), appPoiUids)) {
        duplicateReference = true;
      }
      const externalized = await externalizePoisArray(mapPois, poiCtx);
      mergeWarnings(warnings, externalized.warnings);
      maps[entry.viewerMapID].pois = this.toHttpAsset(externalized.pois, token);
    }
    // startFromはViewer向けmapIDで渡す。document.startFromはuid(新形)/slug(旧形)のどちらもあり得る。
    // m6-t6 (§3.1・M5): 3段照合を resolveStartFromViewerMapID へ共通化。除外されたソースは
    // entries に存在しないため3段目でも一致せず、除外ソースを指す startFrom は自動的に undefined になる
    const resolvedStartFrom = resolveStartFromViewerMapID(
      entries.map((entry) => ({
        startFrom: Boolean(entry.source.startFrom),
        mapUid: entry.source.mapUid,
        mapSlug: entry.source.mapSlug,
        viewerMapID: entry.viewerMapID,
      })),
      document.startFrom,
    );
    // M4-T3: app 側 pois も同じコンテキストで外部化する (map の後 = 連番採番の順序が決定的)
    const externalizedAppPois = await externalizePoisArray(appPoisRaw, poiCtx);
    mergeWarnings(warnings, externalizedAppPois.warnings);
    const appPoisForViewer = this.toHttpAsset(externalizedAppPois.pois, token);
    // 外部ファイルの実体はメモリから配信する (export が outDir/pois/ へ書くのと同じ内容)。
    // キーは dest から 'pois/' を除いたファイル名
    const poiDocuments: Record<string, unknown> = {};
    for (const doc of externalizedAppPois.documents) {
      poiDocuments[doc.dest.replace(/^pois\//, '')] = doc.json;
    }
    if (duplicateReference) mergeWarnings(warnings, [DUPLICATE_POI_REFERENCE_WARNING]);
    const app = this.toHttpAsset(normalizeRuntimeKeys({
      appName: document.appName || document.title,
      title: document.title || document.appName,
      description: document.description,
      lang: document.lang || 'ja',
      splash: document.appSettings?.splash || document.splash || '',
      homePosition: [
        finiteOr(document.appSettings?.homeLng, 139.767),
        finiteOr(document.appSettings?.homeLat, 35.681),
      ],
      defaultZoom: Number(document.appSettings?.defaultZoom || 10),
      startFrom: resolvedStartFrom,
      sources: entries.map((entry) => entry.composed),
      pois: appPoisForViewer,
    }), token);
    return {
      token,
      app,
      maps,
      viewerSources: entries.map((entry) => entry.composed),
      poiDocuments,
      manifest: this.createManifest(document),
      viewerOption: this.createViewerOption(token, document, hasViewerBasemapSource(previewableSources)),
      warnings,
    };
  }

  private createManifest(document: any) {
    const manifest = document.manifestSettings || {};
    const localized = resolveAppLocalizedMetadata(document);
    return {
      name: localized.manifestName || 'Maplat',
      short_name: localized.manifestShortName || 'Maplat',
      background_color: manifest.backgroundColor || '#f6f0d3',
      theme_color: manifest.themeColor || '#f6f0d3',
      display: manifest.display || 'standalone',
      start_url: manifest.startUrl || './',
      scope: manifest.scope || './',
      icons: manifest.icons || [],
    };
  }

  // M1-T6 (a): DNS rebinding 防御。listen(port,'127.0.0.1') は「外から直接届くこと」しか
  // 防がない。攻撃者ドメインを 127.0.0.1 へ再解決させた fetch はブラウザから見れば同一
  // オリジンなので、Host ヘッダでしか弾けない。
  // 許可されるものだけを列挙し、Host 欠落を含む残り全部を落とす(fail-closed)。
  private isAllowedHost(req: http.IncomingMessage): boolean {
    if (!this.port) return false;
    const host = req.headers.host;
    if (!host) return false;
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
  }

  // M1-T6 (a): Origin は補助検査。同一オリジンのナビゲーションとサブリソース GET は
  // Origin を送らないため「不在」は許可する。値がある場合もホスト部だけを見てポートは問わない。
  // 理由: main.ts:67-70 が webSecurity:false のため、レンダラ本体
  // (file:// なら Origin:null / dev なら http://localhost:<vite port>) からプレビューサーバへ
  // 直接 fetch する経路が実在する(tests/e2e/m18-t5:163-169)。ポート一致を要求するとこれを弾く。
  // rebinding 攻撃はリバインド後に同一オリジン扱いとなり Origin を送らないので、
  // ここを厳しくしても防御は増えない(主防御は Host)。
  private isAllowedOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    if (origin === 'null') return true;
    try {
      const { hostname, protocol } = new URL(origin);
      if (protocol !== 'http:' && protocol !== 'https:') return false;
      return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
    } catch {
      return false;
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.isAllowedHost(req) || !this.isAllowedOrigin(req)) {
      return this.sendText(res, 403, 'Forbidden');
    }
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port || 0}`);
    const segments = requestUrl.pathname.split('/').filter(Boolean);
    // 配信は完全非同期で行い、失敗時も必ずレスポンスを閉じる(接続リーク防止)
    Promise.resolve()
      .then(() => {
        if (segments[0] === 'preview' && segments[1]) return this.handlePreview(segments[1], segments.slice(2), res);
        // M1-T6 (b): /local-file は従来 token 不要で saveFolder 配下を無条件配信していた。
        // token を必須にする。split('/').filter(Boolean) ではなく slice で切るのは、
        // filter(Boolean) が UNC の '//srv/share/...' を '/srv/share/...' へ潰すため
        if (requestUrl.pathname.startsWith(LOCAL_FILE_PREFIX)) {
          const rest = requestUrl.pathname.slice(LOCAL_FILE_PREFIX.length);
          const slash = rest.indexOf('/');
          if (slash <= 0) return this.sendText(res, 404, 'Not Found');
          const fileToken = rest.slice(0, slash);
          if (!this.sessions.has(fileToken)) return this.sendText(res, 404, 'Not Found');
          return this.serveLocalFile(rest.slice(slash), res);
        }
        this.sendText(res, 404, 'Not Found');
      })
      .catch((e) => {
        console.error('[AppPreviewService] request failed', e);
        if (!res.headersSent) {
          this.sendText(res, 500, 'Internal Server Error');
        } else {
          res.destroy();
        }
      });
  }

  private async handlePreview(token: string, rest: string[], res: http.ServerResponse): Promise<void> {
    const session = this.sessions.get(token);
    if (!session) return this.sendText(res, 404, 'Preview session not found');
    if (rest.length === 0) return this.sendHtml(res, this.renderHtml(session));
    if (rest[0] === 'service-worker.js') return this.servePackageAsset('service-worker.js', res);
    if (rest[0] === 'tiles') return this.servePreviewTile(rest.slice(1), res);
    if (rest[0] === 'tmbs') return this.serveDataFile('tmbs', rest.slice(1), res);
    if (rest[0] === 'img') return this.serveDataFile('img', rest.slice(1), res);
    // M11-T9: maplat-asset:<UID> 解決用の Asset 実体配信。既存 imgs 分岐より前に置く
    if (rest[0] === 'imgs' && rest[1] === 'assets') return this.serveAssetFile(rest[2], res);
    if (rest[0] === 'imgs') return this.serveResolvedIcon(rest.slice(1), res);
    if (rest[0] === 'basemap_icons') return this.serveResourceAsset(rest, res);
    if (rest[0] === 'apps' && rest[1] === `${token}.json`) return this.sendJson(res, session.app);
    if (rest[0] === 'maps' && rest[1]) return this.sendJson(res, session.maps[rest[1].replace(/\.json$/, '')] || {});
    // M4-T3: POI 実体の配信。maps と同じくセッションのメモリを引くだけ (ファイルシステムに触れない)。
    // 未知キーは 404 ではなく {} を返す — viewer の nodesLoader は response.ok しか見ず、
    // 404 だと throw して pois 全体が落ちるため (maps と同じ作法)
    if (rest[0] === 'pois' && rest[1]) return this.sendJson(res, session.poiDocuments[rest[1]] || {});
    if (rest[0] === 'pwa' && rest[1] === `${token}_manifest.json`) return this.sendJson(res, session.manifest);
    if (rest[0] === 'assets') return this.servePackageAsset(rest.slice(1).join('/'), res);
    this.sendText(res, 404, 'Not Found');
  }

  private renderHtml(session: PreviewSession) {
    const { token, app } = session;
    const title = escapeHtml(localizeTitle(app.title || app.appName || app.app_name, app.lang) || token);
    const manifestLink = session.viewerOption.pwaManifest ? `  <link rel="manifest" href="pwa/${token}_manifest.json">\n` : '';
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
${manifestLink}
  <link rel="stylesheet" href="assets/maplat_ui.css">
  <style>
    html, body, .mainview, #map_div { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; overflow: hidden; }
  </style>
</head>
<body>
  <div class="mainview"><div id="map_div"></div></div>
${renderProviderGlCdnTags(detectRequiredProviderGl(session.viewerSources || []))}  <script src="assets/ol.js"></script>
  <script src="assets/maplat_ui.umd.js"></script>
  <script>
    const option = ${JSON.stringify(session.viewerOption)};
    const MaplatPreview = window.MaplatUi && window.MaplatUi.createObject
      ? window.MaplatUi
      : window.MaplatUi && window.MaplatUi.MaplatUi
        ? window.MaplatUi.MaplatUi
        : window.Maplat;
    MaplatPreview.createObject(option).then((previewApp) => {
      // E2E・デバッグ用に viewer インスタンスを公開（m18-t5 AC5-12: iframe 内 ready/marker 到達の状態ベース待機に使用）
      window.__maplatPreview = previewApp;
    }).catch((e) => {
      document.body.innerHTML = '<pre style="padding:12px;color:#842029;background:#f8d7da;">' + (e && e.stack || e) + '</pre>';
    });
  </script>
</body>
</html>`;
  }

  private createViewerOption(token: string, document: any, hasBasemap: boolean) {
    const httpSettings = document.httpSettings || {};
    return {
      appid: token,
      div: 'map_div',
      pwaManifest: Boolean(httpSettings.pwaManifest),
      restoreSession: false,
      // @maplat/core の overlay=true は背景用 basemap が存在する前提。
      // maplat/overlay だけのプレビューでは backTo が null になり初期化時に落ちるため抑止する。
      overlay: Boolean(httpSettings.overlay) && hasBasemap,
      enableHideMarker: Boolean(httpSettings.enableHideMarker),
      // viewer のマーカー一覧 UI (ui_init.ts の appOption.enableMarkerList)。GUI 検証 D3
      enableMarkerList: Boolean(httpSettings.enableMarkerList),
      enableBorder: Boolean(httpSettings.enableBorder),
      enableCache: Boolean(httpSettings.enableCache),
      stateUrl: Boolean(httpSettings.stateUrl),
      enableShare: Boolean(httpSettings.enableShare),
      // m6-t6 (§3.1): アプリ単位キーの直読みをやめ、3段解決（エディタ用→アプリ単位→既定公開用）へ
      mapboxToken: resolvePreviewKey('mapbox', httpSettings, SettingsService),
      googleApiKey: resolvePreviewKey('google', httpSettings, SettingsService),
    };
  }

  private async servePackageAsset(assetPath: string, res: http.ServerResponse): Promise<void> {
    const candidates = [
      path.join(previewAssetRoot, assetPath),
      path.join(uiPackageRoot, 'dist', assetPath),
      path.join(uiPackageRoot, 'assets', assetPath),
      assetPath === 'ol.css' ? path.join(olPackageRoot, 'ol.css') : '',
      assetPath === 'ol.js' ? path.join(olPackageRoot, 'dist', 'ol.js') : '',
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (await this.sendFileIfExists(res, candidate)) return;
    }
    this.sendText(res, 404, 'Asset not found');
  }

  // POI icon 参照解決 (POI-117) の出力パス 'imgs/...' の配信。
  // imgs/icons/{setId}/{iconId}.{ext} → icon set 実体 (public/icons/... の候補解決、traversal ガード込み)、
  // imgs/{slug}.{ext} → 登録 image asset の実体 {saveFolder}/assets/{uid}.{ext} (slug は DB 引き、
  // ext が record と一致する場合のみ — 任意ファイル読み出しを防ぐ)
  private async serveResolvedIcon(segments: string[], res: http.ServerResponse): Promise<void> {
    const decoded = segments.map(segment => decodeURIComponent(segment));
    if (decoded[0] === 'icons') {
      const resolved = iconSetFilePath(decoded.join('/'));
      if (!resolved) return this.sendText(res, 404, 'Icon not found');
      return this.sendFile(res, resolved);
    }
    if (decoded.length === 1) {
      const match = /^(.+)\.([A-Za-z0-9]+)$/.exec(decoded[0]);
      if (match) {
        const record = await SqliteDataService.findAssetByRef(match[1]);
        if (record && record.ext === match[2].toLowerCase()) {
          const saveFolder = SettingsService.get('saveFolder') as string;
          return this.sendFile(res, path.join(saveFolder, 'assets', `${record.uid}.${record.ext}`));
        }
      }
    }
    this.sendText(res, 404, 'Icon not found');
  }

  // M11-T9: maplat-asset:<UID> 解決用の Asset 実体配信。
  // パストラバーサル防御: uid 部が UUID 形状、ext 部が画像拡張子のみ許可。
  private async serveAssetFile(filename: string | undefined, res: http.ServerResponse): Promise<void> {
    if (!filename) return this.sendText(res, 404, 'Not Found');
    const decoded = decodeURIComponent(filename);
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpe?g|gif|webp|svg)$/i.exec(decoded);
    if (!match) return this.sendText(res, 404, 'Not Found');
    const uid = match[1].toLowerCase();
    if (!UUID_PATTERN.test(uid)) return this.sendText(res, 404, 'Not Found');
    const ext = match[2].toLowerCase();
    const saveFolder = SettingsService.get('saveFolder') as string;
    const assetPath = path.join(saveFolder, 'assets', `${uid}.${ext}`);
    await this.sendFile(res, assetPath);
  }

  // ビルトインベースマップのアイコン等、アプリ同梱リソースを配信する
  private async serveResourceAsset(segments: string[], res: http.ServerResponse): Promise<void> {
    const relPath = segments.map(segment => decodeURIComponent(segment)).join('/');
    const resolved = resolveResourceAsset(relPath);
    if (!resolved) return this.sendText(res, 404, 'Asset not found');
    await this.sendFile(res, resolved);
  }

  private async serveDataFile(folder: 'tmbs' | 'img', segments: string[], res: http.ServerResponse): Promise<void> {
    const saveFolder = SettingsService.get('saveFolder') as string;
    const baseFolder = path.resolve(path.join(saveFolder, folder));
    const resolved = path.resolve(path.join(baseFolder, ...segments.map(segment => decodeURIComponent(segment))));
    // M12-T14: startsWith(baseFolder) は末尾 path.sep 欠落で `{baseFolder}-x`（例 tmbs-x）が
    // prefix 一致通過していた。isUnderFolder（= startsWith(base + path.sep)）で厳密化（M12-T13 と同型）
    if (!isUnderFolder(resolved, baseFolder)) return this.sendText(res, 403, 'Forbidden');
    await this.sendFile(res, resolved);
  }

  private async servePreviewTile(tileSegments: string[], res: http.ServerResponse): Promise<void> {
    const saveFolder = SettingsService.get('saveFolder') as string;
    await this.serveLocalFile(path.join(saveFolder, 'tiles', ...tileSegments), res);
  }

  private async serveLocalFile(filePath: string, res: http.ServerResponse): Promise<void> {
    const decoded = decodeURIComponent(filePath);
    const saveFolder = SettingsService.get('saveFolder') as string;
    // M1-T6 (b): URL 経路由来は常に '/' 始まり。Windows のドライブレター形 '/C:/...' は
    // path.win32.resolve が '\C:\...'(ドライブ相対)と誤解するため fromUrlPathname で剥がす。
    // servePreviewTile が渡すネイティブパスに対しては no-op
    const resolved = path.resolve(fromUrlPathname(decoded));
    // M12-T14: 同上。`{saveFolder}-x` の兄弟ディレクトリを除外
    if (!isUnderFolder(resolved, saveFolder)) return this.sendText(res, 403, 'Forbidden');
    await this.sendFile(res, resolved);
  }

  private async sendFile(res: http.ServerResponse, filePath: string): Promise<void> {
    if (!(await this.sendFileIfExists(res, filePath))) {
      this.sendText(res, 404, 'File not found');
    }
  }

  // ファイルが存在すれば配信してtrue。stat/読み込みは非同期で行い、メインスレッドを
  // ブロックしない(遅いストレージ上のタイルburst読み込みで全接続が詰まるのを防ぐ)。
  // ストリーム失敗・クライアント切断時は双方を確実に破棄し、接続リークを防ぐ。
  private async sendFileIfExists(res: http.ServerResponse, filePath: string): Promise<boolean> {
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch {
      return false;
    }
    if (!stats.isFile()) return false;
    res.writeHead(200, {
      'content-type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': stats.size,
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (e) => {
      console.error('[AppPreviewService] file stream failed', filePath, e);
      res.destroy();
    });
    res.on('close', () => {
      stream.destroy();
    });
    stream.pipe(res);
    return true;
  }

  // M1-T6 (d-2): 従来 HTTP server を閉じる経路が存在せず、macOS では main.ts:100-104 により
  // ウィンドウを閉じてもアプリが常駐するためサーバがポートを掴んだままだった。
  async shutdown(): Promise<void> {
    return this.enqueue(() => this.shutdownInner());
  }

  private async shutdownInner(): Promise<void> {
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // keep-alive で滞留しているソケットを落とさないと close コールバックが来ない
      server.closeAllConnections();
    });
  }

  private sendJson(res: http.ServerResponse, data: any) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  private sendHtml(res: http.ServerResponse, html: string) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  }

  private sendText(res: http.ServerResponse, status: number, text: string) {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
  }

  private toHttpAsset<T>(value: T, token: string): T {
    if (Array.isArray(value)) return value.map(item => this.toHttpAsset(item, token)) as T;
    if (!value || typeof value !== 'object') return this.toHttpUrl(value, token) as T;
    return Object.entries(value as Record<string, any>).reduce((acc, [key, item]) => {
      acc[key] = this.toHttpAsset(item, token);
      return acc;
    }, {} as Record<string, any>) as T;
  }

  private toHttpUrl(value: any, token: string): any {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('file://')) return value;
    // M1-T6 (b): token を挟む。あわせて toUrlPathname で先頭 '/' を保証する。
    // 従来は Windows で 'C:/...' が直結して '/local-fileC:/...' になり、
    // handle() の分岐に一致せず 404 になっていた(既存欠陥の是正)
    const pathname = encodeURI(toUrlPathname(fileURLToPath(value)))
      .replace(/%7B/g, '{')
      .replace(/%7D/g, '}');
    // m6-t6 hotfix H-B: プレビューページ本体(localhost)と同一オリジンへ揃える
    return `http://localhost:${this.port}/local-file/${token}${pathname}`;
  }
}

// M1-T6 (b): ネイティブ絶対パスを URL 経路へ載せる形へ正規化する。
// POSIX '/Users/x' → '/Users/x' / Windows 'C:/Users/x' → '/C:/Users/x' / UNC '//srv/s' → '//srv/s'
// テストから path.win32.sep を注入できるよう sep を引数に取る(POSIX 環境で Windows 形状を検証するため)
export function toUrlPathname(nativePath: string, sep: string = path.sep): string {
  const forward = nativePath.split(sep).join('/');
  return forward.startsWith('/') ? forward : `/${forward}`;
}

// M1-T6 (b): URL 経路上の絶対パスをネイティブ解決可能な形へ戻す。
// path.win32.resolve('/C:/Users/x') は '\C:\Users\x'(ドライブ相対のガベージ)を返すため、
// Windows ドライブレター形に限り先頭 '/' を剥がす。UNC と POSIX はそのまま。
// 引数がネイティブパス(servePreviewTile 経由の 'C:\...' / '/Users/...')の場合は no-op になる
export function fromUrlPathname(urlPath: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(urlPath) ? urlPath.slice(1) : urlPath;
}

function sanitizeId(value: string) {
  return String(value || 'preview').replace(/[^\w-]/g, '_');
}

// null/空文字/非数はfallback(ホームポジション未設定時に使用)
function finiteOr(value: any, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function findExistingPath(candidates: string[]) {
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

export default new AppPreviewService();
