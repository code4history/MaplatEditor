// EnvelopeEditorModal の経緯度の直接入力欄（西・南・東・北）の振る舞い。
//
//   1. 欄に入れた値が矩形になる（描画レイヤの feature の extent を EPSG:4326 へ戻して比べる）
//   2. 地図で描き直すと欄の値が変わる
//   3. 正しくない値では矩形を変えず、欄の近くに理由を出す（数字でない・経緯度の範囲外・西≧東・南≧北）
//   4. 存在範囲があるときは内側へ切り詰め、切った後の値を欄に出して知らせる。
//      重ならないときは未選択にせず、理由を出して変えない
//   5. 確定すると modelValue に入る。「範囲をクリア」で欄も空になる
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 存在範囲のマスタの bbox（近似: 130.25, 32.5, 131.75, 33.8）
const COVERAGE_LNG_LATS: [number, number][] = [
  [130.25, 32.5],
  [131.75, 32.5],
  [131.75, 33.25],
  [130.9, 33.8],
  [130.25, 33.25],
];
const COVERAGE_BBOX = [130.25, 32.5, 131.75, 33.8];

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('https://example.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  return { app, page };
}

async function seedApp(page: Page, appSlug: string, sources: unknown[]): Promise<string> {
  return await page.evaluate(async ({ slug, srcs }) => {
    const saved = await window.appedit.save({
      slug,
      document: {
        appID: slug, appName: { ja: 'Coord App' }, title: { ja: 'Coord App' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: srcs, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
      },
    });
    if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
    return saved.uid as string;
  }, { slug: appSlug, srcs: sources });
}

async function openApp(page: Page, appUid: string): Promise<void> {
  await page.evaluate((uid: string) => { location.hash = `#/appedit?uid=${uid}`; }, appUid);
  await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
}

// 描画レイヤの矩形を EPSG:4326 へ戻した値（小窓の e2e の口）
async function featureExtent(page: Page): Promise<number[] | null> {
  const extents: number[][] = await page.evaluate(
    () => (window as any).envelopeModalDebug.featureExtents4326(),
  );
  return extents.length ? extents[0] : null;
}

function expectCloseList(actual: number[], expected: number[]): void {
  for (let i = 0; i < 4; i += 1) {
    expect(actual[i], `extent[${i}]`).toBeCloseTo(expected[i], 5);
  }
}

async function fieldValues(page: Page): Promise<string[]> {
  const texts: Record<string, string> = await page.evaluate(
    () => (window as any).envelopeModalDebug.fieldTexts(),
  );
  return [texts.west, texts.south, texts.east, texts.north];
}

async function fillCoord(page: Page, field: string, value: string): Promise<void> {
  await page.getByTestId(`envelope-coord-${field}`).fill(value);
}

test('経緯度の入力が矩形になり、地図で描くと欄が変わり、確定すると modelValue に入る', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-coord-input-1-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const appUid = await seedApp(page, `coord-app-1-${Date.now()}`, []);
    await openApp(page, appUid);

    // アプリ対象範囲の小窓（未設定 → 欄は空）
    await page.getByTestId('app-coverage-pick-button').click();
    await expect(page.getByTestId('envelope-editor-dialog')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('envelope-coord-fields')).toBeVisible({ timeout: 30000 });
    expect(await fieldValues(page), '未設定のときは欄が空').toEqual(['', '', '', '']);
    expect(await featureExtent(page), '未設定のときは矩形が無い').toBeNull();

    // 1. 欄に入れた値が矩形になる（ベクタの feature の extent を EPSG:4326 に戻して比べる）
    await fillCoord(page, 'west', '139.5');
    await fillCoord(page, 'south', '35.5');
    await fillCoord(page, 'east', '139.9');
    await fillCoord(page, 'north', '35.9');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect.poll(() => featureExtent(page), { timeout: 15000 }).not.toBeNull();
    expectCloseList((await featureExtent(page))!, [139.5, 35.5, 139.9, 35.9]);
    expect(await fieldValues(page), '欄にも確定値が出る').toEqual(['139.5', '35.5', '139.9', '35.9']);

    // 入れた値が今の画面の外なら、地図をその矩形に合わせる
    for (let i = 0; i < 4; i += 1) await page.locator('.envelope-modal .ol-zoom-in').click();
    await fillCoord(page, 'west', '135.5');
    await fillCoord(page, 'south', '35.5');
    await fillCoord(page, 'east', '135.9');
    await fillCoord(page, 'north', '35.9');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect.poll(async () => {
      const view: number[] | null = await page.evaluate(
        () => (window as any).envelopeModalDebug.viewExtent4326(),
      );
      return !!view && view[0] <= 135.5 && view[1] <= 35.5 && view[2] >= 135.9 && view[3] >= 35.9;
    }, { timeout: 15000 }).toBe(true);
    expectCloseList((await featureExtent(page))!, [135.5, 35.5, 135.9, 35.9]);

    // 2. 地図で描くと欄の値が変わる。
    //    OL 10 の Draw は down/up が clickTolerance 内（クリック）のときだけ確定するので、
    //    角を 2 回クリックして描く（ドラッグの離しでは確定しない。今回の変更前からの挙動）
    const mapBox = await page.locator('.envelope-modal .envelope-map').boundingBox();
    if (!mapBox) throw new Error('no map box');
    await page.mouse.click(mapBox.x + mapBox.width * 0.25, mapBox.y + mapBox.height * 0.25);
    await page.waitForTimeout(300);
    await page.mouse.click(mapBox.x + mapBox.width * 0.55, mapBox.y + mapBox.height * 0.55);
    await expect.poll(async () => (await fieldValues(page)).join(','), { timeout: 15000 }).not.toBe('135.5,35.5,135.9,35.9');
    const drawn = (await fieldValues(page)).map(Number);
    expectCloseList((await featureExtent(page))!, drawn);
    expect(drawn[0], '描いた矩形は西<東').toBeLessThan(drawn[2]);

    // 「範囲をクリア」で欄も空になる
    await page.locator('.envelope-modal .btn-outline-danger').first().click();
    expect(await fieldValues(page), 'クリアで欄が空になる').toEqual(['', '', '', '']);
    expect(await featureExtent(page), 'クリアで矩形が消える').toBeNull();

    // 5. 確定すると modelValue に入る
    await fillCoord(page, 'west', '139.4');
    await fillCoord(page, 'south', '35.4');
    await fillCoord(page, 'east', '139.8');
    await fillCoord(page, 'north', '35.8');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect.poll(() => featureExtent(page), { timeout: 15000 }).not.toBeNull();
    await page.locator('.envelope-modal .btn-primary').first().click();
    await expect(page.locator('.envelope-modal')).not.toBeVisible({ timeout: 15000 });
    const savedCoverage = await page.evaluate(() => (window as any).testDebug.appData.value.coverageLngLats);
    expect(savedCoverage).toEqual([
      [139.4, 35.4], [139.8, 35.4], [139.8, 35.8], [139.4, 35.8],
    ]);
  } finally {
    await quitElectronApplication(app);
  }
});

