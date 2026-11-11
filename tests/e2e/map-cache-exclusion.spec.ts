// #85: アプリの地図ごとに「オフライン表示から外す」を選べる。
//
// S1 画面: アプリの「オフライン表示（キャッシュ）」（と「ホーム画面に追加（PWA）」）が働かないときは不活性で、
//          右の ? に理由が出る。働くときに印を付けて保存すると、そのソースのトップレベルに noCache: true が入る。
//          Undo で外れ、開き直しても残る。保存済みの「PWA オフ・キャッシュオン」の文書でも不活性（値は消さない）
// S2 書き出し: 印を付けた地図（組み込みの OpenStreetMap）の apps/<appID>.json の要素に noCache: true、
//          対照のベースマップ（利用者定義の tms）には無い
// S3 ビューア: 書き出したアプリを開き、地図の情報の窓のキャッシュの欄（.modal_map .modal_cache_content）が、
//          外した地図では見えず、対照の地図では見える。外した地図のタイルは Weiwudi を通らない
//
// タイルは tests/e2e/fixtures/osm-tiles の実在の OpenStreetMap のタイル（札幌の周り z14）。テストの中の
// サーバから配り、tile.openstreetmap.org への要求はそこへ振り替える（helpers/exportedApp.ts）。対照の
// ベースマップは同じサーバを URL に持つ利用者定義の tms のマスタ。
//
// 環境変数 MAP_CACHE_EXCLUSION_SHOT_DIR を付けたときだけ、ソースの欄の写真の段を足す
// （人が前後を見比べる記録。合否の関門ではない。MAP_CACHE_EXCLUSION_SHOT_PREFIX で before / after を選ぶ）。
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch, openHash, stubMessageBoxAutoOk } from './helpers/mapPackage';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';
import { openInWindow, routeOsmTilesToFixture, serveExportedZip } from './helpers/exportedApp';

const UI_APP_ID = 'map-cache-exclusion-ui';
const EXPORT_APP_ID = 'map-cache-exclusion-export';
const SHOT_APP_ID = 'map-cache-exclusion-shot';
const LEGACY_APP_ID = 'map-cache-exclusion-legacy';
const B_SLUG = 'map-cache-exclusion-tms';
const SHOT_DIR = process.env.MAP_CACHE_EXCLUSION_SHOT_DIR;
const SHOT_PREFIX = process.env.MAP_CACHE_EXCLUSION_SHOT_PREFIX || 'after';

// 実在のタイル（fixtures/osm-tiles）の範囲: z14・経度 141.35〜141.39・緯度 43.15〜43.26
const APP_SETTINGS = { homeLng: 141.37, homeLat: 43.2, defaultZoom: 14 };
// 状態URL（#!s:<mapID>/x:/y:/z:）の位置。x・y は同じ点の Web メルカトル座標（m）。s: だけだと位置が初期化される
const STATE_POSITION = 'x:15737236.41/y:5342463.60/z:14';

let app: ElectronApplication;
let page: Page;
let e2eRoot: string;
let tiles: Awaited<ReturnType<typeof routeOsmTilesToFixture>>;
const uids: Record<string, string> = {};
let exportedZip = '';

async function createApp(slug: string, sources: unknown[], httpSettings: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ s, src, http, appSettings }) => {
    const uid = crypto.randomUUID();
    const r = await (window as any).appedit.save({
      uid, slug: s, create: true,
      document: {
        appID: s, appName: { ja: s }, title: { ja: s }, description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: src, startFrom: '', pois: [], appSettings, httpSettings: http, manifestSettings: { backgroundColor: '#f6f0d3' },
      },
    });
    if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
    return uid;
  }, { s: slug, src: sources, http: httpSettings, appSettings: APP_SETTINGS });
}

async function openAppEdit(uid: string): Promise<void> {
  await openHash(page, '#/applist');
  await expect(page.locator('iframe.preview-map')).toHaveCount(0, { timeout: 30_000 });
  await openHash(page, `#/appedit?uid=${uid}`);
  await expect(page.getByTestId('app-pwa-toggle')).toBeVisible({ timeout: 30_000 });
}

