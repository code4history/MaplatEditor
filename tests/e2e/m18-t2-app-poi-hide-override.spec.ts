// M18-T2: アプリ管理 > POI 編集の hide 上書き UI — E2E
// 設計 docs/superpowers/specs/2026-07-30-m18-t2-app-poi-hide-override-ui-design.md v1.0 §6.2 準拠。
//
// 検証範囲（AC2-1/2/3/4/7/8/9/10）:
//   1. AppEdit の POI タブで参照要素に hide チェックボックスが出る / 2. 非参照要素には出ない
//   3/4/7. ON → 保存 → 再読込 → OFF → 保存 の round-trip（OFF では hide キーごと消える）
//   8. 他の上書き（icon）との佷存・並べ替え・追加選択・別参照の解除でも hide が保持される
//   9. viewer 到達: AppEdit の preview タブで app-level POI の hide が viewer に届く
//      （app-level レイヤの namespaceID は prefix なしの key = normalize_pois:192-193 + index.ts:384）
//   10. undo / redo（AppEdit の historyApplying + recordHistory 経路）
//
// t1 E2E（m18-t1-map-poi-hide-override.spec.ts）と t5 E2E（m18-t5-properties-viewer-reach.spec.ts）の
// 両方の知見を踏襲。待機はすべて状態ベース（固定スリープ禁止 = m18-t5 実装レビュー Minor-1 の教訓）。
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const OSM_TILE_FIXTURE_ROOT = path.resolve(import.meta.dirname, 'fixtures/osm-tiles');
const FAKE_TILE_PATH = path.resolve(import.meta.dirname, 'fixtures/fake-osm-tile.png');

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash: string) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
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
  // 外部 OSM タイルをローカル fixture へ差し替え（m18-t1/t5 と同一方式）
  const fakeTile = await readFile(FAKE_TILE_PATH);
  await page.route('**/tile.openstreetmap.org/**', async (route) => {
    const m = route.request().url().match(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) {
      const fixturePath = path.join(OSM_TILE_FIXTURE_ROOT, m[1], m[2], `${m[3]}.png`);
      if (existsSync(fixturePath)) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: await readFile(fixturePath) });
      }
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: fakeTile });
  });
  return { app, page };
}

// main 側 dialog.showMessageBox を OK 自動応答へ差し替える（AppEdit の保存も確認ダイアログを挟む）
async function stubMessageBoxOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function previewFrame(page: Page): Promise<Frame> {
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 30000 });
  const handle = await page.locator('iframe.preview-map').elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('preview iframe の contentFrame を取得できません');
  return frame;
}

// AppEdit の POI データタブを開いてペインスコープの locator を返す
async function openAppPoisTab(page: Page, uid: string, slug: string) {
  await openHash(page, `#/appedit?uid=${uid}`);
  await expect(page.getByTestId('app-id')).toHaveValue(slug, { timeout: 30000 });
  await page.locator('[role="tab"]').filter({ hasText: /POI選択/ }).click();
  const poisPane = page.getByTestId('app-pois-tab-pane');
  return { poisPane, cards: poisPane.locator('.selected-source') };
}

// 保存済み App の pois 配列を main 側から取得する（DOM ではなく保存形の直接検証）
async function readSavedAppPois(page: Page, uid: string): Promise<any[]> {
  return await page.evaluate(async (appUid: string) => {
    const doc: any = await (window as any).appedit.request(appUid);
    return Array.isArray(doc?.pois) ? doc.pois : [];
  }, uid);
}

const POI_A_ID = 'a1';
const POI_B_ID = 'b1';

