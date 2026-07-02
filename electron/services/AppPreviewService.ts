import fs from 'fs-extra';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import SettingsService from './SettingsService';
import MapEditService from './MapEditService';
import { normalizeRuntimeKeys } from './MaplatRuntimeKeys';

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
    const token = `${sanitizeId(document.appID || 'preview')}-${Date.now().toString(36)}`;
    const session = await this.createSession(token, document);
    this.sessions.set(token, session);
    return { url: `http://127.0.0.1:${this.port}/preview/${token}/`, port: this.port! };
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
    const sources = await Promise.all((document.sources || []).map(async (source: any) => {
      const data = { ...(source.data || source) };
      data.mapID = source.mapID;
      if (source.sourceType === 'maplat' || data.maptype === 'maplat') {
        const preview = await MapEditService.requestPreviewSource(source.mapID);
        const label = source.label || source.title || data.label || data.title || source.mapID;
        const thumbnail = source.thumbnail || data.thumbnail || preview.thumbnail || 'Maplat.png';
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
        return {
          mapID: source.mapID,
          maptype: 'maplat',
          settingFile: `maps/${source.mapID}.json`,
          label,
          title: label,
          thumbnail: this.toHttpUrl(thumbnail),
        };
      }
      const role = source.role || (data.maptype === 'overlay' ? 'overlay' : 'base');
      return this.toHttpAsset(normalizeRuntimeKeys({
        ...data,
        mapID: source.mapID,
        maptype: role === 'overlay' ? 'overlay' : (data.maptype || 'base'),
        label: data.label || source.title || source.mapID,
        title: data.title || source.title || source.mapID,
        thumbnail: data.thumbnail || source.thumbnail || (role === 'overlay' ? 'overlay.png' : 'basemap.png'),
      }));
    }));
    const app = this.toHttpAsset(normalizeRuntimeKeys({
      appName: document.appName || document.title,
      title: document.title || document.appName,
      description: document.description,
      lang: document.lang || 'ja',
      splash: document.appSettings?.splash || document.splash || '',
      fakeGps: Boolean(document.appSettings?.fakeGps),
      fakeCenter: document.appSettings?.fakeCenter || '',
      fakeRadius: Number(document.appSettings?.fakeRadius || 0),
      homePosition: [
        Number(document.appSettings?.homeLng || 139.767),
        Number(document.appSettings?.homeLat || 35.681),
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
    try {
      if (segments[0] === 'preview' && segments[1]) return this.handlePreview(segments[1], segments.slice(2), res);
      if (segments[0] === 'local-file') return this.serveLocalFile('/' + segments.slice(1).join('/'), res);
      this.sendText(res, 404, 'Not Found');
    } catch (e) {
      console.error('[AppPreviewService] request failed', e);
      this.sendText(res, 500, 'Internal Server Error');
    }
  }

  private handlePreview(token: string, rest: string[], res: http.ServerResponse) {
    const session = this.sessions.get(token);
    if (!session) return this.sendText(res, 404, 'Preview session not found');
    if (rest.length === 0) return this.sendHtml(res, this.renderHtml(session));
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

  private servePackageAsset(assetPath: string, res: http.ServerResponse) {
    const candidates = [
      path.join(uiPackageRoot, 'dist', assetPath),
      path.join(uiPackageRoot, 'assets', assetPath),
      assetPath === 'ol.js' ? path.join(olPackageRoot, 'dist', 'ol.js') : '',
    ];
    const filePath = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!filePath) return this.sendText(res, 404, 'Asset not found');
    this.sendFile(res, filePath);
  }

  private serveLocalFile(filePath: string, res: http.ServerResponse) {
    const decoded = decodeURIComponent(filePath);
    const saveFolder = SettingsService.get('saveFolder') as string;
    const resolved = path.resolve(decoded);
    if (!resolved.startsWith(path.resolve(saveFolder))) return this.sendText(res, 403, 'Forbidden');
    this.sendFile(res, resolved);
  }

  private sendFile(res: http.ServerResponse, filePath: string) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return this.sendText(res, 404, 'File not found');
    res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
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
