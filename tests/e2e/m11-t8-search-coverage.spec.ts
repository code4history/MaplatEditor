import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  return { app, page };
}

test.describe('M11-T8 Search Coverage & Backfill E2E Tests', () => {
  test('FTS5 & RTree indexes built by triggers survive restart, and auto coverage app is indexable in searchExtent', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t8-'));

    // m19-t7: この spec は元々「索引トリガを全 DROP して行を捏造し、再起動時の一度きり
    // backfill（marker '2026-07-16-app-fts-rtree-backfill'）が索引を張り直す」ことを検証していた。
    // その backfill は m19-t7 で撤去した。
    //   索引の器（FTS / RTree テーブル）は CREATE ... IF NOT EXISTS で**再起動しても中身が残る**。
    //   毎起動 DROP & CREATE されるのはトリガ定義だけであり、行の索引化は投入時にトリガが行う。
    //   0.7.0 → 1.0.0 の初回起動では backfill が走る時点でまだ 1 行も無い（取込は後段）ので
    //   構造的に 0 件であり、公開版に同梱する意味が無かった。「トリガ導入以前に書かれた行」は
    //   未公開の SQLite ストア内部にしか存在し得ない。
    // ∴ 検証対象を「トリガが張った索引が再起動を越えて全文検索・空間検索に効く」ことへ移した。
    //   併せて seed を **公開 API だけ** で行う形へ揃えた（m11-t11 の T12-4 と同じ処方。
    //   索引トリガは main プロセスで登録した SQL 関数を呼ぶため、外部コネクションからの
    //   直書きでは発火させられない＝直書き seed は索引を伴わない、という構造的な制約もある）。

    // 1. 起動して公開 API で seed する
    let { app, page } = await launch(e2eRoot);
    const seeded = await page.evaluate(async () => {
      const stamp = Date.now();

      // ベースマップ（全文検索の対象）
      const baseSlug = `m11-t8-basemap-${stamp}`;
      const bm = await window.baseMaps.saveUser({
        slug: baseSlug,
        tms: {
          lang: 'ja',
          title: { ja: 'テストベースマップ', en: 'Test BaseMap' },
          label: { ja: 'テストベースマップ', en: 'Test BaseMap' },
          attr: {},
          url: 'https://example.com/tiles/{z}/{x}/{y}.png',
          minZoom: 0,
          maxZoom: 18,
          thumbnail: '',
        },
        create: true,
      });
      if (!bm || bm.result !== 'Success') throw new Error(`base map seed failed: ${JSON.stringify(bm)}`);

      // 地図（アプリの自動カバレッジ元。compiled.vertices_points から maps_rtree が張られる）
      const mapSlug = `m11-t8-map-${stamp}`;
      const mapObject = {
        mapID: mapSlug,
        title: { ja: 'カバレッジテスト地図', en: 'Coverage Test Map' },
        author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'png', width: 400, height: 300,
        url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        // W139.69 の期待値はこの GCP のメルカトル座標に由来する
        gcps: [
          [[0, 300], [15551351.4, 4249117.8]],
          [[400, 300], [15562483.3, 4249117.8]],
          [[400, 0], [15562483.3, 4259837.2]],
          [[0, 0], [15551351.4, 4259837.2]],
        ],
        edges: [],
        sub_maps: [],
        // 'loose': strict だと compiled が strict_error になり後続の appedit.save が拒否される
        // （m11-t11 の実測 2026-08-02。bbox は strict / loose で同一）
        strictMode: 'loose', vertexMode: 'plain', status: 'New',
      };
      const m1 = await window.mapedit.save({ slug: mapSlug, mapObject, tins: [] });
      if (!m1 || m1.result !== 'Success') throw new Error(`map seed failed: ${JSON.stringify(m1)}`);
      const tinResult = await window.mapedit.updateTin(
        mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
        mapObject.strictMode, mapObject.vertexMode,
      );
      if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
        throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
      }
      const m2 = await window.mapedit.save({ slug: mapSlug, uid: m1.uid, mapObject, tins: [tinResult[1]] });
      if (!m2 || m2.result !== 'Success') throw new Error(`compiled map save failed: ${JSON.stringify(m2)}`);

      // アプリ（自動カバレッジ。範囲属性を明示せず maps_rtree から導出させる）
      // ※ここで範囲属性名を literal で書かないこと。m19-t11 の MC5 が凍結属性名の
      //   出現数を tests/ 込みで数えており、コメントであっても baseline を動かす
      const appSlug = `m11-t8-app-${stamp}`;
      const ap = await window.appedit.save({
        slug: appSlug,
        create: true,
        document: {
          appID: appSlug,
          appName: { ja: 'テストアプリ' },
          title: { ja: 'テストアプリ' },
          description: {}, lang: 'ja',
          sources: [{ sourceType: 'maplat', mapUid: m2.uid }],
          pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
        },
      });
      if (!ap || ap.result !== 'Success') throw new Error(`app seed failed: ${JSON.stringify(ap)}`);

      return { baseMapUid: bm.uid, mapUid: m2.uid, appUid: ap.uid, appSlug };
    });
    const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
    await quitElectronApplication(app);

    // 2. 投入と同時にトリガが索引を張っていること（backfill を待たない）を DB で直接確かめる
    const dbPath = path.join(saveFolder as unknown as string, 'maplat.sqlite');
    {
      const db = new DatabaseSync(dbPath);
      try {
        const fts = db.prepare('SELECT COUNT(*) as cnt FROM base_maps_fts WHERE uid = ?').get(seeded.baseMapUid) as any;
        const rtree = db
          .prepare('SELECT COUNT(*) as cnt FROM apps_rtree_key WHERE uid = ?')
          .get(seeded.appUid) as any;
        expect(fts.cnt, '保存時にトリガが FTS 索引を張るはず（backfill 非依存）').toBe(1);
        expect(rtree.cnt, '保存時にトリガが RTree 索引を張るはず（backfill 非依存）').toBe(1);
      } finally {
        db.close();
      }
    }

    // 3. 再起動（トリガ定義はここで DROP & CREATE され直すが、張り済みの索引は残る）
    const relaunch = await launch(e2eRoot);
    app = relaunch.app;
    page = relaunch.page;

    // FTS 全文検索の検証 (base-map の全文検索が機能することを確認)
    const ftsResult = await page.evaluate(async () => {
      return await (window as any).search.baseMaps({ q: 'ベースマップ', page: 1, pageSize: 10 });
    });
    expect(ftsResult.docs.map((d: any) => d.uid)).toContain(seeded.baseMapUid);

    // 空間検索の検証 (自動カバレッジのアプリが searchExtent で引っかかること)
    // 東京周辺の BBox [W, S, E, N] = [139.5, 35.5, 140.0, 36.0]
    const spatialResult = await page.evaluate(async () => {
      return await (window as any).search.searchExtent('app', [15529087, 4232311, 15584729, 4301232]);
    });
    expect(spatialResult).toContain(seeded.appSlug);

    // 4. アプリ編集画面でのカバレッジ変更のインタラクション（トグル無し）の検証
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.evaluate((nextHash) => { location.hash = nextHash; }, '#/applist');
    await expect(page.locator('.resource-list__toolbar')).toBeVisible();

    await page.locator(`[data-resource-uid="${seeded.appUid}"] a`).click();
    // m19-t11: ③の呼称は「アプリ提供範囲(参考)」→「アプリ対象範囲」
    await expect(page.getByTestId('app-coverage-label')).toContainText('アプリ対象範囲');
    // 自動カバレッジが maps_rtree 由来で表示されること。値の細部は TIN の頂点展開に依存する
    // ため（m19-t7 で seed を公開 API 経由へ移した際に W139.69… → W139.67… へ動いた）、
    // 手動指定値 'W139 S35 E140 N36' と判別できる粒度で見る
    await expect(page.locator('.small.font-monospace')).toContainText('W139.6');
    await expect(page.locator('button:has-text("クリア")')).not.toBeVisible();

    // 手動指定をシミュレート
    await page.evaluate(() => {
      (window as any).testDebug.applyAppCoverage([
        [139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0]
      ]);
    });

    // 手動指定後は、その値が表示され、かつ「クリア」ボタンが表示される
    await expect(page.locator('.small.font-monospace')).toContainText('W139 S35 E140 N36');
    await expect(page.locator('button:has-text("クリア")')).toBeVisible();

    // 手動の状態で地図を追加しても、手動の範囲が上書きされないことを確認
    await page.evaluate(() => {
      (window as any).testDebug.appData.value.sources.push({
        sourceType: 'maplat',
        mapUid: 'map-new'
      });
    });

    // 手動カバレッジ（W139 S35 E140 N36）のままであること
    await expect(page.locator('.small.font-monospace')).toContainText('W139 S35 E140 N36');

    // 「クリア」ボタンをクリックして手動をクリア
    await page.locator('button:has-text("クリア")').click();

    // クリア後は、クリアボタンが消え、自動計算結果に戻る
    await expect(page.locator('button:has-text("クリア")')).not.toBeVisible();
    await expect(page.locator('.small.font-monospace')).not.toContainText('W139 S35 E140 N36');

    // 地図をすべて削除すると、カバレッジも消去（-）される
    await page.evaluate(() => {
      (window as any).testDebug.appData.value.sources = [];
    });
    await expect(page.locator('.small.font-monospace')).toHaveText('-');

    // 5. ヘッダー被りの検証（800px幅で navbar-bottom ≤ main-content-top）
    // タブ展開が保たれる 800px（>768px navbar-expand-md 閾値）で検証
    await page.setViewportSize({ width: 800, height: 800 });
    await page.waitForTimeout(500);

    const overlap = await page.evaluate(() => {
      const navbar = document.querySelector('.navbar') as HTMLElement | null;
      const main = document.querySelector('.main-content') as HTMLElement | null;
      if (!navbar || !main) return { gap: NaN, status: 'missing' };
      const nr = navbar.getBoundingClientRect();
      const mr = main.getBoundingClientRect();
      return { gap: mr.top - nr.bottom, status: mr.top < nr.bottom ? 'overlap' : 'ok' };
    });
    expect(overlap.status, `Header-content gap: ${overlap.gap}px (expected >= 0)`).toBe('ok');

    await quitElectronApplication(app);
  });
});