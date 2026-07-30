// M18-T2: アプリ管理 > POI 編集の hide 上書き UI — E2E
// 設計 docs/superpowers/specs/2026-07-30-m18-t2-app-poi-hide-override-ui-design.md v1.0 §6.2 準拠。
//
// 検証範囲（AC2-1/2/3/4/7/8/9/10）:
//   1. AppEdit の POI タブで参照要素に hide チェックボックスが出る
//   2. 非参照要素（生 FC）には出ない（別 seed・シナリオ2で検証 = §6.2-2）
//   3/4/7. ON → 保存 → 再読込 → OFF → 保存 の round-trip（OFF では hide キーごと消える）
//   8a. 他の上書き（icon）との佷存（シナリオ1内で検証）
//   8b. 追加選択・並べ替え・別参照の解除でも hide が保持される（シナリオ3で検証 = §6.2-4）
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
  test('シナリオ1: AC2-1/3/4/7/8a/9/10: hide 上書きの AppEdit UI・round-trip・viewer 到達・undo', async () => {
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
      // ※生 URL 非参照要素は viewer 到達検証（シナリオ5）の seed に含めない — viewer の
      //   nodesLoader が fetch を試みてタイムアウトするため。AC2-2 はシナリオ2（生 FC =
      //   インライン・fetch 不要・preview 不使用の UI 検証）で別途検証する。
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

      // AC2-2（非参照要素に hide が出ない）はシナリオ2（§6.2-2）で検証

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

      // ================= AC2-8a: 他の上書き（icon）との佷存 =================
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
      console.log('  AC2-8a: icon と hide の佷存が保存後も保持される: PASS');

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

  // §6.2-2: AC2-2 — 非参照要素（生 FC）には hide チェックボックスが出ない。
  // 別 seed（参照2件 + 生 FC 1件）。preview タブは開かない（UI 検証のみ・viewer 無関係）。
  // 生 FC はインラインのため nodesLoader の fetch は発火しない（生 URL とは異なる）。
  test('シナリオ2: AC2-2: 非参照要素（生 FC）には hide チェックボックスが出ない', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t2-ac2-2-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const stamp = Date.now();
    const slugA = `m18-t2-s2a-${stamp}`;
    const slugB = `m18-t2-s2b-${stamp}`;
    const appSlug = `m18-t2-s2-app-${stamp}`;

    try {
      // ---- seed: POI ソース A と B ----
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
        return { poiUidA: await mk(sa, 'S2レイヤA', idA, 141.35), poiUidB: await mk(sb, 'S2レイヤB', idB, 141.36) };
      }, { sa: slugA, sb: slugB, idA: POI_A_ID, idB: POI_B_ID });

      // ---- seed: App（pois に参照2件 + 生 FC 1件を混在）----
      // 生 FC はインラインのため fetch 不要（preview を開かないため viewer も無関係）
      const appUid = await page.evaluate(async ({ slug, poiUidA, poiUidB }: any) => {
        const uid = crypto.randomUUID();
        const r = await (window as any).appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'S2 App' }, title: { ja: 'S2 App' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: ['osm'],
            appSettings: { homeLng: 141.35, homeLat: 43.06, defaultZoom: 14 },
            pois: [
              { poiUid: poiUidA },
              { poiUid: poiUidB },
              { type: 'FeatureCollection', id: 'raw-fc', features: [] },
            ],
            httpSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(r)}`);
        return uid;
      }, { slug: appSlug, poiUidA, poiUidB });

      // ---- POI タブを開き、参照2件分のみに hide UI が出ることを assert ----
      const { poisPane, cards } = await openAppPoisTab(page, appUid, appSlug);
      await expect(cards, 'シナリオ2: カード数は3件（参照2 + 生FC1）').toHaveCount(3, { timeout: 30000 });
      await expect(
        poisPane.locator('[data-testid="poiref-hide-override"]'),
        'AC2-2: 参照要素2件分のみ hide UI が出る（生 FC 要素には出ない）',
      ).toHaveCount(2);
      console.log('  AC2-2: 非参照要素（生 FC）に hide チェックボックスが出ない: PASS');
    } finally {
      await quitElectronApplication(app).catch(() => {});
    }
  });

  // §6.2-4: AC2-8b — 追加選択・並べ替え・別参照の解除でも hide が保持される。
  // 別 seed（参照2件 → 追加選択で3件 → 並べ替え → 参照解除で2件）。
  // 検証は保存形（readSavedAppPois）で行い、DOM の再マウントに依存しない。
  test('シナリオ3: AC2-8b: 追加選択・並べ替え・別参照の解除でも hide が保持される', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t2-ac2-8b-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const stamp = Date.now();
    const slugA = `m18-t2-s3a-${stamp}`;
    const slugB = `m18-t2-s3b-${stamp}`;
    const slugC = `m18-t2-s3c-${stamp}`;
    const appSlug = `m18-t2-s3-app-${stamp}`;

    try {
      // ---- seed: POI ソース A, B, C ----
      const { poiUidA, poiUidB, poiUidC } = await page.evaluate(async ({ sa, sb, sc, idA, idB, idC }: any) => {
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
        return {
          poiUidA: await mk(sa, 'S3レイヤA（icon）', idA, 141.35),
          poiUidB: await mk(sb, 'S3レイヤB（hide）', idB, 141.36),
          poiUidC: await mk(sc, 'S3レイヤC（追加）', idC, 141.37),
        };
      }, { sa: slugA, sb: slugB, sc: slugC, idA: 'a3', idB: 'b3', idC: 'c3' });

      // ---- seed: App（pois に A（icon）と B を参照）----
      const appUid = await page.evaluate(async ({ slug, poiUidA, poiUidB }: any) => {
        const uid = crypto.randomUUID();
        const r = await (window as any).appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'S3 App' }, title: { ja: 'S3 App' },
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

      // ---- B の hide を ON にして保存 ----
      let { poisPane } = await openAppPoisTab(page, appUid, appSlug);
      let hideChecks = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks).toHaveCount(2, { timeout: 30000 });
      await hideChecks.nth(1).check(); // B の hide ON
      await expect(hideChecks.nth(1)).toBeChecked();
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

      // ---- 追加選択: セレクタ左ペインで C をクリック → 3件になる ----
      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const availableC = poisPane.locator(`[data-resource-uid="${poiUidC}"]`);
      await expect(availableC, 'シナリオ3: セレクタに C が表示される').toBeVisible({ timeout: 30000 });
      await availableC.click();

      // 3件になったことを確認（A, B, C の順）
      const cards = poisPane.locator('.selected-source');
      await expect(cards, 'シナリオ3: 追加選択で3件になる').toHaveCount(3, { timeout: 10000 });

      // B の hide が ON のまま保持されていることを DOM で確認
      hideChecks = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks, 'シナリオ3: hide UI は3件分').toHaveCount(3);
      await expect(hideChecks.nth(1), 'AC2-8b: 追加選択後も B の hide が ON').toBeChecked();

      // 保存して保存形で検証
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => {
          const saved = await readSavedAppPois(page, appUid);
          const a = saved.find((e: any) => e?.poiUid === poiUidA);
          const b = saved.find((e: any) => e?.poiUid === poiUidB);
          const c = saved.find((e: any) => e?.poiUid === poiUidC);
          return { aIcon: a?.icon ?? null, bHide: b?.hide ?? null, cCount: c ? 1 : 0 };
        }, { timeout: 30000 })
        .toEqual({ aIcon: 'builtin:defaultpin', bHide: true, cCount: 1 });
      console.log('  AC2-8b-1: 追加選択後も icon/hide が保持される: PASS');

      // ---- 並べ替え: B（index 1）を ↓ で下へ移動 → [A, C, B] ----
      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const cards2 = poisPane.locator('.selected-source');
      await expect(cards2).toHaveCount(3, { timeout: 30000 });
      // B は index 1。↓ ボタンをクリックして B を下へ移動
      await cards2.nth(1).locator('button[title="下へ"]').click();

      // 保存して並び順と上書きを検証
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => {
          const saved = await readSavedAppPois(page, appUid);
          return saved.map((e: any) => ({ uid: e?.poiUid, icon: e?.icon ?? null, hide: e?.hide ?? null }));
        }, { timeout: 30000 })
        .toEqual([
          { uid: poiUidA, icon: 'builtin:defaultpin', hide: null },
          { uid: poiUidC, icon: null, hide: null },
          { uid: poiUidB, icon: null, hide: true },
        ]);
      console.log('  AC2-8b-2: 並べ替え後も icon/hide が保持される: PASS');

      // ---- 別参照の解除: A（index 0）を × で解除 → [C, B] ----
      // 設計 §6.2-4: "hide を ON にした参照とは別の参照を選択解除（×）し、
      //   残った参照の hide / icon が保持されることを assert"
      // A は icon を持つ参照で、B は hide を持つ参照。A を解除 → 残る C と B。
      // B の hide が保持されることを検証。
      ({ poisPane } = await openAppPoisTab(page, appUid, appSlug));
      const cards3 = poisPane.locator('.selected-source');
      await expect(cards3).toHaveCount(3, { timeout: 30000 });
      // 参照解除は確認ダイアログなし（requestRemove → removeAt の直接呼び出し）
      await cards3.nth(0).locator('.btn-outline-danger').click();
      await expect(cards3, 'シナリオ3: 解除後は2件').toHaveCount(2, { timeout: 10000 });

      // 保存して残った参照の上書きを検証
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => {
          const saved = await readSavedAppPois(page, appUid);
          return saved.map((e: any) => ({ uid: e?.poiUid, hide: e?.hide ?? null }));
        }, { timeout: 30000 })
        .toEqual([
          { uid: poiUidC, hide: null },
          { uid: poiUidB, hide: true },
        ]);
      console.log('  AC2-8b-3: 別参照解除後も残った参照の hide が保持される: PASS');
    } finally {
      await quitElectronApplication(app).catch(() => {});
    }
  });
});
