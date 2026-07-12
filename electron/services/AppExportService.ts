import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, type BrowserWindow } from 'electron';
import { Jimp } from 'jimp';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import { ProgressReporter } from '../utils/ProgressReporter';
import { resolveResourceAsset } from '../utils/resourceAssets';
import {
  collectPoiUids,
  hasSharedPoiUid,
  mergeIconFiles,
  mergeWarnings,
  resolvePoisArray,
  DUPLICATE_POI_REFERENCE_WARNING,
  type IconFile,
} from './poiReferenceResolver';
import {
  compactLangObject,
  composeViewerSource,
  hasViewerBasemapSource,
  normalizeAppSource,
  type AppSource,
} from '../../src/utils/appSourceModel';
import { compactMapLangFields } from '../../src/utils/langResource';
import { normalizeJsonArray } from '../utils/jsonArray';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..', '..');

function findExistingPath(candidates: string[]) {
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

// タイル進捗の事前計上用: ファイル数のみを数える高速カウント(配列を積まない)
async function countTileFiles(dir: string): Promise<number> {
  let count = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        count++;
      }
    }
  }
  return count;
}

// 実コピー用: tileDir を基準にした相対パスの一覧を返す
async function listTileFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = rel ? path.join(dir, rel) : dir;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        result.push(childRel);
      }
    }
  }
  return result;
}

