// nov26-editor-feat3: 地図の編集用ベースマップに Google を条件付きで加える。
//
// AC2 : キー未設定 + google マスタあり → 左ペインに行が出ず、理由の注記が出る
// AC3 : キー設定 + google マスタあり → 行が出て、選ぶと右ペインへ移り enabled が永続化される
// AC4 : 選ぶと ol/source/Google が tile.googleapis.com/v1/createSession へ POST する
//       （設計レビュー 2026-10-21 指示1 のスパイク。ネットワークは使わない）
//       要求は main の webRequest で観測して cancel し、続けて protocol.handle で 403 を返して
//       失敗の注記が出ることも確かめる（指示1 の後段・指示2 の失敗検知）
// AC7 : キーを後から消すと選択肢から消えるが map_base_map_visibility の行は残る
// AC8 : キーを消した状態で開いても pageerror 0 件
//
// 注意: テストのログ（assert のメッセージ・expect の出力）に URL とキーを出さない。
// そのため main 側では URL ではなく host/method/path だけを保持し、集計値だけを返す。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const GOOGLE_HOST = 'tile.googleapis.com';
const DUMMY_KEY = 'e2e-dummy-google-key';
const ROADMAP_SLUG = 'e2e-feat3-google-roadmap';
const SATELLITE_SLUG = 'e2e-feat3-google-satellite';

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** キー未設定の状態から始める（前のテストの設定を持ち越さない） */
async function resetEditorKeys(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.settings.set('lang', 'ja');
    await window.settings.set('editorGoogleApiKey', '');
    await window.settings.set('defaultPublishGoogleApiKey', '');
  });
}

/**
 * 指示1（スパイク）: tile.googleapis.com への要求を main で観測して cancel する。
 * これで実ネットワークを使わずに createSession の POST の有無だけを見る。
 * 保持するのは host/method/path のみ（URL 全体・クエリのキーは保持しない）。
 */
async function installGoogleRequestBlocker(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session }, host) => {
    const state = ((globalThis as any).__feat3 = (globalThis as any).__feat3 ?? { observed: [], served403: 0 });
    state.observed = [];
    state.served403 = 0;
    session.defaultSession.webRequest.onBeforeRequest({ urls: [`https://${host}/*`] }, (details, callback) => {
      try {
        const parsed = new URL(details.url);
        state.observed.push({ method: details.method, host: parsed.hostname, path: parsed.pathname });
      } catch {
        // 解析できない URL は記録しない（そもそもここへは来ない）
      }
      callback({ cancel: true });
    });
  }, GOOGLE_HOST);
}

/** 観測結果の集計だけを返す（キーを含み得る URL は返さない） */
async function googleRequestSummary(app: ElectronApplication): Promise<{ total: number; createSession: number }> {
  return app.evaluate(({ }, host) => {
    const state = (globalThis as any).__feat3 ?? { observed: [] };
    const rows: { method: string; host: string; path: string }[] = state.observed ?? [];
    return {
      total: rows.length,
      createSession: rows.filter(
        (row) => row.method === 'POST' && row.host === host && row.path === '/v1/createSession',
      ).length,
    };
  }, GOOGLE_HOST);
}

/** 地図を seed してベースマップ設定タブを開く */
async function seedMapAndOpenSettings(page: Page): Promise<{ mapUid: string }> {
  const seeded = await page.evaluate(async () => {
    const mapSlug = `feat3-map-${Date.now()}`;
    const mapR = await (window as any).mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 'feat3 map', en: 'feat3 map en' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'attr' }, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [[[0, 0], [15550000, 4160000]], [[400, 0], [15560000, 4160000]], [[400, 300], [15560000, 4150000]]],
        edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return { mapUid: mapR.uid };
  });
  await page.evaluate((uid: string) => { location.hash = `#/mapedit?uid=${uid}`; }, seeded.mapUid);
  await expect(page.getByTestId('map-tab-settings')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('map-tab-settings').click();
  await expect(page.getByTestId('map-base-map-selector')).toBeVisible({ timeout: 30_000 });
  return seeded;
}

