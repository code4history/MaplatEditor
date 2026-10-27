// directgo 往復 E2E: 手で書いた POI の `directgo` が、画面の操作を伴う経路で残るかを確かめる。
// サービス層の経路（保存・変換・取り込み・書き出し・プレビュー）は scripts/directgo-roundtrip-smoke.mjs。
//   E3 内容の形の切替: P1 を standard → url → standard と切り替え、その都度保存して directgo を確かめる
//   E4 生 JSON の窓:   directgo の無い P2 に生 JSON の窓で directgo を書き足し、適用・保存して確かめる
//   続けて同じソースをアプリとして書き出し（zip の pois/*.geojson）・プレビュー（配信される pois/*.geojson）
//   して、P1〜P3 の directgo が残ることを確かめる
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(projectRoot, 'tests/e2e/fixtures/directgo/directgo-pois.geojson');

interface FixtureFeature {
  id: string;
  properties: Record<string, unknown>;
}

async function loadFixture(): Promise<{ type: string; features: FixtureFeature[] }> {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  // 保存の途中で出る確認の窓（native）は「既定のボタン」で閉じ、文言を記録する
  await app.evaluate(async ({ dialog }) => {
    (globalThis as Record<string, unknown>).__directgoMessageBoxLog = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length >= 2 ? args[1] : args[0]) as { message?: string };
      ((globalThis as Record<string, unknown>).__directgoMessageBoxLog as string[]).push(options?.message ?? '');
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

async function messageBoxLog(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => ((globalThis as Record<string, unknown>).__directgoMessageBoxLog as string[]) ?? []);
}

async function openPoiSource(page: Page, uid: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, `#/poisources/${uid}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
}

async function seedSource(page: Page, slug: string, fc: unknown): Promise<string> {
  return page.evaluate(async (params) => {
    const created = await window.poiSources.createLocal({ slug: params.slug, title: { ja: params.slug }, lang: 'ja' });
    if (!created || created.result !== 'Success') throw new Error(`create failed: ${JSON.stringify(created)}`);
    const saved = await window.poiSources.save(created.uid, {
      slug: params.slug, title: { ja: params.slug }, fc: params.fc, expectedRevision: created.revision,
    });
    if (!saved || saved.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saved)}`);
    return created.uid as string;
  }, { slug, fc });
}

// 保存済みのソース（Write Store）から、表示 ID → properties を読む
async function storedProperties(page: Page, uid: string): Promise<Record<string, Record<string, unknown>>> {
  return page.evaluate(async (sourceUid) => {
    const detail = await window.poiSources.get(sourceUid);
    if (!detail) throw new Error(`source not found: ${sourceUid}`);
    const out: Record<string, Record<string, unknown>> = {};
    for (const f of detail.fc.features) out[String(f.id)] = f.properties as Record<string, unknown>;
    return out;
  }, uid);
}

function propertiesById(fc: { features?: Array<{ id?: unknown; properties?: Record<string, unknown> }> }): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const f of fc.features ?? []) out[String(f.id)] = f.properties ?? {};
  return out;
}

async function selectFeature(page: Page, displayId: string): Promise<void> {
  await page.locator('.poi-feature-row').filter({
    has: page.locator('.poi-feature-row-id', { hasText: new RegExp(`^${displayId}$`) }),
  }).click();
}

async function switchMode(page: Page, mode: 'standard' | 'html' | 'url'): Promise<void> {
  await page.getByTestId(`poi-content-mode-tab-${mode}`).click();
  const confirm = page.getByTestId('poi-content-mode-confirm');
  if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click();
  await expect(page.getByTestId(`poi-content-mode-tab-${mode}`)).toHaveClass(/active/, { timeout: 5000 });
}

async function save(page: Page): Promise<void> {
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
}

function expectDirectgoKept(
  label: string,
  actual: Record<string, Record<string, unknown>>,
  expected: Record<string, unknown>,
  ids: string[],
): void {
  for (const id of ids) {
    const value = actual[id]?.directgo;
    console.log(`result: ${label} ${id.toUpperCase()} ${JSON.stringify(value)}`);
    expect(value, `${label}: ${id} の directgo が入力のまま残るはず`).toEqual(expected[id]);
  }
}

