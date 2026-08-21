// m1-t2「ベースマップ位置合わせモードの新設」E2E。
// 設計: docs/superpowers/specs/2026-08-21-m1-t2-basemap-align-mode-task-design.md v1.0
// モード遷移の正本: マイルストーン設計 §6.2 のモード表（P0/P1/P2）・§6.2.1（バー表示値）。
// メニューの相の優先関係: タスク設計 §6.1（P1/P2 は F0/F1/F2 のいずれよりも優先・1 項目のみ）。
//
// 担当 AC:
//   AC1  副機能ドロップダウンに 3 つ目の選択肢が出る
//   AC2  バーに現在のベースマップの保持値が出る（未計測なら 0.00。P1/P2 は対象の保持値）
//   AC3  ベースマップ切替で表示値が随時そのベースマップの保持値へ変わる（§5.7）
//   AC4  保持値はセッション限り（リロードで 0 に戻る）
//   AC5  バー右端に「編集開始」ボタン
//   AC6  P1: (a) 地図面操作不可 (b) ドロップダウン操作不可 (c) 切替ラジオ 0 件 (d) ボタン文言
//   AC7  P1 で対象ソースの実効シフトが 0
//   AC8  P1 の地理面右クリックが「基準点を選ぶ」のみ（空き部分・GCP マーカー上・対応線上）。置き直し可
//   AC9  P2: ボタン文言・ベースマップが OSM
//   AC10 P2: 対象以外へ切替可・対象は候補に出ない。対象が OSM のとき編集開始が無効
//   AC11 P2: 非対象ベースマップには保持値が実効で載っている
//   AC12 P2 でも基準点マーカーが同じ位置に残る
//   AC13 P2 の右クリックが「Ground Truth を選ぶ」のみ。置き直し可
//   AC14 確定で shift = GT − 基準点 が保持値になり、バーと表示に反映される
//   AC16 レイヤ再構築でシフトが失われない（P1 中の再構築で切替禁止も解けない = MIN-3）
//   AC21 反復適用: 2 回目の編集開始で実効 0 へ戻り（画が動く機械観測）、確定値は置換
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((next) => window.settings.set('lang', next), 'ja');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // オフラインの e2e 環境ではベースマップタイル取得が失敗する（本タスクと無関係の環境ノイズ）
    if (text.includes('Failed to load resource')) return;
    errors.push(`console.error: ${text}`);
  });
  return { app, page, errors };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

// GCP3点（三角形）+ edge [0,1] 付きの地図を compiled tin 付きで seed する（m1-t1 と同型）
async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `mapedit-align-m1-t2-map-${Date.now()}`;
    const toMercIn = (x: number, y: number): number[] => [
      15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
      4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
    ];
    const mapObject = {
      mapID: slug,
      title: { ja: 'm1-t2 ベースマップ位置合わせ検証地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'm1-t2 attribution' }, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      gcps: [
        [[50, 250], toMercIn(50, 250)],
        [[350, 250], toMercIn(350, 250)],
        [[350, 50], toMercIn(350, 50)],
      ],
      edges: [[[], [], [0, 1]]],
      sub_maps: [],
      strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    const r1 = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`Map seed failed: ${JSON.stringify(r1)}`);
    const tinResult = await window.mapedit.updateTin(
      mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
      mapObject.strictMode, mapObject.vertexMode,
    );
    if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
      throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
    }
    const r2 = await window.mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tinResult[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`Compiled map save failed: ${JSON.stringify(r2)}`);
    return { uid: r2.uid, slug };
  });
}

async function forceGcpsTabReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).testDebug.mapData.value.url_ =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  });
  await page.evaluate(() => (window as any).testDebug.loadMapTiles());
  await page.waitForFunction(() => !!(window as any).testDebug.illstMapInfo().source, undefined, { timeout: 60000 });
}

async function openGcpsTab(page: Page): Promise<void> {
  await page.getByTestId('map-tab-gcps').click();
  await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 20000 });
  await expect.poll(
    async () => page.evaluate(() => (window as any).testDebug.edges.value.length),
    { timeout: 15000 },
  ).toBe(1);
}

