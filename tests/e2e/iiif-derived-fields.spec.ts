// IIIF から配信する地図の、IIIF で決まる欄 E2E
//
// IIIF から配信する地図（delivery を持つ地図）の画像・大きさ・タイルは、IIIF の配信元（info.json）で決まる。
// 編集画面ではタイルの URL・地図画像の登録・拡張子を入力させず、理由を ? で示す。
// case 1: Manifest からインポートした直後の地図で、タイルの URL は配信元が入力できない形で出る・
//         画像の登録は押せない・拡張子は出ない・大きさは info.json の値で、決まり方を ? で示す
// case 2: タイルの URL を入れたまま保存した IIIF の地図を開くと、その URL は残っておらず、
//         配信元が出て、左の地図は IIIF の配信元から読み込む（手の URL へは取りに行かない）。
//         以前の版の保存形（データベースに URL が残った地図）の読み込みは iiif-app-export-smoke が見る
// case 3: アプリのソースの欄で、IIIF の地図の「オフライン表示から外す」は押せず、理由を ? で示す
//         （IIIF でない地図は押せる）
//
// 取得は本物のネットワークに出さない（iiif-delivery-editing.spec.ts と同じ応答の表と route）。
// 資料は国立国会図書館の実在の Manifest（948741）を保存したもの。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { evalMain } from './helpers/evalMain';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'iiif');

const MANIFEST_URL = 'https://dl.ndl.go.jp/api/iiif/948741/manifest.json';
const CANVAS_3_SERVICE_URL = 'https://dl.ndl.go.jp/api/iiif/948741/R0000003';
const CANVAS_3_INFO_URL = `${CANVAS_3_SERVICE_URL}/info.json`;
const MANUAL_TILE_URL = 'https://tiles.example.org/manual/{z}/{x}/{y}.png';

const TRANSPARENT_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function fixturePath(name: string): string {
  return path.join(fixtureDir, name);
}

async function writeMainResponses(root: string): Promise<void> {
  const table = {
    [MANIFEST_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      file: fixturePath('ndl-948741.manifest.json'),
    },
    [CANVAS_3_INFO_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      file: fixturePath('ndl-948741-r3.info.json'),
    },
    [`${CANVAS_3_SERVICE_URL}/*`]: {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      file: fixturePath('thumb-512.jpg'),
    },
  };
  await writeFile(path.join(root, 'iiif-responses.json'), JSON.stringify(table), 'utf8');
}

// renderer の取得を資料に差し替える。手で入れたタイルの URL へ取りに行ったら数える
async function routeRendererRequests(page: Page): Promise<{ iiifTiles: string[]; manualTiles: string[] }> {
  const iiifTiles: string[] = [];
  const manualTiles: string[] = [];
  const infoJson = await readFile(fixturePath('ndl-948741-r3.info.json'));
  const tileJpeg = await readFile(fixturePath('thumb-512.jpg'));
  await page.route(`${CANVAS_3_SERVICE_URL}/**`, async (route) => {
    const url = route.request().url();
    const isInfo = url === CANVAS_3_INFO_URL;
    if (!isInfo) iiifTiles.push(url);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': isInfo ? 'application/json' : 'image/jpeg',
        'access-control-allow-origin': '*',
      },
      body: isInfo ? infoJson : tileJpeg,
    });
  });
  await page.route('**/tiles.example.org/**', async (route) => {
    manualTiles.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_TILE });
  });
  for (const pattern of [
    '**/tile.openstreetmap.org/**',
    '**/cyberjapandata.gsi.go.jp/**',
    '**/t.tilemap.jp/**',
    '**/basemaps.cartocdn.com/**',
  ]) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_TILE }),
    );
  }
  return { iiifTiles, manualTiles };
}

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function stubDialogOk(app: ElectronApplication): Promise<void> {
  await evalMain(app, async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function expectPopover(page: Page, testId: string, text: string): Promise<void> {
  await page.getByTestId(testId).click();
  await expect(page.locator('.popover')).toContainText(text, { timeout: 5000 });
  await page.keyboard.press('Escape');
}

// メタデータ編集タブの、IIIF で決まる欄の見え方
async function expectIiifDerivedFields(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'メタデータ編集' }).click();
  await expect(page.getByTestId('map-tile-url')).toHaveCount(0);
  const tileUrl = page.getByTestId('map-tile-url-iiif');
  await expect(tileUrl).toBeDisabled();
  await expect(tileUrl).toHaveValue(CANVAS_3_SERVICE_URL);
  await expect(page.getByTestId('map-tile-url-iiif-reason')).toHaveAttribute('aria-label', '「地図タイルURL」を使えない理由');
  await expectPopover(page, 'map-tile-url-iiif-reason', 'インポートした IIIF の情報で決まるため');

  await expect(page.getByTestId('map-upload-image')).toBeDisabled();
  await expect(page.getByTestId('map-upload-image-iiif-reason')).toHaveAttribute('aria-label', '「地図画像登録」を使えない理由');
  await expectPopover(page, 'map-upload-image-iiif-reason', '大きさが合わなくなり地図が壊れる');

  await expect(page.getByTestId('map-image-extension')).toHaveCount(0);
  await expect(page.getByTestId('map-image-width')).toHaveValue('4074');
  await expect(page.getByTestId('map-image-height')).toHaveValue('2705');
  // 大きさの ? は幅と高さの両方の説明（高さの後ろに 1 つ）。? の有無で幅と高さの入力欄がずれない
  await expect(page.getByTestId('map-image-size-iiif-help')).toHaveAttribute('aria-label', '「地図画像の大きさ」の説明');
  const widthBox = await page.getByTestId('map-image-width').boundingBox();
  const heightBox = await page.getByTestId('map-image-height').boundingBox();
  expect(Math.abs((widthBox?.y ?? 0) - (heightBox?.y ?? -10))).toBeLessThan(0.5);
  await expectPopover(page, 'map-image-size-iiif-help', 'info.json で決まります');
}

