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

export interface PoiZipImport {
  fc: FeatureCollection;
  createdAssetUids: string[];
  cleanup(): Promise<void>;
}

function safeSlug(value: unknown): string {
  return String(value ?? 'poi').replace(/[^A-Za-z0-9_-]+/g, '-') || 'poi';
}

function isSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  const mode = (Number(entry.header.attr) >>> 16) & 0o170000;
  return mode === 0o120000;
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
  assertSafePoiPackageEntries(allEntries.map((entry) => ({
    name: entry.entryName,
    size: Number(entry.header.size),
    isSymlink: isSymlinkEntry(entry),
  })));
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

  const cleanup = async () => {
    for (const uid of [...createdAssetUids].reverse()) {
      await imageAssetService.delete(uid).catch(() => undefined);
    }
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
