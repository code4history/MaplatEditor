/**
 * 地図データが「IIIF のまま配る地図」かどうか。
 *
 * `delivery`（配信先の URL）を持つ地図だけが真になる。この地図は画像を IIIF の
 * サーバーから配るので、書き出しの ZIP にタイルの実体を同梱しない
 * （アプリの書き出しと地図 1 枚の ZIP の両方で、この 1 つの判定を使う）。
 */
export function hasIiifDelivery(mapDoc: unknown): boolean {
  const delivery = (mapDoc as { delivery?: { url?: unknown } } | null | undefined)?.delivery;
  if (!delivery) return false;
  return typeof delivery.url === 'string';
}
