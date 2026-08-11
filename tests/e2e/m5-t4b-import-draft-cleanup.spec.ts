// M5-T4B（人間検証 2026-08-03 で発見）: 地図 ZIP の取込が身寄りのない下書きを残さないこと。
//
// 【欠陥】MapList の「インポート」は /mapedit?new=1&import=1 へ遷移し、**新規地図エディタを
// ホスト**にして取込を走らせる（M11-T10 AC11）。新規エディタは mount 時に newMapUid を採番し、
// useInitialDraftPersist が slug 予約の成立時点で初期下書きを即時保存する（M11-T7 AC6。
// 予約を GC から守るための仕組み）。取込が成功すると adoptLoaded でサーバ採番の別 uid を
// 正本に引き取るが、**newMapUid で書かれた下書きは誰も消さない** ∴ 取り込んだ地図とは別に
// 下書きが1件残る。
//
// 保存経路には同じ手当てが M12-T29 で入っている（MapEdit.vue の
// markSaved → rebase → flush）。取込経路にだけ無かった。
//
// 【base でも再現する】2026-08-03 に gitlink 2a8953a（本タスク着手前）の製品コードへ戻して
// 同じ手順を実行し、同様に下書きが残ることを確認済み。本タスクが入れた欠陥ではないが、
// 人間検証で表面化したため m5-t4b 内で吸収する（人間判断 2026-08-03）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
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
  return { app, page };
}

// 人間が踏んだ ZIP と同じ構成（外部 POI + 多数タイル）で作る。
// タイル数が少ない ZIP では取込が速すぎて初期下書きの保存が間に合わず、欠陥が出ない
// ＝ 競合であるため、実物と同程度の分量にして安定して踏ませる。
async function buildMapZip(dest: string, slug: string): Promise<void> {
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip();
  // 実際の搬出 ZIP と同じく **compiled TIN を持つ**交換形にする。
  // gcps だけの軽い地図では取込後の mount 処理が短く、初期下書きの保存が間に合わない
  const { default: Tin } = await import('@maplat/tin');
  const tin = new Tin({});
  tin.setWh([400, 300]);
  tin.setStrictMode('loose');
  tin.setVertexMode('plain');
  tin.setPoints([
    [[0, 0], [135.0, 35.1]],
    [[400, 0], [135.1, 35.1]],
    [[200, 300], [135.05, 35.0]],
  ]);
  tin.setEdges([]);
  await tin.updateTinAsync();

  zip.addFile(`maps/${slug}.json`, Buffer.from(JSON.stringify({
    title: slug, attr: 'test', license: 'All right reserved', dataLicense: 'CC BY-SA',
    reference: '', url: '', lang: 'ja', imageExtension: 'png',
    pois: [{ layer: `pois/${slug}-poi.geojson` }],
    compiled: tin.getCompiled(), sub_maps: [],
  })));
  zip.addFile(`pois/${slug}-poi.geojson`, Buffer.from(JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', id: 'p1',
      geometry: { type: 'Point', coordinates: [135.0, 35.0] },
      properties: { name: { ja: '取込POI' } },
    }],
  })));
  zip.addFile(`tmbs/${slug}.jpg`, Buffer.from('THUMB'));
  zip.addFile(`tmbs/${slug}_512.webp`, Buffer.from('THUMB512'));
  for (let z = 0; z < 6; z++) {
    for (let x = 0; x < 6; x++) {
      zip.addFile(`tiles/${slug}/${z}/${x}/0.jpg`, Buffer.from(`TILE-${z}-${x}`));
    }
  }
  await writeFile(dest, zip.toBuffer());
}

test('取込で作られた地図とは別に、身寄りのない下書きが残らない', async () => {
  test.setTimeout(240_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-importdraft-'));
  const zipPath = path.join(e2eRoot, 'import-src.zip');
  const slug = 'importdraft';
  await buildMapZip(zipPath, slug);

  const { app, page } = await launch(e2eRoot);
  page.on('dialog', (d) => void d.accept());
  try {
    // ファイル選択に **数秒かかる**状態を作る。実際の利用ではファイルピッカーを操作する間、
    // エディタは「新規」のまま待機し、その窓で useInitialDraftPersist が初期下書きを書く。
    // 即時 resolve するスタブでは窓が開かず欠陥が出ない（＝ 競合の忠実な再現に必要）
    await app.evaluate(async ({ dialog }, inZip) => {
      dialog.showOpenDialog = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { canceled: false, filePaths: [inZip] };
      }) as typeof dialog.showOpenDialog;
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    }, zipPath);

    await page.evaluate(() => { location.hash = '#/maplist'; });
    await expect(page.locator('.resource-list__toolbar')).toBeVisible({ timeout: 30000 });
    expect(await page.evaluate(() => window.assetDrafts.list('map')), '前提: 取込前に下書きが無い')
      .toEqual([]);

    // 実 UI の取込導線
    await page.locator('[data-resource-import]').click();
    await expect(page.getByText('正常に地図データが登録できました。')).toBeVisible({ timeout: 120000 });


    // 取り込んだ地図は存在する
    const imported = await page.evaluate((s) => (window as any).mapedit.request(s), slug);
    expect(imported?.mapID, '取込した地図が保存されていること').toBe(slug);

    // 一覧へ戻って下書きが残っていないこと（下書きカードは一覧に出る）
    await page.evaluate(() => { location.hash = '#/maplist'; });
    await expect(page.locator('.resource-list__toolbar')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000); // debounce 後の遅延保存も拾う

    const drafts = await page.evaluate(() => window.assetDrafts.list('map'));
    expect(drafts, '取込しただけで下書きが残らないこと（実際: ' + JSON.stringify(drafts) + '）')
      .toEqual([]);

    // 一覧に下書きカードが出ていないこと（利用者から見える形での確認）
    await expect(page.locator('.badge.bg-warning', { hasText: '下書き' })).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
  }
});