test('正しくない値では矩形を変えずに理由を出す（数字でない・範囲外・西≧東・南≧北）', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-coord-input-2-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const appUid = await seedApp(page, `coord-app-2-${Date.now()}`, []);
    await openApp(page, appUid);
    await page.getByTestId('app-coverage-pick-button').click();
    await expect(page.getByTestId('envelope-editor-dialog')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('envelope-coord-fields')).toBeVisible({ timeout: 30000 });

    await fillCoord(page, 'west', '139.5');
    await fillCoord(page, 'south', '35.5');
    await fillCoord(page, 'east', '139.9');
    await fillCoord(page, 'north', '35.9');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect.poll(() => featureExtent(page), { timeout: 15000 }).not.toBeNull();
    const before = (await featureExtent(page))!;

    const diagnostics = page.getByTestId('envelope-coord-diagnostics');

    // 数字でない
    await fillCoord(page, 'west', 'abc');
    await page.getByTestId('envelope-coord-west').press('Enter');
    await expect(diagnostics).toContainText('数字で入力', { timeout: 15000 });
    await expect(page.getByTestId('envelope-coord-west')).toHaveClass(/is-invalid/);
    expectCloseList((await featureExtent(page))!, before);

    // 経緯度の範囲の外
    await fillCoord(page, 'west', '300');
    await page.getByTestId('envelope-coord-west').press('Enter');
    await expect(diagnostics).toContainText('座標が範囲外', { timeout: 15000 });
    await expect(diagnostics).not.toContainText('数字で入力');
    expectCloseList((await featureExtent(page))!, before);

    // 西が東以上（矩形を変えない）
    await fillCoord(page, 'west', '139.5');
    await fillCoord(page, 'east', '130');
    await page.getByTestId('envelope-coord-east').press('Enter');
    await expect(diagnostics).toContainText('西は東より小さい値', { timeout: 15000 });
    expectCloseList((await featureExtent(page))!, before);

    // 南が北以上（矩形を変えない）
    await fillCoord(page, 'east', '139.9');
    await fillCoord(page, 'north', '30');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect(diagnostics).toContainText('南は北より小さい値', { timeout: 15000 });
    expectCloseList((await featureExtent(page))!, before);

    // 正しくない値が残っている間は確定できない
    await expect(page.getByTestId('envelope-confirm')).toBeDisabled();

    // 4 欄が揃わない（西を空にする）→ 矩形を変えず、空の欄を示して理由を出す
    await fillCoord(page, 'north', '35.9');
    await fillCoord(page, 'west', '');
    await page.getByTestId('envelope-coord-west').press('Enter');
    await expect(diagnostics).toContainText('4 つすべてを入力', { timeout: 15000 });
    await expect(page.getByTestId('envelope-coord-west')).toHaveClass(/is-invalid/);
    await expect(page.getByTestId('envelope-coord-east')).not.toHaveClass(/is-invalid/);
    expectCloseList((await featureExtent(page))!, before);
    await expect(page.getByTestId('envelope-confirm')).toBeDisabled();

    // 全角の数字と小数点のコンマも受け付ける
    await fillCoord(page, 'west', '１３９．４５');
    await fillCoord(page, 'east', '139,85');
    await page.getByTestId('envelope-coord-east').press('Enter');
    await expect.poll(async () => (await featureExtent(page))![0], { timeout: 15000 }).toBeCloseTo(139.45, 5);
    expectCloseList((await featureExtent(page))!, [139.45, 35.5, 139.85, 35.9]);
    expect(await fieldValues(page), '受け付けた値を半角で欄に戻す').toEqual(['139.45', '35.5', '139.85', '35.9']);
    await expect(diagnostics).toHaveCount(0);
    await expect(page.getByTestId('envelope-confirm')).toBeEnabled();

    // 正しい値へ直して欄から離れると反映され、理由は消える
    await fillCoord(page, 'north', '30');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect(diagnostics).toContainText('南は北より小さい値', { timeout: 15000 });
    await fillCoord(page, 'north', '35.95');
    await page.getByTestId('envelope-coord-north').press('Tab');
    await expect.poll(() => featureExtent(page), { timeout: 15000 }).not.toBeNull();
    await expect.poll(async () => (await featureExtent(page))![3], { timeout: 15000 }).toBeCloseTo(35.95, 5);
    await expect(diagnostics).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
  }
});