type AlignDebug = {
  phase: string;
  targetMapID: string | null;
  shifts: Record<string, { x: number; y: number }>;
  referencePoint: number[] | null;
  groundTruth: number[] | null;
  baseLayers: Array<{ mapID: string; title: string; visible: boolean; mercatorXShift: number; mercatorYShift: number }>;
  alignFeatures: Array<{ kind: string; coord: number[] }>;
};

async function alignDebug(page: Page): Promise<AlignDebug> {
  return page.evaluate(() => (window as any).testDebug.basemapAlignDebug());
}

/** ベースマップの可視レイヤをプログラム的に切り替える（change:visible 購読 = §5.7 の検証も兼ねる） */
async function setVisibleBaseMap(page: Page, mapID: string): Promise<void> {
  await page.evaluate((id) => {
    const map = (window as any).testDebug.mercMapInfo().map;
    const rootLayer = map.getLayers().item(0);
    const layers = rootLayer?.get?.('layers') || rootLayer?.getLayers?.();
    layers.getArray().forEach((layer: any) => layer.setVisible(layer.get('mapID') === id));
  }, mapID);
}

/** LayerSwitcher のパネルを開いて描画させ、ラジオの数と対象ラベル群を返す */
async function layerSwitcherRadios(page: Page): Promise<{ count: number; labels: string[] }> {
  return page.evaluate(() => {
    const map = (window as any).testDebug.mercMapInfo().map;
    const ctrl = map.getControls().getArray()
      .find((c: any) => c.element?.classList?.contains('layer-switcher'));
    ctrl.showPanel();
    const inputs = Array.from(document.querySelectorAll('.layer-switcher input[type=radio]')) as HTMLInputElement[];
    const labels = inputs.map((input) => {
      const label = input.parentElement?.querySelector('label');
      return (label?.textContent || '').trim();
    });
    return { count: inputs.length, labels };
  });
}

const functionSelect = (page: Page) => page.locator('select:has(option[value="basemap_align"])');
const shiftX = (page: Page) => page.getByTestId('mapedit-align-shift-x');
const shiftY = (page: Page) => page.getByTestId('mapedit-align-shift-y');
const phaseButton = (page: Page) => page.getByTestId('mapedit-align-phase-button');

const MERC_MENU_SELECTOR = '#mercMap .ol-ctx-menu-container:not(.ol-ctx-menu-hidden) > ul > li';
const ILLST_MENU_SELECTOR = '#illstMap .ol-ctx-menu-container:not(.ol-ctx-menu-hidden) > ul > li';

async function mercMenuTexts(page: Page): Promise<string[]> {
  return page.evaluate((selector) =>
    Array.from(document.querySelectorAll(selector)).map((el) => (el as HTMLElement).innerText.trim()),
    MERC_MENU_SELECTOR);
}

/** merc 面の任意座標（EPSG:3857）で右クリックする */
async function rightClickMerc(page: Page, coord: number[], dyPx = 0): Promise<void> {
  const point = await page.evaluate(({ coord: c, dyPx: dy }) => {
    const info = (window as any).testDebug.mercMapInfo();
    const pixel = info.map.getPixelFromCoordinate(c);
    const rect = document.getElementById('mercMap')!.getBoundingClientRect();
    return { x: rect.left + pixel[0], y: rect.top + pixel[1] + dy };
  }, { coord, dyPx });
  await page.mouse.click(point.x, point.y, { button: 'right' });
}

async function centerMercOn(page: Page, coord: number[]): Promise<void> {
  await page.evaluate((c) => new Promise<void>((resolve) => {
    const map = (window as any).testDebug.mercMapInfo().map;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    map.once('rendercomplete', finish);
    map.getView().setCenter(c);
    map.render();
    setTimeout(finish, 3000);
  }), coord);
}

async function expectMercMenu(page: Page, expected: string[]): Promise<void> {
  await expect.poll(async () => (await mercMenuTexts(page)).join('|'), { timeout: 10000 })
    .toBe(expected.join('|'));
}

