// M12-T15: 512pxアイコン活用 E2E。
// AC5（サムネイル管理 UI: 置換ボタン・チェックボックス・512px→52px 流用）/
// AC6（地図一覧が 512px を優先表示）/ AC7（アプリ一覧が favicon 未設定時に地図 512px を表示）を検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
// m19-t5: 512px は webp。符号化/復号の唯一の実装（宛先拡張子で選ぶ）へ委譲する
import { readImageMeta } from '../../electron/utils/thumbnail512Codec';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

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

// ダイアログを差し替えて任意の画像を選択させる（置換フロー検証用）
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
  }, imagePath);
}

async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const mapSlug = `t15-map-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 't15 map' },
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
    return { uid: mapR.uid, slug: mapSlug };
  });
}

// saveFolder/tmbs/{uid}_512.webp を直接配置する（512px サムネイルがある状態を作る）
async function placeThumbnails(saveFolder: string, uid: string): Promise<void> {
  const tmbs = path.join(saveFolder, 'tmbs');
  await mkdir(tmbs, { recursive: true });
  await writeFile(path.join(tmbs, `${uid}_512.webp`), Buffer.from(PNG_B64, 'base64'));
  await writeFile(path.join(tmbs, `${uid}.jpg`), Buffer.from(PNG_B64, 'base64'));
}

test.describe('M12-T15 512pxアイコン活用', () => {
  test('AC5: MapEdit にサムネイル管理セクション（512px/52px プレビュー・置換ボタン・チェックボックス）が表示される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-ac5-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMap(page);
      await placeThumbnails(await saveFolderOf(page), uid);
      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15000 });

      // AC5: サムネイル管理セクションと各要素
      await expect(page.getByText('サムネイル管理')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('thumbnail-replace-512')).toBeVisible();
      await expect(page.getByTestId('thumbnail-replace-52')).toBeVisible();
      await expect(page.getByTestId('thumbnail-derive-52')).toBeChecked();

      // AC5: 512px プレビューが表示（tmbs/{uid}_512.webp を配置済み）
      const metadataTab = page.getByTestId('map-title').locator('xpath=ancestor::form');
      await expect(metadataTab.locator('img[src*="_512.webp"]')).toBeVisible({ timeout: 15000 });

      console.log('  AC5: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5+Fix-2: 置換フローで 512px を置換し、プレビューが cache buster で更新される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-replace-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMap(page);
      const saveFolder = await saveFolderOf(page);
      await placeThumbnails(saveFolder, uid);

      // 置換用の画像（緑 800x400）を用意し、dialog を差し替える
      const replaceImagePath = path.join(e2eRoot, 'replace.png');
      const { Jimp } = await import('jimp');
      await new Jimp({ width: 800, height: 400, color: 0x00ff00ff }).write(replaceImagePath);
      await installDialogHarness(app, replaceImagePath);

      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15000 });

      const metadataTab = page.getByTestId('map-title').locator('xpath=ancestor::form');
      const img512 = metadataTab.locator('img[src*="_512.webp"]');
      await expect(img512).toBeVisible({ timeout: 15000 });
      const srcBefore = await img512.getAttribute('src');

      // 512px を置換（「52px も作成」チェックは既定 ON）
      await page.getByTestId('thumbnail-replace-512').click();

      // 置換後: プレビューの src が変わる（cache buster ?v= がインクリメントされる）
      await expect.poll(async () => img512.getAttribute('src'), { timeout: 15000 }).not.toBe(srcBefore);

      // 置換された 512px が実ファイルとして存在（緑画像から生成）
      const thumb512Path = `${saveFolder}/tmbs/${uid}_512.webp`;
      // m19-t5: 512px は webp。Jimp は webp を decode できないため codec の readImageMeta を使う
      const image = (await readImageMeta(thumb512Path))!;
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(512);
      // 「52px も作成」チェックが ON のため 52px も更新される
      const thumb52Path = `${saveFolder}/tmbs/${uid}.jpg`;
      const image52 = await Jimp.read(thumb52Path);
      expect(Math.max(image52.width, image52.height)).toBeLessThanOrEqual(52);

      console.log('  AC5+Fix-2: PASS (replace + cache buster + 52px 流用)');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC8: export に 512px サムネイルが同梱される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-export-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid, slug } = await seedMap(page);
      const saveFolder = await saveFolderOf(page);
      await placeThumbnails(saveFolder, uid);

      const zipPath = path.join(e2eRoot, 'export.zip');
      // export の save dialog を差し替えて zipPath へ出力させる
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);

      // app（favicon 未設定・地図をソースに持つ）を export
      await page.evaluate(async (mapSlug) => {
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug: `t15-exp-app-${Date.now()}`, create: true,
          document: {
            appID: `t15-exp-app-${Date.now()}`, lang: 'ja', title: { ja: 't15 exp app' }, appName: { ja: 't15 exp app' },
            description: {}, keywords: '', siteUrl: '',
            sources: [{ sourceType: 'maplat', mapUid: mapSlug, mapSlug }],
            startFrom: mapSlug, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        const exportResult = await window.appedit.export((await window.appedit.request(uid)).document ?? (await window.appedit.request(uid)));
        return exportResult;
      }, slug);

      // zip を adm-zip で読み、tmbs/{slug}_512.webp が同梱されることを検証
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const names = zip.getEntries().map((entry) => entry.entryName);
      expect(names).toContain(`tmbs/${slug}.jpg`); // 52px（現行）
      expect(names).toContain(`tmbs/${slug}_512.webp`); // 512px（M12-T15 G）

      console.log('  AC8: PASS (export 同梱)');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC6: 地図一覧 grid card が 512px を優先表示する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-ac6-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMap(page);
      await placeThumbnails(await saveFolderOf(page), uid);
      // 初期ルートで MapList が先に読み込まれるため、別画面へ逃がしてから戻って再読み込みさせる
      await openHash(page, '#/basemaps');
      await openHash(page, '#/maplist');
      await expect(page.locator('[data-resource-list="map"]')).toBeVisible({ timeout: 15000 });

      // AC6: 512px がある地図の grid card は _512.webp を使う（画像読み込みを poll で待つ）
      const card = page.locator(`[data-resource-uid="${uid}"]`);
      await expect(card).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => card.locator('img').getAttribute('src'), { timeout: 15000 }).toMatch(/_512\.webp/);

      console.log('  AC6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC7: アプリ一覧で favicon 未設定のアプリは地図の 512px を表示する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-ac7-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid, slug } = await seedMap(page);
      await placeThumbnails(await saveFolderOf(page), uid);
      const appSlug = await page.evaluate(async (mapSlug) => {
        const slug = `t15-app-${Date.now()}`;
        const uid = crypto.randomUUID();
        const appR = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, lang: 'ja', title: { ja: 't15 app' }, appName: { ja: 't15 app' },
            description: {}, keywords: '', siteUrl: '',
            sources: [{ sourceType: 'maplat', mapUid: mapSlug, mapSlug }],
            startFrom: mapSlug, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!appR || appR.result !== 'Success') throw new Error(JSON.stringify(appR));
        return slug;
      }, slug);

      // 初期ルートで AppList が先に読み込まれるため、別画面へ逃がしてから戻って再読み込みさせる
      await openHash(page, '#/maplist');
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-list="app"]')).toBeVisible({ timeout: 15000 });

      // AC7: favicon 未設定のアプリは地図の 512px を使う
      const appCard = page.locator(`[data-resource-uid]`).filter({ hasText: 't15 app' });
      await expect(appCard).toBeVisible({ timeout: 15000 });
      await expect(appCard.locator('img')).toHaveAttribute('src', /_512\.webp/);

      console.log('  AC7: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5b: サムネイル未存在時は placeholder が表示される（null 連結退行の回帰）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-placeholder-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 画像未アップロードの新規地図を作成（サムネイル不存在）
      const slug = await page.evaluate(async () => {
        const mapSlug = `t15-nomap-${Date.now()}`;
        const mapR = await window.mapedit.save({
          slug: mapSlug,
          mapObject: {
            mapID: mapSlug, title: { ja: 'no thumb map' },
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
        return mapR.uid;
      });

      // MapEdit へ遷移（初期タブは metadata。サムネイル管理セクションは metadata タブ内）
      await openHash(page, `#/mapedit?uid=${slug}`);
      await expect(page.getByTestId('thumbnail-replace-512')).toBeVisible({ timeout: 15000 });

      // 512px の placeholder が表示される（img ではなく div.placeholder）
      const placeholder512 = page.locator('div.border.rounded.text-muted').filter({ hasText: '512px' }).first();
      await expect(placeholder512).toBeVisible({ timeout: 15000 });

      // 52px の placeholder も表示される
      const placeholder52 = page.locator('div.border.rounded.text-muted').filter({ hasText: '52px' }).first();
      await expect(placeholder52).toBeVisible({ timeout: 15000 });

      // img タグが表示されない（null 連結で壊れた画像が出ないことを検証）
      const img512 = page.locator('img[alt="512px"]');
      await expect(img512).toHaveCount(0);

      console.log('  AC5b: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
