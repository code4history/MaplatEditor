// アプリ編集のソースのカード（AppSourceEditor）の利用範囲の 4 つの入力欄の振る舞い。
// 小窓（EnvelopeEditorModal。tests/e2e/envelope-coord-input.spec.ts）と同じふるまいに揃えたので、
// 同じことを欄の側でも確かめる。
//
//   1. 正しくない値は保存されず、欄の近くに理由が出る（数字でない・経緯度の範囲外・
//      西≧東・南≧北・4 欄が揃わない）。欄から離れるまで反映されない
//   2. 存在範囲があるときは内側へ切り詰めて保存し、切ったことを知らせる。
//      重ならないときは保存済みの値を変えず、理由を出す
//   3. 全角の数字と小数点のコンマを受け付け、半角で欄に戻す。並びは小窓と同じ
//      経度（西・東）と緯度（南・北）の 2 組
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
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
        appID: slug, appName: { ja: 'Source Coord App' }, title: { ja: 'Source Coord App' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: srcs, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
      },
    });
    if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
    return saved.uid as string;
  }, { slug: appSlug, srcs: sources });
}

// マスタ（存在範囲つき）と、そのソースを持つアプリを作り、ソースのカードまで開く
async function openSourceCard(page: Page, prefix: string): Promise<{ card: Locator; masterSlug: string }> {
  const masterSlug = `${prefix}-base-${Date.now()}`;
  await seedBaseMap(page, masterSlug, baseMapMasterDoc({
    kind: 'tms',
    maptype: null,
    url: 'https://example.com/{z}/{x}/{y}.png',
    title: { ja: 'Coord マスタ' },
    label: { ja: 'Coord マスタ' },
    coverageLngLats: COVERAGE_LNG_LATS,
  }));
  const appUid = await seedApp(page, `${prefix}-app-${Date.now()}`, [
    { sourceType: 'tms', mapUid: masterSlug, role: 'base', startFrom: true },
  ]);
  await page.evaluate((uid: string) => { location.hash = `#/appedit?uid=${uid}`; }, appUid);
  await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('app-sources-tab').click();
  const card = page.getByTestId(`app-selected-source-${masterSlug}`);
  await expect(card).toBeVisible({ timeout: 30000 });
  return { card, masterSlug };
}

function coordInput(card: Locator, field: string): Locator {
  return card.getByTestId(`app-source-envelope-${field}`);
}

function envelopeDiagnostics(card: Locator): Locator {
  return card.getByTestId('app-source-envelope-diagnostics');
}

// 保存される前の値（アプリ文書のソースの overrides）を見る
async function savedEnvelope(page: Page, mapUid: string): Promise<unknown> {
  return await page.evaluate((uid: string) => {
    const data = (window as any).testDebug.appData.value;
    const source = (data.sources ?? []).find((s: any) => s.mapUid === uid);
    return source ? source.overrides?.envelopeLngLats ?? null : null;
  }, mapUid);
}

// 欄の値を小窓と同じ並び（西・東・南・北 = DOM 順）で取る
async function fieldValues(card: Locator): Promise<string[]> {
  const inputs = card.locator('.envelope-input input');
  await expect(inputs).toHaveCount(4);
  return Promise.all([0, 1, 2, 3].map((i) => inputs.nth(i).inputValue()));
}

async function fillCoord(card: Locator, field: string, value: string): Promise<void> {
  await coordInput(card, field).fill(value);
}

test('正しくない値は保存されず理由が出る（数字でない・範囲外・西≧東・南≧北・4欄が揃わない）', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-source-coord-1-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const { card, masterSlug } = await openSourceCard(page, 'srccoord1');
    const diagnostics = envelopeDiagnostics(card);

    // 欄から離れるまで反映されない
    await fillCoord(card, 'west', '131');
    expect(await savedEnvelope(page, masterSlug), '反映前は保存されない').toBeNull();

    // 4 欄そろわない（西だけ）→ 保存せず理由を出す。空の欄に印が付く
    await coordInput(card, 'west').press('Tab');
    await expect(diagnostics).toContainText('4 つすべてを入力', { timeout: 15000 });
    await expect(coordInput(card, 'south')).toHaveClass(/is-invalid/);
    await expect(coordInput(card, 'west')).not.toHaveClass(/is-invalid/);
    expect(await savedEnvelope(page, masterSlug), '4 欄そろわないときは保存されない').toBeNull();

    // まず正しくない値の状態を残すため、4 欄そろえて一度だけ保存する
    await fillCoord(card, 'south', '32.6');
    await fillCoord(card, 'east', '131.5');
    await fillCoord(card, 'north', '33');
    await coordInput(card, 'north').press('Enter');
    await expect.poll(async () => savedEnvelope(page, masterSlug), { timeout: 15000 }).not.toBeNull();
    const before = await savedEnvelope(page, masterSlug);
    expect(before).toEqual([[131, 32.6], [131.5, 32.6], [131.5, 33], [131, 33]]);

    // 数字でない
    await fillCoord(card, 'west', 'abc');
    await coordInput(card, 'west').press('Enter');
    await expect(diagnostics).toContainText('数字で入力', { timeout: 15000 });
    await expect(coordInput(card, 'west')).toHaveClass(/is-invalid/);
    expect(await savedEnvelope(page, masterSlug), '数字でない値は保存されない').toEqual(before);

    // 経緯度の範囲の外
    await fillCoord(card, 'west', '300');
    await coordInput(card, 'west').press('Enter');
    await expect(diagnostics).toContainText('座標が範囲外', { timeout: 15000 });
    await expect(diagnostics).not.toContainText('数字で入力');
    expect(await savedEnvelope(page, masterSlug), '範囲外の値は保存されない').toEqual(before);

    // 西が東以上（保存済みの値を変えない）
    await fillCoord(card, 'west', '131');
    await fillCoord(card, 'east', '130');
    await coordInput(card, 'east').press('Enter');
    await expect(diagnostics).toContainText('西は東より小さい値', { timeout: 15000 });
    expect(await savedEnvelope(page, masterSlug)).toEqual(before);

    // 南が北以上（保存済みの値を変えない）
    await fillCoord(card, 'east', '131.5');
    await fillCoord(card, 'north', '32');
    await coordInput(card, 'north').press('Enter');
    await expect(diagnostics).toContainText('南は北より小さい値', { timeout: 15000 });
    expect(await savedEnvelope(page, masterSlug)).toEqual(before);

    // 正しい値へ直すと理由が消える
    await fillCoord(card, 'north', '33');
    await coordInput(card, 'north').press('Tab');
    await expect(envelopeDiagnostics(card)).toHaveCount(0, { timeout: 15000 });
    expect(await savedEnvelope(page, masterSlug)).toEqual(before);
  } finally {
    await quitElectronApplication(app);
  }
});