async function clickMercMenuItem(page: Page, text: string): Promise<void> {
  // メニューの描画は右クリック後に非同期で起きる ∴ 対象項目が出るまで待ってから押す
  await expect.poll(async () => (await mercMenuTexts(page)).includes(text), { timeout: 10000 }).toBe(true);
  const clicked = await page.evaluate(({ selector, label }) => {
    const items = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    const target = items.find((el) => el.innerText.trim() === label);
    if (!target) return false;
    target.click();
    return true;
  }, { selector: MERC_MENU_SELECTOR, label: text });
  expect(clicked, `メニュー項目「${text}」が merc 面に見つからない`).toBe(true);
}

/** merc の GCP マーカー座標（gcpIndex 指定） */
async function mercMarkerCoord(page: Page, gcpIndex: string): Promise<number[] | null> {
  return page.evaluate((idx) => {
    const map = (window as any).testDebug.mercMapInfo().map;
    const src = map?.getSource('marker');
    if (!src) return null;
    const feature = src.getFeatures().find((ft: any) => String(ft.get('gcpIndex')) === idx);
    return feature ? (feature.getGeometry().getCoordinates() as number[]) : null;
  }, gcpIndex);
}

/** ビュー中心から相対オフセット（EPSG:3857 メートル）の座標を返す */
async function mercCoordNearCenter(page: Page, dx: number, dy: number): Promise<number[]> {
  return page.evaluate(({ dx: ox, dy: oy }) => {
    const map = (window as any).testDebug.mercMapInfo().map;
    const center = map.getView().getCenter();
    return [center[0] + ox, center[1] + oy];
  }, { dx, dy });
}

async function bootstrap(prefix: string): Promise<{ app: ElectronApplication; page: Page; errors: string[]; uid: string }> {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const { app, page, errors } = await launch(e2eRoot);
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  const seeded = await seedMap(page);
  await openHash(page, `#/mapedit?uid=${seeded.uid}`);
  await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
  await forceGcpsTabReady(page);
  await openGcpsTab(page);
  return { app, page, errors, uid: seeded.uid };
}

/** ベースマップレイヤ群（group）が構築されるまで待つ */
async function waitBaseLayers(page: Page): Promise<void> {
  await expect.poll(async () => (await alignDebug(page)).baseLayers.length, { timeout: 30000 })
    .toBeGreaterThan(1);
}