// tileDir 配下をファイル単位でコピーしつつ進捗を報告する(小バッチ並列)。
// throttle: 前回送信から200ms以上経過 or 100ファイル以上進んだ時のみ reporter.update を呼ぶ
// (reporter 自身も%変化/heartbeatで二重throttleする)
async function copyTilesWithProgress(
  tileDir: string,
  destDir: string,
  slug: string,
  reporter: ProgressReporter,
  progressState: { step: number },
): Promise<void> {
  const files = await listTileFiles(tileDir);
  const total = files.length;
  if (total === 0) return;
  const concurrency = 8;
  let done = 0;
  let sinceLastReport = 0;
  let lastReportTime = 0;
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map(rel => fs.copy(path.join(tileDir, rel), path.join(destDir, rel))),
    );
    done += batch.length;
    sinceLastReport += batch.length;
    progressState.step += batch.length;
    const now = Date.now();
    if (now - lastReportTime >= 200 || sinceLastReport >= 100 || done === total) {
      lastReportTime = now;
      sinceLastReport = 0;
      reporter.update(progressState.step, `${slug} (${done}/${total})`);
    }
  }
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

    try {
      // 0) maplatソースのuid参照を地図docへ解決 (ADR-0007)。旧保存形のslug参照も受容する。
      //    出力(maps/tiles/tmbs/アプリJSON内mapID)はすべてslug名で行う(viewer互換)
      const maplatDocs = new Map<AppSource, any>();
      for (const source of maplatSources) {
        const mapDoc = await SqliteDataService.findMapByRef(source.mapUid);
        if (!mapDoc) throw new Error(`Map not found: ${source.mapUid}`);
        maplatDocs.set(source, mapDoc);
      }
      const viewerMapID = (source: AppSource): string =>
        source.sourceType === 'maplat' ? String(maplatDocs.get(source)!.slug) : source.mapUid;

      // 0a) 進捗の事前計上: 全maplat地図の tiles/{uid} 配下のファイル数を数える。
      //     地図1枚のtilesコピー完了ごとにしか進まなかった旧実装の「バーが長時間0%のまま」
      //     問題を解消するため、タイル1ファイルごとに進むようtotalへ織り込む
      const tileFileCounts = new Map<AppSource, number>();
      let totalTileFiles = 0;
      for (const source of maplatSources) {
        const mapDoc = maplatDocs.get(source)!;
        const tileDir = path.join(this.saveFolder, 'tiles', mapDoc.uid);
        const count = fs.existsSync(tileDir) ? await countTileFiles(tileDir) : 0;
        tileFileCounts.set(source, count);
        totalTileFiles += count;
      }

      // 進捗: タイルファイル単位 + 地図ごとの残り作業(JSON書き出し/tmbコピー) + 固定ステップ(アセット/PWA/HTML)
      // minPercentDelta:0 でタイルコピー中も1%刻みで送信されるようにする(呼び出し側で200ms/100件throttle済み)
      const reporter = new ProgressReporter(
        'app:taskProgress',
        totalTileFiles + maplatSources.length + 4,
        'appedit.export.progress',
        'appedit.export.done',
        { minPercentDelta: 0 },
      );
      reporter.setWindow(win);
      const progressState = { step: 0 };
      reporter.update(progressState.step);

      // 0b) TMSソースのアイコン: 内部はuid名(tmbs/{uid}.png)だが、出力(アプリJSON内の
      //     thumbnailパスとコピー先ファイル名)はslug名に解決する (ADR-0007: viewer互換)。
      //     uidが解決できない場合(ベースマップ削除済み等)は保存値のまま出力する
      const thumbnailCopies = new Map<string, string>(); // 出力相対パス → コピー元相対パス
      for (const source of sources) {
        if (source.sourceType !== 'tms' || !source.data) continue;
        const thumbnail = source.data.thumbnail;
        if (typeof thumbnail !== 'string') continue;
        const match = thumbnail.match(/^tmbs\/([0-9a-f-]{36})\.([A-Za-z0-9]+)$/i);
        if (!match) continue;
        const baseMap = await SqliteDataService.findBaseMapByUid(match[1]);
        if (!baseMap) continue;
        const outRel = `tmbs/${baseMap.slug}.${match[2]}`;
        thumbnailCopies.set(outRel, thumbnail);
        source.data.thumbnail = outRel;
      }

      // POI icon 参照解決 (POI-117) の実体コピー要求。app/map の全解決結果を dest キーで畳んで
      // 最後に outDir/imgs/... へまとめてコピーする
      const iconFiles = new Map<string, IconFile>();

      // 1) apps/{appID}.json (pois の {poiUid} 参照は export 形 FC へ解決される、Phase 7)
      const appJson = await this.composeAppJson(document, sources, viewerMapID, warnings, iconFiles);
      await fs.outputJson(path.join(outDir, 'apps', `${appID}.json`), appJson, { spaces: 4 });

      // 二重参照検出 (POI-142): app pois の {poiUid} 集合 × 各 map pois の集合の積が非空なら警告1回
      const appPoiUids = collectPoiUids(normalizeJsonArray(document.pois || document.poiSources));
      let duplicateReference = false;

      // 2) Maplat地図: maps/{slug}.json + tiles + tmbs
      for (const source of maplatSources) {
        const mapDoc = maplatDocs.get(source)!;
        const slug = String(mapDoc.slug);
        // 交換形: デフォルト言語のみの言語別フィールドはプレーン文字列に畳み込む (ADR-0005)
        const mapJson = compactMapLangFields({ ...mapDoc });
        delete (mapJson as any)._id;
        delete (mapJson as any).status;
        delete (mapJson as any).onlyOne;
        delete (mapJson as any).url_;
        // 交換形にはv2の内部メタデータ(uid/slug/revision)を含めない (ADR-0007)
        delete (mapJson as any).uid;
        delete (mapJson as any).slug;
        delete (mapJson as any).revision;
        // map data_json の pois 内の {poiUid} 参照を export 形 FC へ解決 (生要素は透過、Phase 7)
        if (Array.isArray((mapJson as any).pois)) {
          if (!duplicateReference && hasSharedPoiUid(collectPoiUids((mapJson as any).pois), appPoiUids)) {
            duplicateReference = true;
            mergeWarnings(warnings, [DUPLICATE_POI_REFERENCE_WARNING]);
          }
          const resolved = await resolvePoisArray((mapJson as any).pois);
          mergeWarnings(warnings, resolved.warnings);
          mergeIconFiles(iconFiles, resolved.files);
          (mapJson as any).pois = resolved.pois;
        }
        await fs.outputJson(path.join(outDir, 'maps', `${slug}.json`), mapJson, { spaces: 4 });
        progressState.step++;
        reporter.update(progressState.step, `${slug} (0/${tileFileCounts.get(source) ?? 0})`);

        // 読み込みは内部のuidパス、出力はslug名 (ADR-0007: viewer互換)。
        // ファイル単位でコピーしつつ進捗を報告する(まとまった大きな地図でもバーが動き続ける)
        const tileDir = path.join(this.saveFolder, 'tiles', mapDoc.uid);
        if (fs.existsSync(tileDir)) {
          await copyTilesWithProgress(tileDir, path.join(outDir, 'tiles', slug), slug, reporter, progressState);
        }
        const thumb = path.join(this.saveFolder, 'tmbs', `${mapDoc.uid}.jpg`);
        if (fs.existsSync(thumb)) {
          await fs.copy(thumb, path.join(outDir, 'tmbs', `${slug}.jpg`));
        }
      }

      // 3) TMSソースのサムネイル
      //    tmbs/… はデータフォルダから、basemap_icons/… はアプリ同梱リソースからコピーする。
      //    uid名のアイコンはslug名の出力パスへ解決済み(thumbnailCopies)
      for (const source of sources) {
        if (source.sourceType !== 'tms') continue;
        const thumbnail = source.data?.thumbnail;
        if (typeof thumbnail !== 'string') continue;
        if (thumbnail.startsWith('tmbs/')) {
          const from = path.join(this.saveFolder, thumbnailCopies.get(thumbnail) ?? thumbnail);
          if (fs.existsSync(from)) {
            await fs.copy(from, path.join(outDir, thumbnail));
          } else {
            warnings.push('appedit.export.missing_thumbnail');
          }
        } else if (thumbnail.startsWith('basemap_icons/')) {
          const from = resolveResourceAsset(thumbnail);
          if (from) {
            await fs.copy(from, path.join(outDir, thumbnail));
          } else {
            warnings.push('appedit.export.missing_thumbnail');
          }
        }
      }

      // 3b) POI icon 実体 (POI-117): 解決済み参照が指す imgs/... へコピー。
      //     解決時 (resolveIconValue) に存在確認済みだが、レース等で消えていたら警告に落とす
      for (const file of iconFiles.values()) {
        if (fs.existsSync(file.src)) {
          await fs.copy(file.src, path.join(outDir, ...file.dest.split('/')));
        } else {
          mergeWarnings(warnings, ['appedit.warn_unresolved_icon']);
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
      progressState.step++;
      reporter.update(progressState.step);

      // 5) Viewerアセット
      await this.copyViewerAssets(outDir, Boolean(document.httpSettings?.enableCache));
      progressState.step++;
      reporter.update(progressState.step);

      // 6) PWAアイコン/スプラッシュ生成 + manifest
      let htmlMeta: Record<string, string> = {};
      if (document.httpSettings?.pwaManifest) {
        const generated = await this.generatePwaAssets(outDir, appID, document, warnings);
        htmlMeta = generated.htmlMeta;
        const manifest = this.composeManifest(document, appID, generated.icons);
        await fs.outputJson(path.join(outDir, 'pwa', `${appID}_manifest.json`), manifest, { spaces: 2 });
      }
      progressState.step++;
      reporter.update(progressState.step);

      // 7) index.html
      await fs.outputFile(
        path.join(outDir, 'index.html'),
        this.renderIndexHtml(document, appID, htmlMeta, hasViewerBasemapSource(sources)),
      );
      progressState.step++;
      reporter.update(progressState.step);

      return { result: 'Success', outDir, warnings };
    } catch (e: any) {
      console.error('[AppExportService] export failed', e);
      return { result: 'Error', warnings, message: e?.message || String(e) };
    }
  }

  // Viewer形式の正規アプリJSON（camelCase・ビルトイン=文字列）。
  // viewerMapID: ソースのViewer向けmapID解決(maplatはuid→slug) (ADR-0007)。
  // pois の {poiUid} 参照は export 形 FC へ解決し、警告 (missing 等) は warnings に合流する (Phase 7)
  private async composeAppJson(
    document: any,
    sources: AppSource[],
    viewerMapID: (source: AppSource) => string,
    warnings: string[],
    iconFiles: Map<string, IconFile>,
  ) {
    const lang = document.lang || 'ja';
    const out: Record<string, unknown> = {
      // 交換形: デフォルト言語のみの多言語フィールドはプレーン文字列に畳み込む (ADR-0005)
      appName: compactLangObject(document.appName || document.title, lang),
      lang,
      sources: sources.map(source => composeViewerSource(source, { lang, maplatMapID: viewerMapID(source) })),
    };
    const description = compactLangObject(document.description, lang);
    if (description) out.description = description;
    const splash = String(document.appSettings?.splash || '');
    if (splash) out.splash = splash;
    out.homePosition = [
      finiteOr(document.appSettings?.homeLng, 139.767),
      finiteOr(document.appSettings?.homeLat, 35.681),
    ];
    out.defaultZoom = Number(document.appSettings?.defaultZoom ?? 17);
    // startFromはViewer向けmapID(slug)で出力する。document.startFromはuid(新形)/slug(旧形)
    // のどちらもあり得るため、対応するソースを介して解決する
    const startSource =
      sources.find(source => source.startFrom) ??
      sources.find(source => source.mapUid === document.startFrom || source.mapSlug === document.startFrom);
    const startFrom = startSource ? viewerMapID(startSource) : document.startFrom;
    if (startFrom) out.startFrom = startFrom;
    const pois = normalizeJsonArray(document.pois || document.poiSources);
    if (Array.isArray(pois) && pois.length > 0) {
      const resolved = await resolvePoisArray(pois);
      mergeWarnings(warnings, resolved.warnings);
      mergeIconFiles(iconFiles, resolved.files);
      if (resolved.pois.length > 0) out.pois = resolved.pois;
    }
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

  private renderIndexHtml(document: any, appID: string, htmlMeta: Record<string, string>, hasBasemap: boolean): string {
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
      // @maplat/core の overlay=true は背景用 basemap が存在する前提。
      // maplat/overlay だけのエクスポートでは backTo が null になり初期化時に落ちるため抑止する。
      overlay: Boolean(httpSettings.overlay) && hasBasemap,
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

// null/空文字/非数はfallback(ホームポジション未設定時に使用)
function finiteOr(value: any, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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
