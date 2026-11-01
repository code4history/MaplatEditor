// directgo 編集 E2E: 内容の形「リンク」で directgo を編集する。
//   AC1 リンク先と「新しいタブで開く」を入れて保存 → チェックなしは文字列、ありは { href, blank: true }
//   AC3 拒否される href は保存できず理由が出る。生 JSON の窓で書いた拒否される directgo も同じ error
//   AC4 standard・html・url の値がある POI をリンクにしても値は消えない。リンクから standard へ戻すと
//       確認の窓が出て、確定で directgo が消え standard の値は残る。Undo 1 回で戻る
//   確かめ用アプリ: tests/e2e/fixtures/directgo/directgo-edit-app/ の POI を osm・gsi の 2 枚の地図と
//       アプリとして書き出し、directgo が入力のまま入ることを確かめる。環境変数
//       DIRECTGO_DEMO_EXPORT_PATH があれば、書き出した zip をそこに置く（人間が画面で確かめるため。README 参照）
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
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

async function setHref(page: Page, value: string): Promise<void> {
  const input = page.getByTestId('poi-directgo-href');
  await input.fill(value);
  await input.press('Tab'); // @change でコミット
}

const point = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const LINK_ERROR = /リンク先に使えない値です/;

test.describe('directgo edit', () => {
  test('AC1: リンクの形で href と「新しいタブで開く」を入れて保存する（文字列 / { href, blank: true }）', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-directgo-edit-ac1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const uid = await seedSource(page, `directgo-edit-ac1-${Date.now()}`, [
        { type: 'Feature', id: 'a1', geometry: point(135.76, 35.01), properties: { name: 'A1', desc: 'A1 description' } },
      ]);
      await openPoiSource(page, uid);
      await selectFeature(page, 'a1');
      await expect(page.getByTestId('poi-content-mode-tab-standard')).toHaveClass(/active/, { timeout: 5000 });

      // standard → link は何も消さないので確認の窓は出ない
      await page.getByTestId('poi-content-mode-tab-link').click();
      await expect(page.getByTestId('poi-content-mode-confirm')).toHaveCount(0);
      await expect(page.getByTestId('poi-content-mode-tab-link')).toHaveClass(/active/);
      await expect(page.getByTestId('poi-directgo-note')).toBeVisible();
      // 説明は隠れて「データは残ります」が出る
      await expect(page.getByTestId('poi-directgo-hidden-content')).toContainText('データは残ります');

      await setHref(page, 'https://example.org/');
      await save(page);
      let stored = await storedProperties(page, uid);
      console.log(`result: AC1 unchecked ${JSON.stringify(stored.a1?.directgo)}`);
      expect(stored.a1?.directgo).toBe('https://example.org/');
      expect(stored.a1?.desc).toBeTruthy();

      await page.getByTestId('poi-directgo-blank').check();
      await save(page);
      stored = await storedProperties(page, uid);
      console.log(`result: AC1 checked ${JSON.stringify(stored.a1?.directgo)}`);
      expect(stored.a1?.directgo).toEqual({ href: 'https://example.org/', blank: true });

      // 同じアプリの中の位置（#!s:）も入れられる。チェックを外すと文字列に戻る
      await page.getByTestId('poi-directgo-blank').uncheck();
      await setHref(page, '#!s:other-map/x:100/y:200/z:3');
      await save(page);
      stored = await storedProperties(page, uid);
      console.log(`result: AC1 in-app ${JSON.stringify(stored.a1?.directgo)}`);
      expect(stored.a1?.directgo).toBe('#!s:other-map/x:100/y:200/z:3');
      expect(stored.a1?._maplatContentMode).toBe('link');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC3: 拒否される href は保存できず理由が出る（フォーム・生 JSON の窓）', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-directgo-edit-ac3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const uid = await seedSource(page, `directgo-edit-ac3-${Date.now()}`, [
        { type: 'Feature', id: 'b1', geometry: point(135.76, 35.01), properties: { name: 'B1', directgo: 'https://example.org/ok' } },
        { type: 'Feature', id: 'b2', geometry: point(135.77, 35.02), properties: { name: 'B2', desc: 'B2 description' } },
      ]);
      await openPoiSource(page, uid);
      await selectFeature(page, 'b1');
      // directgo を持つ POI はリンクと推定される
      await expect(page.getByTestId('poi-content-mode-tab-link')).toHaveClass(/active/, { timeout: 5000 });
      await expect(page.getByTestId('poi-directgo-href')).toHaveValue('https://example.org/ok');

      for (const bad of ['javascript:alert(1)', 'java\tscript:alert(1)']) {
        await setHref(page, bad);
        await expect(page.getByTestId('poi-directgo-error')).toContainText(LINK_ERROR);
        await expect(page.getByTestId('editor-save')).toBeDisabled();
        console.log(`result: AC3 form ${JSON.stringify(bad)} rejected`);
      }
      await setHref(page, 'https://example.org/fixed');
      await expect(page.getByTestId('poi-directgo-error')).toHaveCount(0);
      await save(page);
      expect((await storedProperties(page, uid)).b1?.directgo).toBe('https://example.org/fixed');

      // 生 JSON の窓で standard の POI に拒否される directgo を書いても同じ error
      await page.locator('button[data-editor-action="raw-pane"], button:has-text("Raw GeoJSON"), button:has-text("生GeoJSON")').click();
      const textarea = page.locator('.poi-raw-textarea');
      await expect(textarea).toBeVisible({ timeout: 5000 });
      const raw = JSON.parse(await textarea.inputValue());
      const b2 = raw.features.find((f: { id: string }) => f.id === 'b2');
      b2.properties.directgo = 'javascript:alert(1)';
      await textarea.fill(JSON.stringify(raw, null, 2));
      await page.locator('button:has-text("適用"), button:has-text("Apply")').click();
      await expect(page.getByText(LINK_ERROR).first()).toBeVisible({ timeout: 5000 });
      console.log('result: AC3 raw-pane javascript: rejected');
      const stored = await storedProperties(page, uid);
      expect(stored.b2?.directgo).toBeUndefined();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4: リンクにしても他の内容は消えず、リンクから standard へ戻すと確認の後に directgo だけ消える（Undo 1 回）', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-directgo-edit-ac4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const uid = await seedSource(page, `directgo-edit-ac4-${Date.now()}`, [
        {
          type: 'Feature', id: 'c1', geometry: point(135.76, 35.01),
          properties: { name: 'C1', _maplatContentMode: 'standard', desc: 'C1 description', address: 'C1 address' },
        },
        {
          type: 'Feature', id: 'c2', geometry: point(135.77, 35.02),
          properties: { name: 'C2', html: '<p>C2 html</p>', url: 'https://example.org/c2' },
        },
      ]);
      await openPoiSource(page, uid);

      // html・url の値がある POI をリンクにしても値は消えない
      await selectFeature(page, 'c2');
      await expect(page.getByTestId('poi-content-mode-tab-html')).toHaveClass(/active/, { timeout: 5000 });
      await page.getByTestId('poi-content-mode-tab-link').click();
      await expect(page.getByTestId('poi-content-mode-confirm')).toHaveCount(0);
      await setHref(page, 'https://example.org/c2-link');

      // standard の値がある POI をリンクにし、また standard へ戻す
      await selectFeature(page, 'c1');
      await page.getByTestId('poi-content-mode-tab-link').click();
      await expect(page.getByTestId('poi-content-mode-tab-link')).toHaveClass(/active/);
      await setHref(page, 'https://example.org/c1-link');
      await save(page);
      let stored = await storedProperties(page, uid);
      console.log(`result: AC4 link c1 ${JSON.stringify(stored.c1)}`);
      console.log(`result: AC4 link c2 ${JSON.stringify(stored.c2)}`);
      expect(stored.c1?.desc).toBeTruthy();
      expect(stored.c1?.address).toBeTruthy();
      expect(stored.c1?.directgo).toBe('https://example.org/c1-link');
      expect(stored.c2?.html).toBeTruthy();
      expect(stored.c2?.url).toBeTruthy();
      expect(stored.c2?.directgo).toBe('https://example.org/c2-link');

      // link → standard: 確認の窓（directgo が消える）。取り消すと何も変わらない
      await page.getByTestId('poi-content-mode-tab-standard').click();
      await expect(page.getByTestId('poi-content-mode-confirm')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('poi-content-mode-cancel').click();
      await expect(page.getByTestId('poi-content-mode-tab-link')).toHaveClass(/active/);
      await page.getByTestId('poi-content-mode-tab-standard').click();
      await expect(page.getByTestId('poi-content-mode-confirm')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('poi-content-mode-confirm').click();
      await expect(page.getByTestId('poi-content-mode-tab-standard')).toHaveClass(/active/);
      // standard の値はそのまま見える
      await expect(page.locator('.poi-attribute-form textarea').first()).toHaveValue('C1 description');

      // Undo 1 回で link と directgo が戻る
      await page.locator('[data-editor-action="undo"]').click();
      await expect(page.getByTestId('poi-content-mode-tab-link')).toHaveClass(/active/);
      await expect(page.getByTestId('poi-directgo-href')).toHaveValue('https://example.org/c1-link');

      // もう一度戻して保存 → directgo が消え、standard の値は残る
      await page.getByTestId('poi-content-mode-tab-standard').click();
      await page.getByTestId('poi-content-mode-confirm').click();
      await save(page);
      stored = await storedProperties(page, uid);
      console.log(`result: AC4 back to standard c1 ${JSON.stringify(stored.c1)}`);
      expect(stored.c1?.directgo).toBeUndefined();
      expect(stored.c1?._maplatContentMode).toBe('standard');
      expect(stored.c1?.desc).toBeTruthy();
      expect(stored.c1?.address).toBeTruthy();
      expect(stored.c2?.directgo).toBe('https://example.org/c2-link');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('確かめ用アプリ: リンク 3 つと標準 1 つの POI を osm・gsi の地図とアプリとして書き出す', async () => {
    test.setTimeout(180_000);
    const fixturePath = path.join(projectRoot, 'tests/e2e/fixtures/directgo/directgo-edit-app/directgo-demo-pois.geojson');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { features: Array<{ id: string; properties: Record<string, unknown> }> };
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-directgo-edit-demo-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const slug = 'directgo-demo-pois';
      const uid = await seedSource(page, slug, fixture.features);
      const zipPath = process.env.DIRECTGO_DEMO_EXPORT_PATH || path.join(e2eRoot, 'directgo-demo.zip');
      await app.evaluate(async ({ dialog }, out) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
      }, zipPath);
      const exportResult = await page.evaluate(async (poiUid) => window.appedit.export({
        appID: 'directgodemo', appName: { ja: 'directgo demo', en: 'directgo demo' }, title: { ja: 'directgo demo', en: 'directgo demo' },
        lang: 'ja', sources: ['osm', 'gsi'], pois: [{ poiUid }],
        // #!s: のリンクはビューアが状態 URL を読むときだけ動く（AppEdit の「状態URL」。既定でオン）
        appSettings: {}, httpSettings: { stateUrl: true }, manifestSettings: {},
      }), uid);
      expect(exportResult?.result, `export result: ${JSON.stringify(exportResult)}`).toBe('Success');
      const zip = new AdmZip(zipPath);
      const names = zip.getEntries().map((e) => e.entryName);
      console.log(`record: demo export ${zipPath} entries=${names.length}`);
      const poiEntry = zip.getEntries().find((e) => e.entryName.endsWith(`pois/${slug}.geojson`));
      expect(poiEntry, `pois/${slug}.geojson in: ${names.join(', ')}`).toBeTruthy();
      const exported = JSON.parse(poiEntry!.getData().toString('utf8')) as { features: Array<{ id: string; properties: Record<string, unknown> }> };
      for (const f of fixture.features) {
        const got = exported.features.find((e) => String(e.id) === f.id)?.properties ?? {};
        console.log(`result: demo ${f.id} ${JSON.stringify(got.directgo)}`);
        expect(got.directgo).toEqual(f.properties.directgo);
        expect(Object.prototype.hasOwnProperty.call(got, '_maplatContentMode')).toBe(false);
      }
      const appEntry = zip.getEntries().find((e) => /(^|\/)apps\/[^/]+\.json$/.test(e.entryName));
      expect(appEntry, `apps/*.json in: ${names.join(', ')}`).toBeTruthy();
      const appJson = JSON.parse(appEntry!.getData().toString('utf8')) as { sources?: unknown[] };
      const mapIds = (appJson.sources ?? []).map((src) => (typeof src === 'string' ? src : (src as { mapID?: string }).mapID));
      // #!s:gsi/… のリンク先の地図がアプリにある
      expect(mapIds).toEqual(expect.arrayContaining(['osm', 'gsi']));
      const indexHtml = zip.getEntries().find((e) => e.entryName === 'index.html')?.getData().toString('utf8') ?? '';
      expect(indexHtml).toMatch(/"stateUrl":\s*true/);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
