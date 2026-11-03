// The internal tile pyramid of a map image: 256 px tiles, z = 0 is the smallest level and z = maxZoom is the
// image at full size. The upload writes the tiles with these formulas and the readers use the same ones.
// No electron import, so the main process code and the tests can both load it.

export const TILE_SIZE = 256;

/** The largest zoom level of the pyramid. Images of 256 px or less have a single level, z = 0. */
export function tileMaxZoom(width: number, height: number): number {
  return Math.max(0, Math.ceil(Math.log(Math.max(width, height) / TILE_SIZE) / Math.log(2)));
}

/** The size of the whole image at zoom level z. */
export function tileLevelSize(width: number, height: number, maxZoom: number, z: number): { pw: number; ph: number } {
  const scale = Math.pow(2, maxZoom - z);
  return { pw: Math.round(width / scale), ph: Math.round(height / scale) };
}
