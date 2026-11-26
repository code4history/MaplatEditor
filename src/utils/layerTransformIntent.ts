import { cloneDeep } from 'lodash-es';
import Tin from '@maplat/tin';
import { normalizeEdges } from '@maplat/transform';
import { compiledPointToExternalCrs, reverseFollowEdgeAxis } from './compiledGeo.ts';
import { resolveTinBuildOptions } from './tinOptions.ts';
import type { CompiledTransformData, CrsObject, StrictMode, VertexMode, WorldFile, YaxisMode } from '@maplat/transform';
import type { LayerBuildOptions, LayerTransformIntent, TransformLayer } from '../composables/useLayerTransformState';

export function deriveIntentFromStoredLayer(layer: any, compiled?: any): LayerTransformIntent {
  if (layer?.tinEnabled === false) {
    return { setup: 'A', crs: layer.crs as CrsObject, worldFile: layer.worldFile as WorldFile };
  }
  if (layer?.crs === undefined) return { setup: 'legacyV2' };
  const actual = compiled ?? layer?.compiled;
  if (actual?.outerTransform === 'worldFile' && actual?.worldFile) {
    return { setup: 'B', crs: layer.crs as CrsObject, worldFile: actual.worldFile as WorldFile };
  }
  return { setup: 'C', crs: layer.crs as CrsObject };
}

export function deriveLayerBuildOptions(layer: any, compiled?: any, defaults?: Partial<LayerBuildOptions>): LayerBuildOptions {
  const actual = compiled ?? layer?.compiled;
  return {
    strictMode: (actual?.strictMode ?? layer?.strictMode ?? defaults?.strictMode ?? 'strict') as StrictMode,
    vertexMode: (actual?.vertexMode ?? layer?.vertexMode ?? defaults?.vertexMode ?? 'plain') as VertexMode,
    yaxisMode: (actual?.yaxisMode ?? layer?.yaxisMode ?? defaults?.yaxisMode ?? 'invert') as YaxisMode,
  };
}

export function resolveTransformLayerTinOptions(layer: TransformLayer) {
  const { intent, buildOptions } = layer;
  const document = intent.setup === 'legacyV2' ? {} : {
    crs: intent.crs,
    ...(intent.setup === 'A' ? { tinEnabled: false } : {}),
    ...('worldFile' in intent ? { worldFile: intent.worldFile } : {}),
  };
  return resolveTinBuildOptions(document, buildOptions, intent.setup);
}

export function seedCompiledTin(layer: TransformLayer, compiled: CompiledTransformData): Tin {
  const options = resolveTransformLayerTinOptions(layer);
  if (!options) throw new Error('ワールドファイルだけの層に三角網は設定できません');
  const tin = new Tin(options);
  tin.setCompiled(compiled);
  return tin;
}

export function transformLayerFromDocument(
  layerId: string,
  layer: any,
  compiled: any,
  defaults?: Partial<LayerBuildOptions>,
): TransformLayer {
  const actual = typeof compiled === 'object' && compiled !== null ? compiled : layer?.compiled;
  const intent = deriveIntentFromStoredLayer(layer, actual);
  const gcps: TransformLayer['gcps'] = cloneDeep(layer?.gcps ?? actual?.points ?? []);
  const edges: TransformLayer['edges'] = cloneDeep(normalizeEdges(layer?.edges ?? actual?.edges ?? []));
  // 投影済み層の編集・履歴・下書きには、東・北の外部 CRS 座標を入れる。
  // compiled 由来の点列だけ、読み込み時に Tin の内部軸を戻す。
  const fromFollow = intent.setup !== 'legacyV2' && intent.setup !== 'A' && actual?.yaxisMode === 'follow';
  if (fromFollow) {
    for (const gcp of gcps) gcp[1] = compiledPointToExternalCrs(gcp[1], 'follow');
  }
  return {
    layerId,
    intent,
    buildOptions: deriveLayerBuildOptions(layer, actual, defaults),
    gcps,
    edges: fromFollow ? reverseFollowEdgeAxis(edges) : edges,
    ...(layer?.bounds !== undefined || layerId === 'main'
      ? { bounds: cloneDeep(layerId === 'main' ? [Number(layer?.width) || 0, Number(layer?.height) || 0] : layer.bounds) }
      : {}),
    ...(layer?.importance !== undefined ? { importance: layer.importance } : {}),
    ...(layer?.priority !== undefined ? { priority: layer.priority } : {}),
  };
}
