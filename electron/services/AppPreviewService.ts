import fs from 'fs-extra';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { session } from 'electron';
import SettingsService from './SettingsService';
import MapEditService from './MapEditService';
import { normalizeRuntimeKeys } from './MaplatRuntimeKeys';
import { resolveResourceAsset, isUnderFolder } from '../utils/resourceAssets';
import { normalizeJsonArray } from '../utils/jsonArray';
import SqliteDataService from './SqliteDataService';
import {
  collectPoiUids,
  hasSharedPoiUid,
  iconSetFilePath,
  mergeWarnings,
  resolvePoisArray,
  resolveAssetRefsInFcForPreview,
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

type PreviewSession = {
  token: string;
  app: any;
  maps: Record<string, any>;
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

  // maplat-asset:<UID> の実体パス解決 (map側/app側 pois 共通)。callback として渡すため arrow で束縛
  private resolveAssetPath = async (uid: string): Promise<string | null> => {
    const record = await SqliteDataService.findAsset(uid);
    if (!record) return null;
    const saveFolder = SettingsService.get('saveFolder') as string;
    const src = path.join(saveFolder, 'assets', `${record.uid}.${record.ext}`);
    if (!(await fs.pathExists(src))) return null;
    return src;
  };

  async prepare(document: any): Promise<{ url: string; port: number; warnings: string[] }> {
    await this.ensureServer(Number(document.httpSettings?.previewPort || 0) || undefined);
    await this.purgePreviewStorage();
    const token = `${sanitizeId(document.appID || 'preview')}-${Date.now().toString(36)}`;
    const previewSession = await this.createSession(token, document);
    this.sessions.set(token, previewSession);
    return {
      url: `http://127.0.0.1:${this.port}/preview/${token}/`,
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
      await session.defaultSession.clearStorageData({
        origin: `http://127.0.0.1:${this.port}`,
        storages: ['indexdb', 'serviceworkers', 'cachestorage'],
      });
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
    const appPoisRaw = normalizeJsonArray(document.pois || document.poiSources);
    const appPoiUids = collectPoiUids(appPoisRaw);
    let duplicateReference = false;
    const normalizedSources: AppSource[] = (Array.isArray(document.sources) ? document.sources : [])
      .map((raw: any) => normalizeAppSource(raw, documentLang));
    const entries = await Promise.all(normalizedSources.map(async (source: AppSource) => {
      if (source.sourceType === 'maplat') {
        // uid正準参照 (ADR-0007)。旧保存形のslug参照もrequestPreviewSourceが解決する。
        // Viewer向けmapID(maps/{...}.json のキー)は解決済みslug
        const preview = await MapEditService.requestPreviewSource(source.mapUid);
        const viewerMapID = String(preview.mapID || source.mapUid);
        const label = source.label || preview.title || viewerMapID;
        // map data_json の pois 内の {poiUid} 参照を export 形 FC へ解決 (生要素は透過)
        let mapPois = preview.pois;
        if (Array.isArray(mapPois)) {
          if (!duplicateReference && hasSharedPoiUid(collectPoiUids(mapPois), appPoiUids)) {
            duplicateReference = true;
          }
          const resolved = await resolvePoisArray(mapPois);
          mergeWarnings(warnings, resolved.warnings);
          mapPois = resolved.pois;
          // M11-T9: maplat-asset:<UID> をプレビュー用パスに解決
          mapPois = await Promise.all(
            mapPois.map((poi: unknown) => resolveAssetRefsInFcForPreview(poi, token, this.resolveAssetPath)),
          );
        }
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
          pois: mapPois,
        }));
        const composed = composeViewerSource(source, {
          settingFilePrefix: 'maps/',
          lang: documentLang,
          maplatMapID: viewerMapID,
        }) as Record<string, unknown>;
        composed.thumbnail = thumbnail;
        return { source, viewerMapID, composed };
      }
      // builtin → 素の文字列 / tms → Editor専用キー除去済みオブジェクト
      return { source, viewerMapID: source.mapUid, composed: composeViewerSource(source, { lang: documentLang }) };
    }));
    // startFromはViewer向けmapIDで渡す。document.startFromはuid(新形)/slug(旧形)のどちらもあり得る
    const startEntry =
      entries.find((entry) => entry.source.startFrom) ??
      entries.find((entry) =>
        entry.source.mapUid === document.startFrom || entry.source.mapSlug === document.startFrom);
    // app 側 pois の {poiUid} 参照も同じ resolver で export 形 FC へ解決する
    const resolvedAppPois = await resolvePoisArray(appPoisRaw);
    mergeWarnings(warnings, resolvedAppPois.warnings);
    // M11-T9: app 側 pois の maplat-asset:<UID> もプレビュー用パスに解決する
    // (実装レビューv3: map 側のみ解決されており、POI選択タブで付けた app 直下 pois が未解決だった)
    const appPoisAssetResolved = await Promise.all(
      resolvedAppPois.pois.map((poi: unknown) => resolveAssetRefsInFcForPreview(poi, token, this.resolveAssetPath)),
    );
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
      startFrom: startEntry ? startEntry.viewerMapID : document.startFrom,
      sources: entries.map((entry) => entry.composed),
      pois: appPoisAssetResolved,
    }));
    return {
      token,
      app,
      maps,
      manifest: this.createManifest(document),
      viewerOption: this.createViewerOption(token, document, hasViewerBasemapSource(normalizedSources)),
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

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port || 0}`);
    const segments = requestUrl.pathname.split('/').filter(Boolean);
    // 配信は完全非同期で行い、失敗時も必ずレスポンスを閉じる(接続リーク防止)
    Promise.resolve()
      .then(() => {
        if (segments[0] === 'preview' && segments[1]) return this.handlePreview(segments[1], segments.slice(2), res);
        if (segments[0] === 'local-file') return this.serveLocalFile('/' + segments.slice(1).join('/'), res);
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
  <script src="assets/ol.js"></script>
  <script src="assets/maplat_ui.umd.js"></script>
  <script>
    const option = ${JSON.stringify(session.viewerOption)};
    const MaplatPreview = window.MaplatUi && window.MaplatUi.createObject
      ? window.MaplatUi
      : window.MaplatUi && window.MaplatUi.MaplatUi
        ? window.MaplatUi.MaplatUi
        : window.Maplat;
    MaplatPreview.createObject(option).catch((e) => {
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
      mapboxToken: httpSettings.mapboxToken || undefined,
      googleApiKey: httpSettings.googleApiKey || undefined,
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
    const resolved = path.resolve(decoded);
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

  private toHttpAsset<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => this.toHttpAsset(item)) as T;
    if (!value || typeof value !== 'object') return this.toHttpUrl(value) as T;
    return Object.entries(value as Record<string, any>).reduce((acc, [key, item]) => {
      acc[key] = this.toHttpAsset(item);
      return acc;
    }, {} as Record<string, any>) as T;
  }

  private toHttpUrl(value: any): any {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('file://')) return value;
    const pathname = encodeURI(fileURLToPath(value).split(path.sep).join('/'))
      .replace(/%7B/g, '{')
      .replace(/%7D/g, '}');
    return `http://127.0.0.1:${this.port}/local-file${pathname}`;
  }
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
