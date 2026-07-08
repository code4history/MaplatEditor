import fs from 'fs-extra';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { session } from 'electron';
import SettingsService from './SettingsService';
import MapEditService from './MapEditService';
import { normalizeRuntimeKeys } from './MaplatRuntimeKeys';
import { resolveResourceAsset } from '../utils/resourceAssets';
import { composeViewerSource, normalizeAppSource } from '../../src/utils/appSourceModel';

type PreviewSession = {
  token: string;
  app: any;
  maps: Record<string, any>;
  manifest: any;
  viewerOption: any;
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

  async prepare(document: any): Promise<{ url: string; port: number }> {
    await this.ensureServer(Number(document.httpSettings?.previewPort || 0) || undefined);
    await this.purgePreviewStorage();
    const token = `${sanitizeId(document.appID || 'preview')}-${Date.now().toString(36)}`;
    const previewSession = await this.createSession(token, document);
    this.sessions.set(token, previewSession);
    return { url: `http://127.0.0.1:${this.port}/preview/${token}/`, port: this.port! };
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
    const sources = await Promise.all((document.sources || []).map(async (raw: any) => {
      const source = normalizeAppSource(raw);
      if (source.sourceType === 'maplat') {
        const preview = await MapEditService.requestPreviewSource(source.mapID);
        const label = source.label || preview.title || source.mapID;
        // サムネイル実体はuidパス (ADR-0007)。preview serverの tmbs/ 経路で配信される
        const thumbnail = `tmbs/${preview.uid || source.mapID}.jpg`;
        maps[source.mapID] = this.toHttpAsset(normalizeRuntimeKeys({
          ...preview,
          mapID: source.mapID,
          maptype: 'maplat',
          label,
          title: preview.title || label,
          thumbnail,
          url: preview.url || preview.url_,
          pois: preview.pois,
        }));
        const composed = composeViewerSource(source, { settingFilePrefix: 'maps/', lang: documentLang }) as Record<string, unknown>;
        composed.thumbnail = thumbnail;
        return composed;
      }
      // builtin → 素の文字列 / tms → Editor専用キー除去済みオブジェクト
      return composeViewerSource(source, { lang: documentLang });
    }));
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
      startFrom: document.startFrom || document.sources?.find((source: any) => source.startFrom)?.mapID,
      sources,
      pois: normalizeJsonArray(document.pois || document.poiSources),
    }));
    return { token, app, maps, manifest: this.createManifest(document), viewerOption: this.createViewerOption(token, document) };
  }

  private createManifest(document: any) {
    const manifest = document.manifestSettings || {};
    const appName = localize(document.appName || document.title, document.lang || 'ja') || document.appID || 'Maplat';
    return {
      name: manifest.name || appName,
      short_name: manifest.shortName || appName,
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
    if (rest[0] === 'basemap_icons') return this.serveResourceAsset(rest, res);
    if (rest[0] === 'apps' && rest[1] === `${token}.json`) return this.sendJson(res, session.app);
    if (rest[0] === 'maps' && rest[1]) return this.sendJson(res, session.maps[rest[1].replace(/\.json$/, '')] || {});
    if (rest[0] === 'pwa' && rest[1] === `${token}_manifest.json`) return this.sendJson(res, session.manifest);
    if (rest[0] === 'assets') return this.servePackageAsset(rest.slice(1).join('/'), res);
    this.sendText(res, 404, 'Not Found');
  }

  private renderHtml(session: PreviewSession) {
    const { token, app } = session;
    const title = escapeHtml(localize(app.title || app.appName || app.app_name, app.lang) || token);
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

  private createViewerOption(token: string, document: any) {
    const httpSettings = document.httpSettings || {};
    return {
      appid: token,
      div: 'map_div',
      pwaManifest: Boolean(httpSettings.pwaManifest),
      restoreSession: false,
      overlay: Boolean(httpSettings.overlay),
      enableHideMarker: Boolean(httpSettings.enableHideMarker),
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
    if (!resolved.startsWith(baseFolder)) return this.sendText(res, 403, 'Forbidden');
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
    if (!resolved.startsWith(path.resolve(saveFolder))) return this.sendText(res, 403, 'Forbidden');
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

function localize(value: any, lang = 'ja') {
  if (typeof value === 'string') return value;
  return value?.[lang] || value?.ja || value?.en || Object.values(value || {})[0] || '';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function findExistingPath(candidates: string[]) {
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function normalizeJsonArray(value: any) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default new AppPreviewService();