test('存在範囲の内側へ切り詰めて保存し、重ならないときは変えず理由を出す', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-source-coord-2-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const { card, masterSlug } = await openSourceCard(page, 'srccoord2');

    // 東が存在範囲の外に来る → 内側へ切り詰めて保存し、切った後の値を欄に出して知らせる
    await fillCoord(card, 'west', '131');
    await fillCoord(card, 'south', '32.6');
    await fillCoord(card, 'east', '133');
    await fillCoord(card, 'north', '33');
    await coordInput(card, 'north').press('Enter');
    await expect.poll(async () => savedEnvelope(page, masterSlug), { timeout: 15000 }).not.toBeNull();
    // 切り詰めた結果（東が存在範囲の東端 131.75）が保存される
    expect(await savedEnvelope(page, masterSlug)).toEqual([
      [131, 32.6], [131.75, 32.6], [131.75, 33], [131, 33],
    ]);
    // 小窓と同じ並び（西・東・南・北）で、切ったあとの値が欄に出る
    await expect.poll(() => fieldValues(card), { timeout: 15000 }).toEqual(['131', '131.75', '32.6', '33']);
    await expect(envelopeDiagnostics(card)).toContainText('切り詰めました', { timeout: 15000 });

    // 存在範囲と重ならない → 保存済みの値を変えず、入れた値は欄に残して理由を出す
    await fillCoord(card, 'west', '140.5');
    await fillCoord(card, 'south', '35.5');
    await fillCoord(card, 'east', '141');
    await fillCoord(card, 'north', '36');
    await coordInput(card, 'north').press('Enter');
    await expect(envelopeDiagnostics(card)).toContainText('重なっていません', { timeout: 15000 });
    expect(await savedEnvelope(page, masterSlug)).toEqual([
      [131, 32.6], [131.75, 32.6], [131.75, 33], [131, 33],
    ]);
    expect(await fieldValues(card), '入れた値は欄に残る').toEqual(['140.5', '141', '35.5', '36']);
  } finally {
    await quitElectronApplication(app);
  }
});

test('全角の数字と小数点のコンマを受け付け、半角で欄に戻す。並びは経度（西・東）と緯度（南・北）', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-source-coord-3-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const { card, masterSlug } = await openSourceCard(page, 'srccoord3');

    // 小窓と同じ並びの 2 組（経度: 西・東 / 緯度: 南・北）
    await expect(card.getByTestId('app-source-override-envelopeLngLats')).toContainText('経度');
    await expect(card.getByTestId('app-source-override-envelopeLngLats')).toContainText('緯度');

    // 全角の数字・小数点のコンマを入れる（存在範囲の内側なので切り詰めない）
    await fillCoord(card, 'west', '１３０．４５');
    await fillCoord(card, 'south', '３２．６');
    await fillCoord(card, 'east', '131,5');
    await fillCoord(card, 'north', '３３．５');
    await coordInput(card, 'north').press('Enter');
    await expect.poll(async () => savedEnvelope(page, masterSlug), { timeout: 15000 }).not.toBeNull();
    expect(await savedEnvelope(page, masterSlug)).toEqual([
      [130.45, 32.6], [131.5, 32.6], [131.5, 33.5], [130.45, 33.5],
    ]);
    // 半角で欄に戻り、並びは小窓と同じ（西・東・南・北）
    await expect.poll(() => fieldValues(card), { timeout: 15000 }).toEqual(['130.45', '131.5', '32.6', '33.5']);
    await expect(envelopeDiagnostics(card)).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
  }
});