test('存在範囲の内側へ切り詰めて欄に出して知らせ、重ならないときは理由を出して変えない', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-coord-input-3-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const masterSlug = `coord-base-${Date.now()}`;
    await seedBaseMap(page, masterSlug, baseMapMasterDoc({
      kind: 'tms',
      maptype: null,
      url: 'https://example.com/{z}/{x}/{y}.png',
      title: { ja: 'Coord マスタ' },
      label: { ja: 'Coord マスタ' },
      coverageLngLats: COVERAGE_LNG_LATS,
    }));
    const appUid = await seedApp(page, `coord-app-3-${Date.now()}`, [
      { sourceType: 'tms', mapUid: masterSlug, role: 'base', startFrom: true },
    ]);
    await openApp(page, appUid);
    await page.getByTestId('app-sources-tab').click();
    const card = page.getByTestId(`app-selected-source-${masterSlug}`);
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.getByTestId('app-source-override-envelopeLngLats').getByRole('button', { name: '地図で指定' }).click();
    await expect(page.getByTestId('envelope-editor-dialog')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('envelope-coord-fields')).toBeVisible({ timeout: 30000 });

    // 東が存在範囲の外に来る → 内側へ切り詰め、切った後の値を欄に出して知らせる
    await fillCoord(page, 'west', '131');
    await fillCoord(page, 'south', '32.6');
    await fillCoord(page, 'east', '133');
    await fillCoord(page, 'north', '33');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect.poll(() => featureExtent(page), { timeout: 15000 }).not.toBeNull();
    const cropped = [131, 32.6, COVERAGE_BBOX[2], 33];
    expectCloseList((await featureExtent(page))!, cropped);
    expect(await fieldValues(page), '切ったあとの値を欄に出す').toEqual(['131', '32.6', '131.75', '33']);
    await expect(page.getByTestId('envelope-coord-diagnostics')).toContainText('切り詰めました', { timeout: 15000 });

    // 存在範囲と重ならない → 未選択にせず理由を出して変えない
    await fillCoord(page, 'west', '140.5');
    await fillCoord(page, 'south', '35.5');
    await fillCoord(page, 'east', '141');
    await fillCoord(page, 'north', '36');
    await page.getByTestId('envelope-coord-north').press('Enter');
    await expect(page.getByTestId('envelope-coord-diagnostics')).toContainText('重なっていません', { timeout: 15000 });
    expectCloseList((await featureExtent(page))!, cropped);
    expect(await fieldValues(page), '入れた値は欄に残る').toEqual(['140.5', '35.5', '141', '36']);
  } finally {
    await quitElectronApplication(app);
  }
});
