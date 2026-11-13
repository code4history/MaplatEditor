// 地図の上に重ねる UI の共通部品（docs/ui-map-overlay-proposal.md §4.2 案 A）。
// - OL の既定の部品の名前（i18n）とアイコン
// - 左上の一列（ズーム → 回転のリセット → 住所検索）と右下の余白の並べ方
// - 編集中・参考の図形の縁取り（白の halo と濃い灰の細線）と取っ手の色
import { defaults as controlDefaults } from 'ol/control';
import type { Collection } from 'ol';
import type Control from 'ol/control/Control';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import CircleStyle from 'ol/style/Circle';
import LayerSwitcher from 'ol-layerswitcher';

export const MAP_TOOL_EDGE = 'rgba(0,0,0,.45)';
export const HALO_OUTER = '#555555';
export const HALO_WIDTH = 1.5;

/** Bootstrap Icons のアイコンを作る（OL の label に渡す） */
export function iconElement(className: string): HTMLElement {
  const el = document.createElement('i');
  el.className = `bi ${className}`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export interface MapOverlayControlLabels {
  zoomIn: string;
  zoomOut: string;
  resetRotation: string;
}

/**
 * 地図の上の OL の部品の名前を渡した `controlDefaults` を作る。
 * 小窓も同じ名前に揃える（§5-3）。
 */
export function mapOverlayControlDefaults(labels: MapOverlayControlLabels): Collection<Control> {
  return controlDefaults({
    zoomOptions: {
      zoomInLabel: iconElement('bi-plus-lg'),
      zoomOutLabel: iconElement('bi-dash-lg'),
      zoomInTipLabel: labels.zoomIn,
      zoomOutTipLabel: labels.zoomOut,
    },
    rotateOptions: {
      label: iconElement('bi-compass'),
      tipLabel: labels.resetRotation,
    },
    attributionOptions: {
      collapsible: false,
    },
  });
}

/**
 * 地図の上の部品を §4.2 の配置へ並べ替える。
 * 左上にズーム・回転のリセット・住所検索を一列にまとめ、
 * 右下の余白（`toolsEl`）の最下段に帰属表示を置く。
 * OL の部品の `title` を `aria-label` に写し、住所検索の拡大鏡を Bootstrap Icons にする。
 */
export function layoutMapOverlayControls(mapEl: HTMLElement | null, toolsEl?: HTMLElement | null): void {
  const overlay = mapEl?.querySelector('.ol-overlaycontainer-stopevent');
  if (!overlay) return;

  let column = overlay.querySelector<HTMLElement>('.map-overlay-column');
  if (!column) {
    column = document.createElement('div');
    column.className = 'map-overlay-column';
    overlay.appendChild(column);
  }
  for (const selector of ['.ol-zoom', '.ol-rotate', '.ol-geocoder']) {
    const el = overlay.querySelector<HTMLElement>(selector);
    if (el && el.parentElement !== column) column.appendChild(el);
  }

  const geocoderButton = overlay.querySelector<HTMLElement>('.ol-geocoder .gcd-gl-btn');
  if (geocoderButton && !geocoderButton.querySelector('.bi')) {
    geocoderButton.textContent = '';
    geocoderButton.appendChild(iconElement('bi-search'));
  }

  if (toolsEl) {
    const attribution = overlay.querySelector<HTMLElement>('.ol-attribution');
    if (attribution && attribution.parentElement !== toolsEl) toolsEl.appendChild(attribution);
  }

  overlay.querySelectorAll<HTMLElement>('button[title]').forEach((button) => {
    if (!button.getAttribute('aria-label') && button.title) {
      button.setAttribute('aria-label', button.title);
    }
  });
}

// ---- 編集中・参考の図形の縁取り（§4.2） ----

/** 線の外側に白 1.5px の halo、さらに外に濃い灰の細線を重ねたスタイル */
export function haloLineStyles(
  color: string,
  width: number,
  options?: { fill?: string; dash?: number[] },
): Style[] {
  const dash = options?.dash;
  const stroke = (w: number, c: string) =>
    new Stroke({ color: c, width: w, ...(dash ? { lineDash: [...dash] } : {}) });
  return [
    new Style({
      ...(options?.fill ? { fill: new Fill({ color: options.fill }) } : {}),
      stroke: stroke(width + HALO_WIDTH * 2 + 2, HALO_OUTER),
    }),
    new Style({ stroke: stroke(width + HALO_WIDTH * 2, '#ffffff') }),
    new Style({ stroke: stroke(width, color) }),
  ];
}

/** 点を不透明にし、外側に白 1.5px の halo と濃い灰の細線を重ねたスタイル */
export function haloPointStyles(
  color: string,
  radius: number,
  options?: { strokeColor?: string; strokeWidth?: number },
): Style[] {
  const strokeWidth = options?.strokeWidth ?? 0;
  const outer = radius + strokeWidth / 2 + HALO_WIDTH + 0.5;
  return [
    new Style({
      image: new CircleStyle({
        radius: outer,
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: HALO_OUTER, width: 1 }),
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color }),
        ...(strokeWidth
          ? { stroke: new Stroke({ color: options?.strokeColor ?? color, width: strokeWidth }) }
          : {}),
      }),
    }),
  ];
}

