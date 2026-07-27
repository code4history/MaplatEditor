import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { app, dialog, type BrowserWindow } from 'electron';
import { Jimp } from 'jimp';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import MapPurposeService from './MapPurposeService';
import { ProgressReporter } from '../utils/ProgressReporter';
import { resolveResourceAsset } from '../utils/resourceAssets';
import { packIco } from '../utils/icoPack';
import {
  collectPoiUids,
  hasSharedPoiUid,
  mergeIconFiles,
  mergeWarnings,
  resolvePoisArray,
  resolveAssetRefsForExport,
  DUPLICATE_POI_REFERENCE_WARNING,
  type IconFile,
} from './poiReferenceResolver';
import {
  compactLangObject,
  composeViewerSource,
  extractTmsThumbnailBaseMapRef,
  hasViewerBasemapSource,
  normalizeAppSource,
  type AppSource,
} from '../../src/utils/appSourceModel';
import { compactMapLangFields, localizeTitle } from '../../src/utils/langResource';
import { resolveAppLocalizedMetadata } from '../../src/utils/appLocalizedMetadata';
import { readAppDocumentPois } from '../../src/utils/appPoisFormat';

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

// 実コピー/zip 追加用: dir を基準にした相対パスの一覧を返す
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
  // Success 時はユーザーが選んだ zip ファイルのパス (Phase 8 Task 6 で zip 出力へ統一)
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

    // M13-T1 (§2.7): pre-dialog revalidation。strict_error / missing map を含む maplat 参照は
    // dialog を開く前に拒否する (AC-T1-2)
    try {
      await MapPurposeService.assertViewerRuntimeAllowed(
        MapPurposeService.collectMaplatMapRefs(document), 'app-export'
      );
    } catch (e: any) {
      return { result: 'Error', warnings, message: e?.message || 'appedit.preview.strict_error' };
    }

    // 地図ダウンロード(mapedit:download)と同じ流儀で zip 保存先を選ぶ (Phase 8 Task 6)。
    // 上書き確認は showSaveDialog のネイティブ確認に任せる(旧フォルダ出力の独自確認は廃止)
    const picked = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `${appID}.zip`),
      filters: [{ name: 'Output file', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePath) return { result: 'Canceled', warnings };
    const zipFilePath = picked.filePath;

    // パッケージは一時ディレクトリに構成し、zip 化して保存先へ書き出したら finally で必ず削除する
    await fs.ensureDir(app.getPath('temp'));
    const outDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'maplat-app-export-'));
    // zip は一旦 staging 領域(outDir と同じ temp 配下)へ書き、成功後にユーザー選択先へ move する
    // (mapedit:download と同方式)。途中失敗時はユーザーの選択先に何も残らない
    const tmpZipPath = `${outDir}.zip`;

    const sources: AppSource[] = (document.sources || [])
      .map((raw: any) => normalizeAppSource(raw, document.lang || 'ja'));
    const maplatSources = sources.filter(source => source.sourceType === 'maplat');

    // catch 節でエラー時の進捗モーダル片付け(MINOR-3)に使うため try の外で宣言する
    let reporter: ProgressReporter | undefined;

    try {
      // M13-T1 (§2.7): post-dialog revalidation。dialog 待ち中の strict flip / delete を
      // pre-dialog の古い判定のまま通さないよう再判定する (AC-T1-3)。outDir/tmpZipPath は
      // 失敗時も finally で確実に削除される
      await MapPurposeService.assertViewerRuntimeAllowed(
        MapPurposeService.collectMaplatMapRefs(document), 'app-export'
      );

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
      //       + zip 追加単位(=パッケージ内全ファイル数)。zip 単位はパッケージ完成まで確定しないため、
      //       支配的なタイル数で見積もっておき、確定後に extendTotal で補正する (Phase 8 Task 6)
      // minPercentDelta:0 でタイルコピー中も1%刻みで送信されるようにする(呼び出し側で200ms/100件throttle済み)
      reporter = new ProgressReporter(
        'app:taskProgress',
        totalTileFiles * 2 + maplatSources.length + 4,
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
        const thumbnailRef = extractTmsThumbnailBaseMapRef(source);
        if (!thumbnailRef) continue;
        const baseMap = await SqliteDataService.findBaseMapByUid(thumbnailRef.uid);
        if (!baseMap) continue;
        const outRel = `tmbs/${baseMap.slug}.${thumbnailRef.ext}`;
        thumbnailCopies.set(outRel, thumbnailRef.thumbnail);
        source.data!.thumbnail = outRel;
      }

      // POI icon 参照解決 (POI-117) の実体コピー要求。app/map の全解決結果を dest キーで畳んで
      // 最後に outDir/imgs/... へまとめてコピーする
      const iconFiles = new Map<string, IconFile>();

      // 1) apps/{appID}.json (pois の {poiUid} 参照は export 形 FC へ解決される、Phase 7)
      const appJson = await this.composeAppJson(document, sources, viewerMapID, warnings, iconFiles);
      await fs.outputJson(path.join(outDir, 'apps', `${appID}.json`), appJson, { spaces: 4 });

      // 二重参照検出 (POI-142): app pois の {poiUid} 集合 × 各 map pois の集合の積が非空なら警告1回
      const appPoiUids = collectPoiUids(readAppDocumentPois(document).pois);
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
          // M11-T9: maplat-asset:<UID> をエクスポート用パスに解決 + Asset実体収集
          const assetRefResults = await Promise.all(
            resolved.pois.map((poi: unknown) => resolveAssetRefsForExport(poi, iconFiles)),
          );
          for (const r of assetRefResults) {
            mergeWarnings(warnings, r.warnings);
          }
          (mapJson as any).pois = assetRefResults.map((r) => r.entry);
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
        // M12-T15 (G): 512px サムネイルも package に同梱する（tmbs/{uid}_512.jpg → tmbs/{slug}_512.jpg）
        const thumb512 = path.join(this.saveFolder, 'tmbs', `${mapDoc.uid}_512.jpg`);
        if (fs.existsSync(thumb512)) {
          await fs.copy(thumb512, path.join(outDir, 'tmbs', `${slug}_512.jpg`));
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
          // M12-T15 (G): ユーザー basemap の 512px も同梱する（tmbs/{mapID}_512.png → 同じ相対パス）
          const thumbnail512 = thumbnail.replace(/^(tmbs\/.+?)\.([a-z]+)$/i, '$1_512.$2');
          if (thumbnail512 !== thumbnail && thumbnail512.startsWith('tmbs/')) {
            const from512 = path.join(this.saveFolder, thumbnail512);
            if (fs.existsSync(from512)) {
              await fs.copy(from512, path.join(outDir, thumbnail512));
            }
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

      // 6) PWAアイコン/スプラッシュ生成 + manifest (pwaManifest 有効時)。favicon.ico は常時生成する。
      //    アイコン元画像 (manifestSettings.iconSource) 未指定時は同梱のデフォルト SVG (Maplat ロゴ)
      //    へフォールバックするため、デフォルト経路でも manifest の icons は空にならない
      let htmlMeta: Record<string, string> = {};
      if (document.httpSettings?.pwaManifest) {
        const generated = await this.generatePwaAssets(outDir, appID, document, warnings);
        htmlMeta = generated.htmlMeta;
        const manifest = this.composeManifest(document, appID, generated.icons);
        await fs.outputJson(path.join(outDir, 'pwa', `${appID}_manifest.json`), manifest, { spaces: 2 });
      }
      await this.writeFaviconIco(outDir, appID, document);
      progressState.step++;
      reporter.update(progressState.step);

      // 7) index.html
      await fs.outputFile(
        path.join(outDir, 'index.html'),
        this.renderIndexHtml(document, appID, htmlMeta, hasViewerBasemapSource(sources)),
      );
      progressState.step++;
      reporter.update(progressState.step);

      // 8) 一時パッケージを zip 化して保存先へ書き出す (Phase 8 Task 6)。
      //    addLocalFolder 一括ではバーが止まるため、ファイル単位で zip へ追加しながら
      //    タイルコピーと同じ 200ms/100件 throttle で進捗を報告する
      const packageFiles = await listTileFiles(outDir);
      // extendTotal 後の確定total(以後 finalTotal)を自前計算しておく: 100%到達を
      // writeZip+move完了後まで遅らせる(MINOR-1)ための上限値として使う
      const initialTotal = totalTileFiles * 2 + maplatSources.length + 4;
      reporter.extendTotal(packageFiles.length - totalTileFiles);
      const finalTotal = initialTotal + (packageFiles.length - totalTileFiles);
      const zip = new AdmZip();
      let zipped = 0;
      let sinceLastReport = 0;
      let lastReportTime = 0;
      for (const rel of packageFiles) {
        const zipDir = path
          .dirname(rel)
          .split(path.sep)
          .filter(segment => segment && segment !== '.')
          .join('/');
        zip.addLocalFile(path.join(outDir, rel), zipDir, path.basename(rel));
        zipped++;
        sinceLastReport++;
        progressState.step++;
        // イベントループ解放 (MAJOR-2): addLocalFile は同期読込のため、大量ファイルで
        // メインプロセスが固まらないよう50ファイルごとに1マクロタスク分だけ他イベントへ譲る
        if (zipped % 50 === 0) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        const now = Date.now();
        if (now - lastReportTime >= 200 || sinceLastReport >= 100 || zipped === packageFiles.length) {
          lastReportTime = now;
          sinceLastReport = 0;
          // 100%はwriteZip(とmove)完了後にのみ到達させる(MINOR-1)。ここでは finalTotal-1 を
          // 上限にし、addLocalFile 完了だけで完了文言(endMsg)が出てしまうのを防ぐ
          reporter.update(
            Math.min(progressState.step, finalTotal - 1),
            `(${zipped}/${packageFiles.length})`,
            'appedit.export.zipping',
          );
        }
      }
      // ユーザー指定パスへ直接ではなく staging 領域(outDir と同じ temp 配下)の zip パスへ書き、
      // 成功後に move する(MINOR-2、mapedit:download と同方式)。途中失敗時はユーザーの選択先に
      // 何も残らない。adm-zip 0.5.17 は writeZipPromise(内部で toAsyncBuffer)を持つため使用する
      await zip.writeZipPromise(tmpZipPath);
      await fs.move(tmpZipPath, zipFilePath, { overwrite: true });

      // 100% / 完了文言(appedit.export.done)の送信は zip 書き出し・move が完了してから (MINOR-1)
      reporter.update(finalTotal);

      return { result: 'Success', outDir: zipFilePath, warnings };
    } catch (e: any) {
      console.error('[AppExportService] export failed', e);
      // 進捗モーダルが残留しないよう percent=100 を送って閉じられる状態にする。
      // 成功文言(endMsg)は出さずエラー専用テキストを表示する (MINOR-3)
      reporter?.fail('appedit.export.failed');
      return { result: 'Error', warnings, message: e?.message || String(e) };
    } finally {
      // 一時パッケージ・staging zip はキャンセル・失敗も含め必ず片付ける
      await fs.remove(outDir);
      await fs.remove(tmpZipPath);
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
    const pois = readAppDocumentPois(document).pois;
    if (Array.isArray(pois) && pois.length > 0) {
      const resolved = await resolvePoisArray(pois);
      mergeWarnings(warnings, resolved.warnings);
      mergeIconFiles(iconFiles, resolved.files);
      // M11-T9: app 側 pois の asset ref も解決
      const appAssetRefResults = await Promise.all(
        resolved.pois.map((poi: unknown) => resolveAssetRefsForExport(poi, iconFiles)),
      );
      for (const r of appAssetRefResults) {
        mergeWarnings(warnings, r.warnings);
      }
      if (appAssetRefResults.length > 0) out.pois = appAssetRefResults.map((r) => r.entry);
    }
    return out;
  }

  private composeManifest(document: any, appID: string, icons: any[]) {
    const manifest = document.manifestSettings || {};
    const localized = resolveAppLocalizedMetadata({ ...document, appID });
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
      name: localized.manifestName,
      short_name: localized.manifestShortName,
      background_color: manifest.backgroundColor || '#f6f0d3',
      theme_color: manifest.themeColor || '#f6f0d3',
      display: manifest.display || 'standalone',
      start_url: startUrl,
      scope,
      icons,
    };
  }

  // アイコン元画像 (generator/jimp への入力) の解決。manifestSettings.iconSource (saveFolder 相対)
  // が未指定または実体無しの場合は、アプリ同梱のデフォルト SVG (Maplat ロゴ、512x512 viewBox) に
  // フォールバックする。SVG は pwa-asset-generator が Puppeteer でラスタライズできるため直接渡す
  private resolveIconInput(document: any): string {
    const iconSourceRel = String(document.manifestSettings?.iconSource || '');
    const userIcon = iconSourceRel ? path.join(this.saveFolder, iconSourceRel) : '';
    if (userIcon && fs.existsSync(userIcon)) return userIcon;
    return resolveResourceAsset('pwa/appicon-default.svg') || '';
  }

  // pwa-asset-generatorでアイコン/スプラッシュ生成。Chrome不在などの失敗時はjimpで最低限のアイコンを生成
  private async generatePwaAssets(
    outDir: string,
    appID: string,
    document: any,
    warnings: string[],
  ): Promise<{ icons: any[]; htmlMeta: Record<string, string> }> {
    const iconSource = this.resolveIconInput(document);
    const splashName = String(document.appSettings?.splash || '');
    const splashSource = splashName ? path.join(this.saveFolder, 'img', splashName) : '';
    const backgroundColor = document.manifestSettings?.backgroundColor || '#f6f0d3';
    const pagDir = path.join(outDir, 'pwa', appID);

    if (!iconSource) {
      // 同梱デフォルトも解決できない場合のみ (通常起き得ない)
      warnings.push('appedit.export.no_icon_source');
      return { icons: [], htmlMeta: {} };
    }

    // raster 入力の解像度チェック: 長辺 512px 未満は生成アイコンが粗くなるため警告して続行。
    // SVG はベクタなのでチェック不要。読めない raster は generator/fallback 側の失敗処理に任せる
    if (!iconSource.toLowerCase().endsWith('.svg')) {
      try {
        const probe = await Jimp.read(iconSource);
        if (Math.max(probe.bitmap.width, probe.bitmap.height) < 512) {
          warnings.push('appedit.warn_icon_too_small');
        }
      } catch {
        /* noop */
      }
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

  // フォールバック: jimpで192/512アイコンのみ生成。
  // jimp は SVG をデコードできないため、SVG 入力 (デフォルト SVG 含む) は同梱のプリレンダ済み
  // デフォルト PNG (512x512) に差し替える
  private async generateFallbackIcons(
    iconSource: string,
    pagDir: string,
    appID: string,
  ): Promise<{ icons: any[]; htmlMeta: Record<string, string> }> {
    if (iconSource.toLowerCase().endsWith('.svg')) {
      iconSource = resolveResourceAsset('pwa/appicon-default.png') || iconSource;
    }
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

  // favicon.ico をパッケージルートへ生成する (pwaManifest 無効時も常時)。
  // 優先順: ① pwa-asset-generator 出力に .ico があればそれを配置 (8.1.5 時点では PNG のみで
  // 出力されないが、将来の対応に備える) → ② generator の favicon PNG (favicon-196.png) を
  // PNG-in-ICO (icoPack) で包む → ③ generator 未実行 (pwaManifest 無効) / 失敗時は jimp で
  // 196px PNG を作ってから包む。favicon 生成失敗はエクスポート全体を落とさない
  private async writeFaviconIco(outDir: string, appID: string, document: any) {
    const pagDir = path.join(outDir, 'pwa', appID);
    const icoPath = path.join(outDir, 'favicon.ico');
    try {
      if (fs.existsSync(pagDir)) {
        const entries = await fs.readdir(pagDir);
        const ico = entries.find(name => name.toLowerCase().endsWith('.ico'));
        if (ico) {
          await fs.copy(path.join(pagDir, ico), icoPath);
          return;
        }
        const faviconPng = entries.find(name => /^favicon.*\.png$/i.test(name));
        if (faviconPng) {
          const data = await fs.readFile(path.join(pagDir, faviconPng));
          // PNG IHDR (先頭16バイト目から width/height 各4バイト big-endian) から寸法を読む
          const width = data.readUInt32BE(16);
          const height = data.readUInt32BE(20);
          await fs.writeFile(icoPath, packIco([{ data, width, height }]));
          return;
        }
      }
      // jimp は SVG をデコードできないため、SVG 入力は同梱のプリレンダ済みデフォルト PNG に差し替える
      let input = this.resolveIconInput(document);
      if (input.toLowerCase().endsWith('.svg')) {
        input = resolveResourceAsset('pwa/appicon-default.png') || '';
      }
      if (!input || !fs.existsSync(input)) return;
      const image = await Jimp.read(input);
      image.resize({ w: 196, h: 196 });
      const data = Buffer.from(await image.getBuffer('image/png'));
      await fs.writeFile(icoPath, packIco([{ data, width: 196, height: 196 }]));
    } catch (e) {
      console.error('[AppExportService] favicon.ico generation failed', e);
    }
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
    const localized = resolveAppLocalizedMetadata({ ...document, appID });
    const title = escapeHtml(localized.appName);
    const description = escapeHtml(localizeTitle(document.description, lang) || '');
    const keywords = escapeHtml(localized.keywords.trim());
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
    // favicon.ico は writeFaviconIco が常時パッケージルートへ生成する。
    // generator 由来の PNG favicon リンク (htmlMeta.favicon) がある場合も併記する
    headLines.push(`  <link rel="icon" href="favicon.ico">`);
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
      // viewer のマーカー一覧 UI (ui_init.ts の appOption.enableMarkerList)。GUI 検証 D3
      enableMarkerList: Boolean(httpSettings.enableMarkerList),
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function joinUrl(base: string, rest: string): string {
  if (rest.startsWith('?')) return base.replace(/\/?$/, '/') + rest;
  return base.replace(/\/?$/, '/') + rest.replace(/^\.?\//, '');
}

export default new AppExportService();