const metadataTab = () => page.locator('[role="tab"]').filter({ hasText: 'メタデータ編集' });
const cacheToggle = () => page.locator('.toggle-grid > label').nth(5).locator('input[type="checkbox"]');
const card = (mapUid: string): Locator => page.getByTestId(`app-selected-source-${mapUid}`);

async function showSources(): Promise<void> {
  await page.getByTestId('app-sources-tab').click();
  await expect(card('osm')).toBeVisible({ timeout: 30_000 });
}

async function setHttp(pwa: boolean, cache: boolean): Promise<void> {
  await metadataTab().click();
  const pwaToggle = page.getByTestId('app-pwa-toggle');
  if ((await pwaToggle.isChecked()) !== pwa) await pwaToggle.click();
  if (pwa && (await cacheToggle().isChecked()) !== cache) await cacheToggle().click();
  await expect(pwaToggle).toBeChecked({ checked: pwa });
  await expect(cacheToggle()).toBeChecked({ checked: pwa && cache });
}

async function saveNow(): Promise<void> {
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60_000 });
}

async function savedSources(uid: string): Promise<any[]> {
  const doc = await page.evaluate(async (u) => (window as any).appedit.request(u), uid);
  return (doc?.sources ?? doc?.document?.sources ?? []) as any[];
}