test('IIIF から配信する地図は、IIIF で決まる欄を入力できず、手で入れたタイルの URL も読まない', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-derived-fields-'));
  await writeMainResponses(e2eRoot);
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await stubDialogOk(app);
    const requests = await routeRendererRequests(page);
    await forceJapanese(page);

    // case 1: Manifest → 3 コマ目 → 「IIIF から配信」
    await page.evaluate(() => { location.hash = '#/maplist'; });
    await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('map-import-iiif').click();
    await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
    await page.getByTestId('iiif-import-inspect').click();
    await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
    await page.getByTestId('iiif-canvas-option').nth(2).click();
    await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('IIIF から配信');
    await page.getByTestId('iiif-deliverable').click();
    await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.delivery, undefined, { timeout: 60_000 });
    await expectIiifDerivedFields(page);
    // 保存しておく（未保存のまま別の地図へ移らない）
    await page.getByTestId('map-title').fill('IIIF から配信する地図');
    await page.getByTestId('map-slug').fill(`iiif-imported-${Date.now()}`);
    await page.getByTestId('map-attr').fill('国立国会図書館');
    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('editor-save').click();
    await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.uid, undefined, { timeout: 60_000 });
    await expectIiifDerivedFields(page);

    // case 2: タイルの URL を入れたまま保存した IIIF の地図
    const slug = `iiif-manual-url-${Date.now()}`;
    const mapUid = await page.evaluate(async ({ s, manual, service }) => {
      const saved = await window.mapedit.save({ slug: s, mapObject: {
        mapID: s, title: { ja: 'タイルの URL を手で入れた IIIF の地図' }, label: {},
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: '国立国会図書館' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
        reference: '', url: manual, lang: 'ja', width: 4074, height: 2705,
        gcps: [], edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
        delivery: { type: 'iiifImage', url: service }, iiif: { image: service },
      }, tins: [] });
      if (!saved || saved.result !== 'Success') throw new Error(`map create failed: ${JSON.stringify(saved)}`);
      return saved.uid as string;
    }, { s: slug, manual: MANUAL_TILE_URL, service: CANVAS_3_SERVICE_URL });
    await page.evaluate(() => { location.hash = '#/maplist'; });
    await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
    await page.evaluate((uid) => { location.hash = `#/mapedit?uid=${uid}`; }, mapUid);
    await page.waitForFunction((uid) => (window as any).testDebug?.mapData?.value?.uid === uid, mapUid, { timeout: 60_000 });
    const loaded = await page.evaluate(() => {
      const md = (window as any).testDebug.mapData.value;
      return { url: md.url ?? null, runtimeUrl: md.url_ ?? null };
    });
    expect(loaded).toEqual({ url: null, runtimeUrl: null });
    await expectIiifDerivedFields(page);
    await page.getByTestId('map-tab-gcps').click();
    await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => requests.iiifTiles.length, { timeout: 60_000 }).toBeGreaterThan(0);
    expect(requests.manualTiles).toEqual([]);

    // case 3: アプリのソースの欄。IIIF の地図と、IIIF でない地図を並べる
    const appUid = await page.evaluate(async ({ uid, s }) => {
      const plainSlug = `${s}-plain`;
      const plain = await window.mapedit.save({ slug: plainSlug, mapObject: {
        mapID: plainSlug, title: { ja: '普通の地図' }, label: {},
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'a' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
        reference: '', url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
      }, tins: [] });
      if (!plain || plain.result !== 'Success') throw new Error(`map create failed: ${JSON.stringify(plain)}`);
      const saved = await window.appedit.save({ slug: `app-${s}`, document: {
        appID: `app-${s}`, appName: { ja: 'IIIF のアプリ' }, title: { ja: 'IIIF のアプリ' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [
          { sourceType: 'maplat', mapUid: uid, mapSlug: s, role: 'maplat', startFrom: true },
          { sourceType: 'maplat', mapUid: plain.uid, mapSlug: plainSlug, role: 'maplat', startFrom: false },
        ],
        pois: [], httpSettings: { pwaManifest: true, enableCache: true }, appSettings: {}, manifestSettings: {},
      } });
      if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
      return { app: saved.uid as string, plain: plain.uid as string };
    }, { uid: mapUid, s: slug });
    await page.evaluate((uid) => { location.hash = `#/appedit?uid=${uid}`; }, appUid.app);
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('app-sources-tab').click();
    const iiifCard = page.getByTestId(`app-selected-source-${mapUid}`);
    const plainCard = page.getByTestId(`app-selected-source-${appUid.plain}`);
    await expect(iiifCard.getByTestId('app-source-no-cache')).toBeDisabled({ timeout: 30_000 });
    await expect(iiifCard.getByTestId('app-source-no-cache-help')).toHaveCount(0);
    const reason = iiifCard.getByTestId('app-source-no-cache-iiif-reason');
    await expect(reason).toHaveAttribute('aria-label', '「オフライン表示から外す」を使えない理由');
    await reason.click();
    await expect(page.locator('.popover')).toContainText('ここで外す必要はありません', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(plainCard.getByTestId('app-source-no-cache')).toBeEnabled();
    await expect(plainCard.getByTestId('app-source-no-cache-help')).toHaveCount(1);
    await expect(plainCard.getByTestId('app-source-no-cache-iiif-reason')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
