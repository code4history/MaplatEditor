import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import type { FeatureCollection } from 'geojson';
import { listIconSets } from '../../src/utils/iconRefs';
import {
  assertSafeArchiveEntries,
  assertPoiPayloadLimits,
  assertSafePoiPackageEntries,
  findPoiDocumentEntry,
  isPoiPayloadEntry,
  rewritePoiMediaReferences,
  type PoiPackageEntryInfo,
} from '../../src/utils/poiPackage';
import SqliteDataService from './SqliteDataService';
import SettingsService from './SettingsService';
import imageAssetService from './ImageAssetService';
import { resolvePoiFeatureCollection, type IconFile } from './poiReferenceResolver';

export type PoiExportInspection = {
  kind: 'geojson' | 'zip';
  slug: string;
  fc: FeatureCollection;
  files: IconFile[];
  warnings: string[];
};

// M5-T4 (I-4c): 補償に到達できなかった残留物。**kind で対象を区別する** —
// asset は「DB は消えたがバイト実体が live path に残る」という部分的な残留があり得るが
// (retainedPath)、poi_sources 行は DB のみのため残留の形が異なる。1つの型に混ぜると
// retainedPath が asset にしか意味を持たない曖昧なフィールドになる。
export type CompensationResidue =
  | { kind: 'asset'; assetUid: string; retainedPath?: string; dbError?: string }
  | { kind: 'poiSource'; poiSourceUid: string; slug?: string; dbError?: string };

/** 補償を最後まで試み、到達できなかったものを列挙して返す。**空配列 = 完全補償**。 */
export type PoiZipImportCleanup = () => Promise<CompensationResidue[]>;

export interface PoiZipImport {
  fc: FeatureCollection;
  createdAssetUids: string[];
  cleanup: PoiZipImportCleanup;
}

function safeSlug(value: unknown): string {
  return String(value ?? 'poi').replace(/[^A-Za-z0-9_-]+/g, '-') || 'poi';
}

function isSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  const mode = (Number(entry.header.attr) >>> 16) & 0o170000;
  return mode === 0o120000;
}

/**
 * M5-T4: AdmZip の entry を安全検証・容量検査の入力形へ変換する共通処理。
 *
 * 地図 ZIP 側（DataUploadService）も同じ変換を要するが、そこで組み直すと
 * **symlink 判定（上の isSymlinkEntry）が二重実装になる**。判定を1本に保つため
 * ここを唯一の変換点とする（恒久指示「同一扱い処理は共通実装へ徹底」）。
 */
export function zipEntryInfos(zip: AdmZip): PoiPackageEntryInfo[] {
  return zip.getEntries().map((entry) => ({
    name: entry.entryName,
    size: Number(entry.header.size),
    isSymlink: isSymlinkEntry(entry),
  }));
}

export async function inspectPoiExport(fc: FeatureCollection): Promise<PoiExportInspection> {
  const resolved = await resolvePoiFeatureCollection(fc);
  return {
    kind: resolved.files.length > 0 ? 'zip' : 'geojson',
    slug: safeSlug((fc as FeatureCollection & { id?: string | number }).id),
    fc: resolved.fc as FeatureCollection,
    files: resolved.files,
    warnings: resolved.warnings,
  };
}

