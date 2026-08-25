import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, type BrowserWindow } from 'electron';
import { Jimp } from 'jimp';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import MapPurposeService from './MapPurposeService';
import { ProgressReporter } from '../utils/ProgressReporter';
import { writeZipStreaming } from '../utils/zipWriter';
import { resolveResourceAsset } from '../utils/resourceAssets';
import { packIco } from '../utils/icoPack';
import {
  collectPoiUids,
  hasSharedPoiUid,
  mergeIconFiles,
  mergeWarnings,
  externalizePoisArray,
  externalizeMapDocumentPois,
  createPoiExternalizationContext,
  writePoiDocuments,
  DUPLICATE_POI_REFERENCE_WARNING,
  type IconFile,
  type PoiExternalizationContext,
} from './poiReferenceResolver';
import {
  compactLangObject,
  composeViewerSource,
  composeBaseMapSettingFile,
  createBaseMapMasterLookup,
  extractMercSourceRefs,
  resolveAppSource,
  hasViewerBasemapSource,
  normalizeAppSource,
  type AppSource,
  type BaseMapMasterLookup,
} from '../../src/utils/appSourceModel';
import { detectRequiredProviderGlFromAppSources, renderProviderGlCdnTags } from './providerGlCdn';
import { compactMapLangFields, localizeTitle } from '../../src/utils/langResource';
// m19-t2: 512px パスの派生は単一関数へ集約する（マイルストーン設計 v1.6 §4.3.2-3）
import { thumb512PathFor, thumb52PathFor } from '../../src/utils/thumbnailPaths';
import { resolveAppLocalizedMetadata } from '../../src/utils/appLocalizedMetadata';
import { readAppDocumentPois } from '../../src/utils/appPoisFormat';
import { requiresProviderKey } from '../../src/utils/baseMapEditorDocument';
import {
  resolvePublishKey,
  resolveStartFromViewerMapID,
  PROVIDER_KEY_MISSING_WARNING,
  BASE_MAP_MASTER_MISSING_WARNING,
  type ProviderKeyKind,
} from './providerKeyResolution';