/** 設定タブを出入りさせる（MapEdit.vue:2374 のタブ切替でキーと一覧を読み直させる） */
async function reopenSettingsTab(page: Page): Promise<void> {
  await page.getByTestId('map-tab-pois').click();
  await page.getByTestId('map-tab-settings').click();
  await expect(page.getByTestId('map-base-map-selector')).toBeVisible({ timeout: 30_000 });
}

async function getVisibility(page: Page, mapUid: string): Promise<any[]> {
  return page.evaluate(async (uid: string) => {
    return await (window as any).mapedit.getBaseMapVisibilityOfMapID(uid);
  }, mapUid);
}

test('AC3/AC4: キー設定済みなら google が出て、選ぶと createSession への POST が出る（実現性スパイク）', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-feat3-spike-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await resetEditorKeys(page);
    await page.evaluate(async (key: string) => { await window.settings.set('editorGoogleApiKey', key); }, DUMMY_KEY);
    const roadmapUid = await seedBaseMap(page, ROADMAP_SLUG, baseMapMasterDoc({ kind: 'google', maptype: 'google_roadmap', url: '' }));
    const satelliteUid = await seedBaseMap(page, SATELLITE_SLUG, baseMapMasterDoc({ kind: 'google', maptype: 'google_satellite', url: '' }));

    // 先に要求の観測網を張る（源の生成は選択の直後に走る）
    await installGoogleRequestBlocker(app);
    const { mapUid } = await seedMapAndOpenSettings(page);

    const selector = page.getByTestId('map-base-map-selector');
    // AC3: キーがあり一覧に登録済みなので左ペインに出る
    await expect(
      selector.locator(`[data-resource-uid="${roadmapUid}"]`),
      'google のベースマップが左ペインに出ていない',
    ).toBeVisible({ timeout: 30_000 });

    await selector.locator(`[data-resource-uid="${roadmapUid}"]`).click();
    await expect(
      page.locator(`[data-testid="map-selected-basemap-${ROADMAP_SLUG}"]`),
      '選択した google が右ペインに出ていない',
    ).toBeVisible({ timeout: 30_000 });

    // AC3: 地図単位の opt-in として永続化される
    const visibility = await getVisibility(page, mapUid);
    const roadmap = visibility.find((item: any) => item.mapID === ROADMAP_SLUG);
    expect(roadmap, 'IPC 返却に google のベースマップが無い').toBeTruthy();
    expect(roadmap.enabled, '選択が永続化されていない').toBe(true);

    // AC4（スパイクの判定点）: createSession への POST が実際に発行された
    await expect
      .poll(async () => (await googleRequestSummary(app)).createSession, {
        message: 'tile.googleapis.com/v1/createSession への POST が観測されない',
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    // 指示2: createSession の失敗は source の error 状態として届き、注記になる
    // （この時点の失敗理由は cancel によるネットワーク断）
    await expect(page.getByTestId('base-map-google-failed'), '失敗の注記が出ていない').toBeVisible({ timeout: 30_000 });

    // 指示1 の後段: webRequest を外し、https を protocol.handle で受けて 403 を返す。
    // そのうえで別の google を選び直し、403 応答の本文が注記へ載ることを確かめる
    await app.evaluate(({ session, net }) => {
      const state = (globalThis as any).__feat3;
      (session.defaultSession.webRequest as any).onBeforeRequest(null);
      session.defaultSession.protocol.handle('https', (request: any) => {
        if (request.url.startsWith('https://tile.googleapis.com/')) {
          state.served403 += 1;
          return new Response(JSON.stringify({ error: { message: 'e2e forced forbidden' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          });
        }
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      });
    });
    await selector.locator(`[data-resource-uid="${satelliteUid}"]`).click();
    await expect(
      page.getByTestId('base-map-google-failed'),
      '403 を受けたときの注記が出ていない（または API の文言が載っていない）',
    ).toContainText('e2e forced forbidden', { timeout: 30_000 });
    const served403 = await app.evaluate(() => (globalThis as any).__feat3.served403 as number);
    expect(served403, '403 を返す経路が実際には走っていない').toBeGreaterThan(0);

    expect(pageErrors, 'pageerror が出ている').toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

test('AC2/AC7/AC8: キー未設定なら出さず理由を注記・キーを消しても選択は残る', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-feat3-keys-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await resetEditorKeys(page);
    const roadmapUid = await seedBaseMap(page, ROADMAP_SLUG, baseMapMasterDoc({ kind: 'google', maptype: 'google_roadmap', url: '' }));
    // 選択後に源を作るので、ネットワークへ出ないよう先に観測網を張る
    await installGoogleRequestBlocker(app);
    const { mapUid } = await seedMapAndOpenSettings(page);

    const selector = page.getByTestId('map-base-map-selector');
    const row = selector.locator(`[data-resource-uid="${roadmapUid}"]`);
    // IPC には存在する（＝ベースマップ管理の一覧に登録済み）が、キーが無いので出さない
    const before = await getVisibility(page, mapUid);
    expect(before.some((item: any) => item.mapID === ROADMAP_SLUG), 'IPC 返却に google が無い（seed 失敗）').toBe(true);
    await expect(row, 'キー未設定なのに google が左ペインに出ている').toHaveCount(0);
    await expect(page.getByTestId('base-map-google-key-missing'), 'キー未設定の理由の注記が出ていない').toBeVisible({
      timeout: 30_000,
    });

    // キーを入れると選択肢に出る
    await page.evaluate(async (key: string) => { await window.settings.set('editorGoogleApiKey', key); }, DUMMY_KEY);
    await reopenSettingsTab(page);
    await expect(row, 'キー設定後に google が左ペインに出ていない').toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.locator(`[data-testid="map-selected-basemap-${ROADMAP_SLUG}"]`)).toBeVisible({ timeout: 30_000 });

    // AC7: キーを消すと選択肢から消えるが、地図単位の選択行は残る
    await page.evaluate(async () => { await window.settings.set('editorGoogleApiKey', ''); });
    await reopenSettingsTab(page);
    await expect(row, 'キーを消したのに google が選択肢に残っている').toHaveCount(0);
    await expect(page.getByTestId('base-map-google-key-missing')).toBeVisible({ timeout: 30_000 });
    const afterRemoval = await getVisibility(page, mapUid);
    const kept = afterRemoval.find((item: any) => item.mapID === ROADMAP_SLUG);
    expect(kept?.enabled, 'キーを消したら選択まで消えている（利用者の意図を消さない）').toBe(true);
    // AC8: キーが無い状態でも他のベースマップは従来どおり描画され、例外は出ない
    await expect(page.locator('[data-testid="map-selected-basemap-osm"]')).toBeVisible({ timeout: 15_000 });
    expect(pageErrors, 'キーを消した状態で pageerror が出ている').toEqual([]);

    // AC8 の本題: キーが無い状態でその地図を**開き直す**（入場時の setupBaseMaps を通す）
    await page.evaluate(() => { location.hash = '#/basemaps'; });
    await page.evaluate((uid: string) => { location.hash = `#/mapedit?uid=${uid}`; }, mapUid);
    await expect(page.getByTestId('map-tab-settings')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('map-tab-settings').click();
    await expect(page.getByTestId('map-base-map-selector')).toBeVisible({ timeout: 30_000 });
    await expect(row, 'キー無しで開き直したら google が出ている').toHaveCount(0);
    await expect(page.getByTestId('base-map-google-key-missing')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="map-selected-basemap-osm"]')).toBeVisible({ timeout: 15_000 });
    expect(pageErrors, 'キー無しで開き直したときに pageerror が出ている').toEqual([]);

    // キーを入れ直すと選択が復活する
    await page.evaluate(async (key: string) => { await window.settings.set('editorGoogleApiKey', key); }, DUMMY_KEY);
    await reopenSettingsTab(page);
    await expect(row, 'キーを入れ直しても google が戻らない').toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(`[data-testid="map-selected-basemap-${ROADMAP_SLUG}"]`),
      'キーを入れ直しても選択済みに戻らない',
    ).toBeVisible({ timeout: 30_000 });
    expect(pageErrors, 'pageerror が出ている').toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
