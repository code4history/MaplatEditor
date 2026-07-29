export const POI_PACKAGE_MAX_ENTRIES = 512;
export const POI_PACKAGE_MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export const POI_PACKAGE_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface PoiPackageEntryInfo {
  name: string;
  size: number;
  isSymlink?: boolean;
}

export function assertSafePoiPackageEntries(entries: readonly PoiPackageEntryInfo[]): void {
  if (entries.length > POI_PACKAGE_MAX_ENTRIES) {
    throw new Error('POI package contains too many entries');
  }
  let total = 0;
  const names = new Set<string>();
  for (const entry of entries) {
    const name = String(entry.name);
    if (
      !name ||
      name.includes('\\') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').some((segment) => segment === '..') ||
      entry.isSymlink
    ) {
      throw new Error(`Unsafe POI package entry: ${name}`);
    }
    if (names.has(name)) throw new Error(`Duplicate POI package entry: ${name}`);
    names.add(name);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid POI package entry size: ${name}`);
    }
    total += entry.size;
    if (/^imgs\/.+[^/]$/i.test(name) && entry.size > POI_PACKAGE_MAX_IMAGE_BYTES) {
      throw new Error(`Packaged image is too large: ${name}`);
    }
    if (total > POI_PACKAGE_MAX_EXPANDED_BYTES) {
      throw new Error('POI package is too large');
    }
  }
}

export function findPoiDocumentEntry(names: readonly string[]): string {
  const matches = names.filter((name) => /^pois\/[^/]+\.geojson$/i.test(name));
  if (matches.length !== 1) {
    throw new Error(`POI package must contain exactly one pois/*.geojson file (found ${matches.length})`);
  }
  return matches[0];
}

type MediaResolver = (value: string) => string | Promise<string>;

async function rewriteImage(value: unknown, resolve: MediaResolver): Promise<unknown> {
  if (typeof value === 'string') return resolve(value);
  if (Array.isArray(value)) return Promise.all(value.map((entry) => rewriteImage(entry, resolve)));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.src !== 'string') return value;
    return { ...object, src: await resolve(object.src) };
  }
  return value;
}

async function rewriteProperties(
  properties: Record<string, unknown>,
  resolve: MediaResolver,
): Promise<Record<string, unknown>> {
  let changed: Record<string, unknown> | null = null;
  for (const key of ['icon', 'selectedIcon'] as const) {
    if (typeof properties[key] !== 'string') continue;
    const next = await resolve(properties[key] as string);
    if (next !== properties[key]) {
      if (!changed) changed = { ...properties };
      changed[key] = next;
    }
  }
  if ('image' in properties) {
    const next = await rewriteImage(properties.image, resolve);
    if (JSON.stringify(next) !== JSON.stringify(properties.image)) {
      if (!changed) changed = { ...properties };
      changed.image = next;
    }
  }
  return changed ?? properties;
}

export async function rewritePoiMediaReferences<T>(document: T, resolve: MediaResolver): Promise<T> {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
  const fc = document as Record<string, unknown>;
  let output = await rewriteProperties(fc, resolve);

  // m18-t5: FC.properties（layer metadata の正本位置）の icon 参照書き換え
  const fcProps = fc.properties;
  if (fcProps && typeof fcProps === 'object' && !Array.isArray(fcProps)) {
    const changedProps = await rewriteProperties(fcProps as Record<string, unknown>, resolve);
    if (changedProps !== fcProps) {
      output = output === fc ? { ...fc } : output;
      output.properties = changedProps;
    }
  }

  if (Array.isArray(fc.features)) {
    const originalFeatures = fc.features;
    const features = await Promise.all(originalFeatures.map(async (feature) => {
      if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return feature;
      const row = feature as Record<string, unknown>;
      if (!row.properties || typeof row.properties !== 'object' || Array.isArray(row.properties)) return feature;
      const properties = await rewriteProperties(row.properties as Record<string, unknown>, resolve);
      return properties === row.properties ? feature : { ...row, properties };
    }));
    if (features.some((feature, index) => feature !== originalFeatures[index])) {
      output = output === fc ? { ...fc } : output;
      output.features = features;
    }
  }
  return output as T;
}
