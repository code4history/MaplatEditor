// POI エディタ地図の markerStyle icon 解決ロジック（純粋関数）。
// viewer (MaplatCore createIconSet + setMarker) と整合する icon 起点ペア継承モデル。
// window/document に依存せず Node 安全（E2E spec から直接 import 可能）。

/**
 * viewer (MaplatCore createIconSet) と整合する icon ペア解決。
 * feature.icon があれば feature の (icon, selectedIcon) ペアを使い、
 * なければ layerMeta の (icon, selectedIcon) ペアを継承する。
 * いずれもなければ null。
 */
export function resolveIconPair(
  properties: Record<string, unknown> | undefined,
  layerMeta: Record<string, unknown> | undefined,
): { icon: string; selectedIcon?: string } | null {
  // feature.icon があれば feature ペアを使用（祖先を見ない）
  const fIcon = properties?.icon;
  if (typeof fIcon === "string" && fIcon.trim() !== "") {
    const fSelected = properties?.selectedIcon;
    return {
      icon: fIcon.trim(),
      ...(typeof fSelected === "string" && fSelected.trim() !== ""
        ? { selectedIcon: fSelected.trim() }
        : {}),
    };
  }
  // layerMeta.icon があれば layer ペアを継承
  const lIcon = layerMeta?.icon;
  if (typeof lIcon === "string" && lIcon.trim() !== "") {
    const lSelected = layerMeta?.selectedIcon;
    return {
      icon: lIcon.trim(),
      ...(typeof lSelected === "string" && lSelected.trim() !== ""
        ? { selectedIcon: lSelected.trim() }
        : {}),
    };
  }
  return null;
}

/**
 * viewer (MaplatCore setMarker) と整合する表示 icon 文字列決定。
 * pair があれば通常時は pair.icon、選択時は pair.selectedIcon (なければ pair.icon)。
 * pair が null なら null（呼び出し側が既定ピンへフォールバック）。
 */
export function resolveDisplayIcon(
  pair: { icon: string; selectedIcon?: string } | null,
  selected: boolean,
): string | null {
  if (!pair) return null;
  if (selected && pair.selectedIcon) return pair.selectedIcon;
  return pair.icon;
}

/**
 * E2E 検証用: icon ペア解決 + 表示 icon 決定 + source 帰属を1呼び出しで返す。
 * Playwright spec が Node 側で直接 import して使用する（window 公開なし・テストフック混入なし）。
 * source は properties.icon の有無で決定する（v1.4 Major-1 修正）。
 */
export function resolveIconPairForTest(
  properties: Record<string, unknown> | undefined,
  layerMeta: Record<string, unknown> | undefined,
  selected: boolean,
): { resolvedIcon: string | null; source: "feature" | "layer" | "default" } {
  const pair = resolveIconPair(properties, layerMeta);
  const display = resolveDisplayIcon(pair, selected);
  if (!pair || display === null) {
    return { resolvedIcon: null, source: "default" };
  }
  // source は properties.icon の有無で決定（pair === null の判定ではない）
  const fIcon = properties?.icon;
  const source =
    typeof fIcon === "string" && fIcon.trim() !== "" ? "feature" : "layer";
  return { resolvedIcon: display, source };
}
