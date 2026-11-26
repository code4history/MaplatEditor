import { cloneDeep } from 'lodash-es';
import Tin from '@maplat/tin';
import { normalizeEdges } from '@maplat/transform';
import { compiledPointToExternalCrs, reverseFollowEdgeAxis } from './compiledGeo.ts';
import { resolveTinBuildOptions, yaxisModeFromCrs } from './tinOptions.ts';
import type { CompiledTransformData, CrsObject, StrictMode, VertexMode, WorldFile, YaxisMode } from '@maplat/transform';
import type { LayerBuildOptions, LayerTransformIntent, TransformLayer } from '../composables/useLayerTransformState';

/** 層に保存されている y 軸の向き（compiled、層の直下、地図最上位の順）。 */
type StoredYaxis = { yaxisMode?: YaxisMode; compiled?: { yaxisMode?: YaxisMode } | null } | null | undefined;

function storedYaxisMode(layer: StoredYaxis, compiled?: StoredYaxis, defaults?: { yaxisMode?: YaxisMode }): YaxisMode | undefined {
  return (compiled ?? layer?.compiled)?.yaxisMode ?? layer?.yaxisMode ?? defaults?.yaxisMode;
}

export function deriveIntentFromStoredLayer(layer: any, compiled?: any, defaults?: { yaxisMode?: YaxisMode }): LayerTransformIntent {
  if (layer?.tinEnabled === false) {
    return { setup: 'A', crs: layer.crs as CrsObject, worldFile: layer.worldFile as WorldFile };
  }
  if (layer?.crs === undefined) {
    // crs の無い V2 は、保存されている向きをそのまま使う。既定の invert は省く。
    return storedYaxisMode(layer, compiled, defaults) === 'follow'
      ? { setup: 'legacyV2', yaxisMode: 'follow' }
      : { setup: 'legacyV2' };
  }
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
  };
}

/** 層が Tin を作るときの y 軸の向き。crs のある層は crs から導き、旧 V2 は保存されていた値。 */
export function layerYaxisMode(layer: Pick<TransformLayer, 'intent'>): YaxisMode {
  const { intent } = layer;
  return intent.setup === 'legacyV2' ? intent.yaxisMode ?? 'invert' : yaxisModeFromCrs(intent.crs);
}

/**
 * 読み込んだ compiled の向きが、層の向き（crs から導いた値）と食い違うか。
 * 食い違う compiled は鏡に映したような対応で正しく変換できないので、種付けせず作り直す。
 */
export function compiledYaxisMismatch(
  layer: Pick<TransformLayer, 'intent'>,
  compiled: { yaxisMode?: YaxisMode } | null | undefined,
): { stored: YaxisMode; derived: YaxisMode } | undefined {
  if (!compiled || typeof compiled !== 'object' || layer.intent.setup === 'A') return undefined;
  const stored = compiled.yaxisMode ?? 'invert';
  const derived = layerYaxisMode(layer);
  return stored === derived ? undefined : { stored, derived };
}

/** 三角網を作り直す必要があるか。想定外の生成エラー（unknownError）は、次の機会にやり直す。 */
export function shouldRebuildTin(state: { status: string; tin?: unknown } | undefined): boolean {
  return !state || state.status !== 'ready' || state.tin === 'unknownError';
}

export function resolveTransformLayerTinOptions(layer: TransformLayer) {
  const { intent, buildOptions } = layer;
  const document = intent.setup === 'legacyV2' ? (intent.yaxisMode ? { yaxisMode: intent.yaxisMode } : {}) : {
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

type LayerDocumentDefaults = Partial<LayerBuildOptions> & { yaxisMode?: YaxisMode; width?: number; height?: number; bounds?: number[][] };

export function transformLayerFromDocument(
  layerId: string,
  layer: any,
  compiled: any,
  defaults?: LayerDocumentDefaults,
): TransformLayer {
  const actual = typeof compiled === 'object' && compiled !== null ? compiled : layer?.compiled;
  const intent = deriveIntentFromStoredLayer(layer, actual, defaults);
  const width = Number(defaults?.width) || 0;
  const height = Number(defaults?.height) || 0;
  const defaultBounds = defaults?.bounds ?? (width && height ? [[0, 0], [width, 0], [width, height], [0, height]] : undefined);
  const bounds = layerId === 'main'
    ? [Number(layer?.width) || 0, Number(layer?.height) || 0]
    : layer?.bounds ?? actual?.bounds ?? defaultBounds;
  const gcps: TransformLayer['gcps'] = cloneDeep(layer?.gcps ?? actual?.points ?? []);
  const edges: TransformLayer['edges'] = cloneDeep(normalizeEdges(layer?.edges ?? actual?.edges ?? []));
  // 編集・履歴・下書きには、Tin へ渡す外部の座標（東・北、旧 V2 は保存時の向き）を入れる。
  // 保存された compiled の点列は、それを作った Tin の内部軸なので、compiled の向きで外部へ戻す。
  // crs と compiled の向きが食い違っていても、戻すのは compiled の向きで（作った時の向き）、
  // 作り直しは crs から導いた向きで行う（`compiledYaxisMismatch`）。
  const fromFollow = intent.setup !== 'A' && actual?.yaxisMode === 'follow';
  if (fromFollow) {
    for (const gcp of gcps) gcp[1] = compiledPointToExternalCrs(gcp[1], 'follow');
  }
  return {
    layerId,
    intent,
    buildOptions: deriveLayerBuildOptions(layer, actual, defaults),
    gcps,
    edges: fromFollow ? reverseFollowEdgeAxis(edges) : edges,
    ...(bounds !== undefined ? { bounds: cloneDeep(bounds) } : {}),
    ...(layer?.importance !== undefined ? { importance: layer.importance } : {}),
    ...(layer?.priority !== undefined ? { priority: layer.priority } : {}),
  };
}
