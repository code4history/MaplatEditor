import { cloneDeep } from 'lodash-es';
import type { CrsObject, StrictMode, VertexMode, WorldFile, YaxisMode } from '@maplat/transform';
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
    yaxisMode: (actual?.yaxisMode ?? defaults?.yaxisMode ?? 'invert') as YaxisMode,
  };
}

export function transformLayerFromDocument(
  layerId: string,
  layer: any,
  compiled: any,
  defaults?: Partial<LayerBuildOptions>,
): TransformLayer {
  const intent = deriveIntentFromStoredLayer(layer, compiled);
  return {
    layerId,
    intent,
    buildOptions: deriveLayerBuildOptions(layer, compiled, defaults),
    gcps: cloneDeep(layer?.gcps ?? []),
    edges: cloneDeep(layer?.edges ?? []),
    ...(layer?.bounds !== undefined || layerId === 'main'
      ? { bounds: cloneDeep(layerId === 'main' ? [Number(layer?.width) || 0, Number(layer?.height) || 0] : layer.bounds) }
      : {}),
    ...(layer?.importance !== undefined ? { importance: layer.importance } : {}),
    ...(layer?.priority !== undefined ? { priority: layer.priority } : {}),
  };
}
