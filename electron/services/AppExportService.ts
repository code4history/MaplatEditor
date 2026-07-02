import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, type BrowserWindow } from 'electron';
import { Jimp } from 'jimp';
import SettingsService from './SettingsService';
import MapDataService from './MapDataService';
import { ProgressReporter } from '../utils/ProgressReporter';
import {
  compactLangObject,
  composeViewerSource,
  normalizeAppSource,
  type AppSource,
} from '../../src/utils/appSourceModel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..', '..');

function findExistingPath(candidates: string[]) {
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

const previewAssetRoot = findExistingPath([
  path.resolve(appRoot, 'public/preview'),
  path.resolve(appRoot, 'dist/preview'),
  path.resolve(__dirname, '..', 'public/preview'),
  path.resolve(__dirname, '..', 'dist/preview'),
  path.resolve(__dirname, '..', 'preview'),
]);
const olPackageRoot = findExistingPath([
  path.resolve(appRoot, 'node_modules/ol'),
  path.resolve(__dirname, '..', 'node_modules/ol'),
]);

type ExportResult = {
  result: 'Success' | 'Canceled' | 'Error';
  outDir?: string;
  warnings: string[];
  message?: string;
};

class AppExportService {
  private get saveFolder(): string {
    return SettingsService.get('saveFolder') as string;
  }

  async exportApp(win: BrowserWindow, document: any): Promise<ExportResult> {
    const warnings: string[] = [];
    const appID = String(document?.appID || '').trim();
    if (!appID) return { result: 'Error', warnings, message: 'appedit.no_appid' };

    const picked = await dialog.showOpenDialog(win, {
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { result: 'Canceled', warnings };
    const outDir = path.join(picked.filePaths[0], appID);

    if (fs.existsSync(outDir) && (await fs.readdir(outDir)).length > 0) {
      const answer = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: `${outDir}`,
        detail: 'Existing contents will be overwritten.',
      });
      if (answer.response !== 0) return { result: 'Canceled', warnings };
      await fs.emptyDir(outDir);
    }

    const sources: AppSource[] = (document.sources || []).map((raw: any) => normalizeAppSource(raw));
    const maplatSources = sources.filter(source => source.sourceType === 'maplat');
    // 進捗: 地図ごとのコピー + 固定ステップ(アセット/PWA/HTML)
    const reporter = new ProgressReporter('app:taskProgress', maplatSources.length + 4, 'appedit.export.progress', 'appedit.export.done');
    reporter.setWindow(win);
    let step = 0;
    reporter.update(step);

    try {
      // 1) apps/{appID}.json
      const appJson = this.composeAppJson(document, sources);
      await fs.outputJson(path.join(outDir, 'apps', `${appID}.json`), appJson, { spaces: 4 });

      // 2) Maplat地図: maps/{mapID}.json + tiles + tmbs
      const db = await MapDataService.getDBInstance();
      for (const source of maplatSources) {
        const mapDoc = await db.findOneAsync({ _id: source.mapID });
        if (!mapDoc) throw new Error(`Map not found: ${source.mapID}`);
        const mapJson = { ...mapDoc };
        delete (mapJson as any)._id;
        delete (mapJson as any).status;
        delete (mapJson as any).onlyOne;
        delete (mapJson as any).url_;
        await fs.outputJson(path.join(outDir, 'maps', `${source.mapID}.json`), mapJson, { spaces: 4 });

        const tileDir = path.join(this.saveFolder, 'tiles', source.mapID);
        if (fs.existsSync(tileDir)) {
          await fs.copy(tileDir, path.join(outDir, 'tiles', source.mapID));
        }
        const thumb = path.join(this.saveFolder, 'tmbs', `${source.mapID}.jpg`);
        if (fs.existsSync(thumb)) {
          await fs.copy(thumb, path.join(outDir, 'tmbs', `${source.mapID}.jpg`));
        }
        reporter.update(++step);
      }

      // 3) TMSソースのサムネイル(tmbs/{mapID}_menu.jpg)
      for (const source of sources) {
        if (source.sourceType !== 'tms') continue;
        const thumbnail = source.data?.thumbnail;
        if (typeof thumbnail === 'string' && thumbnail.startsWith('tmbs/')) {
          const from = path.join(this.saveFolder, thumbnail);
          if (fs.existsSync(from)) {
            await fs.copy(from, path.join(outDir, thumbnail));
          } else {
            warnings.push('appedit.export.missing_thumbnail');
          }
        }
      }

      // 4) スプラッシュ画像
      const splash = String(document.appSettings?.splash || '');
      if (splash) {
        const from = path.join(this.saveFolder, 'img', splash);
        if (fs.existsSync(from)) {
          await fs.copy(from, path.join(outDir, 'img', splash));
        } else {
          warnings.push('appedit.export.missing_splash');
        }
      }
      reporter.update(++step);

      // 5) Viewerアセット
      await this.copyViewerAssets(outDir, Boolean(document.httpSettings?.enableCache));
      reporter.update(++step);

      // 6) PWAアイコン/スプラッシュ生成 + manifest
      let htmlMeta: Record<string, string> = {};
      if (document.httpSettings?.pwaManifest) {
        const generated = await this.generatePwaAssets(outDir, appID, document, warnings);
        htmlMeta = generated.htmlMeta;
        const manifest = this.composeManifest(document, appID, generated.icons);
        await fs.outputJson(path.join(outDir, 'pwa', `${appID}_manifest.json`), manifest, { spaces: 2 });
      }
      reporter.update(++step);

      // 7) index.html
      await fs.outputFile(path.join(outDir, 'index.html'), this.renderIndexHtml(document, appID, htmlMeta));
      reporter.update(++step);

      return { result: 'Success', outDir, warnings };
    } catch (e: any) {
      console.error('[AppExportService] export failed', e);
      return { result: 'Error', warnings, message: e?.message || String(e) };
    }
  }

  // Viewer形式の正規アプリJSON（camelCase・ビルトイン=文字列）
  private composeAppJson(document: any, sources: AppSource[]) {
    const out: Record<string, unknown> = {
      appName: compactLangObject(document.appName || document.title),
      lang: document.lang || 'ja',
      sources: sources.map(source => composeViewerSource(source)),
    };
    const description = compactLangObject(document.description);
    if (description) out.description = description;
    const splash = String(document.appSettings?.splash || '');
    if (splash) out.splash = splash;
    if (document.appSettings?.fakeGps) {
      out.fakeGps = true;
      if (document.appSettings.fakeCenter) out.fakeCenter = document.appSettings.fakeCenter;
      if (document.appSettings.fakeRadius) out.fakeRadius = Number(document.appSettings.fakeRadius);
    }
    out.homePosition = [
      Number(document.appSettings?.homeLng ?? 139.767),
      Number(document.appSettings?.homeLat ?? 35.681),
    ];
    out.defaultZoom = Number(document.appSettings?.defaultZoom ?? 17);
    const startFrom = document.startFrom || sources.find(source => source.startFrom)?.mapID;
    if (startFrom) out.startFrom = startFrom;
    const pois = document.pois ?? parseJsonArray(document.poiSources);
    if (Array.isArray(pois) && pois.length > 0) out.pois = pois;
    return out;
  }

  private composeManifest(document: any, appID: string, icons: any[]) {
    const manifest = document.manifestSettings || {};
    const appName = localize(document.appName || document.title, document.lang || 'ja') || appID;
    const siteUrl = String(document.siteUrl || '').trim();
    let startUrl = manifest.startUrl || './';
    let scope = manifest.scope || './';
    if (siteUrl) {
      startUrl = siteUrl;
      try {
        scope = new URL(siteUrl).pathname || '/';
      } catch {
        scope = './';
      }
    }
    return {
      name: manifest.name || appName,
      short_name: manifest.shortName || appName,
      background_color: manifest.backgroundColor || '#f6f0d3',
      theme_color: manifest.themeColor || '#f6f0d3',
      display: manifest.display || 'standalone',
      start_url: startUrl,
      scope,
      icons,
    };
  }

  // pwa-asset-generatorでアイコン/スプラッシュ生成。Chrome不在などの失敗時はjimpで最低限のアイコンを生成
  private async generatePwaAssets(
    outDir: string,
    appID: string,
    document: any,
    warnings: string[],
  ): Promise<{ icons: any[]; htmlMeta: Record<string, string> }> {
    const iconSourceRel = String(document.manifestSettings?.iconSource || '');
    const iconSource = iconSourceRel ? path.join(this.saveFolder, iconSourceRel) : '';
    const splashName = String(document.appSettings?.splash || '');
    const splashSource = splashName ? path.join(this.saveFolder, 'img', splashName) : '';
    const backgroundColor = document.manifestSettings?.backgroundColor || '#f6f0d3';
    const pagDir = path.join(outDir, 'pwa', appID);

    if (!iconSource || !fs.existsSync(iconSource)) {
      warnings.push('appedit.export.no_icon_source');
      return { icons: [], htmlMeta: {} };
    }

    try {
      const { generateImages } = await import('pwa-asset-generator');
      const common = {
        log: false,
        pathOverride: `pwa/${appID}`,
        background: backgroundColor,
        type: 'png' as const,
      };
      const iconResult = await generateImages(iconSource, pagDir, {
        ...common,
        iconOnly: true,
        favicon: true,
        mstile: true,
        maskable: true,
        opaque: false,
      });
      const splashInput = splashSource && fs.existsSync(splashSource) ? splashSource : iconSource;
      const splashResult = await generateImages(splashInput, pagDir, {
        ...common,
        splashOnly: true,
      });
      return {
        icons: iconResult.manifestJsonContent || [],
        htmlMeta: { ...(splashResult.htmlMeta || {}), ...(iconResult.htmlMeta || {}) },
      };
    } catch (e) {
      console.error('[AppExportService] pwa-asset-generator failed', e);
      warnings.push('appedit.export.pwa_fallback');
      return await this.generateFallbackIcons(iconSource, pagDir, appID);
    }
  }

  // フォールバック: jimpで192/512アイコンのみ生成
  private async generateFallbackIcons(
    iconSource: string,
    pagDir: string,
    appID: string,
  ): Promise<{ icons: any[]; htmlMeta: Record<string, string> }> {
    await fs.ensureDir(pagDir);
    const icons: any[] = [];
    for (const size of [192, 512]) {
      const image = await Jimp.read(iconSource);
      image.resize({ w: size, h: size });
      const fileName = `manifest-icon-${size}.png`;
      await image.write(path.join(pagDir, fileName) as `${string}.${string}`);
      icons.push({
        src: `pwa/${appID}/${fileName}`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'maskable any',
      });
    }
    const htmlMeta = {
      favicon: `<link rel="icon" type="image/png" sizes="192x192" href="pwa/${appID}/manifest-icon-192.png">`,
      appleTouchIcon: `<link rel="apple-touch-icon" href="pwa/${appID}/manifest-icon-192.png">`,
    };
    return { icons, htmlMeta };
  }

  private async copyViewerAssets(outDir: string, enableCache: boolean) {
    const assetsDir = path.join(outDir, 'assets');
    await fs.ensureDir(assetsDir);
    const entries = await fs.readdir(previewAssetRoot);
    for (const entry of entries) {
      if (entry === 'service-worker.js') continue;
      if (entry === 'assets') {
        // public/preview/assets/* (locales等) はViewerが assets/ 直下として参照する
        const subEntries = await fs.readdir(path.join(previewAssetRoot, entry));
        for (const subEntry of subEntries) {
          await fs.copy(path.join(previewAssetRoot, entry, subEntry), path.join(assetsDir, subEntry));
        }
        continue;
      }
      await fs.copy(path.join(previewAssetRoot, entry), path.join(assetsDir, entry));
    }
    const olJs = path.join(olPackageRoot, 'dist', 'ol.js');
    if (fs.existsSync(olJs) && !fs.existsSync(path.join(assetsDir, 'ol.js'))) {
      await fs.copy(olJs, path.join(assetsDir, 'ol.js'));
    }
    if (enableCache) {
      const serviceWorker = path.join(previewAssetRoot, 'service-worker.js');
      if (fs.existsSync(serviceWorker)) {
        await fs.copy(serviceWorker, path.join(outDir, 'service-worker.js'));
      }
    }
  }

  private renderIndexHtml(document: any, appID: string, htmlMeta: Record<string, string>): string {
    const lang = document.lang || 'ja';
    const title = escapeHtml(localize(document.appName || document.title, lang) || appID);
    const description = escapeHtml(localize(document.description, lang) || '');
    const keywords = escapeHtml(String(document.keywords || '').trim());
    const siteUrl = String(document.siteUrl || '').trim();
    const splash = String(document.appSettings?.splash || '');
    const pwaManifest = Boolean(document.httpSettings?.pwaManifest);
    const httpSettings = document.httpSettings || {};

    const headLines: string[] = [];
    if (description) {
      headLines.push(`  <meta name="description" content="${description}">`);
      headLines.push(`  <meta property="og:description" content="${description}">`);
    }
    if (keywords) headLines.push(`  <meta name="keywords" content="${keywords}">`);
    headLines.push(`  <meta property="og:title" content="${title}">`);
    headLines.push(`  <meta name="twitter:card" content="summary">`);
    if (splash) {
      const ogImage = siteUrl ? joinUrl(siteUrl, `img/${splash}`) : `img/${splash}`;
      headLines.push(`  <meta property="og:image" content="${escapeHtml(ogImage)}">`);
    }
    if (siteUrl) {
      const escaped = escapeHtml(siteUrl);
      headLines.push(`  <link rel="canonical" href="${escaped}">`);
      headLines.push(`  <meta property="og:url" content="${escaped}">`);
      headLines.push(`  <link rel="alternate" href="${escapeHtml(joinUrl(siteUrl, '?lang=ja'))}" hreflang="ja">`);
      headLines.push(`  <link rel="alternate" href="${escapeHtml(joinUrl(siteUrl, '?lang=en'))}" hreflang="en">`);
    }
    if (pwaManifest) {
      headLines.push(`  <link rel="manifest" href="pwa/${appID}_manifest.json">`);
      headLines.push(`  <meta name="apple-mobile-web-app-capable" content="yes">`);
    }
    // apple-mobile-web-app-capable は上で明示出力するためhtmlMetaからは除外
    for (const key of ['favicon', 'appleTouchIcon', 'msTileImage', 'appleLaunchImage', 'appleLaunchImageDarkMode'] as const) {
      if (htmlMeta[key]) {
        headLines.push(htmlMeta[key].split('\n').map(line => `  ${line.trim()}`).join('\n'));
      }
    }

    const viewerOption: Record<string, unknown> = {
      appid: appID,
      pwaManifest,
      overlay: Boolean(httpSettings.overlay),
      enableHideMarker: Boolean(httpSettings.enableHideMarker),
      enableBorder: Boolean(httpSettings.enableBorder),
      enableCache: Boolean(httpSettings.enableCache),
      stateUrl: Boolean(httpSettings.stateUrl),
      enableShare: Boolean(httpSettings.enableShare),
    };
    if (httpSettings.mapboxToken) viewerOption.mapboxToken = httpSettings.mapboxToken;
    if (httpSettings.googleApiKey) viewerOption.googleApiKey = httpSettings.googleApiKey;

    return `<!DOCTYPE html>
<html>

<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
${headLines.join('\n')}
  <link rel="stylesheet" href="assets/maplat_ui.css">
  <style>
    .mainview {
      position: absolute;
      top: 0px;
      bottom: 0px;
      left: 0px;
      right: 0px;
    }
  </style>
</head>

<body>
  <div class="mainview">
    <div id="map_div"></div>
  </div>

  <script src="assets/ol.js"></script>
  <script src="assets/maplat_ui.umd.js"></script>
  <script>
    var option = ${JSON.stringify(viewerOption, null, 2).replace(/\n/g, '\n    ')};
    var hashes = (window.location.href.split('#!'))[0];
    hashes = hashes.slice(window.location.href.indexOf('?') + 1).split('&');
    for (var i = 0; i < hashes.length; i++) {
      var hash = hashes[i].split('=');
      option[hash[0]] = hash[1] == 'true' ? true : hash[1] == 'false' ? false : hash[1];
    }
    var MaplatApp = window.MaplatUi && window.MaplatUi.createObject
      ? window.MaplatUi
      : window.MaplatUi && window.MaplatUi.MaplatUi
        ? window.MaplatUi.MaplatUi
        : window.Maplat;
    MaplatApp.createObject(option);
  </script>
</body>

</html>
`;
  }
}

function parseJsonArray(value: any): any[] {
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

function localize(value: any, lang = 'ja'): string {
  if (typeof value === 'string') return value;
  return value?.[lang] || value?.ja || value?.en || Object.values(value || {})[0] || '';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function joinUrl(base: string, rest: string): string {
  if (rest.startsWith('?')) return base.replace(/\/?$/, '/') + rest;
  return base.replace(/\/?$/, '/') + rest.replace(/^\.?\//, '');
}

export default new AppExportService();
