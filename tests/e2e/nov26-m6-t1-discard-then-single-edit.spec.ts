// nov26-m6-t1 (#117 E3・実装レビュー B19-MAJ-1): 保存済みの地図・アプリで、復元された下書きを破棄した後の
// 「1 回で終わる編集」が下書きに残ること（黙って失われないこと）。
//
// E3 の修正（破棄済みの印）は、印が「利用者の次の編集（schedule(true)）」で解けることを前提にしていたが、
// MapEdit の履歴の記録は setTimeout(0) で下書きの watcher より後に積まれ、AppEdit の @change の欄は
// v-model の更新の後に blur で履歴を積む。∴ 保存版から 1 回だけ変えると watcher は schedule(false) になり、
// 印が解けないまま forced flush が止まって、その編集が保存版にも下書きにも残らなかった。
// 既存 asset の破棄では reloadFromStore() が履歴の基点を保存版へ戻し終えた後に印を解く。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6t1-single-edit-'));
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  // 破棄の確認ダイアログは先頭ボタン（破棄）で応答
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function draftOf(page: Page, kind: 'map' | 'app', uid: string): Promise<any> {
  return page.evaluate(async ([k, u]) => window.assetDrafts.get(k as any, u), [kind, uid] as const);
}

test('MapEdit: 保存済みの地図で下書きを破棄した後の 1 回の編集が下書きに残る', async () => {
  test.setTimeout(180_000);
  const { app, page } = await launch();
  try {
    const uid = await page.evaluate(async () => {
      const slug = `m6t1-single-${Date.now()}`;
      const r = await window.mapedit.save({
        slug,
        mapObject: {
          mapID: slug, title: { ja: 'seed' },
          officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
          attr: { ja: 'attr' }, dataAttr: {}, description: {},
          license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
          imageExtension: 'jpg', width: 400, height: 300,
          gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
        },
        tins: [],
      });
      if (!r || !('result' in r) || (r as any).result !== 'Success') throw new Error(JSON.stringify(r));
      return (r as any).uid as string;
    });

    // 下書きを 1 件作る（対照: 破棄しなければ 1 回の編集は下書きに残る）
    await openHash(page, `#/mapedit?uid=${uid}`);
    await expect(page.getByTestId('map-title')).toHaveValue('seed', { timeout: 20_000 });
    await page.getByTestId('map-title').fill('control-edit');
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('map-title')).toBeHidden();
    await expect.poll(async () => (await draftOf(page, 'map', uid))?.payload?.mapData?.title, { timeout: 10_000 })
      .toEqual({ ja: 'control-edit' });

    // 再度開く（自動復元）→ 破棄 → 保存版へ戻る
    await openHash(page, `#/mapedit?uid=${uid}`);
    await expect(page.getByTestId('map-title')).toHaveValue('control-edit', { timeout: 20_000 });
    await page.getByTestId('editor-discard-draft').click();
    await expect(page.getByTestId('map-title')).toHaveValue('seed', { timeout: 20_000 });
    await expect(page.getByTestId('editor-discard-draft')).toBeHidden();
    await expect.poll(async () => draftOf(page, 'map', uid), { timeout: 10_000 }).toBeNull();

    // 破棄の後の 1 回で終わる編集 → 戻る
    await page.getByTestId('map-title').fill('after-discard-edit');
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('map-title')).toBeHidden();
    await expect.poll(async () => (await draftOf(page, 'map', uid))?.payload?.mapData?.title, { timeout: 10_000 })
      .toEqual({ ja: 'after-discard-edit' });
  } finally {
    await quitElectronApplication(app);
  }
});

test('AppEdit: 保存済みのアプリで下書きを破棄した後の 1 回の @change の編集が下書きに残る', async () => {
  test.setTimeout(180_000);
  const { app, page } = await launch();
  try {
    const uid = await page.evaluate(async () => {
      const slug = `m6t1-single-app-${Date.now()}`;
      const appUid = crypto.randomUUID();
      const r = await window.appedit.save({
        uid: appUid, slug, create: true,
        document: {
          appID: slug, appName: { ja: 'seed app' }, title: { ja: 'seed app' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: ['osm'],
          appSettings: { homeLng: 135, homeLat: 35, defaultZoom: 14 }, pois: [],
          httpSettings: { previewPort: 41781 }, manifestSettings: {},
        },
      } as any);
      if (!r || (r as any).result !== 'Success') throw new Error(JSON.stringify(r));
      return appUid;
    });
    const port = page.locator('input[type=number][max="65535"]');

    await openHash(page, `#/appedit?uid=${uid}`);
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 20_000 });
    await expect(port).toHaveValue('41781', { timeout: 20_000 });
    await port.fill('9001');
    await port.blur();
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('app-id')).toBeHidden();
    await expect.poll(async () => (await draftOf(page, 'app', uid))?.payload?.httpSettings?.previewPort, { timeout: 10_000 })
      .toBe(9001);

    await openHash(page, `#/appedit?uid=${uid}`);
    await expect(port).toHaveValue('9001', { timeout: 20_000 });
    await page.getByTestId('editor-discard-draft').click();
    await expect(port).toHaveValue('41781', { timeout: 20_000 });
    await expect(page.getByTestId('editor-discard-draft')).toBeHidden();
    await expect.poll(async () => draftOf(page, 'app', uid), { timeout: 10_000 }).toBeNull();

    await port.fill('9002');
    await port.blur();
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('app-id')).toBeHidden();
    await expect.poll(async () => (await draftOf(page, 'app', uid))?.payload?.httpSettings?.previewPort, { timeout: 10_000 })
      .toBe(9002);
  } finally {
    await quitElectronApplication(app);
  }
});
