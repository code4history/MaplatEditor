// POI の取り込み: 既存の POI への合流 (追記・上書き)。renderer・main 共用の純関数。
//
// 規則 (空セルは全項目で「変えない」。PoiImportRow は空でない値だけを持つので、合流は空セルを意識しない):
// - 追記: 取り込む行はすべて新しい POI として末尾へ足す。id が既存と衝突すれば連番で付け替える。
// - 上書き: id が既存と一致する行は更新し、一致しない行 (id が空を含む) は新しい POI として足す。
//   ファイルに無い既存の POI は残す (消さない)。更新は行が持つ値だけを上書きし、それ以外の項目
//   (html・url・directgo・icon・独自の property・内容モード・_maplatUid) は触らない。
// - 変化が無い更新は同じオブジェクトを返す (往復で「変更なし」)。
import type { Position } from 'geojson';
import { ensureDisplayIds, isDangerousUrlString, roundCoord, type PoiEditorFeature } from './poiGeoJson';
import { UID_RE } from './poiContentMode';
import { slugCandidate, SEQUENCE_MAX_INDEX } from './slugSequence';
import type { PoiImportIssue, PoiImportRow } from './poiImportRows';

export type PoiMergeMode = 'append' | 'overwrite';

export interface PoiMergePlan {
  /** 適用後 (commit に渡す) */
  features: PoiEditorFeature[];
  summary: {
    added: number;
    updated: number;
    unchanged: number;
    keptExisting: number;
    renamed: number;
    skippedRows: number;
  };
  /** 合流が出す issue: name-required・coord-missing・id-renamed・id-exhausted */
  issues: PoiImportIssue[];
}

type LangMap = Record<string, string>;

const normalizeNl = (s: string): string => s.replace(/\r\n?/g, '\n');

function readLangMap(value: unknown, defaultLang: string): LangMap {
  if (typeof value === 'string') return value === '' ? {} : { [defaultLang]: value };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as LangMap;
  }
  return {};
}

// 行が持つ言語の値を重ねる。変化が無ければ null
function mergeLang(current: unknown, incoming: LangMap | undefined, defaultLang: string): LangMap | null {
  if (!incoming) return null;
  const base = readLangMap(current, defaultLang);
  let changed = false;
  const next: LangMap = { ...base };
  for (const [lang, value] of Object.entries(incoming)) {
    if (base[lang] === undefined || normalizeNl(base[lang]) !== value) {
      next[lang] = value;
      changed = true;
    }
  }
  return changed ? next : null;
}

interface ImageParts { writable: { src: string; element: unknown }[]; fixed: unknown[] }

// CSV で表せる要素 (資産の UUID でなく、| を含まず、http(s)・相対 URL の src) と、表せない要素に分ける。
// UUID の判定を相対 URL の判定より先に行う (isDangerousUrlString は裸の UUID を相対 URL として通す)
function splitImageElements(value: unknown): ImageParts {
  const parts: ImageParts = { writable: [], fixed: [] };
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  for (const element of items) {
    const raw = typeof element === 'string' ? element : element && typeof element === 'object' ? (element as { src?: unknown }).src : undefined;
    const src = typeof raw === 'string' ? raw.trim() : '';
    if (src === '' || UID_RE.test(src) || src.includes('|') || isDangerousUrlString(src)) parts.fixed.push(element);
    else parts.writable.push({ src, element });
  }
  return parts;
}

// 行の URL の列で image を更新する。変化が無ければ undefined (= 触らない)
function mergeImage(current: unknown, incoming: string[] | undefined): { value: unknown } | undefined {
  if (!incoming) return undefined;
  const parts = splitImageElements(current);
  if (parts.writable.length === incoming.length && parts.writable.every((w, i) => w.src === incoming[i])) return undefined;
  const reusable = [...parts.writable];
  const next: unknown[] = incoming.map((url) => {
    const at = reusable.findIndex((w) => w.src === url);
    if (at < 0) return url;
    const [hit] = reusable.splice(at, 1);
    return hit.element; // 同じ src の既存要素は再利用してメタ ({src, alt…}) を保つ
  });
  next.push(...parts.fixed); // 表せない既存要素は末尾に保つ
  return { value: next.length === 1 ? next[0] : next };
}

