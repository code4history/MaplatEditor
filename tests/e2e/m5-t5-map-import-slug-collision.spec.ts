// M5-T5 AC8: 実 UI（MapList のインポート）から **同名 slug の** ZIP を取り込む。
//
// 固定する受け入れ条件:
//   AC8  実 UI から同名 ZIP を取り込み、base-2 の地図が一覧に現れ preview まで通る
//
// 【m5-t4b の AC11-b との違い】
// m5-t4b は ZIP の slug を **書き換えてから**取り込んだ（同名は 'Exist' で弾かれる仕様だった）。
// m5-t5 はその制約を外したタスクなので、ここでは **書き換えずそのまま**取り込む。
// 人間が 2026-08-03 に踏んだ「既存のマップIDです。処理を停止します。」の再発検査でもある。
//
// smoke（サンドボックス）は electron スタブ上でサービスを直接叩くため、
// MapList の導線・進捗モーダル・一覧への反映を通らない。∴ ここは実 UI でのみ確認できる範囲に絞る。
//
// 人間確認:
//   MAPLAT_E2E_PAUSE=1 pnpm test:e2e:m5-t5
// を実行すると最後の test が確認用の状態を用意し、**実アプリを開くコマンドを出力して終了**する。
// （Playwright は JS ダイアログを必ず横取りするため、自由操作は Playwright の外へ出す。
//   経緯は m5-t4b の spec 冒頭を参照）
import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import {
  launch,
  openHash,
  saveFolderOf,
  stubMessageBoxAutoOk,
  snapshotDialogs,
  restoreDialogs,
  seedFullMap,
} from './helpers/mapPackage';

const projectRoot = path.resolve(import.meta.dirname, '../..');

/** 元地図を搬出して ZIP を作る（取込の入力を実経路で用意する） */
async function exportSeededMap(
  app: Awaited<ReturnType<typeof launch>>['app'],
  page: Awaited<ReturnType<typeof launch>>['page'],
  mapUid: string,
  outZip: string,
): Promise<void> {
  await app.evaluate(async ({ dialog }, zip) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: zip })) as typeof dialog.showSaveDialog;
  }, outZip);
  await openHash(page, `#/mapedit?uid=${mapUid}`);
  await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-editor-action="export"]').click();
  await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });
}

/** MapList の「インポート」から ZIP を取り込む（M11-T10 AC11 の実導線） */
async function importViaMapList(
  app: Awaited<ReturnType<typeof launch>>['app'],
  page: Awaited<ReturnType<typeof launch>>['page'],
  inZip: string,
): Promise<void> {
  await app.evaluate(async ({ dialog }, zip) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [zip] })) as typeof dialog.showOpenDialog;
  }, inZip);
  await openHash(page, '#/maplist');
  const importButton = page.locator('[data-resource-import]');
  await expect(importButton).toBeVisible({ timeout: 30000 });
  await importButton.click();
}

