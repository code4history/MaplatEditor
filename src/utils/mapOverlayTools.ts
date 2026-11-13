// 地図の上に重ねる UI の共通部品（docs/ui-map-overlay-proposal.md §4.2 案 A）。
// - OL の既定の部品の名前（i18n）とアイコン
// - 左上の一列（ズーム → 回転のリセット → 住所検索）と右下の余白の並べ方
// - 編集中・参考の図形の縁取り（白の halo と濃い灰の細線）と取っ手の色
import { defaults as controlDefaults } from 'ol/control';
import type { Collection } from 'ol';
import type Control from 'ol/control/Control';
import Style, { type RenderFunction, type StyleFunction } from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import CircleStyle from 'ol/style/Circle';
import LayerSwitcher from 'ol-layerswitcher';
import type OlMap from 'ol/Map';
import type { EventsKey } from 'ol/events';
import { unByKey } from 'ol/Observable';

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

// ---- 地図の上に描く文字（帰属表示・ベースマップの名前）の escape ----
// OL の帰属表示（ol/control/Attribution）と ol-layerswitcher のレイヤ名は innerHTML で描かれる。
// 著作権表示とベースマップの名前は利用者の入力や取り込んだデータから来るので、HTML として解釈させず
// 文字として出す（例: 著作権表示に <img src="https://…"> を書いても要素は作らず外部へ要求も出さない）。

