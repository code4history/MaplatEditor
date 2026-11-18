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

/**
 * IIIF のまま配る地図から、手で入れたタイルの URL（`url`）と、それから作った実行時の URL（`url_`）を外す。
 *
 * この地図のタイルは IIIF の配信先（info.json）から取る。MaplatCore は `delivery` があると `url` を
 * 捨てて警告するだけなので、`url` には意味が無い。それどころか、保存のときに `url_` ができると、
 * 「タイルの実体を持たない地図」として扱えなくなる（取り込みで置いたサムネイルが移らない）。
 * ∴ 読み込み・保存・書き出し・取り込みの入口で外す。IIIF でない地図は、そのまま返す（同じオブジェクト）。
 */
export function withoutManualTileUrl<T>(mapDoc: T): T {
  if (!hasIiifDelivery(mapDoc)) return mapDoc;
  const { url: _url, url_: _runtimeUrl, ...rest } = mapDoc as Record<string, unknown>;
  return rest as T;
}
