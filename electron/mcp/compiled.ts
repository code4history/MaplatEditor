// Where a map read for editing keeps the compiled transformation of its main layer.

/** The compiled transformation of the main layer, or null when the map has none (too few GCPs, never compiled). */
export function compiledOf(map: { compiledTins?: unknown } | null | undefined): Record<string, unknown> | null {
  const first = Array.isArray(map?.compiledTins) ? map.compiledTins[0] : undefined;
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}