async function exportFromUi(label: string): Promise<string> {
  const zip = path.join(e2eRoot, `${label}.zip`);
  await app.evaluate(async ({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
  }, zip);
  await page.locator('[data-editor-action="export"]').click();
  await expect(page.getByTestId('app-export-options')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('app-export-options-confirm').click();
  await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 180_000 });
  for (let i = 0; i < 5; i++) {
    const modal = page.locator('.modal.d-block');
    if (await modal.count() === 0) break;
    await modal.locator('button', { hasText: 'OK' }).first().click({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.modal.d-block')).toHaveCount(0, { timeout: 20_000 });
  return zip;
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.describe('#85 地図ごとにオフライン表示の対象から外す', () => {
  test.beforeAll(async () => {
    e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-map-cache-exclusion-'));
    ({ app, page } = await launch(e2eRoot));
    await stubMessageBoxAutoOk(app);
    tiles = await routeOsmTilesToFixture(app);
    // 対照のベースマップ B: 同じ実在のタイルを、テストの中のサーバから配る利用者定義の tms
    await seedBaseMap(page, B_SLUG, baseMapMasterDoc({
      kind: 'tms', maptype: null, url: `${tiles.origin}/{z}/{x}/{y}.png`, minZoom: 0, maxZoom: 19,
      title: { ja: '札幌のタイル（対照）' }, label: { ja: '対照' },
    }));
    uids.ui = await createApp(UI_APP_ID, ['osm', B_SLUG], { previewPort: 45811, pwaManifest: false, enableCache: false });
    // 1.2 以前に保存された「PWA オフ・キャッシュオン」の文書（AppEdit の欄からは作れない形）。印は付いたまま
    uids.legacy = await createApp(LEGACY_APP_ID, [
      { sourceType: 'builtin', mapUid: 'osm', role: 'base', startFrom: true, overrides: {}, noCache: true },
    ], { previewPort: 45812, pwaManifest: false, enableCache: true });
    // 書き出し用: 組み込みの osm（A）に印を付けた保存済みの文書。開く地図を URL で選ぶので状態URL もオン
    uids.export = await createApp(EXPORT_APP_ID, [
      { sourceType: 'builtin', mapUid: 'osm', role: 'base', startFrom: true, overrides: {}, noCache: true },
      B_SLUG,
    ], { previewPort: 45813, pwaManifest: true, enableCache: true, stateUrl: true });
  });

  test.afterAll(async () => {
    if (tiles) await tiles.unroute().catch(() => {});
    if (app) await quitElectronApplication(app);
  });

  if (SHOT_DIR) {
    test('写真: ソースの欄（前後の比較の記録）', async () => {
      await mkdir(SHOT_DIR, { recursive: true });
      const mapUid = await page.evaluate(async () => {
        const slug = 'map-cache-exclusion-maplat';
        const r = await (window as any).mapedit.save({
          slug,
          mapObject: {
            mapID: slug, title: { ja: '札幌の古地図（写真用）' }, label: { ja: '古地図' },
            officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
            attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
            reference: '', url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
            gcps: [], edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
          },
          tins: [],
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        return r.uid as string;
      });
      uids.shot = await createApp(SHOT_APP_ID, [
        { sourceType: 'maplat', mapUid, role: 'maplat', startFrom: true },
        'osm',
      ], { previewPort: 45814, pwaManifest: false, enableCache: false });
      await openAppEdit(uids.shot);
      await showSources();
      await card('osm').scrollIntoViewIfNeeded();
      const hasField = (await card('osm').getByTestId('app-source-no-cache').count()) > 0;
      const osmName = hasField ? `${SHOT_PREFIX}-source-osm-cache-off.png` : `${SHOT_PREFIX}-source-osm.png`;
      await writeFile(path.join(SHOT_DIR, osmName), await card('osm').screenshot());
      await card(mapUid).scrollIntoViewIfNeeded();
      await writeFile(path.join(SHOT_DIR, `${SHOT_PREFIX}-source-maplat.png`), await card(mapUid).screenshot());
      if (!hasField) return; // 直す前の木には欄が無い
      await setHttp(true, true);
      await showSources();
      await card('osm').getByTestId('app-source-no-cache').check();
      await card('osm').scrollIntoViewIfNeeded();
      await writeFile(path.join(SHOT_DIR, `${SHOT_PREFIX}-source-osm-cache-on.png`), await card('osm').screenshot());
      const help = card('osm').getByTestId('app-source-no-cache-help');
      await help.focus();
      const popover = page.locator('.editor-ui-help-popover');
      await expect(popover).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      const a = (await card('osm').boundingBox())!;
      const b = (await popover.boundingBox())!;
      const x = Math.max(0, Math.min(a.x, b.x) - 8);
      const y = Math.max(0, Math.min(a.y, b.y) - 8);
      const clip = { x, y, width: Math.max(a.x + a.width, b.x + b.width) + 8 - x, height: Math.max(a.y + a.height, b.y + b.height) + 8 - y };
      await writeFile(path.join(SHOT_DIR, `${SHOT_PREFIX}-source-no-cache-help.png`), await page.screenshot({ clip }));
      await help.blur();
      await saveNow();
    });
  }

  test('S1 画面: キャッシュが働かないときは不活性で理由が出る。印は保存・Undo・開き直しに耐える', async () => {
    await openAppEdit(uids.ui);
    await showSources();
    const a = card('osm');
    const b = card(B_SLUG);
    const aBox = a.getByTestId('app-source-no-cache');
    const aReason = a.getByTestId('app-source-no-cache-unavailable');

    // PWA・キャッシュともオフ: 不活性で理由の ? が見える（組み込みにも tms にも欄がある）
    await expect(aBox).toBeDisabled();
    await expect(aReason).toBeVisible();
    await expect(b.getByTestId('app-source-no-cache')).toBeDisabled();

    // PWA とキャッシュをオンにすると活性になり、理由が消える
    await setHttp(true, true);
    await showSources();
    await expect(aBox).toBeEnabled();
    await expect(aReason).toHaveCount(0);

    // PWA だけをオフに戻すと（キャッシュも従ってオフになる）、再び不活性で理由が見える
    await setHttp(false, false);
    await showSources();
    await expect(aBox).toBeDisabled();
    await expect(aReason).toBeVisible();

    // もう一度オンにして A に印を付ける → Undo で外れる（履歴 1 件）→ Redo で戻る
    await setHttp(true, true);
    await showSources();
    await aBox.check();
    await expect(aBox).toBeChecked();
    await page.getByTestId('editor-undo').click();
    await expect(aBox, 'Undo で印が外れる').not.toBeChecked();
    await page.getByTestId('editor-redo').click();
    await expect(aBox, 'Redo で印が戻る').toBeChecked();
    await saveNow();

    const sources = await savedSources(uids.ui);
    const savedA = sources.find((s) => s.mapUid === 'osm');
    const savedB = sources.find((s) => s.mapUid === B_SLUG);
    expect(savedA?.noCache, '保存した A のトップレベルに noCache: true').toBe(true);
    expect(savedA?.overrides ?? {}, 'overrides の器には入れない').not.toHaveProperty('noCache');
    expect(savedB, 'B のソースがある').toBeTruthy();
    expect('noCache' in savedB, 'B には noCache のキーが無い').toBe(false);

    // 開き直しても A の印が残り、B は外れたまま
    await openAppEdit(uids.ui);
    await showSources();
    await expect(card('osm').getByTestId('app-source-no-cache')).toBeChecked();
    await expect(card(B_SLUG).getByTestId('app-source-no-cache')).not.toBeChecked();

    // 保存済みの「PWA オフ・キャッシュオン」の文書: 不活性で理由が見え、印（値）は消えない
    await openAppEdit(uids.legacy);
    await showSources();
    const legacyBox = card('osm').getByTestId('app-source-no-cache');
    await expect(legacyBox).toBeDisabled();
    await expect(legacyBox).toBeChecked();
    await expect(card('osm').getByTestId('app-source-no-cache-unavailable')).toBeVisible();
  });

  test('S2 書き出し: 印を付けた地図の要素にだけ noCache: true が出る', async () => {
    await openAppEdit(uids.export);
    exportedZip = await exportFromUi('export');
    const appJson = JSON.parse(new AdmZip(exportedZip).readAsText(`apps/${EXPORT_APP_ID}.json`));
    console.log(`OBSERVED ${JSON.stringify({ label: 'S2', sources: appJson.sources }, null, 2)}`);
    const a = appJson.sources.find((s: any) => s?.mapID === 'osm');
    const b = appJson.sources.find((s: any) => s?.mapID === B_SLUG);
    expect(b, '対照の B が書き出される').toBeTruthy();
    expect('noCache' in b, 'B には noCache が無い（既定の出力のまま）').toBe(false);
    expect(a?.noCache, 'A に noCache: true').toBe(true);
  });

  test('S3 ビューア: 外した地図では情報の窓にキャッシュの欄が無く、タイルは Weiwudi を通らない', async () => {
    // S3 だけを走らせたとき（--grep）は、S2 と同じ保存済みの文書をここで書き出す
    if (!exportedZip) {
      await openAppEdit(uids.export);
      exportedZip = await exportFromUi('export');
    }
    const served = await serveExportedZip(exportedZip, path.join(e2eRoot, 'export-extract'));
    const { win, consoleLines, pageErrors } = await openInWindow(app, 'about:blank');
    // Resource Timing の既定の上限（250 件）で後の要求が落ちないように広げる
    await win.addInitScript(() => { performance.setResourceTimingBufferSize(10_000); });
    const entries = () => win.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    const observed: Record<string, unknown> = { label: 'S3', origin: served.origin };

    // 地図の情報の窓を開き、キャッシュの欄が見えるかを返す（窓の中身は開いたときの地図で決まる）
    const openInfoModal = async () => {
      await win.locator('.ol-copyright button').first().click();
      await expect(win.locator('.modal_map')).toBeVisible({ timeout: 20_000 });
      await win.waitForTimeout(1_000);
      return win.locator('.modal_map .modal_cache_content');
    };
    // 地図を変えるときは別の読み込みにする。同じページで hash だけを変えて読み直すと、ビューアが
    // 今の地図で URL を書き戻してから読み直しになり、切り替わらないことがあった
    const loadMap = async (mapID: string) => {
      await win.goto('about:blank');
      await win.goto(`${served.origin}/index.html#!s:${mapID}/${STATE_POSITION}`);
      await expect(win.locator('canvas').first()).toBeAttached({ timeout: 60_000 });
    };

    try {
      await win.goto(`${served.origin}/index.html#!s:osm/${STATE_POSITION}`);
      // Service Worker が制御してから地図を登録させるため、ready を待って読み直す
      await win.evaluate(() => Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 30_000)),
      ]));
      await loadMap('osm');
      expect(await win.evaluate(() => location.hash), '開いた地図は A').toContain('s:osm');
      observed.controlledA = await win.evaluate(() => Boolean(navigator.serviceWorker.controller));
      // 待つのは A のタイルの要求（直接でも Weiwudi 経由でも）。経路の合否は下で見る
      await expect.poll(async () => (await entries()).filter((n) =>
        n.includes('tile.openstreetmap.org/14/') || n.includes('weiwudi.example.com/api/cache/osm/14/')).length, {
        timeout: 60_000, message: 'A（osm）のタイルの要求が来ない',
      }).toBeGreaterThan(0);
      await win.waitForTimeout(2_000);
      const entriesA = await entries();
      observed.entriesA = {
        total: entriesA.length,
        osmDirect: entriesA.filter((n) => n.includes('tile.openstreetmap.org/14/')).length,
        osmViaWeiwudi: entriesA.filter((n) => n.includes('weiwudi.example.com/api/cache/osm/')).length,
      };
      const cacheA = await openInfoModal();
      observed.cacheContentA = await cacheA.evaluate((el) => (el as HTMLElement).style.display).catch(() => 'missing');
      await expect(cacheA, 'A を開いているとき、情報の窓にキャッシュの欄が無い').toBeHidden();
      expect(entriesA.filter((n) => n.includes('weiwudi.example.com/api/cache/osm/')), 'A のタイルは Weiwudi を通らない').toEqual([]);
      expect(entriesA.filter((n) => n.includes('tile.openstreetmap.org/14/')).length, 'A のタイルは配信元へ直接取りに行く').toBeGreaterThan(0);

      await loadMap(B_SLUG);
      observed.hashB = await win.evaluate(() => location.hash);
      observed.controlledB = await win.evaluate(() => Boolean(navigator.serviceWorker.controller));
      await expect.poll(async () => (await entries()).filter((n) => n.includes(`weiwudi.example.com/api/cache/${B_SLUG}/`)).length, {
        timeout: 60_000, message: 'B のタイルが Weiwudi を通らない（対照）',
      }).toBeGreaterThan(0);
      const entriesB = await entries();
      observed.entriesB = {
        total: entriesB.length,
        bViaWeiwudi: entriesB.filter((n) => n.includes(`weiwudi.example.com/api/cache/${B_SLUG}/`)).length,
      };
      const cacheB = await openInfoModal();
      observed.cacheContentB = await cacheB.evaluate((el) => (el as HTMLElement).style.display).catch(() => 'missing');
      await expect(cacheB, 'B を開いているとき、情報の窓にキャッシュの欄が見える（対照）').toBeVisible();

      // 記録（合否に入れない）: Weiwudi 1.1.1 の格納先
      observed.indexedDB = await win.evaluate(async () => ((await indexedDB.databases?.()) ?? []).map((d) => d.name));
    } finally {
      observed.tileServerRequests = tiles.requests.length;
      observed.tileServerSample = tiles.requests.slice(0, 10).map((r) => `${r.status} ${r.path}`);
      observed.entrySample = await entries().then((list) => list.filter((n) => !n.includes('/assets/')).slice(0, 40)).catch(() => []);
      observed.console = consoleLines.map((l) => `[${l.type}] ${l.text}`).slice(0, 80);
      observed.pageErrors = pageErrors;
      console.log(`OBSERVED ${JSON.stringify(observed, null, 2)}`);
      await win.close().catch(() => {});
      await served.close();
    }
  });
});
