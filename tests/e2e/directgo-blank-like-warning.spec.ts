// directgo が空白だけ・{ href: "" } の POI の警告 E2E。
//   ビューアは directgo が空文字 "" のときだけ「値なし」として無視し、空白だけ・{ href: "" } は遷移の処理に入る。
//   エディタは link 以外の形のこれらを warning（保存は止めない）にし、link の形では error にする。
//   1. 開くと主画面の診断領域に、空白だけの POI・{ href: "" } の POI の warning が POI の ID 付きで出る。
//      空文字・正しい URL の POI には出ない。error は出ない
//   2. warning があっても保存でき、directgo の値は変わらない（warning は知らせだけ）
//   3. 空白だけの POI をリンクの形にすると error になり、保存できない
//   環境変数 DIRECTGO_BLANK_LIKE_SCREENSHOT_DIR があれば、開いた直後の画面をそこに保存する（人間が画面で確かめるため）
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  // 保存の途中で出る native の確認の窓は既定のボタンで閉じる
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

async function seedSource(page: Page, slug: string, features: unknown[]): Promise<string> {
  return page.evaluate(async (params) => {
    const created = await window.poiSources.createLocal({ slug: params.slug, title: { ja: params.slug }, lang: 'ja' });
    if (!created || created.result !== 'Success') throw new Error(`create failed: ${JSON.stringify(created)}`);
    const saved = await window.poiSources.save(created.uid, {
      slug: params.slug, title: { ja: params.slug },
      fc: { type: 'FeatureCollection', features: params.features },
      expectedRevision: created.revision,
    });
    if (!saved || saved.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saved)}`);
    return created.uid as string;
  }, { slug, features });
}

async function openPoiSource(page: Page, uid: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, `#/poisources/${uid}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
}

async function selectFeature(page: Page, displayId: string): Promise<void> {
  await page.locator('.poi-feature-row').filter({
    has: page.locator('.poi-feature-row-id', { hasText: new RegExp(`^${displayId}$`) }),
  }).click();
}

async function storedProperties(page: Page, uid: string): Promise<Record<string, Record<string, unknown>>> {
  return page.evaluate(async (sourceUid) => {
    const detail = await window.poiSources.get(sourceUid);
    if (!detail) throw new Error(`source not found: ${sourceUid}`);
    const out: Record<string, Record<string, unknown>> = {};
    for (const f of detail.fc.features) out[String(f.id)] = f.properties as Record<string, unknown>;
    return out;
  }, uid);
}

async function save(page: Page): Promise<void> {
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
}

const point = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const BLANK_LIKE = 'リンク先（directgo）が空白だけです。';

test.describe('directgo blank-like warning', () => {
  test('空白だけ・{ href: "" } の directgo は warning で知らせ、保存は止めない（リンクの形では error）', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-directgo-blank-like-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const uid = await seedSource(page, `directgo-blank-like-${Date.now()}`, [
        { type: 'Feature', id: 'p1', geometry: point(135.76, 35.01), properties: { name: 'P1', desc: 'P1 description', directgo: '  ' } },
        { type: 'Feature', id: 'p2', geometry: point(135.77, 35.02), properties: { name: 'P2', desc: 'P2 description', directgo: { href: '' } } },
        { type: 'Feature', id: 'p3', geometry: point(135.78, 35.03), properties: { name: 'P3', desc: 'P3 description', directgo: '' } },
        { type: 'Feature', id: 'p4', geometry: point(135.79, 35.04), properties: { name: 'P4', directgo: 'https://example.org/' } },
      ]);
      await openPoiSource(page, uid);
      await expect(page.locator('.poi-feature-row')).toHaveCount(4, { timeout: 15000 });

      const screenshotDir = process.env.DIRECTGO_BLANK_LIKE_SCREENSHOT_DIR;
      if (screenshotDir) {
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, 'poi-edit-opened.png') });
      }

      // 1. 主画面の診断領域: p1・p2 の warning だけ。error は無い
      const warnings = page.locator('.editor-diagnostic__item--warning');
      await expect(warnings).toHaveCount(2, { timeout: 5000 });
      const texts = (await warnings.allTextContents()).map((s) => s.trim()).sort();
      console.log(`result: warnings ${JSON.stringify(texts)}`);
      expect(texts[0].startsWith(`p1: ${BLANK_LIKE}`)).toBe(true);
      expect(texts[1].startsWith(`p2: ${BLANK_LIKE}`)).toBe(true);
      for (const text of texts) {
        expect(text.startsWith('p3:')).toBe(false);
        expect(text.startsWith('p4:')).toBe(false);
      }
      await expect(page.locator('.editor-diagnostic__item--danger')).toHaveCount(0);

      // 2. 生 JSON の窓で p1 の説明を書き換えて適用 → 保存できる。directgo の値は変わらない
      await page.locator('button[data-editor-action="raw-pane"], button:has-text("Raw GeoJSON"), button:has-text("生GeoJSON")').click();
      const textarea = page.locator('.poi-raw-textarea');
      await expect(textarea).toBeVisible({ timeout: 5000 });
      const raw = JSON.parse(await textarea.inputValue());
      const p1 = raw.features.find((f: { id: string }) => f.id === 'p1');
      p1.properties.desc = 'P1 description (edited)';
      await textarea.fill(JSON.stringify(raw, null, 2));
      await page.locator('button:has-text("適用"), button:has-text("Apply")').click();
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 5000 });
      await save(page);
      const stored = await storedProperties(page, uid);
      console.log(`result: stored p1=${JSON.stringify(stored.p1?.directgo)} p2=${JSON.stringify(stored.p2?.directgo)} p3=${JSON.stringify(stored.p3?.directgo)}`);
      // 説明は保存で言語別の形（{ ja: … }）に正規化される
      expect(stored.p1?.desc).toEqual({ ja: 'P1 description (edited)' });
      expect(stored.p1?.directgo).toBe('  ');
      expect(stored.p2?.directgo).toEqual({ href: '' });

      // 3. p1 をリンクの形にすると error になり保存できない
      await selectFeature(page, 'p1');
      await page.getByTestId('poi-content-mode-tab-link').click();
      await expect(page.getByTestId('poi-content-mode-tab-link')).toHaveClass(/active/, { timeout: 5000 });
      await expect(page.getByTestId('poi-directgo-error')).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId('editor-save')).toBeDisabled();
      console.log('result: link mode with whitespace-only directgo is an error');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