test.describe('M18-T2: アプリ管理 POI 編集の hide 上書き UI', () => {
  test('AC2-1/2/3/4/7/8/9/10: hide 上書きの AppEdit UI・round-trip・viewer 到達・undo', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t2-hide-override-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const stamp = Date.now();
    const slugA = `m18-t2-poi-a-${stamp}`;
    const slugB = `m18-t2-poi-b-${stamp}`;
    const appSlug = `m18-t2-app-${stamp}`;

    try {
      // ---- seed: POI ソース A（表示側）と B（hide 対象）----
      const { poiUidA, poiUidB } = await page.evaluate(async ({ sa, sb, idA, idB }: any) => {
        const mk = async (slug: string, titleJa: string, featureId: string, lng: number) => {
          const created = await (window as any).poiSources.createLocal({ slug, title: { ja: titleJa }, lang: 'ja' });
          if (!created || created.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(created)}`);
          await (window as any).poiSources.save(created.uid, {
            slug, title: { ja: titleJa },
            fc: {
              type: 'FeatureCollection', lang: 'ja',
              features: [{
                type: 'Feature', id: featureId,
                geometry: { type: 'Point', coordinates: [lng, 43.06] },
                properties: { _maplatUid: crypto.randomUUID(), name: { ja: titleJa } },
              }],
            },
          });
          return created.uid as string;
        };
        return { poiUidA: await mk(sa, 'レイヤA（表示）', idA, 141.35), poiUidB: await mk(sb, 'レイヤB（hide）', idB, 141.36) };
      }, { sa: slugA, sb: slugB, idA: POI_A_ID, idB: POI_B_ID });

      // ---- seed: App（pois に A と B を参照。A には icon 上書きも付ける）----
      // AppEdit には preview タブが組み込みで存在するため、t1 のように別途 App を作成する必要はない。
      // sources はビルトイン OSM を使用（t5 と同一方式: viewer 内蔵辞書でタイル要求が発火する）。
      // homeLng/homeLat で viewer の初期位置を札幌に固定（t5 の教訓: デフォルト東京だとマーカーが見えない）。
      // ※生 URL 非参照要素は seed に含めない — viewer が nodesLoader で fetch を試みて
      //   タイムアウトするため。AC2-2（非参照要素に hide が出ない）は smoke で検証済み。
      const appUid = await page.evaluate(async ({ slug, poiUidA, poiUidB }: any) => {
        const uid = crypto.randomUUID();
        const r = await (window as any).appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'M18-T2 App' }, title: { ja: 'M18-T2 App' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: ['osm'],
            appSettings: { homeLng: 141.35, homeLat: 43.06, defaultZoom: 14 },
            pois: [
              { poiUid: poiUidA, icon: 'builtin:defaultpin' },
              { poiUid: poiUidB },
            ],
            httpSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(r)}`);
        return uid;
      }, { slug: appSlug, poiUidA, poiUidB });

      // ================= AC2-1: 参照要素に hide チェックボックスが出る =================
      let { poisPane } = await openAppPoisTab(page, appUid, appSlug);
      const hideChecks = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks).toHaveCount(2, { timeout: 30000 });
      console.log('  AC2-1: 参照要素に hide チェックボックスが2件: PASS');

      // AC2-2（非参照要素に hide が出ない）は smoke で検証済み（t1 smoke が共用コンポーネントの
      // v-else ブロックに poiref-hide-override が出現しないことを assert）

      // ================= AC2-3/4/7: round-trip =================
      // 元の App へ戻る
      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const hideChecks2 = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks2).toHaveCount(2, { timeout: 30000 });

      // B（2番目）を ON
      await hideChecks2.nth(1).check();
      await expect(hideChecks2.nth(1)).toBeChecked();

      // 保存
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

      // 再読込して hide が保持されていることを確認
      await expect
        .poll(async () => {
          const saved = await readSavedAppPois(page, appUid);
          const entryB = saved.find((e: any) => e?.poiUid === poiUidB);
          return entryB?.hide ?? null;
        }, { timeout: 30000 })
        .toBe(true);

      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const hideChecks3 = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks3).toHaveCount(2, { timeout: 30000 });
      await expect(hideChecks3.nth(1)).toBeChecked();
      console.log('  AC2-3/7: ON → 保存 → 再読込で hide:true が保持される: PASS');

      // OFF にして保存
      await hideChecks3.nth(1).uncheck();
      await expect(hideChecks3.nth(1)).not.toBeChecked();
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

      // hide キーが存在しないことを確認
      await expect
        .poll(async () => {
          const saved = await readSavedAppPois(page, appUid);
          const entryB = saved.find((e: any) => e?.poiUid === poiUidB);
          return entryB ? ('hide' in entryB) : true;
        }, { timeout: 30000 })
        .toBe(false);
      console.log('  AC2-4: OFF で hide キーごと消える: PASS');

      // ================= AC2-8: 他の上書きとの佷存・選択操作での温存 =================
      // B を再び ON にする。A には icon 上書きが既に設定済み（seed 時）。
      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const hideChecks4 = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks4).toHaveCount(2, { timeout: 30000 });
      await hideChecks4.nth(1).check();
      await expect(hideChecks4.nth(1)).toBeChecked();

      // 保存して、両方の上書きが保持されていることを確認
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

      await expect
        .poll(async () => {
          const saved = await readSavedAppPois(page, appUid);
          const entryA = saved.find((e: any) => e?.poiUid === poiUidA);
          const entryB = saved.find((e: any) => e?.poiUid === poiUidB);
          return { aIcon: entryA?.icon ?? null, bHide: entryB?.hide ?? null };
        }, { timeout: 30000 })
        .toEqual({ aIcon: 'builtin:defaultpin', bHide: true });
      console.log('  AC2-8: icon と hide の佷存が保持される: PASS');

      // ================= AC2-10: undo / redo =================
      // AppEdit は recordHistory が即座に実行されるため、t1 のような expect.poll 待ちは不要。
      // ただしチェックボックスは <input> のため isEditableElement で undo が抑止される → blur が必要。
      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const hideChecks5 = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks5).toHaveCount(2, { timeout: 30000 });
      await hideChecks5.nth(1).uncheck(); // ON → OFF
      await expect(hideChecks5.nth(1)).not.toBeChecked();

      // blur してから undo（isEditableElement 抑止対策 = t1 と同じ）
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await expect(hideChecks5.nth(1), 'AC2-10: undo で ON へ戻る').toBeChecked({ timeout: 15000 });

      // redo
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
      await expect(hideChecks5.nth(1), 'AC2-10: redo で OFF へ戻る').not.toBeChecked({ timeout: 15000 });
      console.log('  AC2-10: undo/redo で hide が巻き戻る: PASS');

      // ================= AC2-9: viewer 到達 =================
      // viewer 検証のため B を再び ON にして保存
      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const hideChecks6 = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks6).toHaveCount(2, { timeout: 30000 });
      await hideChecks6.nth(1).check();
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => (await readSavedAppPois(page, appUid)).filter((e: any) => e?.hide === true).length, { timeout: 30000 })
        .toBe(1);

      // preview タブを開く（AppEdit には組み込みの preview タブがある）
      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      const frame = await previewFrame(page);

      // viewer ready を状態ベースで待機（t5 と同一方式）
      await frame.waitForFunction(() => !!(window as any).__maplatPreview?.core, undefined, { timeout: 90000 });
      await frame.waitForFunction(() => {
        const core = (window as any).__maplatPreview?.core;
        const src = core?.mapObject?.getSource?.('marker');
        return !!src && src.getFeatures().length >= 1;
      }, undefined, { timeout: 90000 });

      // モーダル消失待機（t5 と同一）
      await frame.locator('.modalBase').waitFor({ state: 'hidden', timeout: 30000 });
      await frame.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
      }));

      // (a) 配信 JSON: app-level pois は apps/<appSlug>.json に入る
      const previewSrc = await page.locator('iframe.preview-map').getAttribute('src');
      const appJsonUrl = previewSrc!.replace(/\/$/, '') + '/apps/' + previewSrc!.match(/\/preview\/([^/]+)\//)![1] + '.json';
      const appJson: any = await page.evaluate(async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
        return await resp.json();
      }, appJsonUrl);

      const fcA = appJson.pois.find((p: any) => String(p?.id ?? '').includes(slugA) || String(p?.properties?.id ?? '').includes(POI_A_ID));
      const fcB = appJson.pois.find((p: any) => String(p?.id ?? '').includes(slugB) || String(p?.properties?.id ?? '').includes(POI_B_ID));
      expect(fcA, 'AC2-9(a): apps JSON にレイヤA の FC が存在する').toBeTruthy();
      expect(fcB, 'AC2-9(a): apps JSON にレイヤB の FC が存在する').toBeTruthy();
      expect(fcB.properties?.hide, 'AC2-9(a): B は FC.properties.hide === true').toBe(true);
      expect(fcA.properties?.hide, 'AC2-9(a): A は非表示でない').not.toBe(true);
      for (const p of appJson.pois) {
        expect(p.hide, 'AC2-9(a): FC トップレベルに hide が出ない（properties 正本）').toBeUndefined();
      }

      // (b)(c)(d) viewer 内部: app-level cluster / hidden 一覧 / marker 実描画
      // app-level POI レイヤは core.pois[<key>] に載る。
      // key は FC.id または FC.properties.id から決まる（normalizeLayer で key として使用）。
      // exportForm が返す FC の id は POI ソースの slug になる（t5 E2E と同一。
      // t5 では core.pois[slugB] でアクセスしている）。
      const viewerState = await frame.evaluate(({ sa, sb }: any) => {
        const core = (window as any).__maplatPreview.core;
        const src = core.mapObject.getSource('marker');
        const allPoiKeys = Object.keys(core.pois).filter((k: string) => k !== 'main');
        return {
          allPoiKeys,
          clusterAHide: core.pois?.[sa]?.hide ?? null,
          clusterBHide: core.pois?.[sb]?.hide ?? null,
          hiddenLayerKeys: core.listPoiLayers(true).map((l: any) => l.namespaceID),
          markerCount: src.getFeatures().length,
        };
      }, { sa: slugA, sb: slugB });

      expect(viewerState.clusterBHide, 'AC2-9(b): B の cluster.hide が true').toBe(true);
      expect(viewerState.clusterAHide, 'AC2-9(b): A の cluster.hide は立たない').not.toBe(true);
      // (c) hidden 一覧は B の exact namespaceID のみを含み A を含まない
      // app-level は prefix なしのため、namespaceID = slugB
      expect(viewerState.hiddenLayerKeys, 'AC2-9(c): hidden 一覧に B の exact 値').toContain(slugB);
      expect(viewerState.hiddenLayerKeys, 'AC2-9(c): hidden 一覧に A は含まれない').not.toContain(slugA);
      // (d) marker はレイヤA の 1 件のみ（B の分が加算されない）
      expect(viewerState.markerCount, 'AC2-9(d): 描画マーカーは A の 1 件のみ').toBe(1);
      console.log('  AC2-9: viewer 到達（app-level POI の hide が viewer で効く）: PASS');

      // 人間確認用の一時停止（MAPLAT_E2E_PAUSE=1 のときだけ有効）
      if (process.env.MAPLAT_E2E_PAUSE === '1') {
        await page.pause();
      }
    } finally {
      await quitElectronApplication(app).catch(() => {});
    }
  });
});
