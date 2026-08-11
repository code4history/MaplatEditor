// m6-t10 人間検証ハーネス。**自動テストではない**（既定の実行対象から外すため .skip 付き）。
//
//   pnpm run e2e:m6-t10-human
//
// で起動すると、Electron が立ち上がり、以下まで自動で進んだ状態で `page.pause()` により
// 一時停止する。以後は人間が自由に操作できる（Playwright Inspector の Resume で終了）。
//
//   - ベースマップマスタ 2件を投入済み
//       m6t10-human-tms   : tms（マスタ値がひと目で分かる文言・minZoom 3 / maxZoom 15）
//       m6t10-human-merc  : tms（2件目。マスタ差し替えの体感用）
//   - 新規アプリを1件立ち上げ、ソースタブで上記 tms マスタと builtin osm を選択済み
//
// 見てほしいこと（感性判断が要るもののみ。機械判定できるものは自動テスト側で固定済み）:
//   1. 未上書きの欄が「空欄 + 薄いマスタ値」に見えるか。空欄が「未設定」ではなく
//      「マスタ値が効いている」と読めるか（§3.8-1 の狙い）
//   2. 【m19-t4b 更新】×による解除の出方。**現存する上書き欄は「表示ラベル」1 つだけ**
//      （m19-t3 が上書き可能キーを 10 個廃止した。APP_SOURCE_OVERRIDABLE_KEYS = ["label"]）。
//      その × が検索バーの native × と同じ体感か。うるさすぎ／気づきにくすぎ でないか。
//      「入力があれば指定・消せばマスタ値」と読めるか
//   3. builtin(osm) と tms でフォームが同じであることに違和感がないか（ADR-0017）
//   4. url 欄が無くなり注記だけになったことが、不足ではなく方針として読めるか（§3.3）
//   5. マスタ欠落表示（下記手順）が、削除以外できないと伝わるか（§3.6）
//        別ウィンドウ不要: ベースマップ管理でマスタを削除 → アプリ編集へ戻る
//   6. 【m19-t4b 追加】ベースマップ編集の帰属・ライセンス・表示ラベル 7 欄の「？」が、
//      うるさすぎ／気づきにくすぎ でないか
//   7. 【m19-t4b 追加】アプリ管理・HTTP 設定の 8 個の「？」が、チェックボックスの並び
//      （toggle-grid）を崩していないか
//   8. 【m19-t4b 追加】新規アプリで PWA が既定オフになり「マニフェスト設定」欄が消えている
//      ことが、欠落ではなく既定として読めるか
//   9. 【m19-t4b 追加】プレビュータブの言語切替がタブ下のバーへ移り、地図のコンパスと
//      干渉しないか
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedBaseMap } from './helpers/baseMapSeed';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const masterDoc = (suffix: string) => ({
  lang: 'ja',
  kind: 'tms',
  maptype: null,
  url: 'https://example.com/{z}/{x}/{y}.png',
  title: { ja: `マスタのタイトル(${suffix})` },
  label: { ja: `マスタのラベル(${suffix})` },
  attr: { ja: `© マスタの帰属(${suffix})` },
  // v1.4: 帰属・ライセンス系5欄のプレースホルダを人間が見られるよう実値を入れる
  dataAttr: { ja: `マスタのデータ帰属(${suffix})` },
  license: 'CC BY',
  dataLicense: 'ODbL',
  licenseNote: { ja: `マスタのライセンス補足(${suffix})` },
  dataLicenseNote: { ja: `マスタのデータライセンス補足(${suffix})` },
  minZoom: 3,
  maxZoom: 15,
  thumbnail: '',
  coverageLngLats: null,
});

test('m6-t10 人間検証: 差分保持フォームを自由に操作する', async () => {
  // 自動 CI では常にスキップする。起動は e2e:m6-t10-human（MAPLAT_HUMAN_CHECK=1）だけ
  test.skip(process.env.MAPLAT_HUMAN_CHECK !== '1', 'pnpm run e2e:m6-t10-human で起動する人間検証専用');
  test.setTimeout(0);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t10-human-'));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${e2eRoot}`],
      cwd: projectRoot,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => window.settings.set('lang', 'ja'));

    await seedBaseMap(page, 'm6t10-human-tms', masterDoc('A'));
    await seedBaseMap(page, 'm6t10-human-merc', masterDoc('B'));

    await page.evaluate(() => { location.hash = '/appedit'; });
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-id').fill('m6t10-human-app');
    await page.getByTestId('app-id').press('Tab');
    await page.getByTestId('app-title').fill('m6-t10 人間検証用アプリ');
    await page.getByTestId('app-title').press('Tab');

    await page.getByTestId('app-sources-tab').click();
    await page.getByTestId('app-basemap-mode').click();
    for (const slug of ['m6t10-human-tms', 'osm']) {
      await page.getByTestId('app-basemap-search').fill(slug);
      await expect(page.getByTestId(`app-basemap-row-${slug}`)).toBeVisible({ timeout: 30000 });
      await page.getByTestId(`app-basemap-row-${slug}`).click();
      await expect(page.getByTestId(`app-selected-source-${slug}`)).toBeVisible();
    }

    // ここで停止する。Playwright Inspector の Resume を押すまで人間が自由に操作できる
    await page.pause();
  } finally {
    if (app) await app.close();
  }
});