/** m6-t6 (§3.2): オンザフライ入力（保存しない・呼び出し単位）*/
export type ProviderKeyOverride = {
  googleApiKey?: string;
  mapboxToken?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..', '..');

// m6-t8 §3.11: merc ソースの書き出しディレクトリ名衝突（同一名で異なる baseMapUid）の警告キー。
// 既存の appedit.warn_* 警告キー群（PROVIDER_KEY_MISSING_WARNING/DUPLICATE_POI_REFERENCE_WARNING 等）
// の命名規約に合わせる（設計書は appedit.errors.merc_name_collision としていたが、既存の appedit.errors.*
// 名前空間は存在せず、警告チャネルはすべて appedit.warn_* を使っているため、実装時にこの規約へ揃えた）。
// m6-t10 (AC9): maps/<slug>.json の出力パス衝突ガード。
// slug は asset_registry で kind 横断に UNIQUE（ADR-0007）なので、正常系では発火しない。
// 発火したら「ベースマップと Maplat 地図が同一 slug を主張している」＝ 不変条件の破れであり、
// 黙って上書きすると片方の地図がパッケージから消える。∴ warning ではなく throw する。
export function assertNoMapJsonCollision(written: ReadonlySet<string>, slug: string): void {
  if (!written.has(slug)) return;
  throw new Error(
    `maps/${slug}.json の出力が衝突しました（ベースマップと Maplat 地図が同一 slug を主張しています）`,
  );
}

export const MERC_NAME_COLLISION_WARNING = 'appedit.warn_merc_name_collision';

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

/**
 * asar の中からでも動くディレクトリ/ファイルのコピー。
 *
 * **`fs-extra` の `copy()` を asar 内のパスへ使ってはいけない。**
 * fs-extra 11 の `copyDir` は内部で `fs.opendir()` を呼ぶが（`lib/copy/copy.js:118`）、
 * **Electron の asar 対応は `opendir` を patch していない** ∴ ディレクトリでも
 * `ENOTDIR: not a directory, opendir '.../app.asar/dist/preview/assets/locales'`
 * で落ちる（2026-08-13・パッケージ済みアプリで実機発見）。
 *
 * `readdir` / `stat` / `readFile` は patch 済みなので、それだけで組み直す。
 * 開発時（asar でない）でも同じ経路を通るため、挙動が分岐しない。
 */
async function copyFromPackage(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);
  if (!stat.isDirectory()) {
    await fs.ensureDir(path.dirname(dest));
    // copyFile ではなく read → write。asar から読めることが保証されている経路を使う
    await fs.writeFile(dest, await fs.readFile(src));
    return;
  }
  await fs.ensureDir(dest);
  const entries = await fs.readdir(src);
  for (const entry of entries) {
    await copyFromPackage(path.join(src, entry), path.join(dest, entry));
  }
}

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

  async exportApp(win: BrowserWindow, document: any, overrideKeys?: ProviderKeyOverride): Promise<ExportResult> {
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

    // m6-t6 (§3.2): 鍵が2段（アプリ単位→設定ページ既定公開用）+ オンザフライでも解決できない
    // provider ソースは、この時点で除外する。sources は以後（maplatSources・composeAppJson・
    // サムネイルコピー・renderIndexHtml の overlay/CDN/startFrom）すべての起点になる単一の
    // const のため、ここ1箇所を差し替えるだけで全導出に反映される（R21・設計レビュー M4）
    // m6-t10 (§3.4): ベースマップマスタの解決器。プレビュー側と同一実装を共有する
    const baseMapLookup = createBaseMapMasterLookup(await SettingsService.listBaseMaps());
    const sources: AppSource[] = (document.sources || [])
      .map((raw: any) => normalizeAppSource(raw, document.lang || 'ja'))
      // m6-t10 (§3.6): マスタが引けないソースは除外して警告する（スナップショットを持たない
      // 設計の帰結。人間判断 2026-08-07）。kind をマスタから引くため provider 判定より先に行う
      .filter((source: AppSource) => {
        if (source.sourceType === 'maplat') return true;
        if (resolveAppSource(source, baseMapLookup).ok) return true;
        mergeWarnings(warnings, [BASE_MAP_MASTER_MISSING_WARNING]);
        return false;
      })
      .filter((source: AppSource) => {
        if (source.sourceType === 'maplat') return true;
        // m6-t10: kind は差分保持モデルではアプリ側に無いためマスタから引く
        const resolvedSource = resolveAppSource(source, baseMapLookup);
        const kind = (resolvedSource.ok ? resolvedSource.master.data.kind : undefined) as
          | ProviderKeyKind
          | undefined;
        if (!requiresProviderKey(kind)) return true;
        const resolvedKind = kind as ProviderKeyKind;
        const resolved =
          resolvePublishKey(resolvedKind, document.httpSettings, SettingsService) ??
          overrideKeys?.[resolvedKind === 'google' ? 'googleApiKey' : 'mapboxToken'];
        if (resolved) return true;
        mergeWarnings(warnings, [PROVIDER_KEY_MISSING_WARNING[resolvedKind]]);
        return false;
      });
    const maplatSources = sources.filter(source => source.sourceType === 'maplat');
    const baseMapSources = sources.filter(source => source.sourceType !== 'maplat');

    // m6-t8 §3.11: merc ソースの抽出（実装レビュー round3 M-5: AppPreviewService と共有する
    // 抽出関数へ一本化）。m6-t10: dirName はマスタの現在 slug（§3.5.4）。
    const mercEntries = extractMercSourceRefs(sources, baseMapLookup);
    // 名前衝突診断: 同一 dirName で異なる baseMapUid を持つエントリを検出 (AC8)
    const mercDirNameToUids = new Map<string, Set<string>>();
    for (const entry of mercEntries) {
      const set = mercDirNameToUids.get(entry.dirName) ?? new Set<string>();
      set.add(entry.baseMapUid);
      mercDirNameToUids.set(entry.dirName, set);
    }
    const conflictedMercDirNames = new Set(
      [...mercDirNameToUids.entries()].filter(([, uids]) => uids.size > 1).map(([name]) => name),
    );
    if (conflictedMercDirNames.size > 0) {
      mergeWarnings(warnings, [MERC_NAME_COLLISION_WARNING]);
    }
    // 衝突した dirName は最初の1件のみ実際にコピーする（後勝ちで無警告に上書きされないよう、
    // 進捗事前計上と実コピーの両方でこの決定済み配列を共有する）
    const mercCopiedDirNamesSeen = new Set<string>();
    const mercEntriesToCopy = mercEntries.filter((entry) => {
      if (conflictedMercDirNames.has(entry.dirName) && mercCopiedDirNamesSeen.has(entry.dirName)) return false;
      mercCopiedDirNamesSeen.add(entry.dirName);
      return true;
    });

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
      // m6-t8: merc タイル数も進捗の事前計上へ織り込む（名前衝突で実コピーされないエントリは除く）
      for (const entry of mercEntriesToCopy) {
        const mercDir = path.join(this.saveFolder, 'merc', entry.baseMapUid);
        totalTileFiles += fs.existsSync(mercDir) ? await countTileFiles(mercDir) : 0;
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

      // 0b) m6-t10 (ADR-0017): ベースマップの定義本体を maps/<slug>.json として組み立てる。
      //     アプリ JSON 側は参照＋上書き分のみになるため、サムネイル等のマスタ由来値は
      //     こちらに載る。∴ 出力パスの解決（uid名 → slug名。ADR-0007: viewer互換）も
      //     ここで設定ファイルに対して行う。
      const thumbnailCopies = new Map<string, string>(); // 出力相対パス → コピー元相対パス
      const baseMapSettingFiles = new Map<string, Record<string, unknown>>(); // slug → 設定ファイル
      for (const source of baseMapSources) {
        const resolvedSource = resolveAppSource(source, baseMapLookup);
        if (!resolvedSource.ok) continue; // 上の filter で除外済み（到達しない）
        const { master } = resolvedSource;
        const settingFile = composeBaseMapSettingFile(master, resolvedSource.source.role, {
          lang: document.lang || 'ja',
        });
        const thumbnail = settingFile.thumbnail;
        if (typeof thumbnail === 'string') {
          const match = thumbnail.match(/^tmbs\/([0-9a-f-]{36})\.([A-Za-z0-9]+)$/i);
          if (match) {
            const outRel = `tmbs/${master.mapID}.${match[2]}`;
            thumbnailCopies.set(outRel, thumbnail);
            settingFile.thumbnail = outRel;
          }
        }
        baseMapSettingFiles.set(master.mapID, settingFile);
      }

      // POI icon 参照解決 (POI-117) の実体コピー要求。app/map の全解決結果を dest キーで畳んで
      // 最後に outDir/imgs/... へまとめてコピーする
      const iconFiles = new Map<string, IconFile>();

      // POI の外部ファイル化 (M4-T2)。app JSON と map JSON をまたいで1つのコンテキストを共有し、
      // 同じ POI ソースを両方が参照しても pois/<name>.geojson は1ファイルへ畳む。
      // 処理順は app JSON → maps なので、同名衝突時の連番採番は「app が先に基底名を取る」で決定的
      const poiCtx = createPoiExternalizationContext();

      // 1) apps/{appID}.json (pois は pois/<name>.geojson への参照 + 上書き属性へ変換される、M4-T2)
      const appJson = await this.composeAppJson(document, sources, viewerMapID, warnings, iconFiles, poiCtx, baseMapLookup);
      // M5-T4B: pretty の字下げは **2-space**（2026-08-03 人間指示）。
      // 手編集用途のため pretty を保つが、幅は 4 ではなく 2 とする。
      // POI 単体パッケージの搬出（PoiPackageService:90,93）が既に 2-space であり、
      // アプリ搬出だけ 4-space だったのを揃える
      await fs.outputJson(path.join(outDir, 'apps', `${appID}.json`), appJson, { spaces: 2 });

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
        // M4-T4: 生の Array.isArray ではなく共通の readAppDocumentPois を通す。app 側 (:263,:510)
        // が既にこの関数で読んでいるのに map 側だけ生判定だったため、**単独形 (レイヤ1つを配列に
        // 包まず直接置く形) の地図では POI が export から丸ごと落ちていた**。実データ maps の
        // 3件がこの形であり、t4 で MapEdit が編集可能にした形でもある ∴ 同一扱いへ寄せる
        // (恒久指示「同一扱い処理は共通実装へ徹底」)。未対応形式は従来どおり空配列になるので、
        // その場合の挙動 (pois を触らない) も変わらない。
        // M5-T4B: 読み出しと外部化を **地図 ZIP 搬出と共有する唯一の実装** へ寄せる
        // (externalizeMapDocumentPois)。従来この4行は mapDownloadZip 側にも別々に書かれており、
        // map 側だけ Array.isArray の生判定だったため単独形の地図で POI が素通りしていた。
        // sourcePois は **外部化前** の読み出し結果で、下の二重参照検出に使う
        // (アプリ搬出固有の判定であり共通化の対象ではない)。
        const { sourcePois: mapPois, result: externalized } =
          await externalizeMapDocumentPois(mapJson as { pois?: unknown }, poiCtx);
        if (externalized) {
          // 二重参照の警告は externalized.warnings より **先** に積む (従来の順序を保つ)
          if (!duplicateReference && hasSharedPoiUid(collectPoiUids(mapPois), appPoiUids)) {
            duplicateReference = true;
            mergeWarnings(warnings, [DUPLICATE_POI_REFERENCE_WARNING]);
          }
          mergeWarnings(warnings, externalized.warnings);
          mergeIconFiles(iconFiles, externalized.files);
        }
        // M5-T4B: **地図 JSON は搬出種別を問わず minify** する（地図 ZIP と同じ扱い）。
        // 地図データは容量が大きくなりやすく、整形の空白がそのまま配布サイズに乗る。
        //
        // マイルストーン設計 I-5 は「アプリ JSON は pretty / **地図 ZIP の** maps/<slug>.json は
        // minify」と**パッケージ単位**で書かれていたため、アプリ ZIP に入る地図 JSON まで
        // pretty のままになっていた。人間の指示は m5-t4 再設計時から一貫して
        // 「地図 JSON は minify」という**内容種別単位**であり、こちらが正しい（2026-08-03 訂正）。
        // pretty のまま残すのは手編集用途の apps/<appID>.json と pois/*.geojson である。
        await fs.outputJson(path.join(outDir, 'maps', `${slug}.json`), mapJson);
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
        // M12-T15 (G): 512px サムネイルも package に同梱する（読み込みは uid キー、出力は slug 名）。
        // m19-t5: 両辺とも派生規約の単一モジュールから導く（stem は変わらず拡張子だけが従う。ADR-0007 整合）
        const src512 = thumb512PathFor(thumb52PathFor(mapDoc.uid, 'jpg'));
        const out512 = thumb512PathFor(thumb52PathFor(slug, 'jpg'));
        if (src512 && out512) {
          const thumb512 = path.join(this.saveFolder, src512);
          if (fs.existsSync(thumb512)) {
            await fs.copy(thumb512, path.join(outDir, out512));
          }
        }
      }

      // 2z) m6-t10 (ADR-0017): ベースマップの設定ファイルを maps/<slug>.json へ書き出す。
      //     slug は asset_registry で kind 横断に UNIQUE なので maplat 地図と衝突しないが、
      //     衝突すれば片方の地図が黙って消えるため、検出したら warning ではなく throw する（AC9）。
      //     地図 JSON と同じく minify（内容種別単位の規則。m5-t4b）。
      const writtenMapJsonSlugs = new Set(maplatSources.map(source => String(maplatDocs.get(source)?.slug ?? '')));
      for (const [slug, settingFile] of baseMapSettingFiles) {
        assertNoMapJsonCollision(writtenMapJsonSlugs, slug);
        writtenMapJsonSlugs.add(slug);
        await fs.outputJson(path.join(outDir, 'maps', `${slug}.json`), settingFile);
      }

      // 2a) merc ソース: merc/{baseMapUid} → merc/{dirName} へコピーし、tilejson.json の
      //     tiles[] をディレクトリ名入りへ差し替える (m6-t8 §3.11/§3.4・AC7/AC8)。
      //     衝突した dirName は mercEntriesToCopy の時点で最初の1件のみに絞り込み済み。
      for (const entry of mercEntriesToCopy) {
        const mercDir = path.join(this.saveFolder, 'merc', entry.baseMapUid);
        if (!fs.existsSync(mercDir)) continue; // タイル未生成(異常値)。既存tiles/tmbsと同型のsilent skip
        const mercOutDir = path.join(outDir, 'merc', entry.dirName);
        await copyTilesWithProgress(mercDir, mercOutDir, entry.dirName, reporter, progressState);
        const tileJsonSrc = path.join(mercDir, 'tilejson.json');
        if (fs.existsSync(tileJsonSrc)) {
          const tileJson = await fs.readJson(tileJsonSrc);
          tileJson.tiles = [`${entry.dirName}/{z}/{x}/{y}.png`];
          await fs.outputJson(path.join(mercOutDir, 'tilejson.json'), tileJson);
        }
      }

      // 2.5) pois/{name}.geojson — app / map から参照される POI 実体 (M4-T2)。
      //      app と map の双方の合成が終わってから一括で書き出す (同一ソースの二重参照は
      //      poiCtx で既に1エントリへ畳まれている)。
      //      M5-T4B: 書き出し（整形・境界検査）は地図 ZIP 搬出と共有する writePoiDocuments が担う。
      //      ここに直接書くと、同じ dest の同じ実体が経路によって別物になる
      await writePoiDocuments(outDir, poiCtx.documents.values());

      // 3) ベースマップのサムネイル
      //    tmbs/… はデータフォルダから、basemap_icons/… はアプリ同梱リソースからコピーする。
      //    uid名のアイコンはslug名の出力パスへ解決済み(thumbnailCopies)。
      //    m6-t10: 参照元が source.data から設定ファイル（maps/<slug>.json）へ移った。
      //    builtin も同じ経路を通る（文字列出力の廃止により設定ファイルを持つため）。
      for (const settingFile of baseMapSettingFiles.values()) {
        const thumbnail = settingFile.thumbnail;
        if (typeof thumbnail !== 'string') continue;
        if (thumbnail.startsWith('tmbs/')) {
          const from = path.join(this.saveFolder, thumbnailCopies.get(thumbnail) ?? thumbnail);
          if (fs.existsSync(from)) {
            await fs.copy(from, path.join(outDir, thumbnail));
          } else {
            warnings.push('appedit.export.missing_thumbnail');
          }
          // M12-T15 (G): ユーザー basemap の 512px も同梱する。
          // m19-t2 (ADR-0007 違反 B の是正): この時点の `thumbnail` は既に出力側（slug 名）へ
          // 差し替わっている。∴ コピー元を同じ値から導くと saveFolder 側を slug 名で読みに行き、
          // 実体（uid 名）に当たらず黙って同梱されなかった。52px（直上）が既に採っている
          // thumbnailCopies による uid 名への引き戻しと同型にし、出力先とコピー元を分離する。
          const out512 = thumb512PathFor(thumbnail);
          const src512 = thumb512PathFor(thumbnailCopies.get(thumbnail) ?? thumbnail);
          if (out512 && src512) {
            const from512 = path.join(this.saveFolder, src512);
            if (fs.existsSync(from512)) {
              await fs.copy(from512, path.join(outDir, out512));
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
        this.renderIndexHtml(document, appID, htmlMeta, hasViewerBasemapSource(sources), sources, overrideKeys, baseMapLookup),
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
      // t1 (§4.3): adm-zip の全メモリ方式（原本+圧縮後+連結後の 3 重保持。2.14 GiB で
      // Buffer.alloc が RangeError）を、Node 標準 zlib のみのストリーミング書き出しへ差し替える。
      // 進捗の刻み方・文言・finalTotal-1 上限・staging → move は従来のまま保つ
      let zipped = 0;
      let sinceLastReport = 0;
      let lastReportTime = 0;
      await writeZipStreaming(
        tmpZipPath,
        packageFiles.map(rel => ({
          // adm-zip addLocalFile(abs, zipDir, basename) と同値のエントリ名（§4.3.3 で実測同値）
          entryName: rel.split(path.sep).filter(segment => segment && segment !== '.').join('/'),
          localPath: path.join(outDir, rel),
        })),
        {
          onEntry: async () => {
            zipped++;
            sinceLastReport++;
            progressState.step++;
            // イベントループ解放 (MAJOR-2 踏襲): 50 ファイルごとに1マクロタスク分だけ他イベントへ譲る
            if (zipped % 50 === 0) await new Promise<void>(resolve => setImmediate(resolve));
            const now = Date.now();
            if (now - lastReportTime >= 200 || sinceLastReport >= 100 || zipped === packageFiles.length) {
              lastReportTime = now;
              sinceLastReport = 0;
              // 最終件の update は整数パーセントが進まず ProgressReporter の 1% throttle に
              // 落とされる(§1.3 の表示欠陥) ∴ 最終件に限り throttle を 1 回だけ無効化する(§4.5)
              if (zipped === packageFiles.length) reporter!.forceNext();
              // 100%はzip書き出し(とmove)完了後にのみ到達させる(MINOR-1)。ここでは finalTotal-1 を
              // 上限にし、zip 追加完了だけで完了文言(endMsg)が出てしまうのを防ぐ
              reporter!.update(
                Math.min(progressState.step, finalTotal - 1),
                `(${zipped}/${packageFiles.length})`,
                'appedit.export.zipping',
              );
            }
          },
        },
      );
      // ユーザー指定パスへ直接ではなく staging 領域(outDir と同じ temp 配下)の zip パスへ書き、
      // 成功後に move する(MINOR-2、mapedit:download と同方式)。途中失敗時はユーザーの選択先に
      // 何も残らない
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
  // pois は pois/<name>.geojson への参照 + 上書き属性へ変換し、警告 (missing 等) は warnings に
  // 合流する (M4-T2。poiCtx は map JSON 側と共有して外部ファイルを1つへ畳む)
  private async composeAppJson(
    document: any,
    sources: AppSource[],
    viewerMapID: (source: AppSource) => string,
    warnings: string[],
    iconFiles: Map<string, IconFile>,
    poiCtx: PoiExternalizationContext,
    baseMapLookup: BaseMapMasterLookup,
  ) {
    const lang = document.lang || 'ja';
    const out: Record<string, unknown> = {
      // 交換形: デフォルト言語のみの多言語フィールドはプレーン文字列に畳み込む (ADR-0005)
      appName: compactLangObject(document.appName || document.title, lang),
      lang,
      sources: sources.map(source =>
        composeViewerSource(source, { lang, maplatMapID: viewerMapID(source), lookup: baseMapLookup }),
      ),
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
    // のどちらもあり得るため、対応するソースを介して解決する。
    // m6-t6 (§3.2・M5): 3段照合を resolveStartFromViewerMapID へ共通化。除外されたソースは
    // sources に存在しないため3段目でも一致せず、除外ソースを指す startFrom は自動的に undefined
    // になる（document.startFrom への素通しはしない）
    const startFrom = resolveStartFromViewerMapID(
      sources.map(source => ({
        startFrom: Boolean(source.startFrom),
        mapUid: source.mapUid,
        mapSlug: source.mapSlug,
        viewerMapID: viewerMapID(source),
      })),
      document.startFrom,
    );
    if (startFrom) out.startFrom = startFrom;
    const pois = readAppDocumentPois(document).pois;
    if (Array.isArray(pois) && pois.length > 0) {
      // M4-T2: 外部ファイル化 (icon / asset ref の解決も externalizePoisArray が担う)
      const externalized = await externalizePoisArray(pois, poiCtx);
      mergeWarnings(warnings, externalized.warnings);
      mergeIconFiles(iconFiles, externalized.files);
      if (externalized.pois.length > 0) out.pois = externalized.pois;
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
          await copyFromPackage(path.join(previewAssetRoot, entry, subEntry), path.join(assetsDir, subEntry));
        }
        continue;
      }
      await copyFromPackage(path.join(previewAssetRoot, entry), path.join(assetsDir, entry));
    }
    const olJs = path.join(olPackageRoot, 'dist', 'ol.js');
    if (fs.existsSync(olJs) && !fs.existsSync(path.join(assetsDir, 'ol.js'))) {
      await copyFromPackage(olJs, path.join(assetsDir, 'ol.js'));
    }
    if (enableCache) {
      const serviceWorker = path.join(previewAssetRoot, 'service-worker.js');
      if (fs.existsSync(serviceWorker)) {
        await copyFromPackage(serviceWorker, path.join(outDir, 'service-worker.js'));
      }
    }
  }

  private renderIndexHtml(document: any, appID: string, htmlMeta: Record<string, string>, hasBasemap: boolean, sources: readonly AppSource[] = [], overrideKeys?: ProviderKeyOverride, baseMapLookup?: BaseMapMasterLookup): string {
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
    // m6-t6 (§3.2): アプリ単位キーの直読みをやめ、2段解決（アプリ単位→既定公開用）
    // + オンザフライ（overrideKeys、保存しない）へ
    const mapboxKey = resolvePublishKey('mapbox', httpSettings, SettingsService) ?? overrideKeys?.mapboxToken;
    const googleKey = resolvePublishKey('google', httpSettings, SettingsService) ?? overrideKeys?.googleApiKey;
    if (mapboxKey) viewerOption.mapboxToken = mapboxKey;
    if (googleKey) viewerOption.googleApiKey = googleKey;

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

${renderProviderGlCdnTags(detectRequiredProviderGlFromAppSources(sources, (source) => {
  if (!baseMapLookup) return null;
  const resolved = resolveAppSource(source, baseMapLookup);
  return resolved.ok ? resolved.master.data : null;
}))}  <script src="assets/ol.js"></script>
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
