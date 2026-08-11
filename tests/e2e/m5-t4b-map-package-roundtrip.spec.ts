// M5-T4B: 実 UI からの地図搬出／アプリ搬出と、地図 ZIP の別 slug import（AC11）。
//
// 固定する受け入れ条件:
//   AC11  **実際の UI から**地図搬出・アプリ搬出を行い、地図 ZIP は別 slug への import と
//         preview まで、アプリ ZIP は viewer での読込までを確認する
//
// smoke（サンドボックス）は electron スタブ上でサービスを直接叩くため、
// 「ボタンが押せる状態か」「ダイアログを経て実ファイルが出るか」「進捗オーバーレイが閉じるか」を
// 通らない。∴ ここは実 Electron・実 UI 経路でのみ確認できる範囲に絞る。
//
// 人間確認:
//   MAPLAT_E2E_PAUSE=1 pnpm test:e2e:m5-t4b
// を実行すると最後の test が確認用の状態（地図1件・搬出済み ZIP・別 slug の取込用 ZIP）を
// 用意し、**実アプリを開くコマンドを出力して終了**する。操作はそのコマンドで行う。
// PWDEBUG は不要（Playwright Inspector 配下では操作しない）。
//
// 【なぜ page.pause() を使わないか】Playwright は JS ダイアログを必ず横取りする。
// リスナ未登録なら自動 dismiss、登録すれば accept/dismiss をこちらが決めることになり、
// **window.confirm() の可否を人間に委ねることが構造的にできない**。
// 2026-08-03 に人間が両方の壊れ方を踏んだ（無反応 / 押す前に実行されダイアログだけ残る）。
// いずれも製品不具合と紛らわしいため、自由操作は Playwright の外へ出した。
// MAPLAT_E2E_ROOT が saveFolder・設定・下書き・staging をすべて隔離するため
// (electron/services/runtimeStoragePaths.ts)、同じ root を実アプリへ渡せば状態は引き継がれる。
//
// harness は m12-t15-thumbnail-512 / m11-t3-editor-shell の実績文法に従う。
import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
// M5-T5: seed / ダイアログ退避 / ZIP slug 書き換えは m5-t5 の spec と **同じ処理** である。
// 複製せず共通ハーネスへ寄せた（恒久指示「同一扱い処理は共通実装へ徹底」）。
import {
  launch,
  openHash,
  saveFolderOf,
  stubMessageBoxAutoOk,
  snapshotDialogs,
  restoreDialogs,
  dialogsAreOriginal,
  seedFullMap,
  rewriteZipSlug,
} from './helpers/mapPackage';

const projectRoot = path.resolve(import.meta.dirname, '../..');

