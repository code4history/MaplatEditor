import { isEqual } from 'lodash-es';
import { validateWorldFile } from '@maplat/transform';
import type { PreparedAdoption, TransformLayer } from '../composables/useLayerTransformState';
import type { SelectedCrsCandidate } from '../types/crsEstimation';
import {
  CrsReprojectionError, crsToLonLat, geodesicDistanceMeters, reprojectLayerCoords,
} from './crsProjection.ts';

export interface CrsAdoptionSelection {
  selected: SelectedCrsCandidate;
  setup: 'A' | 'B' | 'C';
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
  const oldCrs = layer.intent.setup === 'legacyV2' ? undefined : layer.intent.crs;
  const reprojected = reprojectLayerCoords(layer.gcps as any, layer.edges as any, oldCrs, selected.crs);
  const references = selected.gcpsNew;
  if (references?.length === reprojected.gcps.length && references.every((reference, index) =>
    isEqual(reference.pixel, reprojected.gcps[index][0]))) {
    references.forEach((reference, index) => {
      const actual = crsToLonLat(reprojected.gcps[index][1], selected.crs);
      const expected = crsToLonLat(reference.geo, selected.crs);
      const distance = actual === false || expected === false ? Number.NaN : geodesicDistanceMeters(actual, expected);
      if (!(distance <= 1.0)) {
        throw new CrsReprojectionError('reference_mismatch', { kind: 'gcp', index }, distance);
      }
      reprojected.gcps[index][1] = [...reference.geo];
    });
  }
  if (signal.aborted) throw new Error('採用が取り消されました');
  const intent = setup === 'C'
    ? { setup, crs: structuredClone(selected.crs) } as const
    : { setup, crs: structuredClone(selected.crs), worldFile: structuredClone(selected.worldFile) } as const;
  return {
    intent, buildOptions: structuredClone(layer.buildOptions),
    gcps: reprojected.gcps as TransformLayer['gcps'], edges: reprojected.edges as TransformLayer['edges'],
  };
}