/** 取っ手（Modify の頂点）。編集中の図形の色にそろえ、白と濃い灰の縁取りを付ける */
export function handleStyles(color: string): Style[] {
  return [
    new Style({
      image: new CircleStyle({
        radius: 7.5,
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: HALO_OUTER, width: 1 }),
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color }),
        stroke: new Stroke({ color, width: 1 }),
      }),
    }),
  ];
}

/**
 * `Modify` / `Draw` の `style` に渡す関数。
 * 頂点は取っ手の色、線分は編集中の図形の色にそろえる（§5-7）。
 */
export function editSketchStyleFunction(color: string, lineWidth = 2) {
  const vertex = handleStyles(color);
  const line = haloLineStyles(color, lineWidth);
  return (feature: { getGeometry?: () => { getType(): string } | null }): Style[] =>
    feature.getGeometry?.()?.getType() === 'Point' ? vertex : line;
}

// ---- ベースマップの切り替え（§4.2 表示の切り替え） ----

export interface BaseMapSwitcher {
  control: MapBaseMapSwitcherControl;
  /** 現在の選択の名前を札に書き直す */
  refreshLabel: () => void;
}

/**
 * 今の選択の名前を札に出し、クリックで開くベースマップの切り替え。
 * 全部の地図（MapEdit・POI・ホーム位置と範囲の小窓）で同じ部品を使う。
 */
export class MapBaseMapSwitcherControl extends LayerSwitcher {
  private labelOf: () => string = () => '';
  private tipText = '';

  constructor(options: { tipLabel: string; labelOf: () => string }) {
    super({
      activationMode: 'click',
      label: '',
      collapseLabel: '',
      tipLabel: options.tipLabel,
      collapseTipLabel: options.tipLabel,
    });
    this.labelOf = options.labelOf;
    this.tipText = options.tipLabel;
    this.refreshLabel();
  }

  /** 現在の選択の名前を札に書き直す（開閉のたびにも呼ばれる） */
  refreshLabel(): void {
    if (!this.tipText) return;
    const button = this.button;
    button.textContent = '';
    button.classList.add('map-tool', 'map-tool--wide', 'map-base-map-switcher__trigger');
    const label = document.createElement('span');
    label.className = 'map-base-map-switcher__label';
    label.textContent = this.labelOf();
    button.appendChild(label);
    const caret = iconElement('bi-caret-down-fill');
    caret.classList.add('map-base-map-switcher__caret');
    button.appendChild(caret);
    button.setAttribute('aria-label', this.tipText);
    button.setAttribute('title', this.tipText);
    button.setAttribute('type', 'button');
  }

  protected updateButton(): void {
    this.refreshLabel();
  }
}

export function createBaseMapSwitcher(options: {
  tipLabel: string;
  labelOf: () => string;
}): BaseMapSwitcher {
  const control = new MapBaseMapSwitcherControl(options);
  return { control, refreshLabel: () => control.refreshLabel() };
}