test.describe('M5-T4B: 実 UI からの地図搬出・別 slug import・アプリ搬出（AC11）', () => {
  test('AC11-a: MapEdit の搬出ボタンから出た ZIP に POI 実体・依存画像・通常/512px サムネイルが入る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-export-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);

      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });

      // 実 UI のヘッダ搬出ボタンを押す
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const names = zip.getEntries().map((e) => e.entryName);

      // AC2: POI はインライン化されず外部参照になり、実体が同梱される
      const mapJson = JSON.parse(zip.getEntry(`maps/${seeded.mapSlug}.json`)!.getData().toString('utf8'));
      expect(Array.isArray(mapJson.pois)).toBe(true);
      expect(mapJson.pois[0].layer).toMatch(/^pois\/.+\.geojson$/);
      expect(names).toContain(mapJson.pois[0].layer);

      // 依存画像（icon / html 内 maplat-asset:）の実体
      expect(names).toContain(`imgs/${seeded.iconSlug}.png`);
      expect(names).toContain(`imgs/${seeded.photoSlug}.png`);

      // AC3: 通常・512px の両サムネイルが slug 名で入る
      expect(names).toContain(`tmbs/${seeded.mapSlug}.jpg`);
      expect(names).toContain(`tmbs/${seeded.mapSlug}_512.webp`);
      expect(names.some((n) => n.startsWith(`tiles/${seeded.mapSlug}/`))).toBe(true);

      console.log('  AC11-a: PASS（実 UI の地図搬出）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC11-b: MapList のインポートボタンから別 slug へ取り込み、POI が復元され preview まで通る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-import-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);
      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      // 別 slug の ZIP を作り、取込ダイアログがそれを返すようにする
      const copySlug = `${seeded.mapSlug}-copy`;
      const copyZip = path.join(e2eRoot, 'map-copy.zip');
      await rewriteZipSlug(zipPath, copyZip, seeded.mapSlug, copySlug);
      await app.evaluate(async ({ dialog }, inZip) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [inZip] })) as typeof dialog.showOpenDialog;
      }, copyZip);

      // 実 UI の取込導線: MapList の「インポート」ボタン → /mapedit?new=1&import=1 へ遷移し、
      // MapEdit の mount 後に importMap() が自動起動してファイル選択ダイアログを開く
      // （M11-T10 AC11 が用意した経路。ImportSlot = [data-resource-import]）
      await openHash(page, '#/maplist');
      const importButton = page.locator('[data-resource-import]');
      await expect(importButton).toBeVisible({ timeout: 30000 });
      await importButton.click();

      // 取込完了は進捗モーダルの成功表示で判定する
      // （URL の import=1 は取込後もクエリに残るため終了判定に使えない）
      await expect(page.getByText('正常に地図データが登録できました。'))
        .toBeVisible({ timeout: 120000 });
      // 取り込んだ地図が編集画面に載る
      await expect(page.getByTestId('map-title')).toHaveValue('T4B 地図', { timeout: 30000 });

      // POI が **管理下 POI ソースとして復元**されていること（ZIP 相対参照のままにしない）
      const restored = await page.evaluate(async (slug) => {
        const doc = await window.mapedit.request(slug);
        return { pois: doc.pois };
      }, copySlug);
      expect(Array.isArray(restored.pois)).toBe(true);
      expect(restored.pois[0].poiUid).toBeTruthy();
      expect(JSON.stringify(restored.pois)).not.toContain('pois/');

      // preview 用の読み出しが通る（プレビューボタンが叩く経路と同じ）
      const previewSource = await page.evaluate(
        (slug) => window.mapedit.previewSource(slug), copySlug);
      expect(previewSource).toBeTruthy();
      expect(JSON.stringify(previewSource)).not.toContain('pois/');

      console.log('  AC11-b: PASS（実 UI の MapList インポート → POI 復元 → preview）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC11-c: AppEdit の搬出ボタンから出た ZIP が地図由来の POI 実体と依存画像を含む', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-appexport-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      const zipPath = path.join(e2eRoot, 'app-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);

      const appUid = await page.evaluate(async ({ mapSlug, mapUid }) => {
        const slug = `t4b-app-${Date.now()}`;
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'T4B App' }, title: { ja: 'T4B App' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: [{ sourceType: 'maplat', mapUid, mapSlug }],
            startFrom: mapSlug, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        return uid;
      }, { mapSlug: seeded.mapSlug, mapUid: seeded.mapUid });

      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      const { default: AdmZip } = await import('adm-zip');
      const names = new AdmZip(zipPath).getEntries().map((e) => e.entryName);

      // AC1: 地図由来の POI 実体と依存画像がアプリ ZIP にも入る（共通化の前後で不変）
      expect(names.some((n) => /^pois\/.+\.geojson$/.test(n))).toBe(true);
      expect(names).toContain(`imgs/${seeded.iconSlug}.png`);
      expect(names).toContain(`imgs/${seeded.photoSlug}.png`);
      // viewer の読込対象（アプリ ZIP は静的配信一式を含む）
      expect(names).toContain('index.html');

      console.log('  AC11-c: PASS（実 UI のアプリ搬出）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  // 人間確認の前提テスト（2026-08-03 の指摘への回帰）。
  // 準備用に差し替えたネイティブダイアログを戻し忘れると、page.pause() 後に搬出ボタンが
  // 保存先を尋ねずに事前指定のパスへ書き、成功モーダルだけが出る。
  // 自由操作のための一時停止なのにダイアログを潰してしまうため、復元の成立を固定する。
  test('AC11 人間確認の前提: 準備で差し替えたネイティブダイアログが原本へ戻る', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-dialog-'));
    const { app } = await launch(e2eRoot);
    try {
      await snapshotDialogs(app);
      await stubMessageBoxAutoOk(app);
      await app.evaluate(async ({ dialog }) => {
        dialog.showSaveDialog = (async () => ({ canceled: true })) as typeof dialog.showSaveDialog;
        dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
      });

      const whileStubbed = await dialogsAreOriginal(app);
      // 前提: 実際に差し替わっていること（この assert が無いと復元検査が空振りする）
      expect(whileStubbed).toEqual({ save: false, open: false, message: false });

      await restoreDialogs(app);
      const afterRestore = await dialogsAreOriginal(app);
      expect(afterRestore).toEqual({ save: true, open: true, message: true });

      console.log('  AC11 前提: PASS（ダイアログが原本へ戻る）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC11 人間確認: 確認用の状態を用意し、実アプリを開くコマンドを提示する', async () => {
    test.skip(process.env.MAPLAT_E2E_PAUSE !== '1',
      '人間確認用。MAPLAT_E2E_PAUSE=1 pnpm test:e2e:m5-t4b で実行する');
    test.setTimeout(0);
    // 【固定パスにする理由】ここは人間がコマンドをコピーして実アプリを開く導線である。
    // mkdtemp のランダム suffix だと毎回貼り直しになり、実際に 2026-08-03 の検証で
    // 伏せ字のまま実行されて EACCES になった。∴ 常に同じパスを使い、案内を安定させる。
    // 前回分は毎回消してから作り直す（前の状態が混ざると確認にならない）
    const e2eRoot = path.join(projectRoot, '.tmp-human-verify');
    await rm(e2eRoot, { recursive: true, force: true });
    await mkdir(e2eRoot, { recursive: true });
    const { app, page } = await launch(e2eRoot);
    try {
      // 準備のあいだだけダイアログを差し替える。原本は先に退避しておく
      await snapshotDialogs(app);
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot, { visibleImages: true });

      // 取込に使う ZIP を作るため、ここでは一度スクリプトから搬出する
      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);
      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      // 別 slug の ZIP を用意する（取込の入力）
      const copySlug = `${seeded.mapSlug}-copy`;
      const copyZip = path.join(e2eRoot, 'map-copy.zip');
      await rewriteZipSlug(zipPath, copyZip, seeded.mapSlug, copySlug);

      // 【方針】ここから先の自由操作は **Playwright の外**で行う。
      //
      // Playwright は JS ダイアログを必ず横取りする（リスナ未登録なら自動 dismiss、
      // 登録すれば accept/dismiss をこちらが決める）。∴ window.confirm() の可否を
      // 人間に委ねることが構造的にできない。実際 2026-08-03 に
      //   - リスナ無し → 下書き削除が無反応（常に Cancel 相当）
      //   - accept へ倒す → 押す前に削除され、描かれたダイアログだけ残る
      // の両方を人間が踏み、いずれも製品不具合と紛らわしかった。
      //
      // MAPLAT_E2E_ROOT は saveFolder / 設定 / 下書き / staging をすべて隔離する
      // (electron/services/runtimeStoragePaths.ts)。∴ **同じ root を実アプリへ渡せば**、
      // ここで用意した状態のまま、ネイティブのダイアログが正しく効く環境で確認できる。
      // 本 spec は「準備して引き渡す」までを担い、操作は実アプリで行う。
      await restoreDialogs(app);

      console.log('');
      console.log('=== M5-T4B 人間確認の準備が完了しました ===');
      console.log('');
      console.log('  次のコマンドで **実アプリ** を開いてください（Playwright 配下ではありません）:');
      console.log('');
      console.log('    MAPLAT_E2E_ROOT=.tmp-human-verify pnpm run dev');
      console.log('');
      console.log(`  （.tmp-human-verify の実体: ${e2eRoot}）`);
      console.log('');
      console.log('  用意したもの（すべて .tmp-human-verify 直下）:');
      console.log(`    元地図       : ${seeded.mapSlug}`);
      console.log('    map-export.zip … 元地図をそのまま搬出したもの（slug は元のまま）');
      console.log(`    map-copy.zip   … 中の slug を ${copySlug} へ書き換えたもの`);
      console.log(`    依存画像     : imgs/${seeded.iconSlug}.png（POI アイコン・96x96 赤）`);
      console.log(`                   imgs/${seeded.photoSlug}.png（吹き出し埋め込み・96x96 赤）`);
      console.log('');
      console.log('  ★ 取込の確認では **map-copy.zip** を選んでください（別 slug の取込確認）。');
      console.log('    ※ M5-T5 以降、map-export.zip（元地図と同じ slug）も弾かれず');
      console.log('      自動採番で取り込めるようになりました。そちらの確認は');
      console.log('      MAPLAT_E2E_PAUSE=1 pnpm test:e2e:m5-t5 で行ってください。');
      console.log('');
      console.log('  確認していただきたいこと:');
      console.log('   1. 搬出ボタンで保存先ダイアログが出て、指定した場所に ZIP ができること');
      console.log('   2. 地図管理の「インポート」→ **map-copy.zip** で取り込め、slug が ' + copySlug + ' になること');
      console.log('   3. 取り込んだ地図の POI が管理下 POI ソースとして復元され、表示されること');
      console.log('   4. プレビューで POI のアイコン画像と吹き出しの埋め込み画像が **見える** こと');
      console.log('   5. 取り込んだ地図を再搬出しても同じ資源構成の ZIP になること');
      console.log('   6. アプリ搬出 → viewer 読込で POI が表示されること');
      console.log('   7. 取込しただけでは下書きが増えないこと（今回の修正点）');
      console.log('');
      console.log('  ※ この spec の Electron はこの後終了します。');
      console.log('    実アプリと同時に動かすと同じ saveFolder を2プロセスが触るため、先に閉じます。');
      console.log('');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