export async function writePoiExport(inspection: PoiExportInspection, filePath: string): Promise<void> {
  const tempFolder = SettingsService.get('tmpFolder') as string;
  await fs.ensureDir(tempFolder);
  const tempPath = path.join(
    tempFolder,
    `poi-export-${crypto.randomUUID()}.${inspection.kind === 'zip' ? 'zip' : 'geojson'}`,
  );
  try {
    if (inspection.kind === 'geojson') {
      await fs.writeFile(tempPath, JSON.stringify(inspection.fc, null, 2), 'utf8');
    } else {
      const zip = new AdmZip();
      zip.addFile(`pois/${inspection.slug}.geojson`, Buffer.from(JSON.stringify(inspection.fc, null, 2)));
      for (const file of inspection.files) {
        if (!(await fs.pathExists(file.src))) throw new Error(`Package file not found: ${file.dest}`);
        zip.addLocalFile(file.src, path.posix.dirname(file.dest), path.posix.basename(file.dest));
      }
      await fs.writeFile(tempPath, zip.toBuffer());
    }
    await fs.move(tempPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(tempPath).catch(() => undefined);
  }
}

async function sameStoredBytes(slug: string, bytes: Buffer): Promise<string | null> {
  const existing = await imageAssetService.get(slug);
  if (!existing) return null;
  const fileUrl = await imageAssetService.getFilePath(existing.uid);
  if (!fileUrl) return null;
  try {
    const stored = await fs.readFile(fileURLToPath(fileUrl));
    return stored.equals(bytes) ? existing.uid : null;
  } catch {
    return null;
  }
}

async function availableAssetSlug(base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (!(await SqliteDataService.isSlugAvailable(candidate))) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

/**
 * 地図 ZIP から、**map JSON が参照した managed POI 文書だけ**を editor 正本形へ読む。
 *
 * 地図 ZIP は複数の `pois/*.geojson` を持ち得るため、POI 単体パッケージ用の
 * `importPoiZip`（1件制約つき）では読めない。かといって読み取り・正本化・asset 登録を
 * 二重実装すると変換正本が2つになる。∴ **多対応の本 API を下に置き、
 * `importPoiZip` をその上に再実装する**。
 *
 * - 入力は ZIP のパスと **dest の集合**。ZIP 全体を舐めない（読み取り対象は呼び出し側が決める）
 * - `imgs/` の解決と asset cache は **全 document で1つ**を共有する。
 *   複数 document が同じ `imgs/x.png` を参照しても asset は1件に畳まれる
 * - `cleanup` も全体で1つ（asset 単位の補償であり document 単位ではない）
 * - **`poi_sources` は作らない。** 本 API の責務は正本化した FC を返すところまでであり、
 *   source 行の作成は PoiSourceService の責務である（責務を混ぜない）
 */
export interface ManagedPoiDocumentsImport {
  /** dest（"pois/<name>.geojson"）→ editor 正本形へ正本化済みの FeatureCollection */
  documents: Map<string, FeatureCollection>;
  /** 今回新規作成した asset UID。**全 document 横断で1本**（重複バイトは1つに畳む） */
  createdAssetUids: string[];
  /** 全 document 分をまとめた補償 */
  cleanup: PoiZipImportCleanup;
  /** 未対応形式・解決不能参照などの警告（呼び出し側が集約する） */
  warnings: string[];
}

/** 今回作成した asset を逆順に補償し、到達できなかったものを返す。途中で止めない。 */
function makeAssetCleanup(createdAssetUids: readonly string[]): PoiZipImportCleanup {
  return async () => {
    const residue: CompensationResidue[] = [];
    for (const uid of [...createdAssetUids].reverse()) {
      try {
        const result = await imageAssetService.delete(uid);
        if (result.bytes === 'retained') {
          residue.push({ kind: 'asset', assetUid: uid, retainedPath: result.retainedPath });
        }
      } catch (e) {
        // DB 削除自体が失敗した場合。行が残るため補償未到達である
        residue.push({ kind: 'asset', assetUid: uid, dbError: e instanceof Error ? e.message : String(e) });
      }
    }
    return residue;
  };
}

export async function importManagedPoiDocuments(
  filePath: string,
  dests: readonly string[],
): Promise<ManagedPoiDocumentsImport> {
  const zip = new AdmZip(filePath);
  const infos = zipEntryInfos(zip);

  // (a) 安全検証は **絞り込み前に ZIP 全体へ**。API 自衛であり冪等
  //     （地図 ZIP の主たる検証点は DataUploadService.extractZip の展開前である）。
  assertSafeArchiveEntries(infos);
  // (b) 容量・件数上限は **POI payload にのみ**。地図 ZIP のタイルは既存形式どおり無制限
  assertPoiPayloadLimits(infos.filter((info) => isPoiPayloadEntry(info.name)));

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const byName = new Map(entries.map((entry) => [entry.entryName, entry]));

  const createdAssetUids: string[] = [];
  // 全 document で共有する解決キャッシュ。同じ imgs/x.png を複数 document が参照しても
  // asset は1つに畳まれる
  const resolvedPaths = new Map<string, string>();
  const warnings: string[] = [];
  const tempFolder = SettingsService.get('tmpFolder') as string;
  await fs.ensureDir(tempFolder);

  const cleanup = makeAssetCleanup(createdAssetUids);

  const resolveMedia = async (value: string): Promise<string> => {
    const cached = resolvedPaths.get(value);
    if (cached) return cached;

    const iconMatch = /^imgs\/icons\/([^/]+)\/([^/.]+)\.[^/]+$/.exec(value);
    if (iconMatch) {
      const [, setId, iconId] = iconMatch;
      const set = listIconSets().find((entry) => entry.setId === setId);
      if (!set || !set.iconIds.includes(iconId)) {
        throw new Error(`Unknown packaged icon: ${value}`);
      }
      const ref = `${setId}:${iconId}`;
      resolvedPaths.set(value, ref);
      return ref;
    }

    const assetMatch = /^imgs\/([^/]+)\.([A-Za-z0-9]+)$/.exec(value);
    if (!assetMatch) return value;
    const entry = byName.get(value);
    if (!entry) throw new Error(`Packaged image is missing: ${value}`);
    const bytes = entry.getData();
    const [, baseSlug, ext] = assetMatch;
    const reusedUid = await sameStoredBytes(baseSlug, bytes);
    if (reusedUid) {
      resolvedPaths.set(value, reusedUid);
      return reusedUid;
    }

    const slug = await availableAssetSlug(baseSlug);
    const tempPath = path.join(tempFolder, `poi-import-${crypto.randomUUID()}.${ext.toLowerCase()}`);
    try {
      await fs.writeFile(tempPath, bytes);
      const result = await imageAssetService.add({ slug, title: { ja: slug }, sourcePath: tempPath });
      if (!('result' in result) || result.result !== 'Success') {
        if ('uid' in result && result.uid) createdAssetUids.push(result.uid);
        throw new Error(
          'result' in result && result.result === 'Error'
            ? result.message || result.code
            : 'Image asset registration failed',
        );
      }
      createdAssetUids.push(result.uid);
      resolvedPaths.set(value, result.uid);
      return result.uid;
    } finally {
      await fs.remove(tempPath).catch(() => undefined);
    }
  };

  // M5-T4B: html 本文の imgs 参照を asset の正本記法へ戻す。
  //
  // 搬出側 (poiReferenceResolver.resolveAssetRefsForExport) は features[].properties.html の
  // `maplat-asset:<UID>` を `imgs/<slug>.<ext>` へ置換して同梱する。その逆変換が無いと
  // **ZIP 相対参照が DB へそのまま入り**、再搬出で前の ZIP のパスが漏れ出す (AC8)。
  //
  // resolveMedia と分ける理由: icon の正本は裸の asset UID だが、html 本文の正本は
  // `maplat-asset:<UID>` である。同じ resolver を使うと html に裸 UID が書かれ、
  // viewer からも editor からも画像として解決できない文字列になる。
  const resolveHtmlAssetRef = async (imgsPath: string): Promise<string | null> => {
    // html は **利用者が書く自由記述**である。ZIP に無い imgs/... は我々が書いた参照ではない
    // ∴ Error にせず原文のまま残す。pois/*.geojson や icon の欠損を Error にする契約
    // （AC7）とはここが違う — 搬出側は html へ書いた imgs/... を必ず同梱するため、
    // 「我々が書いた参照」は常に byName に居る
    if (!byName.has(imgsPath)) return null;
    const resolved = await resolveMedia(imgsPath);
    // icon set 参照 (`setId:iconId`) や未解決の原文はそのまま残す — asset ではない
    return resolved === imgsPath || resolved.includes(':') ? null : resolved;
  };

  const documents = new Map<string, FeatureCollection>();
  try {
    for (const dest of dests) {
      // 重複参照（複数 entry が同じ dest を指す）は1回だけ正本化する
      if (documents.has(dest)) continue;
      const entry = byName.get(dest);
      // 参照されているのに ZIP に無い → Error。黙って落とすと POI が欠けた地図が生まれる
      if (!entry) throw new Error(`Packaged POI document is missing: ${dest}`);

      let fc: FeatureCollection;
      try {
        fc = JSON.parse(entry.getData().toString('utf8')) as FeatureCollection;
      } catch {
        throw new Error('POI package GeoJSON is not valid JSON');
      }
      documents.set(dest, await rewritePoiMediaReferences(
        fc, resolveMedia, resolveHtmlAssetRef) as FeatureCollection);
    }
    return { documents, createdAssetUids, cleanup, warnings };
  } catch (error) {
    // 途中失敗の補償。**残留は握り潰さずログへ出す**（I-4c: 補償は成功したことにできない）。
    // 本 API は throw で失敗を伝えるため戻り値に residue を載せられない。地図 ZIP 経路では
    // 呼び出し側（DataUploadService）が自前の cleanup で residue を集約する。
    const residue = await cleanup();
    if (residue.length > 0) {
      console.warn('[PoiPackageService] 補償に到達できなかった残留物があります (importManagedPoiDocuments):', residue);
    }
    throw error;
  }
}

export async function importPoiZip(filePath: string): Promise<PoiZipImport> {
  const zip = new AdmZip(filePath);

  // POI 単体パッケージは **全 entry が payload** であるため、上限も全 entry へ掛ける。
  // 委譲先の importManagedPoiDocuments は (b) を pois/+imgs/ へ絞るため、委譲だけに任せると
  // **payload 外 entry（巨大 README・512 超の docs/ 等）による zip-bomb 検知が消える**。
  // ∴ 委譲の前に合成関数を全 entry へ直接呼ぶ。
  assertSafePoiPackageEntries(zipEntryInfos(zip));

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  // 1件制約は POI 単体パッケージの入力検証として維持する（地図 ZIP の都合で緩めない）
  const poiEntryName = findPoiDocumentEntry(entries.map((entry) => entry.entryName));

  const imported = await importManagedPoiDocuments(filePath, [poiEntryName]);
  return {
    fc: imported.documents.get(poiEntryName)!,
    createdAssetUids: imported.createdAssetUids,
    cleanup: imported.cleanup,
  };
}
