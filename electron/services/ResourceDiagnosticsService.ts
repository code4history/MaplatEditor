import MapPurposeService from './MapPurposeService';
import { hasStrictError } from './MapEditService';
import PoiSourceService from './PoiSourceService';
import SqliteDataService from './SqliteDataService';
import {
  MISSING_ASSET_REF_WARNING,
  UNRESOLVED_ICON_WARNING,
  resolveAssetRefsForExport,
  resolvePoiFeatureCollection,
  resolvePoisArray,
} from './poiReferenceResolver';
import {
  createBaseMapMasterLookup,
  normalizeAppSource,
  resolveAppSource,
  type AppSource,
} from '../../src/utils/appSourceModel';
import { readAppDocumentPois } from '../../src/utils/appPoisFormat';

export interface MapResourceDiagnostics {
  kind: 'map';
  strictError: boolean;
  missingPoiRefs: boolean;
  missingAssetRefs: boolean;
}

export interface AppResourceDiagnostics {
  kind: 'app';
  mapRefError: boolean;
  missingBaseMapRefs: boolean;
  missingPoiRefs: boolean;
  missingAssetRefs: boolean;
  unsupportedPoisFormat: boolean;
}

export interface PoiSourceResourceDiagnostics {
  kind: 'poi-source';
  missingAssetRefs: boolean;
}

export type ResourceDiagnostics =
  | MapResourceDiagnostics
  | AppResourceDiagnostics
  | PoiSourceResourceDiagnostics;

const MISSING_POI_WARNING = 'appedit.warn_missing_poi_source';

function includesWarning(warnings: string[], key: string): boolean {
  return warnings.includes(key);
}

function createExportFormMemo(): (uid: string) => Promise<unknown | null> {
  const memo = new Map<string, Promise<unknown | null>>();
  return (uid: string) => {
    const existing = memo.get(uid);
    if (existing) return existing;
    const next = PoiSourceService.exportForm(uid);
    memo.set(uid, next);
    return next;
  };
}

async function diagnosePois(
  pois: unknown,
  exportForm: (uid: string) => Promise<unknown | null>,
): Promise<{ missingPoiRefs: boolean; missingAssetRefs: boolean }> {
  const resolved = await resolvePoisArray(pois, { exportForm });
  let missingAssetRefs = includesWarning(resolved.warnings, UNRESOLVED_ICON_WARNING);
  const icons = new Map();
  for (const entry of resolved.pois) {
    const assetResolved = await resolveAssetRefsForExport(entry, icons);
    if (includesWarning(assetResolved.warnings, MISSING_ASSET_REF_WARNING)) {
      missingAssetRefs = true;
    }
  }
  return {
    missingPoiRefs: includesWarning(resolved.warnings, MISSING_POI_WARNING),
    missingAssetRefs,
  };
}

// m6-t10 (AC22): 判定根拠を resolveAppSource の解決結果へ差し替える。
//
// 旧実装は source.data.thumbnail を `tmbs/{uuid}.{ext}` として正規表現で解釈し、逆算した uid を
// 照合していた（extractTmsThumbnailBaseMapUid）。差分保持モデルでは source.data が無くなる。
// ここで source.baseMapUid を「直接」照合してはならない — 旧保存形のソースは baseMapUid を
// 持たず、実データは保存し直すまで全件が旧形であるため、undefined の照合になる（設計 r2-M-2）。
// ∴ 解決順（baseMapUid → mapUid(slug)）を持つ唯一の実装である resolveAppSource を通す。
// これによりプレビュー・書き出しの除外判定（§3.6）と診断が同一経路になり、食い違わない。
//
// 判定範囲は拡大する: 旧実装は「サムネイルが uid 形のパスを持つソース」しか検査していなかったが、
// 新実装は全ベースマップ由来ソースが対象になる。
async function hasMissingBaseMapRef(document: any): Promise<boolean> {
  const sources: AppSource[] = (Array.isArray(document?.sources) ? document.sources : [])
    .map((raw: any) => normalizeAppSource(raw, document?.lang || 'ja'))
    .filter((source: AppSource) => source.sourceType !== 'maplat');
  if (sources.length === 0) return false;
  const lookup = createBaseMapMasterLookup(await SqliteDataService.listBaseMaps());
  return sources.some((source) => !resolveAppSource(source, lookup).ok);
}

export async function attachMapDiagnostics<T extends Record<string, any>>(docs: T[]): Promise<T[]> {
  const exportForm = createExportFormMemo();
  await Promise.all(docs.map(async (doc) => {
    if (!doc) return;
    const poiDiagnostics = await diagnosePois(doc.pois, exportForm);
    (doc as any).resourceDiagnostics = {
      kind: 'map',
      strictError: hasStrictError(doc),
      ...poiDiagnostics,
    } satisfies MapResourceDiagnostics;
  }));
  return docs;
}

export async function attachAppDiagnostics<T extends Record<string, any>>(docs: T[]): Promise<T[]> {
  const exportForm = createExportFormMemo();
  await Promise.all(docs.map(async (doc) => {
    if (!doc) return;
    const refs = MapPurposeService.collectMaplatMapRefs(doc);
    const classified = await MapPurposeService.classifyViewerRuntimeRefs(refs);
    const appPois = readAppDocumentPois(doc);
    const poiDiagnostics = await diagnosePois(appPois.pois, exportForm);
    (doc as any).resourceDiagnostics = {
      kind: 'app',
      mapRefError: classified.missing.length > 0 || classified.strictError.length > 0,
      missingBaseMapRefs: await hasMissingBaseMapRef(doc),
      ...poiDiagnostics,
      unsupportedPoisFormat: appPois.unsupported,
    } satisfies AppResourceDiagnostics;
  }));
  return docs;
}

export async function attachPoiSourceDiagnostics<T extends Record<string, any>>(rows: T[]): Promise<T[]> {
  await Promise.all(rows.map(async (row) => {
    if (!row) return;
    let missingAssetRefs = false;
    const fc = await PoiSourceService.exportForm(row.uid);
    if (fc) {
      const resolved = await resolvePoiFeatureCollection(fc);
      missingAssetRefs = includesWarning(resolved.warnings, UNRESOLVED_ICON_WARNING);
      const assetResolved = await resolveAssetRefsForExport(resolved.fc, new Map());
      if (includesWarning(assetResolved.warnings, MISSING_ASSET_REF_WARNING)) {
        missingAssetRefs = true;
      }
    }
    (row as any).resourceDiagnostics = {
      kind: 'poi-source',
      missingAssetRefs,
    } satisfies PoiSourceResourceDiagnostics;
  }));
  return rows;
}
