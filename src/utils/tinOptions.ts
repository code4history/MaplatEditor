export interface LayerTinBuildOptions {
  strictMode?: unknown;
  vertexMode?: unknown;
  yaxisMode?: unknown;
}

export type LayerTransformIntent = 'A' | 'B' | 'C' | 'legacyV2' | string | undefined;

/** 層直下の crs 鍵だけを基準に、従来 V2 と採用済み V4 外周を選ぶ。 */
export function resolveTinBuildOptions(
  layer: Record<string, any>,
  buildOptions: LayerTinBuildOptions = {},
  intent?: LayerTransformIntent,
): Record<string, unknown> {
  const common = {
    ...(buildOptions.strictMode !== undefined ? { strictMode: buildOptions.strictMode } : {}),
    ...(buildOptions.vertexMode !== undefined ? { vertexMode: buildOptions.vertexMode } : {}),
    ...(buildOptions.yaxisMode !== undefined ? { yaxisMode: buildOptions.yaxisMode } : {}),
  };
  if (!Object.prototype.hasOwnProperty.call(layer, 'crs')) return { useV2Algorithm: true, ...common };
  const compiled = layer.compiled ?? {};
  const outerTransform = intent === 'B' ? 'worldFile' : intent === 'C' ? 'extrapolate' : compiled.outerTransform;
  const worldFile = compiled.worldFile ?? layer.worldFile;
  return {
    useV2Algorithm: false,
    ...common,
    ...(outerTransform ? { outerTransform } : {}),
    ...(outerTransform === 'worldFile' && worldFile ? { worldFile } : {}),
  };
}
