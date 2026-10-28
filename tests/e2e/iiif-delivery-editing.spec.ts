// IIIF から配信する地図を編集画面で開き、対応点を打ち、保存して開き直す e2e。
//
// 取得は本物のネットワークに出さない。main の取得（Manifest・info.json・サムネイル）は
// `MAPLAT_E2E_ROOT` の応答の表で差し替え、renderer の取得（Core が編集画面で info.json と
// タイルを取りに行く道）は Playwright の route で資料を返す。地図の下地（OSM・GSI）も
// ローカルの画像に差し替えて、外へ出ない。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'iiif');

const MANIFEST_URL = 'https://dl.ndl.go.jp/api/iiif/948741/manifest.json';
const CANVAS_3_SERVICE_URL = 'https://dl.ndl.go.jp/api/iiif/948741/R0000003';
const CANVAS_3_INFO_URL = `${CANVAS_3_SERVICE_URL}/info.json`;
const CANVAS_3_FOLDER = `${CANVAS_3_SERVICE_URL}/`;

// 下地の地図に返す 1x1 の透明な PNG（外のタイルを取りに行かせない）
const TRANSPARENT_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function fixturePath(name: string): string {
  return path.join(fixtureDir, name);
}

// main の取得の口（名前解決・分類・要求）が読む応答の表を、e2e の根に置く。
async function writeMainResponses(root: string): Promise<void> {
  const table = {
    [MANIFEST_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      file: fixturePath('ndl-948741.manifest.json'),
    },
    [CANVAS_3_INFO_URL]: {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      file: fixturePath('ndl-948741-r3.info.json'),
    },
    // 取り込みのサムネイル 2 種は画像サービスの下の URL で来る
    [`${CANVAS_3_FOLDER}*`]: {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      file: fixturePath('thumb-512.jpg'),
    },
  };
  await writeFile(path.join(root, 'iiif-responses.json'), JSON.stringify(table), 'utf8');
}

// renderer の取得を資料に差し替える。編集画面が info.json とタイルを取りに行く道が対象。
async function routeRendererRequests(page: Page): Promise<{ tileRequests: string[]; infoRequests: string[] }> {
  const tileRequests: string[] = [];
  const infoRequests: string[] = [];
  const infoJson = await readFile(fixturePath('ndl-948741-r3.info.json'));
  const tileJpeg = await readFile(fixturePath('thumb-512.jpg'));

  await page.route(`${CANVAS_3_SERVICE_URL}/**`, async (route) => {
    const url = route.request().url();
    if (url === CANVAS_3_INFO_URL) {
      infoRequests.push(url);
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
        body: infoJson,
      });
      return;
    }
    tileRequests.push(url);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'access-control-allow-origin': '*',
      },
      body: tileJpeg,
    });
  });

  // 下地の地図は外へ取りに行かせない
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

  return { tileRequests, infoRequests };
}

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function openMapList(page: Page): Promise<void> {
  await page.evaluate(() => {
    location.hash = '#/maplist';
  });
  await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
}

async function stubDialogOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function centerOn(page: Page, face: 'illst' | 'merc', coord: number[]): Promise<void> {
  await page.evaluate(
    ({ face: f, coord: c }) =>
      new Promise<void>((resolve) => {
        const debug = (window as any).testDebug;
        const info = f === 'illst' ? debug.illstMapInfo() : debug.mercMapInfo();
        const map = info.map;
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        map.once('rendercomplete', finish);
        map.getView().setCenter(c);
        map.render();
        setTimeout(finish, 3000);
      }),
    { face, coord },
  );
}

async function rightClickCoord(page: Page, face: 'illst' | 'merc', coord: number[]): Promise<void> {
  const point = await page.evaluate(
    ({ face: f, coord: c, elementId }) => {
      const debug = (window as any).testDebug;
      const info = f === 'illst' ? debug.illstMapInfo() : debug.mercMapInfo();
      const pixel = info.map.getPixelFromCoordinate(c);
      const rect = document.getElementById(elementId)!.getBoundingClientRect();
      return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
    },
    { face, coord, elementId: face === 'illst' ? 'illstMap' : 'mercMap' },
  );
  await page.mouse.click(point.x, point.y, { button: 'right' });
}

