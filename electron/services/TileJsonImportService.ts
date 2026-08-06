// m6-t7: TileJSON URL からの tms 種別マスタ取り込み。
// fetch → JSON parse → vector tileset 拒否 → 必須項目確認 → フィールドマッピングの
// 順で処理する（設計書 docs/superpowers/specs/2026-08-06-m6-t7-tilejson-import-design.md §3.2）。
import { guardedFetch } from './remoteFetchGuard';
import { bboxToEnvelope } from '../../src/utils/appSourceModel';

export type TileJsonImportResult =
  | { ok: true; fields: TileJsonMappedFields; sourceUrl: string }
  | {
      ok: false;
      code:
        | 'unsupported-scheme'
        | 'network'
        | 'http-status'
        | 'too-large'
        | 'invalid-json'
        | 'missing-tiles'
        | 'vector-tileset';
      message?: string;
    };

export interface TileJsonMappedFields {
  url: string;
  minZoom: number;
  maxZoom: number;
  // 存在した場合のみ設定。undefined なら呼び出し元は既存フォーム値を上書きしない
  attr?: string;
  title?: string;
  coverageLngLats?: [number, number][];
}

const TILEJSON_DEFAULT_MIN_ZOOM = 0;
const TILEJSON_DEFAULT_MAX_ZOOM = 22;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// bounds [w,s,e,n] が bboxToEnvelope へ渡してよい形か検証する。
// bboxToEnvelope 自体はバリデーションを持たないため、呼び出し前にここで確認する
// （appSourceModel.ts の envelopeToBbox の検査パターンに倣う）
function isValidBounds(bounds: unknown): bounds is [number, number, number, number] {
  if (!Array.isArray(bounds) || bounds.length !== 4) return false;
  const [west, south, east, north] = bounds;
  if (!isFiniteNumber(west) || !isFiniteNumber(south) || !isFiniteNumber(east) || !isFiniteNumber(north)) return false;
  return west < east && south < north;
}

export async function importTileJson(url: string): Promise<TileJsonImportResult> {
  const fetched = await guardedFetch(url);
  if (!fetched.ok) {
    return fetched.code === 'network' || fetched.code === 'http-status'
      ? { ok: false, code: fetched.code, message: fetched.message }
      : { ok: false, code: fetched.code };
  }

  let json: unknown;
  try {
    json = JSON.parse(fetched.text);
  } catch {
    return { ok: false, code: 'invalid-json' };
  }
  if (json === null || typeof json !== 'object') {
    return { ok: false, code: 'invalid-json' };
  }
  const doc = json as Record<string, unknown>;

  // ベクタタイルセット判定: vector_layers を持つか否かのみ（中身の妥当性は見ない）
  if (Array.isArray(doc.vector_layers)) {
    return { ok: false, code: 'vector-tileset' };
  }

  if (!Array.isArray(doc.tiles) || doc.tiles.length === 0 || typeof doc.tiles[0] !== 'string') {
    return { ok: false, code: 'missing-tiles' };
  }

  const fields: TileJsonMappedFields = {
    url: doc.tiles[0],
    minZoom: isFiniteNumber(doc.minzoom) ? doc.minzoom : TILEJSON_DEFAULT_MIN_ZOOM,
    maxZoom: isFiniteNumber(doc.maxzoom) ? doc.maxzoom : TILEJSON_DEFAULT_MAX_ZOOM,
  };
  if (typeof doc.attribution === 'string') {
    fields.attr = doc.attribution;
  }
  if (typeof doc.name === 'string') {
    fields.title = doc.name;
  }
  if (isValidBounds(doc.bounds)) {
    fields.coverageLngLats = bboxToEnvelope(doc.bounds);
  }

  return { ok: true, fields, sourceUrl: url };
}
