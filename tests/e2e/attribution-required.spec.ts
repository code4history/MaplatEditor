// 帰属表記（attr）の無いデータを作らせない・見つけて知らせる E2E
//
// Viewer は帰属表記を地図の attr と提供元の申告（Google の応答・TileJSON）からだけ出し、既定値で埋めない。
// ∴ エディタは帰属表記が要るのに無い地図・ベースマップを一覧と編集画面で知らせ、アプリのエクスポートを止める。
// Google の地図は帰属表記を入力しないので対象外。
//
// case 1: 一覧の印 — ベースマップ・地図・アプリの一覧で、帰属表記が無いものにだけ「帰属表記なし」が出る
// case 2: アプリのソースの欄 — 帰属表記が無い地図と重ね地図のソースに警告が出る（Google の背景地図には出ない）
// case 3: エクスポート — 帰属表記が無いソースがあると、エクスポートの小窓より前に止まり、どの地図かが出る
// case 4: 直す — ベースマップと地図の編集画面は帰属表記の欠落を最初から示し、入れて保存すると
//         警告が消えてエクスポートの小窓まで進む
import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { seedE2EProviderKeys } from './helpers/providerKeys';

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

type Seeded = { mapOk: string; mapNone: string; tmsNone: string; app: string };

// 以前の版で作られた、帰属表記の無いデータ（保存の入口は main の API を直接使う）
async function seed(page: Page, sfx: string): Promise<Seeded> {
  return await page.evaluate(async (s: string) => {
    const baseMap = async (slug: string, tms: Record<string, unknown>) => {
      const result = await (window as any).baseMaps.saveUser({
        slug, create: true, uid: crypto.randomUUID(),
        tms: {
          lang: 'ja', title: { ja: slug }, label: { ja: slug }, dataAttr: {}, license: '', dataLicense: '',
          licenseNote: {}, dataLicenseNote: {}, minZoom: 0, maxZoom: 18, thumbnail: '', coverageLngLats: null,
          ...tms,
        },
      });
      if (!result?.uid) throw new Error(`base map seed failed: ${JSON.stringify(result)}`);
      return result.uid as string;
    };
    const map = async (slug: string, attr: Record<string, string>) => {
      const saved = await window.mapedit.save({ slug, mapObject: {
        mapID: slug, title: { ja: slug }, label: {},
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
        reference: '', url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
      }, tins: [] });
      if (!saved || saved.result !== 'Success') throw new Error(`map seed failed: ${JSON.stringify(saved)}`);
      return saved.uid as string;
    };
    const tmsOk = `tms-ok-${s}`;
    const tmsNone = `tms-none-${s}`;
    const google = `google-${s}`;
    await baseMap(tmsOk, { kind: 'tms', url: 'https://tiles.example.org/ok/{z}/{x}/{y}.png', attr: { ja: '© Example' } });
    await baseMap(google, { kind: 'google', maptype: 'google_roadmap', url: '', attr: {} });
    const mapOk = await map(`map-ok-${s}`, { ja: '© 地図' });
    const maps = await window.maplist.request('', 1, 100);
    const mapNone = maps.docs.find((doc: any) => doc.mapID === `map-none-${s}`)?.uid;
    const tmsNoneUid = (await window.baseMaps.list()).find((item: any) => item.mapID === `tms-none-${s}`)?.uid;
    if (!mapNone || !tmsNoneUid) throw new Error('legacy attribution fixtures were not migrated');
    const appSlug = `app-${s}`;
    const saved = await window.appedit.save({ slug: appSlug, document: {
      appID: appSlug, appName: { ja: '帰属表記のアプリ' }, title: { ja: '帰属表記のアプリ' },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: [
        { sourceType: 'maplat', mapUid: mapOk, mapSlug: `map-ok-${s}`, role: 'maplat', startFrom: true },
        { sourceType: 'maplat', mapUid: mapNone, mapSlug: `map-none-${s}`, role: 'maplat', startFrom: false },
        { sourceType: 'tms', mapUid: tmsOk, role: 'base' },
        { sourceType: 'tms', mapUid: google, role: 'base' },
        { sourceType: 'tms', mapUid: tmsNone, role: 'overlay' },
      ],
      pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app seed failed: ${JSON.stringify(saved)}`);
    return { mapOk, mapNone, tmsNone: tmsNoneUid, app: saved.uid as string };
  }, sfx);
}

async function openAppSources(page: Page, appUid: string): Promise<void> {
  await page.evaluate(() => { location.hash = '#/applist'; });
  await page.locator('[data-resource-list="app"]').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await page.evaluate((uid) => { location.hash = `#/appedit?uid=${uid}`; }, appUid);
  await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('app-sources-tab').click();
}

test('帰属表記の無い地図・ベースマップは一覧と編集画面で分かり、直すまでアプリをエクスポートできない', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-attribution-required-'));
  const saveFolder = path.join(e2eRoot, 'save-folder');
  await mkdir(path.join(saveFolder, 'settings'), { recursive: true });
  const sfx = `${Date.now()}`;
  const legacyMap = {
    _id: `map-none-${sfx}`, mapID: `map-none-${sfx}`, title: { ja: `map-none-${sfx}` }, label: {},
    attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA', lang: 'ja',
    imageExtension: 'png', width: 400, height: 300, gcps: [], edges: [], sub_maps: [],
    strictMode: 'loose', vertexMode: 'plain',
  };
  await writeFile(path.join(saveFolder, 'nedb.db'), `${JSON.stringify(legacyMap)}\n`, 'utf8');
  await writeFile(path.join(saveFolder, 'settings', 'tmsList.json'), JSON.stringify([{
    mapID: `tms-none-${sfx}`, kind: 'tms', title: `tms-none-${sfx}`, url: 'https://tiles.example.org/none/{z}/{x}/{y}.png', attr: {},
  }]), 'utf8');
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    // 保存の確かめなどのネイティブのダイアログは OK で答える
    await app.evaluate(async ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await seedE2EProviderKeys(page);
    await forceJapanese(page);
    // DB migration completes as part of the first list query. Dismiss its completed progress dialog.
    await page.evaluate(() => window.maplist.request('', 1, 100));
    const startupProgress = page.getByTestId('operation-progress-dialog');
    for (let attempt = 0; attempt < 3 && await startupProgress.isVisible().catch(() => false); attempt++) {
      const closeProgress = startupProgress.getByRole('button', { name: 'OK' });
      await expect(closeProgress).toBeEnabled({ timeout: 60_000 });
      await closeProgress.click();
      await expect(startupProgress).toBeHidden();
    }
    const uids = await seed(page, sfx);
    const badge = 'resource-badge-missing-attribution';

    // case 1: 一覧の印
    await page.evaluate(() => { location.hash = '#/basemaps'; });
    await expect(page.getByTestId(`basemap-row-tms-none-${sfx}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`basemap-row-tms-none-${sfx}`).getByTestId(badge)).toHaveText('帰属表記なし');
    await expect(page.getByTestId(`basemap-row-tms-ok-${sfx}`).getByTestId(badge)).toHaveCount(0);
    await expect(page.getByTestId(`basemap-row-google-${sfx}`).getByTestId(badge)).toHaveCount(0);
    // 組み込みのベースマップはすべて帰属表記を持つ
    await expect(page.getByTestId('basemap-row-osm').getByTestId(badge)).toHaveCount(0);

    await page.evaluate(() => { location.hash = '#/maplist'; });
    await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.locator(`[data-resource-uid="${uids.mapNone}"]`).getByTestId(badge)).toHaveText('帰属表記なし', { timeout: 30_000 });
    await expect(page.locator(`[data-resource-uid="${uids.mapOk}"]`).getByTestId(badge)).toHaveCount(0);

    await page.evaluate(() => { location.hash = '#/applist'; });
    await expect(page.locator(`[data-resource-uid="${uids.app}"]`).getByTestId(badge)).toHaveText('帰属表記なし', { timeout: 30_000 });

    // case 2: アプリのソースの欄
    await openAppSources(page, uids.app);
    const warning = 'app-source-attribution-missing';
    await expect(page.getByTestId(`app-selected-source-${uids.mapNone}`).getByTestId(warning)).toContainText('この地図には帰属表記がありません', { timeout: 30_000 });
    await expect(page.getByTestId(`app-selected-source-tms-none-${sfx}`).getByTestId(warning)).toContainText('このベースマップには帰属表記がありません');
    await expect(page.getByTestId(`app-selected-source-${uids.mapOk}`).getByTestId(warning)).toHaveCount(0);
    await expect(page.getByTestId(`app-selected-source-tms-ok-${sfx}`).getByTestId(warning)).toHaveCount(0);
    await expect(page.getByTestId(`app-selected-source-google-${sfx}`).getByTestId(warning)).toHaveCount(0);

    // case 3: エクスポートはエクスポートの小窓より前に止まる
    await page.locator('[data-editor-action="export"]').click();
    const notice = page.getByTestId('operation-notice');
    await expect(notice).toContainText('帰属表記が無い地図があるため、エクスポートを止めました', { timeout: 30_000 });
    await expect(notice).toContainText(`map-none-${sfx}`);
    await expect(notice).toContainText(`tms-none-${sfx}`);
    await expect(notice).not.toContainText(`google-${sfx}`);
    await expect(page.getByTestId('app-export-options')).toHaveCount(0);

    // case 4: 直す。ベースマップの編集画面は欠落を最初から示す
    await page.evaluate((uid) => { location.hash = `#/basemaps?uid=${uid}`; }, uids.tmsNone);
    await expect(page.getByTestId('basemap-attr')).not.toHaveClass(/is-invalid/, { timeout: 30_000 });
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: '地図画像帰属を入力してください。' })).toBeVisible();
    await fillAndCommit(page.getByTestId('basemap-title'), 'Legacy base map edited');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/, { timeout: 30_000 });
    await fillAndCommit(page.getByTestId('basemap-attr'), '© 直した帰属表記');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/, { timeout: 30_000 });
    await page.getByTestId('basemap-attr').fill(' 　');
    await page.getByTestId('basemap-attr').press('Tab');
    await expect(page.getByTestId('basemap-attr')).toHaveClass(/is-invalid/);
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await page.getByTestId('basemap-attr').fill('© 直した帰属表記');
    await page.getByTestId('basemap-attr').press('Tab');
    await expect(page.getByTestId('basemap-attr')).not.toHaveClass(/is-invalid/);

    // 地図の編集画面は旧欠落を警告しつつ、他の編集を保存できる
    await page.evaluate((uid) => { location.hash = `#/mapedit?uid=${uid}`; }, uids.mapNone);
    await page.waitForFunction((uid) => (window as any).testDebug?.mapData?.value?.uid === uid, uids.mapNone, { timeout: 60_000 });
    // 読み込みが落ち着いてから直す（読み込みの途中で保存すると、後から着く同期で未保存に戻ることがある）
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/, { timeout: 30_000 });
    await page.getByRole('tab', { name: 'メタデータ編集' }).click();
    await expect(page.getByTestId('map-attr')).not.toHaveClass(/is-invalid/);
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await expect(page.getByTestId('map-attr').locator('xpath=..').locator('[data-diagnostic-severity="warning"]')).toBeVisible();
    await page.evaluate(() => { (window as any).testDebug.mapData.value.title = { ja: '旧データを編集' }; });
    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/, { timeout: 30_000 });
    await page.getByTestId('map-attr').fill('© 直した地図');
    await page.getByTestId('map-attr').press('Tab');
    await expect(page.getByTestId('map-attr')).not.toHaveClass(/is-invalid/);
    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/, { timeout: 30_000 });

    // 警告が消え、エクスポートの小窓まで進む（ここでやめる）
    await openAppSources(page, uids.app);
    await expect(page.getByTestId(`app-selected-source-${uids.mapNone}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('app-source-attribution-missing')).toHaveCount(0);
    await page.locator('[data-editor-action="export"]').click();
    await expect(page.getByTestId('app-export-options')).toBeVisible({ timeout: 30_000 });

    // 保存済みの値を消す更新は許可しない
    await page.evaluate((uid) => { location.hash = `#/mapedit?uid=${uid}`; }, uids.mapOk);
    await page.waitForFunction((uid) => (window as any).testDebug?.mapData?.value?.uid === uid, uids.mapOk, { timeout: 60_000 });
    await page.getByRole('tab', { name: 'メタデータ編集' }).click();
    await page.getByTestId('map-attr').fill(' 　');
    await page.getByTestId('map-attr').press('Tab');
    await expect(page.getByTestId('map-attr')).toHaveClass(/is-invalid/);
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await page.locator('[data-editor-action="export"]').click();
    await expect(page.getByTestId('map-export-options')).toHaveCount(0);
    const stillSaved = await page.evaluate((uid) => window.mapedit.request(uid), uids.mapOk);
    expect(stillSaved.attr).toEqual({ ja: '© 地図' });

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

// IIIF の地図: 帰属表記は Manifest の requiredStatement（v2 は attribution）から写す（既定の結び付き）。
// 国立国会図書館の実在の Manifest（948741・保存した資料）を「IIIF から配信」で取り込み、
// 手で入れなくても帰属表記が入っていて、欠落として示されないことを見る。取得は本物のネットワークに出さない
test('IIIF の地図の帰属表記は Manifest の attribution から入り、欠落として示されない', async () => {
  test.setTimeout(240_000);
  const { readFile, writeFile } = await import('node:fs/promises');
  const projectRoot = path.resolve(import.meta.dirname, '../..');
  const fixture = (name: string) => path.join(projectRoot, 'tests', 'fixtures', 'iiif', name);
  const MANIFEST_URL = 'https://dl.ndl.go.jp/api/iiif/948741/manifest.json';
  const SERVICE_URL = 'https://dl.ndl.go.jp/api/iiif/948741/R0000003';
  const INFO_URL = `${SERVICE_URL}/info.json`;
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-attribution-iiif-'));
  await writeFile(path.join(e2eRoot, 'iiif-responses.json'), JSON.stringify({
    [MANIFEST_URL]: { status: 200, headers: { 'content-type': 'application/json' }, file: fixture('ndl-948741.manifest.json') },
    [INFO_URL]: { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, file: fixture('ndl-948741-r3.info.json') },
    [`${SERVICE_URL}/*`]: { status: 200, headers: { 'content-type': 'image/jpeg' }, file: fixture('thumb-512.jpg') },
  }), 'utf8');
  const { app, page } = await launch(e2eRoot);
  try {
    const infoJson = await readFile(fixture('ndl-948741-r3.info.json'));
    const tileJpeg = await readFile(fixture('thumb-512.jpg'));
    await page.route(`${SERVICE_URL}/**`, async (route) => {
      const isInfo = route.request().url() === INFO_URL;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': isInfo ? 'application/json' : 'image/jpeg', 'access-control-allow-origin': '*' },
        body: isInfo ? infoJson : tileJpeg,
      });
    });
    await forceJapanese(page);
    await page.evaluate(() => { location.hash = '#/maplist'; });
    await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('map-import-iiif').click();
    await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
    await page.getByTestId('iiif-import-inspect').click();
    await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
    await page.getByTestId('iiif-canvas-option').nth(2).click();
    await page.getByTestId('iiif-deliverable').click();
    await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.delivery, undefined, { timeout: 60_000 });
    await page.getByRole('tab', { name: 'メタデータ編集' }).click();
    await expect(page.getByTestId('map-attr')).toHaveValue('国立国会図書館 National Diet Library, JAPAN');
    await expect(page.getByTestId('map-attr')).not.toHaveClass(/is-invalid/);
  } finally {
    await quitElectronApplication(app);
  }
});
