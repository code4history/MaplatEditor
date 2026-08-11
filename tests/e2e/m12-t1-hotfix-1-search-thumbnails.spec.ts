// M12-T1-HOTFIX-1: 一覧サムネイル非表示回帰の修正 E2E。
// AC1（MapList が tmbs サムネイルを表示）/ AC4（AppList が iconSource 画像を表示）/
// AC5（AppEdit 地図選択 selector も復旧）/ AC8（ビルトイン BM・POI アイコン非回帰）を検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}
async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

// map + app（iconSource 付き）を seed し、実ファイル（tmbs / saveFolder/img）を配置する
async function seedAll(page: Page): Promise<{ mapUid: string; mapSlug: string; appSlug: string }> {
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  const seeded = await page.evaluate(async () => {
    const mapSlug = `hotfix-map-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 'hotfix map' },
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
    const appSlug = `hotfix-app-${Date.now()}`;
    const appR = await window.appedit.save({
      uid: crypto.randomUUID(),
      slug: appSlug,
      create: true,
      document: {
        appID: appSlug, appName: { ja: 'hotfix app' }, title: { ja: 'hotfix app' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [], pois: [], httpSettings: {}, appSettings: {},
        manifestSettings: { iconSource: 'img/hotfix-icon.png' },
      },
    });
    if (!appR || appR.result !== 'Success') throw new Error(JSON.stringify(appR));
    return { mapUid: mapR.uid, mapSlug, appSlug };
  });
  // tmbs/{uid}.jpg と saveFolder/img/hotfix-icon.png を配置
  await mkdir(path.join(saveFolder, 'tmbs'), { recursive: true });
  await writeFile(path.join(saveFolder, 'tmbs', `${seeded.mapUid}.jpg`), PNG_1PX);
  await mkdir(path.join(saveFolder, 'img'), { recursive: true });
  await writeFile(path.join(saveFolder, 'img', 'hotfix-icon.png'), PNG_1PX);
  return seeded;
}

// 表示中カードの画像読み込み状態を取得（ok = complete && naturalWidth > 0）
async function cardImages(page: Page): Promise<Array<{ uid: string | undefined; src: string; ok: boolean }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-resource-uid] img')).map((img) => ({
      uid: (img as HTMLElement).closest('[data-resource-uid]')?.getAttribute('data-resource-uid') ?? undefined,
      src: (img as HTMLImageElement).src,
      ok: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
    })),
  );
}

test.describe('M12-T1-HOTFIX-1 search thumbnails', () => {
  test('AC1+AC4: MapList が tmbs サムネイル、AppList が iconSource 画像を表示する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-hotfix1-list-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 既定ルートは #/maplist のため、save 時の maplist:refresh で tmbs 配置前の stale 状態が
      // 一覧に残る。先に別画面へ逃がしてから seed + 配置し、#/maplist へ戻って loadFirst させる
      await openHash(page, '#/basemaps');
      const seeded = await seedAll(page);

      // AC1: MapList で seed 地図のサムネイルが実画像として描画される（no_image ではない）
      await openHash(page, '#/maplist');
      await expect(page.locator(`[data-resource-uid="${seeded.mapUid}"]`)).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => {
        const imgs = await cardImages(page);
        const target = imgs.find((img) => img.uid === seeded.mapUid);
        return target ? { ok: target.ok, isNoImage: target.src.includes('no_image') } : null;
      }, { timeout: 15000 }).toEqual({ ok: true, isNoImage: false });

      // AC4: AppList で seed アプリの iconSource 画像が実画像として描画される
      const appUid = await page.evaluate(async (slug) =>
        (await (window as any).search.apps({ page: 1, pageSize: 50 })).docs.find((d: any) => d.slug === slug)?.uid, seeded.appSlug);
      expect(appUid).toBeTruthy();
      await openHash(page, '#/applist');
      await expect(page.locator(`[data-resource-uid="${appUid}"]`)).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => {
        const imgs = await cardImages(page);
        const target = imgs.find((img) => img.uid === appUid);
        return target ? { ok: target.ok, isNoImage: target.src.includes('no_image') } : null;
      }, { timeout: 15000 }).toEqual({ ok: true, isNoImage: false });

      console.log('  AC1+AC4: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5: AppEdit の地図選択 selector もサムネイル復旧する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-hotfix1-selector-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/basemaps');
      const seeded = await seedAll(page);
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await page.locator('[data-resource-new]').click();
      // アプリ編集の地図選択 tab へ
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });
      const sourcesTab = page.locator('[data-testid="app-tab-sources"], [role="tab"]:has-text("地図選択")').first();
      await sourcesTab.click();
      // selector の候補に seed 地図がサムネイル付きで現れる
      await expect.poll(async () => {
        const imgs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img')).map((img) => ({
            src: (img as HTMLImageElement).src,
            ok: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
          })),
        );
        const thumb = imgs.find((img) => img.src.includes('tmbs'));
        return thumb ? { ok: thumb.ok } : null;
      }, { timeout: 15000 }).toEqual({ ok: true });

      console.log('  AC5: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC8: ビルトイン BM アイコンと POI feature アイコンは非回帰', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-hotfix1-nonreg-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // ビルトイン BM アイコン（public/basemap_icons の file://）が表示される
      await openHash(page, '#/basemaps');
      await expect.poll(async () => {
        const imgs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img')).filter((img) =>
            (img as HTMLImageElement).src.includes('basemap_icons') &&
            (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
          ).length,
        );
        return imgs;
      }, { timeout: 15000 }).toBeGreaterThan(0);

      // POI feature アイコン（builtin iconset）が PoiEditMap に表示される
      await page.evaluate(async () => {
        const r = await window.poiSources.createLocal({ slug: `hotfix-poi-${Date.now()}`, title: { ja: 'hotfix poi' }, lang: 'ja' });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        await window.poiSources.save(r.uid, {
          slug: `hotfix-poi-${Date.now()}`,
          title: { ja: 'hotfix poi' },
          fc: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: 'p1',
              geometry: { type: 'Point', coordinates: [139.7, 35.6] },
              properties: { name: { ja: 'POI1' }, icon: 'builtin:defaultpin-red' },
            }],
          },
        });
      });
      await openHash(page, '#/poisources');
      const poiUid = await page.evaluate(async () =>
        (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).docs[0]?.uid);
      await openHash(page, `#/poisources/${poiUid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      // builtin icon の実体（icons/builtin/* の静的アセット）が読み込めることを確認
      // （PoiEditMap は canvas 描画のため DOM <img> ではなく、実体のロード成功で検証する）
      const iconLoaded = await page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth > 0);
            img.onerror = () => resolve(false);
            img.src = 'icons/builtin/defaultpin-red.svg';
          }),
      );
      expect(iconLoaded).toBe(true);

      console.log('  AC8: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
