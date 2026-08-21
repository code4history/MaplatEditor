// m1-t4「リセット／キャンセルボタンとシフト値の即時永続化」E2E。
// 設計: docs/superpowers/specs/2026-08-21-m1-t4-align-reset-persist-task-design.md v1.0
// ボタンの契約（配置・ラベル・disabled・click）の正本: 同設計 §5.2 の表。
// ヘルパは m1-t1 / m1-t2 spec と同型（各 spec は自己完結の前例に従う）。
//
// 担当 AC（スコープ限定子つき。設計 §8）:
//   m1-t4/AC1  バーに第 2 ボタンが在り、相ボタンの一つ左隣である（HR-5.1）
//   m1-t4/AC2  P0・保持値 0,0（未登録含む）→ リセットは disabled（HR-5.2）
//   m1-t4/AC3  P0・保持値 ≠ 0,0 → リセット押下で表示 0.00 / タイル表示からシフトが外れる（HR-5.2）
//   m1-t4/AC4  リセットは永続行も消す（再入場後も 0）（HR-5.2 × HR-6）
//   m1-t4/AC5  P1 でキャンセル → P0 復帰・保持値不変・地図面/ドロップダウン/切替の再有効化・マーカー消去（HR-5.3）
//   m1-t4/AC6  P2 でキャンセル → 同上 + 表示が OSM から対象ベースマップへ戻る（HR-5.3）
//   m1-t4/AC8  確定でシフトが map_base_map_shift へ即時書かれる。地図の Save は不要（HR-6）
//   m1-t4/AC9  地図編集を離れて再入場で保持値が表示・タイルへ反映される（HR-6）
//     （AC9 の反転表現の本体は m1-t2 spec の AC4 改訂。本 spec は確定フロー実走側から重ねて固定する）
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

// GCP3点（三角形）+ edge [0,1] 付きの地図を compiled tin 付きで seed する（m1-t2 と同型）
async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `mapedit-align-m1-t4-map-${Date.now()}`;
    const toMercIn = (x: number, y: number): number[] => [
      15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
      4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
    ];
    const mapObject = {
      mapID: slug,
      title: { ja: 'm1-t4 リセット・永続化検証地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'm1-t4 attribution' }, dataAttr: {}, description: {},
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

async function setVisibleBaseMap(page: Page, mapID: string): Promise<void> {
  await page.evaluate((id) => {
    const map = (window as any).testDebug.mercMapInfo().map;
    const rootLayer = map.getLayers().item(0);
    const layers = rootLayer?.get?.('layers') || rootLayer?.getLayers?.();
    layers.getArray().forEach((layer: any) => layer.setVisible(layer.get('mapID') === id));
  }, mapID);
}

/** LayerSwitcher のパネルを開いて描画させ、ラジオの数を返す（m1-t2 と同型） */
async function layerSwitcherRadioCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as any).testDebug.mercMapInfo().map;
    const ctrl = map.getControls().getArray()
      .find((c: any) => c.element?.classList?.contains('layer-switcher'));
    ctrl.hidePanel();
    ctrl.showPanel();
    return document.querySelectorAll('.layer-switcher input[type=radio]').length;
  });
}

const functionSelect = (page: Page) => page.locator('select:has(option[value="basemap_align"])');
const shiftX = (page: Page) => page.getByTestId('mapedit-align-shift-x');
const shiftY = (page: Page) => page.getByTestId('mapedit-align-shift-y');
const phaseButton = (page: Page) => page.getByTestId('mapedit-align-phase-button');
const secondButton = (page: Page) => page.getByTestId('mapedit-align-second-button');

const MERC_MENU_SELECTOR = '#mercMap .ol-ctx-menu-container:not(.ol-ctx-menu-hidden) > ul > li';

async function mercMenuTexts(page: Page): Promise<string[]> {
  return page.evaluate((selector) =>
    Array.from(document.querySelectorAll(selector)).map((el) => (el as HTMLElement).innerText.trim()),
    MERC_MENU_SELECTOR);
}

