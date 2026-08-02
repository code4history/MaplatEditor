// M11-T9: POI Content Mode & Asset Reference URI E2E Test
// 検証: AC1-AC7, AC10, AC12-AC13, AC14, AC16, AC18
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 1x1 pixel transparent PNG (base64)
const MINI_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.editor-action-header', { timeout: 10000 }).catch(() => {});
}

async function seedPoi(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `m11-t9-poi-${Date.now()}`;
    const result = await window.poiSources.createLocal({ slug, title: { ja: 'T9 POI', en: 'T9 POI' }, lang: 'ja' });
    if (!result || result.result !== 'Success') throw new Error(`create failed: ${JSON.stringify(result)}`);
    const uid = result.uid;
    const saveResult = await window.poiSources.save(uid, {
      slug, title: { ja: 'T9 POI', en: 'T9 POI' },
      fc: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
          properties: { name: { ja: 'テストPOI' }, desc: { ja: '説明文' }, html: { ja: '<p>HTML content</p>' }, url: { ja: 'https://example.com' }, address: { ja: '東京都千代田区' } },
        }],
      },
    });
    if (!saveResult || saveResult.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saveResult)}`);
    return { uid, slug };
  });
}

test.describe('M11-T9 POI Content Mode', () => {
  test('AC1-AC8+AC16: content mode tabs, field visibility, diagnostics, mode switch+undo', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-'));
    const { app, page } = await launch(e2eRoot);

    try {
      const poi = await seedPoi(page);
      await openHash(page, `#/poisources/${poi.uid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      const featureRow = page.locator('.poi-feature-row').first();
      await featureRow.click();
      await page.waitForTimeout(500);

      // AC1: tabs visible
      const standardTab = page.getByTestId('poi-content-mode-tab-standard');
      const htmlTab = page.getByTestId('poi-content-mode-tab-html');
      const urlTab = page.getByTestId('poi-content-mode-tab-url');
      await expect(standardTab).toBeVisible({ timeout: 5000 });
      await expect(htmlTab).toHaveClass(/active/); // legacy → html mode

      // AC3: html mode fields
      await expect(page.locator('label:has-text("HTML")')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('label:has-text("参照素材")')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('label:has-text("説明")').first()).toHaveCount(0);
      await expect(page.locator('label:has-text("住所")').first()).toHaveCount(0);

      // AC5: incompatible diagnostic
      await expect(page.locator('.editor-diagnostic').first()).toBeVisible({ timeout: 5000 });

      // AC7: cancel
      await standardTab.click();
      const confirmDialog = page.getByTestId('poi-content-mode-confirm');
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });
      await page.getByTestId('poi-content-mode-cancel').click();
      await expect(htmlTab).toHaveClass(/active/);

      // AC6: confirm → standard mode
      await standardTab.click();
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });
      await confirmDialog.click();
      await expect(standardTab).toHaveClass(/active/);

      // AC8: undo returns to previous mode
      await page.locator('[data-editor-action="undo"]').click();
      await expect(htmlTab).toHaveClass(/active/);

      // AC4+AC16: url mode
      await urlTab.click();
      const confirmBtn2 = page.getByTestId('poi-content-mode-confirm');
      if (await confirmBtn2.isVisible({ timeout: 1000 }).catch(() => false)) await confirmBtn2.click();
      await expect(urlTab).toHaveClass(/active/);
      await expect(page.locator('label:has-text("画像")')).toHaveCount(0);

      // AC15(表示層): javascript: URL のライブエラーが i18n 文言で表示される
      // (人間検証Round1: 生コード "content-mode-url-format" が表示されていた回帰防止)
      const urlInput = page.locator('label:has-text("URL") + div input').first();
      await urlInput.fill('javascript:alert(1)');
      await urlInput.press('Tab'); // LangResourceInput は @change(blur) コミット
      await expect(page.getByText(/URLに http\/https 以外のプロトコル/)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('content-mode-url-format')).toHaveCount(0);

      console.log('  AC1-AC8+AC16: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC10: 「画像を挿入」ボタン経由で maplat-asset:<UID> が HTML textarea に挿入される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-ac10-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 実画像アセットを seed
      const assetSlug = `t9-asset-${Date.now()}`;
      const imgPath = path.join(e2eRoot, 'test-1x1.png');
      await writeFile(imgPath, Buffer.from(MINI_PNG_BASE64, 'base64'));
      const assetUid = await page.evaluate(async (params) => {
        const r = await window.imageAssets.add({
          slug: params.slug, title: { ja: 'テストアセット' }, lang: 'ja',
          sourceName: 'test-1x1.png', sourcePath: params.imgPath,
        });
        if (!r || r.result !== 'Success') throw new Error(`asset create: ${JSON.stringify(r)}`);
        return r.uid as string;
      }, { slug: assetSlug, imgPath });

      // html mode + 参照素材(image)に asset UID を持つ POI を seed
      const slug = `m11-t9-ac10-${Date.now()}`;
      const srcUid = await page.evaluate(async (params) => {
        const r = await window.poiSources.createLocal({ slug: params.slug, title: { ja: 'AC10 POI' }, lang: 'ja' });
        if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
        await window.poiSources.save(r.uid, {
          slug: params.slug, title: { ja: 'AC10 POI' },
          fc: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
              properties: { _maplatContentMode: 'html', name: { ja: 'AC10' }, html: { ja: '' }, image: [params.assetUid] },
            }],
          },
        });
        return r.uid as string;
      }, { slug, assetUid });

      await openHash(page, `#/poisources/${srcUid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      await page.locator('.poi-feature-row').first().click();

      // html mode で参照素材行に UID が表示されている（実UI状態の無条件アサーション）
      await expect(page.getByTestId('poi-content-mode-tab-html')).toHaveClass(/active/, { timeout: 5000 });
      const refInput = page.locator('label:has-text("参照素材") + div input[type="text"]').first();
      await expect(refInput).toHaveValue(assetUid, { timeout: 5000 });

      // 「画像を挿入」ボタン（実UI）で HTML textarea に挿入される
      await page.locator('button', { hasText: '画像を挿入' }).first().click();
      const htmlContent = await page.evaluate(() => {
        for (const ta of document.querySelectorAll('textarea')) {
          if ((ta.value || '').includes('maplat-asset:')) return ta.value;
        }
        return '';
      });
      expect(htmlContent).toContain(`maplat-asset:${assetUid}`);
      expect(htmlContent).toContain('<img src=');
      console.log('  AC10: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC12+AC14: プレビューで maplat-asset が解決・配信され、欠落参照はエディタで警告される', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-ac12-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 実画像アセット + それを参照する html mode POI を seed
      const assetSlug = `t9-prev-asset-${Date.now()}`;
      const imgPath = path.join(e2eRoot, 'prev-1x1.png');
      await writeFile(imgPath, Buffer.from(MINI_PNG_BASE64, 'base64'));
      const seeded = await page.evaluate(async (params) => {
        const a = await window.imageAssets.add({
          slug: params.slug, title: { ja: 'プレビュー素材' }, lang: 'ja',
          sourceName: 'prev-1x1.png', sourcePath: params.imgPath,
        });
        if (!a || a.result !== 'Success') throw new Error(`asset: ${JSON.stringify(a)}`);
        const p = await window.poiSources.createLocal({ slug: `${params.slug}-poi`, title: { ja: 'AC12 POI' }, lang: 'ja' });
        if (!p || p.result !== 'Success') throw new Error(`poi: ${JSON.stringify(p)}`);
        await window.poiSources.save(p.uid, {
          slug: `${params.slug}-poi`, title: { ja: 'AC12 POI' },
          fc: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
              properties: { _maplatContentMode: 'html', name: { ja: 'AC12' }, html: { ja: `<img src="maplat-asset:${a.uid}" />` } },
            }],
          },
        });
        return { assetUid: a.uid as string, poiUid: p.uid as string };
      }, { slug: assetSlug, imgPath });

      // AC12: app 直下 pois に {poiUid} を持つアプリのプレビューセッションを生成し、解決結果を実HTTPで検証
      const preview = await page.evaluate(async (poiUid) => {
        return await window.appedit.preparePreview({
          appID: 'ac12app', appName: { ja: 'AC12' }, title: { ja: 'AC12' },
          lang: 'ja', sources: [], pois: [{ poiUid }],
          appSettings: {}, httpSettings: {}, manifestSettings: {},
        });
      }, seeded.poiUid);
      const m = /^(https?:\/\/[^/]+)\/preview\/([^/?]+)/.exec(String(preview.url));
      expect(m, `preview url should contain token: ${preview.url}`).not.toBeNull();
      const origin = m![1];
      const token = m![2];

      const appJsonRes = await fetch(`${origin}/preview/${token}/apps/${token}.json`);
      expect(appJsonRes.status).toBe(200);
      const appJsonText = await appJsonRes.text();
      const resolvedUrl = `/preview/${token}/imgs/assets/${seeded.assetUid}.png`;
      expect(appJsonText).toContain(resolvedUrl);
      expect(appJsonText).not.toContain('maplat-asset:');

      // 解決済み URL から実体（画像バイト）が配信される
      const assetRes = await fetch(`${origin}${resolvedUrl}`);
      expect(assetRes.status).toBe(200);
      const bytes = new Uint8Array(await assetRes.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes[0]).toBe(0x89); // PNG magic

      // AC14: 欠落 UID を参照する POI をエディタで開くと欠落警告が表示される（無条件アサーション）
      const missingUid = '00000000-0000-4000-a000-000000000042';
      const missSlug = `t9-miss-${Date.now()}`;
      const missPoiUid = await page.evaluate(async (params) => {
        const p = await window.poiSources.createLocal({ slug: params.slug, title: { ja: 'AC14 POI' }, lang: 'ja' });
        if (!p || p.result !== 'Success') throw new Error(`poi: ${JSON.stringify(p)}`);
        await window.poiSources.save(p.uid, {
          slug: params.slug, title: { ja: 'AC14 POI' },
          fc: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
              properties: { _maplatContentMode: 'html', name: { ja: 'AC14' }, html: { ja: `<img src="maplat-asset:${params.missingUid}" />` } },
            }, {
              // 標準表示モードの画像欄によるアセットUID直接参照の欠落も検出する
              // (人間検証Round1: 画像欄が未検査だった穴の回帰防止)
              type: 'Feature', id: 'p2', geometry: { type: 'Point', coordinates: [139.768, 35.682] },
              properties: { name: { ja: 'AC14img' }, image: ['11111111-2222-4333-a444-000000000055'] },
            }],
          },
        });
        return p.uid as string;
      }, { slug: missSlug, missingUid });

      await openHash(page, `#/poisources/${missPoiUid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      // html内参照(p1)と画像欄UID直接参照(p2)の両方が欠落として数えられる(2件)
      await expect(page.getByText(/参照先が存在しないアセット参照が2件/)).toBeVisible({ timeout: 10000 });

      console.log('  AC12+AC14: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC13: エクスポートで maplat-asset が imgs/{slug}.{ext} に書き換えられ実体が同梱される', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-ac13-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const assetSlug = `t9-exp-asset-${Date.now()}`;
      const imgPath = path.join(e2eRoot, 'exp-1x1.png');
      await writeFile(imgPath, Buffer.from(MINI_PNG_BASE64, 'base64'));
      const seeded = await page.evaluate(async (params) => {
        const a = await window.imageAssets.add({
          slug: params.slug, title: { ja: 'エクスポート素材' }, lang: 'ja',
          sourceName: 'exp-1x1.png', sourcePath: params.imgPath,
        });
        if (!a || a.result !== 'Success') throw new Error(`asset: ${JSON.stringify(a)}`);
        const p = await window.poiSources.createLocal({ slug: `${params.slug}-poi`, title: { ja: 'AC13 POI' }, lang: 'ja' });
        if (!p || p.result !== 'Success') throw new Error(`poi: ${JSON.stringify(p)}`);
        await window.poiSources.save(p.uid, {
          slug: `${params.slug}-poi`, title: { ja: 'AC13 POI' },
          fc: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
              properties: { _maplatContentMode: 'html', name: { ja: 'AC13' }, html: { ja: `<img src="maplat-asset:${a.uid}" />` } },
            }],
          },
        });
        return { assetUid: a.uid as string, poiUid: p.uid as string };
      }, { slug: assetSlug, imgPath });

      // 保存ダイアログを stub して zip 出力先を固定（既存 m11-t4 等と同型）
      const zipPath = path.join(e2eRoot, 'ac13-export.zip');
      await app.evaluate(async ({ dialog }, out) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      }, zipPath);

      const exportResult = await page.evaluate(async (poiUid) => {
        return await window.appedit.export({
          appID: 'ac13app', appName: { ja: 'AC13' }, title: { ja: 'AC13' },
          lang: 'ja', sources: [], pois: [{ poiUid }],
          appSettings: {}, httpSettings: {}, manifestSettings: {},
        });
      }, seeded.poiUid);
      expect(exportResult?.result, `export result: ${JSON.stringify(exportResult)}`).toBe('Success');

      // zip を検査: html の maplat-asset が imgs/{slug}.png に書き換わり、実体が同梱される。
      // M4-T2 以降、POI 実体は apps/*.json へインライン展開されず pois/*.geojson へ書き出される。
      // ∴ html の書き換え結果は pois/ 側で検証する（app json 側には参照だけが残る）
      const zip = new AdmZip(zipPath);
      const names = zip.getEntries().map((e) => e.entryName);
      const appEntry = zip.getEntries().find((e) => /(^|\/)apps\/.*\.json$/.test(e.entryName));
      expect(appEntry, `apps json entry in: ${names.join(', ')}`).toBeTruthy();
      const appText = appEntry!.getData().toString('utf8');
      expect(appText).toContain(`pois/${assetSlug}-poi.geojson`);
      expect(appText).not.toContain('maplat-asset:');
      const poiEntry = zip.getEntries().find((e) => /(^|\/)pois\/.*\.geojson$/.test(e.entryName));
      expect(poiEntry, `pois geojson entry in: ${names.join(', ')}`).toBeTruthy();
      const poiText = poiEntry!.getData().toString('utf8');
      expect(poiText).toContain(`imgs/${assetSlug}.png`);
      expect(poiText).not.toContain('maplat-asset:');
      expect(names.some((n) => n.endsWith(`imgs/${assetSlug}.png`)), `asset entry in: ${names.join(', ')}`).toBe(true);

      console.log('  AC13: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC18: New feature button has + icon matching Resource List grammar', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-btn-'));
    const { app, page } = await launch(e2eRoot);

    try {
      const poi = await seedPoi(page);
      await openHash(page, `#/poisources/${poi.uid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      const addBtn = page.locator('button:has-text("POIを追加")');
      await expect(addBtn).toBeVisible();
      await expect(addBtn.locator('i.bi-plus-lg')).toBeVisible();

      console.log('  AC18: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});