test.describe('directgo roundtrip', () => {
  test('E3: 内容の形を standard → url → standard と切り替えて保存しても P1 の directgo が残る', async () => {
    test.setTimeout(180_000);
    const fixture = await loadFixture();
    const expected = Object.fromEntries(fixture.features.map((f) => [f.id, f.properties.directgo]));
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-directgo-e3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const uid = await seedSource(page, `directgo-e3-${Date.now()}`, fixture);
      await openPoiSource(page, uid);
      await selectFeature(page, 'p1');
      // desc を持つ P1 は standard と推定される（形を明示しない手書きの POI）
      await expect(page.getByTestId('poi-content-mode-tab-standard')).toHaveClass(/active/, { timeout: 5000 });

      await switchMode(page, 'url');
      await save(page);
      const afterUrl = await storedProperties(page, uid);
      console.log(`record: E3 after url mode P1 _maplatContentMode=${JSON.stringify(afterUrl.p1?._maplatContentMode)} desc=${JSON.stringify(afterUrl.p1?.desc)}`);
      expect(afterUrl.p1?._maplatContentMode).toBe('url');
      expectDirectgoKept('E3 url', afterUrl, expected, ['p1', 'p2', 'p3']);

      await switchMode(page, 'standard');
      await save(page);
      const afterStandard = await storedProperties(page, uid);
      console.log(`record: E3 after standard mode P1 _maplatContentMode=${JSON.stringify(afterStandard.p1?._maplatContentMode)}`);
      expect(afterStandard.p1?._maplatContentMode).toBe('standard');
      expectDirectgoKept('E3 standard', afterStandard, expected, ['p1', 'p2', 'p3']);
      console.log(`record: E3 message boxes ${JSON.stringify(await messageBoxLog(app))}`);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('E4: 生 JSON の窓で書き足した directgo が保存・書き出し・プレビューで残る', async () => {
    test.setTimeout(240_000);
    const fixture = await loadFixture();
    const expected = Object.fromEntries(fixture.features.map((f) => [f.id, f.properties.directgo]));
    // P2 だけ directgo を外した状態で始め、生 JSON の窓で書き足す
    const seeded = structuredClone(fixture);
    for (const f of seeded.features) if (f.id === 'p2') delete f.properties.directgo;

    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-directgo-e4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const slug = `directgo-e4-${Date.now()}`;
      const uid = await seedSource(page, slug, seeded);
      expect((await storedProperties(page, uid)).p2?.directgo).toBeUndefined();
      await openPoiSource(page, uid);

      await page.locator('button[data-editor-action="raw-pane"], button:has-text("Raw GeoJSON"), button:has-text("生GeoJSON")').click();
      const textarea = page.locator('.poi-raw-textarea');
      await expect(textarea).toBeVisible({ timeout: 5000 });
      const raw = JSON.parse(await textarea.inputValue());
      const p2 = raw.features.find((f: { id: string }) => f.id === 'p2');
      expect(p2, 'raw JSON に p2 があるはず').toBeTruthy();
      p2.properties.directgo = expected.p2;
      await textarea.fill(JSON.stringify(raw, null, 2));
      await page.locator('button:has-text("適用"), button:has-text("Apply")').click();
      await save(page);

      const stored = await storedProperties(page, uid);
      expectDirectgoKept('E4 raw-apply', stored, expected, ['p1', 'p2', 'p3']);
      console.log(`record: E4 message boxes ${JSON.stringify(await messageBoxLog(app))}`);

      // 同じソースをアプリとして書き出す（保存ダイアログは出力先を固定する）
      const zipPath = path.join(e2eRoot, 'directgo-export.zip');
      await app.evaluate(async ({ dialog }, out) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
      }, zipPath);
      const exportResult = await page.evaluate(async (poiUid) => window.appedit.export({
        appID: 'directgoapp', appName: { ja: 'directgo' }, title: { ja: 'directgo' },
        lang: 'ja', sources: [], pois: [{ poiUid }],
        appSettings: {}, httpSettings: {}, manifestSettings: {},
      }), uid);
      expect(exportResult?.result, `export result: ${JSON.stringify(exportResult)}`).toBe('Success');
      const zip = new AdmZip(zipPath);
      const poiEntry = zip.getEntries().find((e) => e.entryName.endsWith(`pois/${slug}.geojson`));
      expect(poiEntry, `pois/${slug}.geojson in: ${zip.getEntries().map((e) => e.entryName).join(', ')}`).toBeTruthy();
      expectDirectgoKept('E6 app-export', propertiesById(JSON.parse(poiEntry!.getData().toString('utf8'))), expected, ['p1', 'p2', 'p3']);

      // プレビューのサーバが配る POI の実体
      const preview = await page.evaluate(async (poiUid) => window.appedit.preparePreview({
        appID: 'directgoprev', appName: { ja: 'directgo' }, title: { ja: 'directgo' },
        lang: 'ja', sources: [], pois: [{ poiUid }],
        appSettings: {}, httpSettings: {}, manifestSettings: {},
      }), uid);
      const m = /^(https?:\/\/[^/]+)\/preview\/([^/?]+)/.exec(String(preview.url));
      expect(m, `preview url should contain token: ${preview.url}`).not.toBeNull();
      const res = await fetch(`${m![1]}/preview/${m![2]}/pois/${slug}.geojson`);
      expect(res.status).toBe(200);
      expectDirectgoKept('E7 preview', propertiesById(await res.json()), expected, ['p1', 'p2', 'p3']);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
