import { isEqual } from 'lodash-es';
import { validateWorldFile, type CrsObject } from '@maplat/transform';
import type { PreparedAdoption, TransformLayer } from '../composables/useLayerTransformState';
import type { SelectedCrsCandidate } from '../types/crsEstimation';
import { projectionEngineForCrs } from './compiledGeo.ts';
import {
  CrsReprojectionError, crsToLonLat, geodesicDistanceMeters, reprojectLayerCoords,
} from './crsProjection.ts';

export interface CrsAdoptionSelection {
  selected: SelectedCrsCandidate;
  setup: 'A' | 'B' | 'C';
}

function normalizeAdoptionCrs(source: CrsObject): CrsObject {
  const crs = { ...source };
  if (crs.proj4) {
    crs.proj4 = crs.proj4.replace(/\+axis=([^\s+]*)/gi, (_, axis: string) => {
      if (axis !== 'enu') throw new Error('unsupported_axis');
      return '';
    }).trim();
  }
  projectionEngineForCrs(crs).validateDefinition?.(crs);
  return crs;
}

/** 候補の検査と座標変換を一時コピーで完了させ、採用可能な入力だけを返す。 */
export async function prepareCrsAdoption(
  layer: TransformLayer,
  selection: CrsAdoptionSelection,
  signal: AbortSignal,
): Promise<PreparedAdoption> {
  const { selected, setup } = selection;
  if (signal.aborted) throw new Error('採用が取り消されました');
  if (!selected?.coreCompatible || !selected.crs || !selected.worldFile) throw new Error('core_incompatible');
  validateWorldFile(selected.worldFile);
  const crs = normalizeAdoptionCrs(selected.crs);
  const oldCrs = layer.intent.setup === 'legacyV2' ? undefined : layer.intent.crs;
  const reprojected = reprojectLayerCoords(layer.gcps, layer.edges, oldCrs, crs);
  const references = selected.gcpsNew;
  if (!Array.isArray(references) || references.length !== reprojected.gcps.length) {
    throw new CrsReprojectionError('reference_mismatch', { kind: 'gcp', index: 0 });
  }
  // 推定側の投影と東・北の軸順と単位が一致することを全 GCP で確認する。
  references.forEach((reference, index) => {
    const location = { kind: 'gcp', index } as const;
    const [pixel] = reprojected.gcps[index];
    if (!isEqual(reference.pixel, pixel)) throw new CrsReprojectionError('reference_mismatch', location);
    const original = crsToLonLat(layer.gcps[index][1], oldCrs);
    const expected = crsToLonLat(reference.geo, crs);
    const distance = original === false || expected === false ? Number.NaN : geodesicDistanceMeters(original, expected);
    if (!(distance <= 1.0)) throw new CrsReprojectionError('reference_mismatch', location, distance);
    reprojected.gcps[index][1] = [...reference.geo];
  });
  if (signal.aborted) throw new Error('採用が取り消されました');
  const intent = setup === 'C'
    ? { setup, crs: crs } as const
    : { setup, crs: crs, worldFile: { ...selected.worldFile } } as const;
  return {
    intent, buildOptions: structuredClone(layer.buildOptions),
    gcps: reprojected.gcps, edges: reprojected.edges,
  };
}