async function rightClickMerc(page: Page, coord: number[]): Promise<void> {
  const point = await page.evaluate((c) => {
    const info = (window as any).testDebug.mercMapInfo();
    const pixel = info.map.getPixelFromCoordinate(c);
    const rect = document.getElementById('mercMap')!.getBoundingClientRect();
    return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
  }, coord);
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

async function clickMercMenuItem(page: Page, text: string): Promise<void> {
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

async function waitBaseLayers(page: Page): Promise<void> {
  await expect.poll(async () => (await alignDebug(page)).baseLayers.length, { timeout: 30000 })
    .toBeGreaterThan(1);
}

/** 地図編集を抜けて入り直す（reload → 同じ地図の再入場） */
async function reenterMapEdit(page: Page, uid: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await openHash(page, `#/mapedit?uid=${uid}`);
  await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
  await forceGcpsTabReady(page);
  await openGcpsTab(page);
  await waitBaseLayers(page);
  await functionSelect(page).selectOption('basemap_align');
}

/** 永続ストアの実測（実 IPC = m1-t4 の get 経路） */
async function persistedShifts(page: Page, uid: string): Promise<Array<{ mapID: string; x: number; y: number }>> {
  return page.evaluate(async (mapUid) => {
    const rows = await (window as any).mapedit.getBaseMapShiftsOfMapID(mapUid);
    return rows.map((r: any) => ({ mapID: r.mapID, x: r.x, y: r.y }));
  }, uid);
}

test.describe('m1-t4 リセット／キャンセルボタンとシフト値の即時永続化', () => {
  test('m1-t4/AC1/AC2/AC3/AC4: 第 2 ボタンの配置・リセットの disabled と実行・永続行の削除', async () => {
    test.setTimeout(300_000);
    const { app, page, errors, uid } = await bootstrap('maplat-m1t4-reset-');
    try {
      await waitBaseLayers(page);
      await functionSelect(page).selectOption('basemap_align');

      // m1-t4/AC1: 第 2 ボタンが在り「リセット」表示、相ボタンの一つ左隣（同じ行で直前に隣接）
      await expect(secondButton(page)).toBeVisible();
      await expect(secondButton(page)).toHaveText('リセット');
      const geometry = await page.evaluate(() => {
        const second = document.querySelector('[data-testid="mapedit-align-second-button"]')!.getBoundingClientRect();
        const phase = document.querySelector('[data-testid="mapedit-align-phase-button"]')!.getBoundingClientRect();
        return { secondRight: second.right, phaseLeft: phase.left, secondTop: second.top, phaseTop: phase.top };
      });
      expect(geometry.secondRight, 'm1-t4/AC1: 第 2 ボタンが相ボタンの左にない').toBeLessThanOrEqual(geometry.phaseLeft);
      expect(Math.abs(geometry.secondTop - geometry.phaseTop), 'm1-t4/AC1: 2 つのボタンが同じ行にない').toBeLessThan(5);

      // m1-t4/AC2: 保持値 0,0（未登録）→ リセットは disabled
      await expect(shiftX(page)).toHaveValue('0.00');
      await expect(secondButton(page)).toBeDisabled();

      // 保持値 ≠ 0,0 を作る（永続経路 = 実 IPC で書き、メモリも同値に seed）
      const dbg0 = await alignDebug(page);
      const other = dbg0.baseLayers.map((l) => l.mapID).find((id) => id !== 'osm')!;
      expect(other, 'e2e 環境に osm 以外のベースマップが無い').toBeTruthy();
      await page.evaluate(async ({ mapUid, id }) => {
        await (window as any).mapedit.setBaseMapShiftForMapID(mapUid, id, 120, -45);
        (window as any).testDebug.seedBaseMapShifts({ [id]: { x: 120, y: -45 } });
      }, { mapUid: uid, id: other });
      await page.evaluate(() => (window as any).testDebug.refreshBaseMapLayers());
      await waitBaseLayers(page);
      await setVisibleBaseMap(page, other);
      await expect(shiftX(page)).toHaveValue('120.00');
      await expect(shiftY(page)).toHaveValue('-45.00');
      // 永続行が実在する（前提の実測）
      expect(await persistedShifts(page, uid)).toEqual([{ mapID: other, x: 120, y: -45 }]);
      // タイルにも実効値が載っている（リセット前の前提）
      const before = await alignDebug(page);
      expect(before.baseLayers.find((l) => l.mapID === other)!.mercatorXShift).toBe(120);
      // 0,0 でなくなった ∴ リセットが押せる（HR-5.2「0,0以外ならば押せば」）
      await expect(secondButton(page)).toBeEnabled();

      // m1-t4/AC3: リセット押下で表示 0.00 / タイル表示からシフトが外れる
      await secondButton(page).click();
      await expect(shiftX(page)).toHaveValue('0.00');
      await expect(shiftY(page)).toHaveValue('0.00');
      const after = await alignDebug(page);
      const layerAfter = after.baseLayers.find((l) => l.mapID === other)!;
      expect(layerAfter.mercatorXShift).toBe(0);
      expect(layerAfter.mercatorYShift).toBe(0);
      // 0,0 へ戻った ∴ ボタンは再び disabled（HR-5.2）
      await expect(secondButton(page)).toBeDisabled();
      // m1-t4/AC4 前半: 永続行が DELETE されている（実 IPC の実測）
      await expect.poll(async () => (await persistedShifts(page, uid)).length, { timeout: 10000 }).toBe(0);

      // m1-t4/AC4 後半: 再入場しても 0 のまま（行が無い = 未計測 = 0 扱い）
      await reenterMapEdit(page, uid);
      await setVisibleBaseMap(page, other);
      await expect(shiftX(page)).toHaveValue('0.00');
      await expect(shiftY(page)).toHaveValue('0.00');
      const dbgReentered = await alignDebug(page);
      expect(Object.keys(dbgReentered.shifts).length).toBe(0);

      expect(errors, `エラー: ${errors.join('\n')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('m1-t4/AC5/AC6/AC8/AC9: P1/P2 キャンセルと確定フローの即時永続化・再入場での復元', async () => {
    test.setTimeout(360_000);
    const { app, page, errors, uid } = await bootstrap('maplat-m1t4-cancel-');
    try {
      await waitBaseLayers(page);
      await functionSelect(page).selectOption('basemap_align');
      const dbg0 = await alignDebug(page);
      const target = dbg0.baseLayers.map((l) => l.mapID).find((id) => id !== 'osm')!;
      expect(target, 'e2e 環境に osm 以外のベースマップが無い').toBeTruthy();
      await setVisibleBaseMap(page, target);

      // ---- m1-t4/AC5: P1 でキャンセル ----
      await phaseButton(page).click();
      expect((await alignDebug(page)).phase).toBe('P1');
      // 第 2 ボタンは「キャンセル」表示になり、相ボタン（基準点未設置で disabled）と独立して押せる（HR-5.3）
      await expect(secondButton(page)).toHaveText('キャンセル');
      await expect(phaseButton(page)).toBeDisabled();
      await expect(secondButton(page)).toBeEnabled();
      await secondButton(page).click();
      const afterCancelP1 = await alignDebug(page);
      expect(afterCancelP1.phase).toBe('P0');
      expect(afterCancelP1.targetMapID).toBeNull();
      // 保持値不変（未計測のまま）・マーカー無し
      expect(Object.keys(afterCancelP1.shifts).length).toBe(0);
      expect(afterCancelP1.alignFeatures.length).toBe(0);
      // 地図面・ドロップダウン・切替の再有効化
      expect(await page.evaluate(() =>
        (window as any).testDebug.illstMapInfo().map.getInteractions().getArray()
          .every((i: any) => i.getActive()))).toBe(true);
      await expect(functionSelect(page)).toBeEnabled();
      expect(await layerSwitcherRadioCount(page)).toBeGreaterThan(0);
      // 相ボタンが「編集開始」へ戻る
      await expect(phaseButton(page)).toHaveText('編集開始');
      // キャンセルでは何も永続化されない
      expect(await persistedShifts(page, uid)).toEqual([]);

      // ---- m1-t4/AC6: P2 でキャンセル ----
      await phaseButton(page).click();                       // P0 → P1
      const ref1 = await mercCoordNearCenter(page, 0, 0);
      await centerMercOn(page, ref1);
      await rightClickMerc(page, ref1);
      await clickMercMenuItem(page, '基準点を選ぶ');
      await phaseButton(page).click();                       // P1 → P2
      await expect.poll(async () => {
        const d = await alignDebug(page);
        return d.baseLayers.find((l) => l.visible)?.mapID;
      }, { timeout: 10000 }).toBe('osm');
      expect((await alignDebug(page)).phase).toBe('P2');
      await expect(secondButton(page)).toHaveText('キャンセル');
      await secondButton(page).click();
      const afterCancelP2 = await alignDebug(page);
      expect(afterCancelP2.phase).toBe('P0');
      // 表示が OSM から対象ベースマップへ戻る（確定経路と同一の復帰。OSM に置き去りにしない）
      expect(afterCancelP2.baseLayers.find((l) => l.visible)?.mapID).toBe(target);
      expect(Object.keys(afterCancelP2.shifts).length).toBe(0);
      expect(afterCancelP2.alignFeatures.length).toBe(0);
      await expect(functionSelect(page)).toBeEnabled();
      expect(await layerSwitcherRadioCount(page)).toBeGreaterThan(0);
      expect(await persistedShifts(page, uid)).toEqual([]);

      // ---- m1-t4/AC8: 確定フローの実走 → 即時永続化（Save は押していない） ----
      await phaseButton(page).click();                       // P0 → P1
      const ref2 = await mercCoordNearCenter(page, -60, -40);
      await centerMercOn(page, ref2);
      await rightClickMerc(page, ref2);
      await clickMercMenuItem(page, '基準点を選ぶ');
      const refCoord = (await alignDebug(page)).alignFeatures.find((f) => f.kind === 'reference')!.coord;
      await phaseButton(page).click();                       // P1 → P2
      const gtTarget = [refCoord[0] + 250, refCoord[1] + 130];
      await centerMercOn(page, gtTarget);
      await rightClickMerc(page, gtTarget);
      await clickMercMenuItem(page, 'Ground Truth を選ぶ');
      const gtCoord = (await alignDebug(page)).alignFeatures.find((f) => f.kind === 'groundTruth')!.coord;
      await phaseButton(page).click();                       // P2 → P0（確定）
      const expected = { x: gtCoord[0] - refCoord[0], y: gtCoord[1] - refCoord[1] };
      const dbgDone = await alignDebug(page);
      expect(dbgDone.phase).toBe('P0');
      expect(dbgDone.shifts[target]).toEqual(expected);
      // 即時に map_base_map_shift へ書かれている（地図の Save は一度も押していない）
      await expect.poll(async () => JSON.stringify(await persistedShifts(page, uid)), { timeout: 10000 })
        .toBe(JSON.stringify([{ mapID: target, x: expected.x, y: expected.y }]));

      // ---- m1-t4/AC9: 地図編集を抜けて入り直す → 保持値が表示・タイルへ反映 ----
      await reenterMapEdit(page, uid);
      await setVisibleBaseMap(page, target);
      await expect(shiftX(page)).toHaveValue(expected.x.toFixed(2));
      await expect(shiftY(page)).toHaveValue(expected.y.toFixed(2));
      const dbgReentered = await alignDebug(page);
      expect(dbgReentered.shifts[target]).toEqual(expected);
      const layerReentered = dbgReentered.baseLayers.find((l) => l.mapID === target)!;
      expect(layerReentered.mercatorXShift).toBe(expected.x);
      expect(layerReentered.mercatorYShift).toBe(expected.y);
      // 値が入っている ∴ リセットボタンは enabled（AC2 の対偶を再入場後にも固定）
      await expect(secondButton(page)).toBeEnabled();

      expect(errors, `エラー: ${errors.join('\n')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