test.describe('M5-T5: 実 UI からの同名 slug 取込（AC8）', () => {
  test('AC8: 同名 ZIP が Exist で止まらず base-2 として取り込まれ、一覧に出て preview まで通る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t5-import-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot, {
        prefix: 't5', title: 'T5 地図',
      });

      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await exportSeededMap(app, page, seeded.mapUid, zipPath);

      // **slug を書き換えない**。m5-t4b では ここで 'Exist' になっていた
      await importViaMapList(app, page, zipPath);

      // 取込完了は進捗モーダルの成功表示で判定する
      // （URL の import=1 は取込後もクエリに残るため終了判定に使えない）
      await expect(page.getByText('正常に地図データが登録できました。'))
        .toBeVisible({ timeout: 120000 });
      // 失敗表示が出ていないこと（旧挙動の再発検査。人間が 2026-08-03 に踏んだ文言）
      await expect(page.getByText('存在する地図IDです。処理を停止します。')).toBeHidden();

      // 取り込んだ地図が編集画面に載り、slug が base-2 になっている
      await expect(page.getByTestId('map-title')).toHaveValue('T5 地図', { timeout: 30000 });
      const expectedSlug = `${seeded.mapSlug}-2`;
      const loaded = await page.evaluate(async (slug) => {
        const doc = await window.mapedit.request(slug);
        return { mapID: doc.mapID, uid: doc.uid, pois: doc.pois };
      }, expectedSlug);
      expect(loaded.mapID).toBe(expectedSlug);
      expect(loaded.uid).not.toBe(seeded.mapUid);

      // 元地図が残っていること（**上書きではなく別地図として増える**）
      const listSlugs = await page.evaluate(async () =>
        (await window.maplist.request('', 1, 100)).docs.map((d: { mapID: string }) => d.mapID));
      expect(listSlugs).toContain(seeded.mapSlug);
      expect(listSlugs).toContain(expectedSlug);

      // POI が管理下 POI ソースとして復元され、ZIP 相対参照が残っていない
      expect(Array.isArray(loaded.pois)).toBe(true);
      expect(loaded.pois[0].poiUid).toBeTruthy();
      expect(JSON.stringify(loaded.pois)).not.toContain('pois/');
      // 元地図の POI とは別ソースになっている（slug がグローバル一意なので採番される）
      expect(loaded.pois[0].poiUid).not.toBe(seeded.poiUid);

      // preview 用の読み出しが通る（プレビューボタンが叩く経路と同じ）
      const previewSource = await page.evaluate(
        (slug) => window.mapedit.previewSource(slug), expectedSlug);
      expect(previewSource).toBeTruthy();
      expect(JSON.stringify(previewSource)).not.toContain('pois/');

      console.log(`  AC8: PASS（同名取込 → ${expectedSlug} → 一覧2件 → preview）`);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC8-b: 3回連続で同名取込すると base-2 → base-3 と進む', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t5-seq-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot, {
        prefix: 't5seq', title: 'T5 連番',
      });

      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await exportSeededMap(app, page, seeded.mapUid, zipPath);

      for (const n of [2, 3]) {
        await importViaMapList(app, page, zipPath);
        await expect(page.getByText('正常に地図データが登録できました。'))
          .toBeVisible({ timeout: 120000 });
        const slug = `${seeded.mapSlug}-${n}`;
        const doc = await page.evaluate((s) => window.mapedit.request(s), slug);
        expect(doc.mapID).toBe(slug);
      }

      console.log('  AC8-b: PASS（連続同名取込で base-2 → base-3）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC8 人間確認: 確認用の状態を用意し、実アプリを開くコマンドを提示する', async () => {
    test.skip(process.env.MAPLAT_E2E_PAUSE !== '1',
      '人間確認用。MAPLAT_E2E_PAUSE=1 pnpm test:e2e:m5-t5 で実行する');
    test.setTimeout(0);
    // 【固定パスにする理由】人間がコマンドをコピーして実アプリを開く導線である。
    // mkdtemp のランダム suffix だと毎回貼り直しになり、2026-08-03 の検証では
    // 伏せ字のまま実行されて EACCES になった。∴ 常に同じパスを使う。
    const e2eRoot = path.join(projectRoot, '.tmp-human-verify');
    await rm(e2eRoot, { recursive: true, force: true });
    await mkdir(e2eRoot, { recursive: true });
    const { app, page } = await launch(e2eRoot);
    try {
      await snapshotDialogs(app);
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot, {
        visibleImages: true, prefix: 't5', title: 'T5 地図',
      });

      // 取込に使う ZIP を作るため、ここでは一度スクリプトから搬出する
      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await exportSeededMap(app, page, seeded.mapUid, zipPath);

      // 自由操作は Playwright の外で行う（経緯は m5-t4b の spec 冒頭）
      await restoreDialogs(app);

      console.log('');
      console.log('=== M5-T5 人間確認の準備が完了しました ===');
      console.log('');
      console.log('  次のコマンドで **実アプリ** を開いてください（Playwright 配下ではありません）:');
      console.log('');
      console.log('    MAPLAT_E2E_ROOT=.tmp-human-verify pnpm run dev');
      console.log('');
      console.log(`  （.tmp-human-verify の実体: ${e2eRoot}）`);
      console.log('');
      console.log('  用意したもの（すべて .tmp-human-verify 直下）:');
      console.log(`    元地図       : ${seeded.mapSlug}`);
      console.log('    map-export.zip … 元地図をそのまま搬出したもの（**slug は元のまま**）');
      console.log('');
      console.log('  ★ 今回は **map-export.zip をそのまま** 取り込んでください。');
      console.log('    m5-t4b までは「存在する地図IDです。処理を停止します。」で弾かれていました。');
      console.log('    それが弾かれずに取り込めるようになったことが、本タスクの確認点です。');
      console.log('');
      console.log('  確認していただきたいこと:');
      console.log('   1. 地図管理の「インポート」→ map-export.zip が **エラーにならず**取り込めること');
      console.log(`   2. 取り込まれた地図の ID が ${seeded.mapSlug}-2 になっていること`);
      console.log(`   3. 元地図 ${seeded.mapSlug} が **消えず**、一覧に2件並ぶこと`);
      console.log('   4. もう一度同じ ZIP を取り込むと -3 になること');
      console.log('   5. 取り込んだ地図の POI が復元され、プレビューでアイコンと');
      console.log('      吹き出しの埋め込み画像が **見える** こと');
      console.log('   6. 取り込んだ地図を再搬出すると、ZIP 内が maps/<新しいID>.json になること');
      console.log('');
      console.log('  ※ この spec の Electron はこの後終了します。');
      console.log('    実アプリと同時に動かすと同じ saveFolder を2プロセスが触るため、先に閉じます。');
      console.log('');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