test.describe('m1-t2 ベースマップ位置合わせモード', () => {
  test('AC1/AC2/AC5 + Q1: バーの表示・編集開始ボタン・OSM 対象の無効化', async () => {
    test.setTimeout(240_000);
    const { app, page, errors } = await bootstrap('maplat-m1t2-bar-');
    try {
      await waitBaseLayers(page);

      // AC1: 3 つ目の選択肢がある
      const optionTexts = await functionSelect(page).locator('option').allInnerTexts();
      expect(optionTexts.map((s) => s.trim())).toContain('ベースマップ位置合わせ');

      await functionSelect(page).selectOption('basemap_align');

      // AC2: 未計測 ∴ 0.00
      await expect(shiftX(page)).toHaveValue('0.00');
      await expect(shiftY(page)).toHaveValue('0.00');

      // AC5: 「編集開始」ボタンが在る
      await expect(phaseButton(page)).toHaveText('編集開始');

      // Q1: 現在のベースマップが osm のときは編集開始が無効
      await setVisibleBaseMap(page, 'osm');
      await expect(phaseButton(page)).toBeDisabled();

      // osm 以外へ切り替えると押せる
      const dbg = await alignDebug(page);
      const nonOsm = dbg.baseLayers.find((l) => l.mapID !== 'osm');
      expect(nonOsm, 'e2e 環境に osm 以外のベースマップが無い').toBeTruthy();
      await setVisibleBaseMap(page, nonOsm!.mapID);
      await expect(phaseButton(page)).toBeEnabled();

      expect(errors, `エラー: ${errors.join('\n')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC3: ベースマップ切替で表示値が随時その保持値へ変わる（§5.7 currentBaseMapID 追随）', async () => {
    test.setTimeout(240_000);
    const { app, page, errors } = await bootstrap('maplat-m1t2-follow-');
    try {
      await waitBaseLayers(page);
      await functionSelect(page).selectOption('basemap_align');

      // 保持値を直接 seed して切替追随だけを分離して観測する（表示経路は本物を通る）
      const dbg0 = await alignDebug(page);
      const targets = dbg0.baseLayers.map((l) => l.mapID);
      expect(targets).toContain('osm');
      const other = targets.find((id) => id !== 'osm')!;
      await page.evaluate((id) => {
        (window as any).testDebug.seedBaseMapShifts({ [id]: { x: 123.456, y: -78.9 } });
      }, other);

      await setVisibleBaseMap(page, other);
      await expect(shiftX(page)).toHaveValue('123.46');
      await expect(shiftY(page)).toHaveValue('-78.90');

      await setVisibleBaseMap(page, 'osm');
      await expect(shiftX(page)).toHaveValue('0.00');
      await expect(shiftY(page)).toHaveValue('0.00');

      await setVisibleBaseMap(page, other);
      await expect(shiftX(page)).toHaveValue('123.46');

      expect(errors, `エラー: ${errors.join('\n')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC6〜AC14/AC16/AC21: P0→P1→P2→確定の全相フローと反復適用', async () => {
    test.setTimeout(360_000);
    const { app, page, errors } = await bootstrap('maplat-m1t2-flow-');
    try {
      await waitBaseLayers(page);
      await functionSelect(page).selectOption('basemap_align');

      const dbg0 = await alignDebug(page);
      const target = dbg0.baseLayers.map((l) => l.mapID).find((id) => id !== 'osm')!;
      expect(target, 'e2e 環境に osm 以外のベースマップが無い').toBeTruthy();
      // AC11 の観測のため、対象でも表示中でもない第三のベースマップに保持値を seed する
      const third = dbg0.baseLayers.map((l) => l.mapID).find((id) => id !== 'osm' && id !== target);
      if (third) {
        await page.evaluate((id) => {
          (window as any).testDebug.seedBaseMapShifts({ [id]: { x: 11, y: -7 } });
        }, third);
      }
      await setVisibleBaseMap(page, target);

      // ---- P0 → P1 ----
      await phaseButton(page).click();

      // AC6(d): ボタン文言
      await expect(phaseButton(page)).toHaveText('基準点指定完了');
      // ボタンは基準点を置くまで無効（完了操作が空振りしない）
      await expect(phaseButton(page)).toBeDisabled();
      // AC6(a): 地図面の interaction がすべて非 active
      expect(await page.evaluate(() =>
        (window as any).testDebug.illstMapInfo().map.getInteractions().getArray()
          .every((i: any) => !i.getActive()))).toBe(true);
      // AC6(b): 副機能ドロップダウンが操作不可
      await expect(functionSelect(page)).toBeDisabled();
      // AC6(c): 切替ラジオが 1 つも出ない
      expect((await layerSwitcherRadios(page)).count).toBe(0);
      // AC7: 対象ソースの実効シフトが 0
      const dbgP1 = await alignDebug(page);
      expect(dbgP1.phase).toBe('P1');
      expect(dbgP1.targetMapID).toBe(target);
      const targetLayerP1 = dbgP1.baseLayers.find((l) => l.mapID === target)!;
      expect(targetLayerP1.mercatorXShift).toBe(0);
      expect(targetLayerP1.mercatorYShift).toBe(0);
      // AC11 の前提: 非対象（third）には保持値が実効で載っている
      if (third) {
        const thirdLayer = dbgP1.baseLayers.find((l) => l.mapID === third)!;
        expect(thirdLayer.mercatorXShift).toBe(11);
        expect(thirdLayer.mercatorYShift).toBe(-7);
      }

      // AC16(MIN-3): P1 中にレイヤ再構築が起きても切替禁止が解けない
      await page.evaluate(() => (window as any).testDebug.refreshBaseMapLayers());
      await waitBaseLayers(page);
      expect((await layerSwitcherRadios(page)).count).toBe(0);
      // 再構築後も対象の実効 0 が維持される（C-4 の単一実装が再構築末尾から呼ばれている）
      const dbgP1b = await alignDebug(page);
      const targetLayerP1b = dbgP1b.baseLayers.find((l) => l.mapID === target)!;
      expect(targetLayerP1b.mercatorXShift).toBe(0);

      // AC8: 空き部分・GCP マーカー上・対応線上のすべてで「基準点を選ぶ」1 項目のみ
      const gcp0 = (await mercMarkerCoord(page, '0'))!;
      expect(gcp0).not.toBeNull();
      await centerMercOn(page, gcp0);
      //  (a) 空き部分
      const empty = await mercCoordNearCenter(page, 0, 0);
      await rightClickMerc(page, empty);
      await expectMercMenu(page, ['基準点を選ぶ']);
      //  (b) GCP マーカーの上
      await rightClickMerc(page, gcp0, -8);
      await expectMercMenu(page, ['基準点を選ぶ']);
      //  (c) 対応線の上（gcp0-gcp1 の中点）
      const gcp1 = (await mercMarkerCoord(page, '1'))!;
      const mid = [(gcp0[0] + gcp1[0]) / 2, (gcp0[1] + gcp1[1]) / 2];
      await rightClickMerc(page, mid);
      await expectMercMenu(page, ['基準点を選ぶ']);
      // 地図面の右クリックではメニューが出ない（contextmenu.disable）
      await page.evaluate(() => {
        const el = document.getElementById('illstMap')!;
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        }));
      });
      await page.waitForTimeout(500);
      expect(await page.evaluate((sel) => document.querySelectorAll(sel).length, ILLST_MENU_SELECTOR)).toBe(0);

      // 基準点を選ぶ → 何度でも置き直せる（最後の 1 点のみ）
      await rightClickMerc(page, empty);
      await clickMercMenuItem(page, '基準点を選ぶ');
      let dbgRef = await alignDebug(page);
      expect(dbgRef.alignFeatures.filter((f) => f.kind === 'reference').length).toBe(1);
      const firstRef = dbgRef.alignFeatures.find((f) => f.kind === 'reference')!.coord;
      // 置き直し
      const empty2 = await mercCoordNearCenter(page, 120, 80);
      await rightClickMerc(page, empty2);
      await clickMercMenuItem(page, '基準点を選ぶ');
      dbgRef = await alignDebug(page);
      const refs = dbgRef.alignFeatures.filter((f) => f.kind === 'reference');
      expect(refs.length).toBe(1);
      expect(refs[0].coord).not.toEqual(firstRef);
      const refCoord = refs[0].coord;
      // §6.2.1: P1 のバー表示は対象の保持値（0.00）のまま
      await expect(shiftX(page)).toHaveValue('0.00');

      // ---- P1 → P2 ----
      await expect(phaseButton(page)).toBeEnabled();
      await phaseButton(page).click();

      // AC9: ボタン文言と OSM 表示
      await expect(phaseButton(page)).toHaveText('Ground Truth 指定完了');
      await expect.poll(async () => {
        const d = await alignDebug(page);
        return d.baseLayers.find((l) => l.visible)?.mapID;
      }, { timeout: 10000 }).toBe('osm');
      const dbgP2 = await alignDebug(page);
      expect(dbgP2.phase).toBe('P2');
      // AC10: ラジオは出る（>0）が、対象は候補に出ない（title 退避で空）
      const radiosP2 = await layerSwitcherRadios(page);
      expect(radiosP2.count).toBeGreaterThan(0);
      const targetTitleStashed = dbgP2.baseLayers.find((l) => l.mapID === target)!;
      expect(targetTitleStashed.title).toBeFalsy();
      // AC11: 非対象には保持値が実効で載っている
      if (third) {
        const thirdLayerP2 = dbgP2.baseLayers.find((l) => l.mapID === third)!;
        expect(thirdLayerP2.mercatorXShift).toBe(11);
        expect(thirdLayerP2.mercatorYShift).toBe(-7);
      }
      // AC12: 基準点マーカーが同じ位置に残っている
      const refsP2 = dbgP2.alignFeatures.filter((f) => f.kind === 'reference');
      expect(refsP2.length).toBe(1);
      expect(refsP2[0].coord).toEqual(refCoord);
      // ドロップダウンは P2 でも操作不可（HR-4.6(b)「完了まで」）
      await expect(functionSelect(page)).toBeDisabled();
      // GT を置くまで完了ボタンは無効
      await expect(phaseButton(page)).toBeDisabled();

      // AC13: 右クリックは「Ground Truth を選ぶ」のみ（空き部分・GCP マーカー上）
      await centerMercOn(page, refCoord);
      await rightClickMerc(page, refCoord);
      await expectMercMenu(page, ['Ground Truth を選ぶ']);
      await rightClickMerc(page, gcp0, -8);
      await expectMercMenu(page, ['Ground Truth を選ぶ']);

      // GT を置く（基準点から東 +200 / 北 +150 の位置）→ 置き直しで最終位置を確定
      const gtTry = [refCoord[0] + 500, refCoord[1] - 300];
      await rightClickMerc(page, gtTry);
      await clickMercMenuItem(page, 'Ground Truth を選ぶ');
      let dbgGt = await alignDebug(page);
      expect(dbgGt.alignFeatures.filter((f) => f.kind === 'groundTruth').length).toBe(1);
      const gtFinalTarget = [refCoord[0] + 200, refCoord[1] + 150];
      await centerMercOn(page, gtFinalTarget);
      await rightClickMerc(page, gtFinalTarget);
      await clickMercMenuItem(page, 'Ground Truth を選ぶ');
      dbgGt = await alignDebug(page);
      const gts = dbgGt.alignFeatures.filter((f) => f.kind === 'groundTruth');
      expect(gts.length).toBe(1);
      const gtCoord = gts[0].coord;
      // 基準点マーカーはまだ残っている（両種が同時に在る）
      expect(dbgGt.alignFeatures.filter((f) => f.kind === 'reference').length).toBe(1);

      // ---- P2 → P0（確定） ----
      await expect(phaseButton(page)).toBeEnabled();
      await phaseButton(page).click();

      // AC14: shift = GT − 基準点（両符号を含めて一致）
      const expectedShift = { x: gtCoord[0] - refCoord[0], y: gtCoord[1] - refCoord[1] };
      expect(expectedShift.x).toBeGreaterThan(0); // 東へ置いた ∴ 正
      expect(expectedShift.y).toBeGreaterThan(0); // 北へ置いた ∴ 正
      const dbgDone = await alignDebug(page);
      expect(dbgDone.phase).toBe('P0');
      expect(dbgDone.shifts[target]).toEqual(expectedShift);
      // バー表示が更新される
      await expect(shiftX(page)).toHaveValue(expectedShift.x.toFixed(2));
      await expect(shiftY(page)).toHaveValue(expectedShift.y.toFixed(2));
      // 表示が対象へ戻り、実効値として載っている
      expect(dbgDone.baseLayers.find((l) => l.visible)?.mapID).toBe(target);
      const targetDone = dbgDone.baseLayers.find((l) => l.mapID === target)!;
      expect(targetDone.mercatorXShift).toBe(expectedShift.x);
      expect(targetDone.mercatorYShift).toBe(expectedShift.y);
      // マーカーは両方消えている
      expect(dbgDone.alignFeatures.length).toBe(0);
      // 地図面・ドロップダウン・切替が復帰している
      expect(await page.evaluate(() =>
        (window as any).testDebug.illstMapInfo().map.getInteractions().getArray()
          .every((i: any) => i.getActive()))).toBe(true);
      await expect(functionSelect(page)).toBeEnabled();
      const radiosP0 = await layerSwitcherRadios(page);
      expect(radiosP0.count).toBeGreaterThan(0);
      // ボタンが「編集開始」へ戻る
      await expect(phaseButton(page)).toHaveText('編集開始');

      // AC16: レイヤ再構築で保持値が失われない
      await page.evaluate(() => (window as any).testDebug.refreshBaseMapLayers());
      await waitBaseLayers(page);
      const dbgRebuilt = await alignDebug(page);
      expect(dbgRebuilt.shifts[target]).toEqual(expectedShift);
      const targetRebuilt = dbgRebuilt.baseLayers.find((l) => l.mapID === target)!;
      expect(targetRebuilt.mercatorXShift).toBe(expectedShift.x);

      // ---- AC21: 2 巡目（反復適用と置換） ----
      await phaseButton(page).click();
      // (a) 編集開始で対象の実効値が 0 へ戻る（「画が動く」の機械観測）
      const dbg2nd = await alignDebug(page);
      expect(dbg2nd.phase).toBe('P1');
      const target2nd = dbg2nd.baseLayers.find((l) => l.mapID === target)!;
      expect(target2nd.mercatorXShift).toBe(0);
      expect(target2nd.mercatorYShift).toBe(0);
      // (b) バーは保持値のまま（0 にならない。§6.2.1）
      await expect(shiftX(page)).toHaveValue(expectedShift.x.toFixed(2));
      // 2 巡目の基準点と GT（1 巡目と別の差分）
      const ref2 = await mercCoordNearCenter(page, -100, -50);
      await centerMercOn(page, ref2);
      await rightClickMerc(page, ref2);
      await clickMercMenuItem(page, '基準点を選ぶ');
      const ref2Coord = (await alignDebug(page)).alignFeatures.find((f) => f.kind === 'reference')!.coord;
      await phaseButton(page).click();
      await expect(phaseButton(page)).toHaveText('Ground Truth 指定完了');
      const gt2Target = [ref2Coord[0] - 80, ref2Coord[1] + 40];
      await centerMercOn(page, gt2Target);
      await rightClickMerc(page, gt2Target);
      await clickMercMenuItem(page, 'Ground Truth を選ぶ');
      const gt2Coord = (await alignDebug(page)).alignFeatures.find((f) => f.kind === 'groundTruth')!.coord;
      await phaseButton(page).click();
      // (d) 確定値は 2 巡目の差分そのもの（1 巡目との合計でない）
      const expected2nd = { x: gt2Coord[0] - ref2Coord[0], y: gt2Coord[1] - ref2Coord[1] };
      expect(expected2nd.x).toBeLessThan(0); // 西へ置いた ∴ 負（AC15 の両符号）
      expect(expected2nd.y).toBeGreaterThan(0);
      const dbgFinal = await alignDebug(page);
      expect(dbgFinal.shifts[target]).toEqual(expected2nd);
      expect(dbgFinal.shifts[target]).not.toEqual({
        x: expectedShift.x + expected2nd.x, y: expectedShift.y + expected2nd.y,
      });
      await expect(shiftX(page)).toHaveValue(expected2nd.x.toFixed(2));

      expect(errors, `エラー: ${errors.join('\n')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4: 保持値はセッション限り（リロードで 0.00 に戻る）', async () => {
    test.setTimeout(240_000);
    const { app, page, errors, uid } = await bootstrap('maplat-m1t2-session-');
    try {
      await waitBaseLayers(page);
      await functionSelect(page).selectOption('basemap_align');
      const dbg0 = await alignDebug(page);
      const other = dbg0.baseLayers.map((l) => l.mapID).find((id) => id !== 'osm')!;
      await page.evaluate((id) => {
        (window as any).testDebug.seedBaseMapShifts({ [id]: { x: 55, y: 66 } });
      }, other);
      await setVisibleBaseMap(page, other);
      await expect(shiftX(page)).toHaveValue('55.00');

      // リロード = 地図編集を抜けて入り直す
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await openHash(page, `#/mapedit?uid=${uid}`);
      await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
      await forceGcpsTabReady(page);
      await openGcpsTab(page);
      await waitBaseLayers(page);
      await functionSelect(page).selectOption('basemap_align');
      await setVisibleBaseMap(page, other);
      await expect(shiftX(page)).toHaveValue('0.00');
      await expect(shiftY(page)).toHaveValue('0.00');
      const dbgAfter = await alignDebug(page);
      expect(Object.keys(dbgAfter.shifts).length).toBe(0);

      expect(errors, `エラー: ${errors.join('\n')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