function sameCoordinates(a: Position | undefined, b: [number, number]): boolean {
  return !!a && roundCoord(a[0]) === roundCoord(b[0]) && roundCoord(a[1]) === roundCoord(b[1]);
}

function updateFeature(feature: PoiEditorFeature, row: PoiImportRow, defaultLang: string): PoiEditorFeature {
  const props = { ...feature.properties };
  let changed = false;
  for (const field of ['name', 'desc', 'address'] as const) {
    const merged = mergeLang(feature.properties[field], row[field], defaultLang);
    if (merged) { props[field] = merged; changed = true; }
  }
  const image = mergeImage(feature.properties.image, row.image);
  if (image) { props.image = image.value; changed = true; }
  let geometry = feature.geometry;
  if (row.coordinates && !sameCoordinates(feature.geometry?.coordinates, row.coordinates)) {
    geometry = { type: 'Point', coordinates: [row.coordinates[0], row.coordinates[1]] };
    changed = true;
  }
  return changed ? { ...feature, geometry, properties: props } : feature;
}

function newFeature(row: PoiImportRow, id: string): PoiEditorFeature {
  const properties: Record<string, unknown> = { _maplatUid: globalThis.crypto.randomUUID() };
  if (row.name) properties.name = { ...row.name };
  if (row.desc) properties.desc = { ...row.desc };
  if (row.address) properties.address = { ...row.address };
  if (row.image) properties.image = row.image.length === 1 ? row.image[0] : [...row.image];
  const [lng, lat] = row.coordinates as [number, number];
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties };
}

export function planPoiMerge(args: {
  existing: readonly PoiEditorFeature[];
  rows: readonly PoiImportRow[];
  mode: PoiMergeMode;
  defaultLang: string;
}): PoiMergePlan {
  const { existing, rows, mode, defaultLang } = args;
  const out: PoiEditorFeature[] = existing.slice();
  const taken = new Set<string>();
  const indexById = new Map<string, number>();
  existing.forEach((f, i) => {
    const id = String(f.id ?? '');
    taken.add(id);
    if (id !== '' && !indexById.has(id)) indexById.set(id, i);
  });

  const issues: PoiImportIssue[] = [];
  const summary = { added: 0, updated: 0, unchanged: 0, keptExisting: 0, renamed: 0, skippedRows: 0 };
  const matched = new Set<number>();
  let needsDisplayIds = false;

  const issue = (level: 'error' | 'warning', code: string, row: PoiImportRow, extra: Partial<PoiImportIssue> = {}): void => {
    issues.push({ level, code, row: row.row, line: row.line, ...(row.id !== '' ? { featureId: row.id } : {}), ...extra });
  };

  for (const row of rows) {
    const at = mode === 'overwrite' && row.id !== '' ? indexById.get(row.id) : undefined;
    if (at !== undefined) {
      const before = out[at];
      const after = updateFeature(before, row, defaultLang);
      matched.add(at);
      if (after === before) summary.unchanged += 1;
      else { out[at] = after; summary.updated += 1; }
      continue;
    }

    // 新しい POI として必須: name (どの言語でも) と座標
    const missingName = !row.name || Object.keys(row.name).length === 0;
    const missingCoords = row.coordinates === null;
    if (missingName) issue('error', 'name-required', row);
    if (missingCoords) issue('error', 'coord-missing', row);
    if (missingName || missingCoords) { summary.skippedRows += 1; continue; }

    let id = row.id;
    if (id !== '' && taken.has(id)) {
      let renamed: string | null = null;
      for (let n = 2; n <= SEQUENCE_MAX_INDEX; n++) {
        const candidate = slugCandidate(id, n);
        if (!taken.has(candidate)) { renamed = candidate; break; }
      }
      if (renamed === null) {
        issue('error', 'id-exhausted', row);
        summary.skippedRows += 1;
        continue;
      }
      issue('warning', 'id-renamed', row, { value: id, message: `${id} -> ${renamed}` });
      summary.renamed += 1;
      id = renamed;
    }
    if (id === '') needsDisplayIds = true;
    else taken.add(id);
    out.push(newFeature(row, id));
    summary.added += 1;
  }

  if (mode === 'overwrite') summary.keptExisting = existing.length - matched.size;
  const features = needsDisplayIds ? ensureDisplayIds(out).features : out;
  return { features, summary, issues };
}
