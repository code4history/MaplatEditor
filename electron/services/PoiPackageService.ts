import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import type { FeatureCollection } from 'geojson';
import { listIconSets } from '../../src/utils/iconRefs';
import {
  assertSafePoiPackageEntries,
  findPoiDocumentEntry,
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

export async function importPoiZip(filePath: string): Promise<PoiZipImport> {
  const zip = new AdmZip(filePath);
  const allEntries = zip.getEntries();
  // POI 単体パッケージは **全 entry が payload** であるため、上限も全 entry へ掛ける
  // （payload 外 entry による zip-bomb を取り逃がさない）
  assertSafePoiPackageEntries(zipEntryInfos(zip));
  const entries = allEntries.filter((entry) => !entry.isDirectory);
  const poiEntryName = findPoiDocumentEntry(entries.map((entry) => entry.entryName));
  const byName = new Map(entries.map((entry) => [entry.entryName, entry]));
  const poiEntry = byName.get(poiEntryName)!;

  let fc: FeatureCollection;
  try {
    fc = JSON.parse(poiEntry.getData().toString('utf8')) as FeatureCollection;
  } catch {
    throw new Error('POI package GeoJSON is not valid JSON');
  }

  const createdAssetUids: string[] = [];
  const resolvedPaths = new Map<string, string>();
  const tempFolder = SettingsService.get('tmpFolder') as string;
  await fs.ensureDir(tempFolder);

  // M5-T4 (I-4c): 旧実装は `.catch(() => undefined)` で **退避失敗も DB 削除の throw も**
  // 握り潰していた。∴ 補償を呼んだ側は残留の有無を知れず、補償を成功したことにしていた。
  // 到達できなかったものを列挙して返す。**補償は途中で止めない**（残りの asset も試みる）。
  const cleanup: PoiZipImportCleanup = async () => {
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

  try {
    const rewritten = await rewritePoiMediaReferences(fc, async (value) => {
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
    });

    return { fc: rewritten, createdAssetUids, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