async function menuTexts(page: Page, face: 'illst' | 'merc'): Promise<string[]> {
  const selector = `#${face === 'illst' ? 'illstMap' : 'mercMap'} .ol-ctx-menu-container:not(.ol-ctx-menu-hidden) > ul > li`;
  return page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).map((el) => (el as HTMLElement).innerText.trim()),
    selector,
  );
}

async function clickMenuItem(page: Page, face: 'illst' | 'merc', text: string): Promise<void> {
  const selector = `#${face === 'illst' ? 'illstMap' : 'mercMap'} .ol-ctx-menu-container:not(.ol-ctx-menu-hidden) > ul > li`;
  const clicked = await page.evaluate(
    ({ sel, label }) => {
      const items = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      const target = items.find((el) => el.innerText.trim() === label);
      if (!target) return false;
      target.click();
      return true;
    },
    { sel: selector, label: text },
  );
  expect(clicked, `メニュー項目「${text}」が ${face} 面に見つからない`).toBe(true);
}

async function gcpCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).testDebug.gcps.value.length);
}

// 画像側の 1 点と地図側の 1 点を組にして、対応点を 1 点打つ（既存の e2e の操作に合わせる）。
async function addGcpPair(page: Page, imageXy: [number, number], mercPixelOffset: [number, number]): Promise<void> {
  const illstCoord = await page.evaluate((target) => {
    const info = (window as any).testDebug.illstMapInfo();
    return info.source.xy2SysCoord(target) as number[];
  }, imageXy);
  await centerOn(page, 'illst', illstCoord);
  await rightClickCoord(page, 'illst', illstCoord);
  await expect.poll(async () => (await menuTexts(page, 'illst')).join('|'), { timeout: 10_000 }).toContain('マーカー追加');
  await clickMenuItem(page, 'illst', 'マーカー追加');

  // 地図側の空き部分を右クリックして、対応する地理の点を決める
  const mercPoint = await page.evaluate(
    ({ offset }) => {
      const info = (window as any).testDebug.mercMapInfo();
      const center = info.map.getView().getCenter();
      const pixel = info.map.getPixelFromCoordinate(center);
      const rect = document.getElementById('mercMap')!.getBoundingClientRect();
      return { x: rect.left + pixel[0] + offset[0], y: rect.top + pixel[1] + offset[1] };
    },
    { offset: mercPixelOffset },
  );
  await page.mouse.click(mercPoint.x, mercPoint.y, { button: 'right' });
  await expect.poll(async () => (await menuTexts(page, 'merc')).join('|'), { timeout: 10_000 }).toContain('マーカー追加');
  await clickMenuItem(page, 'merc', 'マーカー追加');
}