/** 文字列を HTML の文字として escape する（innerHTML に入れても要素にならない） */
export function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `source.setAttributions` に渡す帰属表示。空なら空の配列、あれば escape した 1 件 */
export function textAttributions(value: unknown): string[] {
  const text = value == null ? '' : String(value).trim();
  return text ? [escapeHtmlText(text)] : [];
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
export function layoutMapOverlayControls(
  mapEl: HTMLElement | null,
  toolsEl?: HTMLElement | null,
  labels?: { searchAddress?: string },
): void {
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
  if (geocoderButton) {
    if (!geocoderButton.querySelector('.bi')) {
      geocoderButton.textContent = '';
      geocoderButton.appendChild(iconElement('bi-search'));
    }
    if (labels?.searchAddress) {
      geocoderButton.setAttribute('title', labels.searchAddress);
      geocoderButton.setAttribute('aria-label', labels.searchAddress);
    }
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

type PixelCoordinates = Parameters<RenderFunction>[0];

/** 描画関数に渡る画素座標（線・面・その集まり）を、線の経路として辿る */
function tracePath(context: CanvasRenderingContext2D, coords: PixelCoordinates, close: boolean): void {
  if (!Array.isArray(coords) || coords.length === 0) return;
  if (typeof coords[0] === 'number') return;
  if (Array.isArray(coords[0]) && typeof (coords[0] as unknown[])[0] === 'number') {
    const path = coords as number[][];
    context.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) context.lineTo(path[i][0], path[i][1]);
    if (close) context.closePath();
    return;
  }
  for (const child of coords as PixelCoordinates[]) tracePath(context, child, close);
}

/**
 * 縁取りの線だけを描く描画関数。当たり判定（`hitDetectionRenderer`）では何も描かない。
 * 縁取りを付けても、地物の当たり判定の幅は色の線（縁取りを付ける前と同じ幅）のままにする。
 *
 * OL は描画関数のスタイルを同じ zIndex の中で最後に描く（線・点の後）。そのままでは縁取りが
 * 色の線の上に載るので、zIndex を負にして色の線（zIndex 0）より先に描く。外側の線（-2）→
 * 白の縁取り（-1）の順にし、図形が重なっても白の縁取りが他の図形の外線に切られないようにする。
 */
function underlayStyle(width: number, color: string, zIndex: number, dash?: number[]): Style {
  const renderer: RenderFunction = (coords, state) => {
    const context = state.context;
    const ratio = state.pixelRatio;
    const close = /Polygon/.test(state.geometry.getType());
    context.save();
    context.beginPath();
    tracePath(context, coords, close);
    context.lineWidth = width * ratio;
    context.strokeStyle = color;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.setLineDash(dash ? dash.map((d) => d * ratio) : []);
    context.stroke();
    context.restore();
  };
  return new Style({ renderer, hitDetectionRenderer: () => {}, zIndex });
}

/**
 * 線の外側に白 1.5px の halo、さらに外に濃い灰の細線を重ねたスタイル（編集中の図形）。
 * `outline: false` のときは白の halo だけにする（参考の図形。§4.2）。
 * 当たり判定は色の線と塗りだけで行う（縁取りでは広げない）。
 */
export function haloLineStyles(
  color: string,
  width: number,
  options?: { fill?: string; dash?: number[]; outline?: boolean },
): Style[] {
  const dash = options?.dash;
  const outline = options?.outline ?? true;
  return [
    ...(options?.fill ? [new Style({ fill: new Fill({ color: options.fill }) })] : []),
    ...(outline ? [underlayStyle(width + HALO_WIDTH * 2 + 2, HALO_OUTER, -2, dash)] : []),
    underlayStyle(width + HALO_WIDTH * 2, '#ffffff', -1, dash),
    new Style({ stroke: new Stroke({ color, width, ...(dash ? { lineDash: [...dash] } : {}) }) }),
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
export function editSketchStyleFunction(color: string, lineWidth = 2): StyleFunction {
  const vertex = handleStyles(color);
  const line = haloLineStyles(color, lineWidth);
  return (feature) => (feature.getGeometry()?.getType() === 'Point' ? vertex : line);
}

// ---- ベースマップの切り替え（§4.2 表示の切り替え） ----

export interface BaseMapSwitcher {
  control: MapBaseMapSwitcherControl;
  /** 現在の選択の名前を札に書き直す */
  refreshLabel: () => void;
}

let switcherSeq = 0;

/**
 * 今の選択の名前を札に出し、クリックで開くベースマップの切り替え。
 * 全部の地図（MapEdit・POI・ホーム位置と範囲の小窓）で同じ部品を使う。
 *
 * ol-layerswitcher の 'click' モードに次を足す（§4.2 表示の切り替え）。
 * - 選んだら閉じる（ポインタで選んだとき・Enter）。矢印キーで選び直している間は開いたまま
 * - 地図を押したとき・Esc で閉じる
 * - 札に aria-expanded、読み上げ名に今の選択の名前を含める
 * - ラジオに同じ name を付け、矢印キーで選び直せるようにする（描き直しの後もフォーカスを戻す）
 */
export class MapBaseMapSwitcherControl extends LayerSwitcher {
  private labelOf: () => string = () => '';
  private tipText = '';
  private radioName = '';
  private pointerSelecting = false;
  private refocusChecked = false;
  private mapKeys: EventsKey[] = [];

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
    this.radioName = `map-base-map-switcher-${++switcherSeq}`;
    this.button.setAttribute('aria-haspopup', 'true');

    const panel = this.panel as HTMLElement;
    // ol-layerswitcher は選び直すたびにパネルを描き直す（静的な renderPanel を直接呼ぶ）。
    // 描き直しの完了はパネルの rendercomplete で分かるので、そこでラジオに name を付ける
    panel.addEventListener('rendercomplete', () => this.decoratePanel());
    panel.addEventListener('pointerdown', () => {
      this.pointerSelecting = true;
    });
    panel.addEventListener('change', (event) => {
      if ((event.target as HTMLInputElement | null)?.type !== 'radio') return;
      if (this.pointerSelecting) {
        this.pointerSelecting = false;
        this.hidePanel();
      } else {
        // キーボード（矢印キー）で選び直した。描き直しで失うフォーカスを選んだラジオへ戻す
        this.refocusChecked = true;
        this.focusChecked();
      }
    });
    (this.element as HTMLElement).addEventListener('keydown', (event: KeyboardEvent) => {
      // ポインタで押した後にキーボードで選び直したときは、キーボードの扱いにする
      this.pointerSelecting = false;
      if (!this.isShown()) return;
      const onRadio = (event.target as HTMLInputElement | null)?.type === 'radio';
      if (event.key === 'Escape' || (event.key === 'Enter' && onRadio)) {
        event.preventDefault();
        event.stopPropagation();
        this.hidePanel();
        this.button.focus();
      }
    });
    this.refreshLabel();
  }

  private isShown(): boolean {
    return (this.element as HTMLElement | null)?.classList.contains('shown') ?? false;
  }

  private decoratePanel(): void {
    this.panel.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input) => {
      input.name = this.radioName;
    });
    if (this.refocusChecked) this.focusChecked();
  }

  private focusChecked(): void {
    const checked = this.panel.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    if (!checked) return;
    this.refocusChecked = false;
    checked.focus();
  }

  setMap(map: OlMap | null): void {
    this.mapKeys.forEach((key) => unByKey(key));
    this.mapKeys = [];
    super.setMap(map as OlMap);
    if (map) {
      // 地図を押したら閉じる（'click' モードの ol-layerswitcher は閉じない）
      this.mapKeys.push(map.on('pointerdown' as any, () => this.hidePanel()));
    }
  }

  hidePanel(): void {
    this.pointerSelecting = false;
    this.refocusChecked = false;
    super.hidePanel();
  }

  /** 現在の選択の名前を札に書き直す（開閉のたびにも呼ばれる） */
  refreshLabel(): void {
    if (!this.tipText) return;
    const button = this.button;
    const current = this.labelOf();
    button.textContent = '';
    button.classList.add('map-tool', 'map-tool--wide', 'map-base-map-switcher__trigger');
    const label = document.createElement('span');
    label.className = 'map-base-map-switcher__label';
    label.textContent = current;
    button.appendChild(label);
    const caret = iconElement('bi-caret-down-fill');
    caret.classList.add('map-base-map-switcher__caret');
    button.appendChild(caret);
    const name = current ? `${this.tipText}: ${current}` : this.tipText;
    button.setAttribute('aria-label', name);
    button.setAttribute('title', name);
    button.setAttribute('aria-expanded', this.isShown() ? 'true' : 'false');
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
