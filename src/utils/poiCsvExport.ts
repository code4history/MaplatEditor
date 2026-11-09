// POI の書き出し (CSV・JSON)。入力は PoiSourceService.exportForm の出力 (交換形の FeatureCollection)。
// 丸め・内部項目の除去・言語の畳み込みは toExportForm が済ませているので、ここでは再実装しない。
import type { Feature, FeatureCollection } from 'geojson';
import { DEFAULT_LANG, isDangerousUrlString, roundCoord } from './poiGeoJson';
import { UID_RE } from './poiContentMode';
import { normalizeLangResource } from './langResource';
import { LANG_CODES } from './editorLanguages';
import { encodeCsvDocument, quotePoiCsvFormula } from './poiTableCodec';

export interface PoiExportOmitted {
  html: number;
  url: number;
  directgo: number;
  icon: number;
  selectedIcon: number;
  otherProperties: number;
  imageAssetRefs: number;
  imageUnrepresentable: number;
  iconAssetRefs: number;
}

export interface PoiTableExport {
  bytes: Uint8Array;
  omitted: PoiExportOmitted;
}

// CSV の列に対応する property。これ以外の property は CSV に出ない (otherProperties に数える)
const CSV_PROPERTIES = new Set(['name', 'desc', 'address', 'image']);
const OMITTED_NAMED = ['html', 'url', 'directgo', 'icon', 'selectedIcon'] as const;
const LANG_FIELDS = ['name', 'desc', 'address'] as const;

function emptyOmitted(): PoiExportOmitted {
  return {
    html: 0, url: 0, directgo: 0, icon: 0, selectedIcon: 0,
    otherProperties: 0, imageAssetRefs: 0, imageUnrepresentable: 0, iconAssetRefs: 0,
  };
}

function propsOf(feature: Feature): Record<string, unknown> {
  return (feature.properties ?? {}) as Record<string, unknown>;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

// image / icon の値 (文字列・{src,…}・それらの配列) を src の文字列の列にする。src の無い要素は null
function imageSources(value: unknown): (string | null)[] {
  const items = Array.isArray(value) ? value : [value];
  const out: (string | null)[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.trim() !== '') out.push(item.trim());
    } else if (item && typeof item === 'object') {
      const src = (item as { src?: unknown }).src;
      out.push(typeof src === 'string' && src.trim() !== '' ? src.trim() : null);
    }
  }
  return out;
}

interface ImageSplit { writable: string[]; assetRef: boolean; unrepresentable: boolean }

// UUID の判定を相対 URL の判定より先に行う (isDangerousUrlString は裸の UUID を相対 URL として通す)
function splitImage(value: unknown): ImageSplit {
  const split: ImageSplit = { writable: [], assetRef: false, unrepresentable: false };
  for (const src of imageSources(value)) {
    if (src === null) split.unrepresentable = true;
    else if (UID_RE.test(src)) split.assetRef = true;
    else if (src.includes('|') || isDangerousUrlString(src)) split.unrepresentable = true;
    else split.writable.push(src);
  }
  return split;
}

function hasAssetRef(value: unknown): boolean {
  return imageSources(value).some((src) => src !== null && UID_RE.test(src));
}

function countOmitted(features: readonly Feature[], format: 'csv' | 'json'): PoiExportOmitted {
  const omitted = emptyOmitted();
  for (const f of features) {
    const props = propsOf(f);
    if (format === 'csv') {
      for (const key of OMITTED_NAMED) {
        const value = props[key];
        const present = key === 'html' || key === 'url'
          ? Object.keys(normalizeLangResource(value as never, DEFAULT_LANG)).length > 0
          : hasValue(value);
        if (present) omitted[key] += 1;
      }
      if (Object.keys(props).some((k) => !CSV_PROPERTIES.has(k) && !(OMITTED_NAMED as readonly string[]).includes(k) && props[k] !== undefined)) {
        omitted.otherProperties += 1;
      }
      if (hasValue(props.image)) {
        const split = splitImage(props.image);
        if (split.assetRef) omitted.imageAssetRefs += 1;
        if (split.unrepresentable) omitted.imageUnrepresentable += 1;
      }
    } else if (hasAssetRef(props.image)) {
      omitted.imageAssetRefs += 1;
    }
    if (hasAssetRef(props.icon) || hasAssetRef(props.selectedIcon)) omitted.iconAssetRefs += 1;
  }
  return omitted;
}

function formatCoordinate(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const fixed = roundCoord(n).toFixed(7).replace(/\.?0+$/, '');
  return fixed === '' || fixed === '-0' ? '0' : fixed;
}

function languageOf(fc: FeatureCollection): string {
  const lang = (fc as { lang?: unknown }).lang;
  return typeof lang === 'string' && lang !== '' ? lang : DEFAULT_LANG;
}

// 交換形の FeatureCollection → CSV (UTF-8・BOM つき)
export function buildPoiCsv(fc: FeatureCollection): PoiTableExport {
  const defaultLang = languageOf(fc);
  const features = fc.features;
  const resources = features.map((f) => {
    const props = propsOf(f);
    return Object.fromEntries(LANG_FIELDS.map((k) => [k, normalizeLangResource(props[k] as never, defaultLang)]));
  });

  // 言語つきの列: その項目にその言語の値を持つ POI が 1 件でもあるものだけ。対応言語の定義順・既定言語を除く
  const header: string[] = ['id'];
  const langColumns: Record<string, string[]> = {};
  for (const field of LANG_FIELDS) {
    langColumns[field] = LANG_CODES.filter(
      (lang) => lang !== defaultLang && resources.some((r) => r[field][lang] !== undefined),
    );
    header.push(field, ...langColumns[field].map((lang) => `${field}:${lang}`));
  }
  header.push('image', 'lat', 'lng');

  const rows: string[][] = [header];
  features.forEach((f, i) => {
    const row: string[] = [quotePoiCsvFormula(String(f.id ?? ''))];
    for (const field of LANG_FIELDS) {
      const res = resources[i][field];
      row.push(quotePoiCsvFormula(res[defaultLang] ?? ''));
      for (const lang of langColumns[field]) row.push(quotePoiCsvFormula(res[lang] ?? ''));
    }
    const image = propsOf(f).image;
    row.push(quotePoiCsvFormula(hasValue(image) ? splitImage(image).writable.join('|') : ''));
    const coords = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : [];
    row.push(formatCoordinate(coords[1]), formatCoordinate(coords[0]));
    rows.push(row);
  });

  return { bytes: encodeCsvDocument(rows), omitted: countOmitted(features, 'csv') };
}

// 交換形の FeatureCollection → JSON (POI の配列・旧オブジェクト形式。UTF-8・BOM なし・インデント 2・末尾に改行)
export function buildPoiJson(fc: FeatureCollection): PoiTableExport {
  const list = fc.features.map((f) => {
    const coords = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : [];
    const out: Record<string, unknown> = {
      id: f.id,
      lnglat: [roundCoord(coords[0]), roundCoord(coords[1])],
    };
    for (const [key, value] of Object.entries(propsOf(f))) {
      if (key !== 'id' && key !== 'lnglat') out[key] = value;
    }
    return out;
  });
  return {
    bytes: new TextEncoder().encode(JSON.stringify(list, null, 2) + '\n'),
    omitted: countOmitted(fc.features, 'json'),
  };
}