test.describe('IIIF delivery editing', () => {
  test('IIIF の地図が編集画面に出て、対応点を打って保存し、開き直しても IIIF のまま出る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-delivery-editing-'));
    await writeMainResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await stubDialogOk(app);
      const { tileRequests, infoRequests } = await routeRendererRequests(page);
      await forceJapanese(page);
      await openMapList(page);

      // 取り込みのダイアログ: Manifest → 3 コマ目 → 「IIIF から配信」
      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
      await page.getByTestId('iiif-import-inspect').click();
      await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
      await page.getByTestId('iiif-canvas-option').nth(2).click();
      await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('IIIF から配信');
      await page.getByTestId('iiif-deliverable').click();

      // 編集画面へ移り、地図のデータに配信先と大きさが入っている
      await page.waitForFunction(
        () => !!(window as any).testDebug?.mapData?.value?.delivery,
        undefined,
        { timeout: 60_000 },
      );
      const applied = await page.evaluate(() => {
        const md = (window as any).testDebug.mapData.value;
        return { delivery: md.delivery, iiif: md.iiif, width: md.width, height: md.height };
      });
      expect(applied.delivery).toEqual({ type: 'iiifImage', url: CANVAS_3_SERVICE_URL });
      expect(applied.iiif).toMatchObject({ image: CANVAS_3_SERVICE_URL });
      expect(applied.width).toBe(4074);
      expect(applied.height).toBe(2705);

      // 左の地図に IIIF の源が出る（renderer の info.json とタイルの取得が NDL の下へ飛ぶ）
      await page.getByTestId('map-tab-gcps').click();
      await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction(
        () => !!(window as any).testDebug?.illstMapInfo?.().source,
        undefined,
        { timeout: 60_000 },
      );
      await expect.poll(async () => tileRequests.length, { timeout: 60_000 }).toBeGreaterThan(0);
      expect(infoRequests.length).toBeGreaterThan(0);
      for (const url of tileRequests) {
        expect(url.startsWith(CANVAS_3_FOLDER)).toBe(true);
        expect(url.endsWith('/info.json')).toBe(false);
      }

      // 対応点を 3 点打つ
      await addGcpPair(page, [1200, 800], [0, 0]);
      await expect.poll(async () => gcpCount(page), { timeout: 20_000 }).toBe(1);
      await addGcpPair(page, [2400, 800], [120, 0]);
      await expect.poll(async () => gcpCount(page), { timeout: 20_000 }).toBe(2);
      await addGcpPair(page, [2400, 1900], [120, 90]);
      await expect.poll(async () => gcpCount(page), { timeout: 20_000 }).toBe(3);

      // 保存する（新規の地図なので名前・ID・帰属を入れる）
      const slug = `iiif-delivery-${Date.now()}`;
      await page.getByRole('tab', { name: 'メタデータ編集' }).click();
      await page.getByTestId('map-title').fill('IIIF から配信する地図');
      await page.getByTestId('map-slug').fill(slug);
      await page.getByTestId('map-attr').fill('国立国会図書館');
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('editor-save').click();
      await page.waitForFunction(
        () => !!(window as any).testDebug?.mapData?.value?.uid,
        undefined,
        { timeout: 60_000 },
      );
      const savedUid = await page.evaluate(() => (window as any).testDebug.mapData.value.uid as string);
      expect(savedUid).toBeTruthy();

      // 一覧に戻ると、その地図の行に「IIIF から配信」の印がある
      await openMapList(page);
      const rowMark = page.locator(`[data-resource-uid="${savedUid}"] [data-testid="map-row-iiif-delivery"]`);
      await expect(rowMark).toBeVisible({ timeout: 30_000 });
      await expect(rowMark).toHaveText('IIIF から配信');

      // 開き直すと、また IIIF の源で出て対応点が 3 点ある
      const infoRequestsBeforeReopen = infoRequests.length;
      await page.evaluate((uid) => {
        location.hash = `#/mapedit?uid=${uid}`;
      }, savedUid);
      await page.waitForFunction(
        () => !!(window as any).testDebug?.mapData?.value?.delivery,
        undefined,
        { timeout: 60_000 },
      );
      await expect(page.getByTestId('map-tab-gcps')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('map-tab-gcps').click();
      await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction(
        () => !!(window as any).testDebug?.illstMapInfo?.().source,
        undefined,
        { timeout: 60_000 },
      );
      await expect.poll(async () => gcpCount(page), { timeout: 20_000 }).toBe(3);
      await expect.poll(async () => infoRequests.length, { timeout: 60_000 }).toBeGreaterThan(infoRequestsBeforeReopen);

      // 保存のフォルダ: タイルの実体は無く、サムネイルだけがある
      const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      const tileFolder = path.join(saveFolder, 'tiles', savedUid);
      const tileFolderEntries = await readdir(tileFolder).catch(() => null);
      expect(tileFolderEntries === null || tileFolderEntries.length === 0).toBe(true);
      const thumbStat = await stat(path.join(saveFolder, 'tmbs', `${savedUid}.jpg`)).catch(() => null);
      expect(thumbStat?.isFile()).toBe(true);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
