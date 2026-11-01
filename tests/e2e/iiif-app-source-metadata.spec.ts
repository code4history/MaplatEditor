// アプリの設定の各ソースが持つ「IIIF の書誌の表の出し方」の欄の E2E。
//
// 見るのは保存したアプリの JSON（window.appedit.request で読み戻す）の
// sources[] だけ。画面ではなく保存形を正とする。
//   - maplat のソースの欄で「書誌の全項目の表を出す」を選ぶと、そのソースにだけ
//     iiifMetadata: 'all' が入る
//   - 触っていないソースには iiifMetadata のキーが無い（Viewer の既定は「出さない」）
//   - 「既定（出さない）」へ戻すとキーごと消える
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
  // 外部へ出ない（中身は断言しない）
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({ status: 404, body: '' }));
  // アプリの保存は main 側の確認ダイアログを挟む（既存のアプリの編集の e2e と同じ stub）
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

// maplat の地図 2 枚と、その 2 枚をソースに持つアプリを IPC で作る
async function seedTwoMapApp(page: Page, suffix: string): Promise<{ mapUid1: string; mapUid2: string; appUid: string }> {
  return await page.evaluate(async (sfx: string) => {
    const createMap = async (mapSlug: string, era: string) => {
      const mapObject = {
        mapID: mapSlug,
        title: { ja: '表題 ' + era },
        label: { ja: 'ラベル ' + era },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
        reference: '', url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
      };
      const saved = await window.mapedit.save({ slug: mapSlug, mapObject, tins: [] });
      if (!saved || saved.result !== 'Success') throw new Error(`map create failed: ${JSON.stringify(saved)}`);
      return { uid: saved.uid as string, slug: mapSlug };
    };
    const first = await createMap(`bookmeta-map-1-${sfx}`, '1');
    const second = await createMap(`bookmeta-map-2-${sfx}`, '2');
    const appSlug = `bookmeta-app-${sfx}`;
    const saved = await window.appedit.save({ slug: appSlug, document: {
      appID: appSlug, appName: { ja: '書誌の表のアプリ' }, title: { ja: '書誌の表のアプリ' },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: [
        { sourceType: 'maplat', mapUid: first.uid, mapSlug: first.slug, role: 'maplat', startFrom: true },
        { sourceType: 'maplat', mapUid: second.uid, mapSlug: second.slug, role: 'maplat', startFrom: false },
      ],
      pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
    return { mapUid1: first.uid, mapUid2: second.uid, appUid: saved.uid as string };
  }, suffix);
}

async function saveNow(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
}

// 保存済みの文書から該当ソースを読み戻す
async function savedSource(page: Page, appUid: string, mapUid: string): Promise<any> {
  const doc = await page.evaluate(async (uid: string) => await window.appedit.request(uid), appUid);
  const found = (doc?.sources ?? []).find((s: any) => s.mapUid === mapUid);
  expect(found, `保存した文書に ${mapUid} のソースがある`).toBeTruthy();
  return found;
}

test('アプリのソースの書誌の表の出し方: 選んだソースにだけ値が入り、既定に戻すとキーが消える', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-app-source-metadata-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const { mapUid1, mapUid2, appUid } = await seedTwoMapApp(page, `${Date.now()}`);

    await page.evaluate((uid: string) => { location.hash = `#/appedit?uid=${uid}`; }, appUid);
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-sources-tab').click();

    const card1 = page.getByTestId(`app-selected-source-${mapUid1}`);
    const card2 = page.getByTestId(`app-selected-source-${mapUid2}`);
    await expect(card1).toBeVisible({ timeout: 30000 });
    await expect(card2).toBeVisible();

    const select1 = card1.getByTestId('app-source-iiif-metadata');
    const select2 = card2.getByTestId('app-source-iiif-metadata');

    // maplat のソースには欄が出る。最初は「既定（出さない）」＝未設定
    await expect(select1).toBeVisible();
    await expect(select2).toBeVisible();
    await expect(select1).toHaveValue('');

    // 保存済みの文書にまだキーが無い（触っていない初期状態の基準）
    const before1 = await savedSource(page, appUid, mapUid1);
    const before2 = await savedSource(page, appUid, mapUid2);
    expect('iiifMetadata' in before1, '触る前のソースにキーが無い').toBe(false);
    expect('iiifMetadata' in before2, '触る前のソースにキーが無い').toBe(false);

    // 1 つ目のソースだけ「書誌の全項目の表を出す」へ
    await select1.selectOption('all');
    await expect(select1).toHaveValue('all');
    await saveNow(page);

    // 是正の見分け: 直す前は欄自体が無いのでこの行で落ちる。
    // 直した後も、出力が未設定のソースへ値を作る実装なら 2 つ目の断言で落ちる
    const after1 = await savedSource(page, appUid, mapUid1);
    const after2 = await savedSource(page, appUid, mapUid2);
    expect(after1.iiifMetadata, '選んだソースにだけ値が入る').toBe('all');
    expect('iiifMetadata' in after2, '選んでいないソースにはキーが無い').toBe(false);

    // 1 つ目を「既定（出さない）」へ戻すとキーごと消える
    await select1.selectOption('');
    await expect(select1).toHaveValue('');
    await saveNow(page);

    // 是正の見分け: 既定を選んだときにキーを残す実装ならこの行で落ちる
    const restored1 = await savedSource(page, appUid, mapUid1);
    expect('iiifMetadata' in restored1, '既定に戻すとキーごと消える').toBe(false);
    expect('iiifMetadata' in (restored1.overrides ?? {}), 'overrides には入らない').toBe(false);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
