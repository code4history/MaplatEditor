// nov26-m6-t4（code4history/MaplatEditor#108）: Maplat 地図のソースのラベル欄に、地図側の label を
// プレースホルダとして出す。
//
// 直す前は AppEdit の masterDataOf が maplat で null を返し、AppSourceEditor の maplat 分岐の
// LangResourceInput に :placeholder が無かった。viewer はアプリの label が無ければ地図の設定の
// label を使う（MaplatCore src/source/mixin.ts）ので、未入力のときに何が出るかが画面から分からない。
//
// 3 条件（マイルストーン設計 t4/AC4）:
//   (1) ラベル未入力のとき地図の label がプレースホルダに出る
//   (2) 上書き済みは上書き値が出る
//   (3) 地図の label が空でも欄が表示され、操作できる（プレースホルダは空）
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
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
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({ status: 404, body: '' }));
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

// 地図 3 件（label あり・label 空・label あり＋アプリ側で上書き済み）と、それらをソースに持つアプリ
async function seed(page: Page, suffix: string) {
  return await page.evaluate(async (sfx: string) => {
    const makeMap = async (slug: string, label: Record<string, string>) => {
      const mapObject = {
        mapID: slug,
        title: { ja: `${slug} 表題` },
        label,
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
        reference: '', url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
      };
      const saved = await window.mapedit.save({ slug, mapObject, tins: [] });
      if (!saved || saved.result !== 'Success') throw new Error(`map create failed: ${JSON.stringify(saved)}`);
      return saved.uid as string;
    };
    const labeled = await makeMap(`t4ph-labeled-${sfx}`, { ja: '地図側のラベル', en: 'Map side label' });
    const empty = await makeMap(`t4ph-empty-${sfx}`, {});
    const overridden = await makeMap(`t4ph-over-${sfx}`, { ja: '使われない地図ラベル' });
    const appSlug = `t4ph-app-${sfx}`;
    const app = await window.appedit.save({ slug: appSlug, document: {
      appID: appSlug, appName: { ja: 'T4 PH App' }, title: { ja: 'T4 PH App' },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: [
        { sourceType: 'maplat', mapUid: labeled, mapSlug: `t4ph-labeled-${sfx}`, role: 'maplat', startFrom: true },
        { sourceType: 'maplat', mapUid: empty, mapSlug: `t4ph-empty-${sfx}`, role: 'maplat' },
        { sourceType: 'maplat', mapUid: overridden, mapSlug: `t4ph-over-${sfx}`, role: 'maplat', label: { ja: 'アプリの上書き' } },
      ],
      pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
    } });
    if (!app || app.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(app)}`);
    return { labeled, empty, overridden, appUid: app.uid as string };
  }, suffix);
}

test('nov26-m6-t4 AC4（#108）: Maplat 地図のラベル欄に地図の label がプレースホルダとして出る', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-nov26-m6-t4-ph-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const ids = await seed(page, `${Date.now()}`);
    await page.evaluate((uid: string) => { location.hash = `#/appedit?uid=${uid}`; }, ids.appUid);
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-sources-tab').click();

    const labeledInput = page.getByTestId(`app-selected-source-${ids.labeled}`).getByTestId('app-source-maplat-label');
    const emptyInput = page.getByTestId(`app-selected-source-${ids.empty}`).getByTestId('app-source-maplat-label');
    const overInput = page.getByTestId(`app-selected-source-${ids.overridden}`).getByTestId('app-source-maplat-label');

    // (1) 未入力 → 地図の label（現在言語 ja）がプレースホルダ
    await expect(labeledInput).toBeVisible();
    await expect(labeledInput).toHaveValue('');
    await expect(labeledInput, '(1) 地図の label がプレースホルダに出る').toHaveAttribute('placeholder', '地図側のラベル', { timeout: 30000 });

    // (2) 上書き済み → 上書き値が出る
    await expect(overInput, '(2) 上書き値が出る').toHaveValue('アプリの上書き');

    // (3) 地図の label が空 → 欄は出て、プレースホルダは空、入力できる
    await expect(emptyInput, '(3) 地図の label が空でも欄が出る').toBeVisible();
    await expect(emptyInput).toBeEnabled();
    await expect(emptyInput).toHaveAttribute('placeholder', '');
    await emptyInput.fill('空の地図へのラベル');
    await emptyInput.press('Tab');
    await expect(emptyInput, '(3) 操作できる').toHaveValue('空の地図へのラベル');

    // 言語を切り替えると、その言語の地図の label がプレースホルダになる
    await page.getByTestId('editor-language').selectOption('en');
    await expect(labeledInput, '現在言語 en では en の地図 label').toHaveAttribute('placeholder', 'Map side label');
    await page.getByTestId('editor-language').selectOption('ja');

    // (1)→(2): 未入力の欄へ入力すると上書き値が出て、空に戻すとプレースホルダへ戻る
    await labeledInput.fill('入力したラベル');
    await labeledInput.press('Tab');
    await expect(labeledInput).toHaveValue('入力したラベル');
    await labeledInput.fill('');
    await labeledInput.press('Tab');
    await expect(labeledInput).toHaveValue('');
    await expect(labeledInput).toHaveAttribute('placeholder', '地図側のラベル');

    // 保存して終える（未保存のまま終了しない。挙動固定 spec と同じ理由）
    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30000 });
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
