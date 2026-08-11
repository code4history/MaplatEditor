// M18-T1: 地図管理 > POI 編集の hide 上書き UI — E2E
// 設計 docs/superpowers/specs/2026-07-29-m18-t1-map-poi-hide-override-ui-design.md v1.3 §6.2 準拠。
//
// 検証範囲（AC1-1/2/3/4/7/8/9/10）:
//   1. 参照要素カードに hide チェックボックスが出る / 2. 非参照要素には出ない
//   3/4/7. ON → 保存 → 再読込 → OFF → 保存 の round-trip（OFF では hide キーごと消える）
//   8. 他の上書き（icon）との併存・並べ替え・追加選択・別参照の解除でも hide が保持される
//   9. viewer 到達: 保存地図を参照する App を作り AppEdit preview で map 側 cluster を検証
//      （保存地図の pois は maps/{viewerMapID}.json へ入る = AppPreviewService:165-196。
//        active source は App source の startFrom:true + core.from.mapID 待機で保証。
//        map 側 namespaceID は `${mapID}#${FC.id}` = normalize_pois:192-193 + mixin:420-424）
//   10. undo / redo
//
// 待機はすべて状態ベース（固定スリープ禁止 = m18-t5 実装レビュー Minor-1 の教訓）。
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
  // 外部 OSM タイルをローカル fixture へ差し替え（m18-t5 と同一方式・実行時ネットワーク非依存）
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

// main 側 dialog.showMessageBox を OK 自動応答へ差し替える（m3-t6 の stubMessageBoxRecording と同方式）。
// MapEdit の保存は confirm ダイアログ（「変更を保存します。よろしいですか?」）を挟むため、
// これを入れないと editor-save-state が「保存済み」にならずタイムアウトする。
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

// POI データタブを開いてペインスコープの locator を返す（m3-t6 の共通手順を踏襲）
// m1-t6-hotfix-1 (設計 §6.3): 抑止スコープの初期無効タグは route query で注入する。
// W3(:2012)/W4(:1957-) は onMounted 内で走るため、testDebug 経由（mount 後）では
// 基点条件を作れない。MAPLAT_NO_HISTORY_SUPPRESS=W2,W3,W4 で基点測定モードになる。
const NO_HISTORY_SUPPRESS = process.env.MAPLAT_NO_HISTORY_SUPPRESS ?? '';

async function openPoisTab(page: Page, uid: string, slug: string) {
  const suffix = NO_HISTORY_SUPPRESS ? `&noHistorySuppress=${NO_HISTORY_SUPPRESS}` : '';
  await openHash(page, `#/mapedit?uid=${uid}${suffix}`);
  await expect(page.getByTestId('map-slug')).toHaveValue(slug, { timeout: 30000 });
  // 注入が効いていないまま測ると基点が偽装されるため、測定前にアサートする（設計 §6.3・AC1）
  const scopeState = await page.evaluate(() => (window as any).testDebug?.historyScopeState?.() ?? null);
  expect(scopeState, 'testDebug.historyScopeState が露出していること').not.toBeNull();
  expect(scopeState.diagEnabled, '履歴診断が有効であること').toBe(true);
  expect(scopeState.W1, 'W1（復元）は常時 ON').toBe(true);
  const expectedDisabled = NO_HISTORY_SUPPRESS.split(',').map((t) => t.trim()).filter(Boolean);
  for (const tag of ['W2', 'W3', 'W4']) {
    expect(scopeState[tag], `${tag} の有効/無効が注入どおりであること`).toBe(!expectedDisabled.includes(tag));
  }
  await page.getByTestId('map-tab-pois').click();
  const poisPane = page.getByTestId('map-pois-tab-pane');
  return { poisPane, cards: poisPane.locator('.selected-source') };
}

async function historyMark(page: Page, label: string): Promise<void> {
  await page.evaluate((l: string) => (window as any).testDebug?.historyMark?.(l), label);
}

async function historyDebug(page: Page): Promise<any> {
  return await page.evaluate(() => (window as any).testDebug?.historyDebug?.() ?? null);
}

async function historyJournal(page: Page): Promise<any[]> {
  return await page.evaluate(() => (window as any).testDebug?.historyJournal?.() ?? []);
}

// 保存済み地図の pois 配列を main 側から取得する（DOM ではなく保存形の直接検証）
async function readSavedPois(page: Page, uid: string): Promise<any[]> {
  return await page.evaluate(async (mapUid: string) => {
    const doc: any = await (window as any).mapedit.request(mapUid);
    return Array.isArray(doc?.pois) ? doc.pois : [];
  }, uid);
}

const POI_A_ID = 'a1';
const POI_B_ID = 'b1';

test.describe('M18-T1: 地図管理 POI 編集の hide 上書き UI', () => {
  test('AC1-1/2/3/4/7/8/9/10: hide 上書きの UI・round-trip・viewer 到達・undo', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-hide-override-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const stamp = Date.now();
    const slugA = `m18-t1-poi-a-${stamp}`;
    const slugB = `m18-t1-poi-b-${stamp}`;
    const mapSlug = `m18-t1-map-${stamp}`;

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

      // ---- seed: 地図（pois に A と B を参照。A には icon 上書きも付ける）----
      // AppEdit preview は GCP が足りないと appedit.preview.too_less_gcps で失敗するため、
      // m11-t11 の createMapWithGcps と同じく GCP 4点 + updateTin による compiled を持たせる
      // （AC1-9 の viewer 到達検証に preview が必須のため。設計 §6.2-5 / §6.4）
      const mapUid = await page.evaluate(async ({ slug, poiUidA, poiUidB }: any) => {
        const mapObject: any = {
          mapID: slug, title: { ja: 'M18-T1 地図' },
          officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
          attr: { ja: 'attr' }, dataAttr: {}, description: {},
          license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
          imageExtension: 'png', width: 400, height: 300,
          url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          // 札幌近傍（homePosition 141.35/43.06 = EPSG:3857 で約 15734000 / 5321000）を囲む4点
          gcps: [
            [[0, 300], [15728000, 5316000]],
            [[400, 300], [15740000, 5316000]],
            [[400, 0], [15740000, 5326000]],
            [[0, 0], [15728000, 5326000]],
          ],
          edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
          pois: [
            { poiUid: poiUidA, icon: 'builtin:defaultpin' },
            { poiUid: poiUidB },
          ],
        };
        const r1: any = await (window as any).mapedit.save({ slug, mapObject, tins: [] });
        if (!r1 || r1.result !== 'Success') throw new Error(`map save failed: ${JSON.stringify(r1)}`);
        const tinResult: any = await (window as any).mapedit.updateTin(
          mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
          mapObject.strictMode, mapObject.vertexMode,
        );
        if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
          throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
        }
        const r2: any = await (window as any).mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tinResult[1]] });
        if (!r2 || r2.result !== 'Success') throw new Error(`compiled map save failed: ${JSON.stringify(r2)}`);
        return r2.uid as string;
      }, { slug: mapSlug, poiUidA, poiUidB });

      // ================= AC1-1: 参照要素カードに hide チェックボックスが出る =================
      const { poisPane, cards } = await openPoisTab(page, mapUid, mapSlug);
      await expect(cards).toHaveCount(2, { timeout: 30000 });
      const hideChecks = poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks, 'AC1-1: 参照カード数と同数の hide チェックボックス').toHaveCount(2);
      await expect(hideChecks.nth(0)).not.toBeChecked();
      await expect(hideChecks.nth(1)).not.toBeChecked();

      // ================= AC1-3/7: B を ON → 保存 → 再読込で ON のまま =================
      await hideChecks.nth(1).check();
      await expect(hideChecks.nth(1)).toBeChecked();
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => (await readSavedPois(page, mapUid)).filter((e: any) => e?.hide === true).length, { timeout: 30000 })
        .toBe(1);

      {
        const saved = await readSavedPois(page, mapUid);
        const entryA = saved.find((e: any) => e?.poiUid === poiUidA);
        const entryB = saved.find((e: any) => e?.poiUid === poiUidB);
        expect(entryB?.hide, 'AC1-3: B の hide が true で保存される').toBe(true);
        expect('hide' in (entryA ?? {}), 'AC1-3: A には hide キーが付かない').toBe(false);
        expect(entryA?.icon, 'AC1-8: A の icon 上書きは保持される').toBe('builtin:defaultpin');
      }

      // 再読込（一覧へ戻ってから開き直す）してチェック状態が復元されること
      await openHash(page, '#/maplist');
      const reopened = await openPoisTab(page, mapUid, mapSlug);
      const hideChecks2 = reopened.poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks2).toHaveCount(2, { timeout: 30000 });
      await expect(hideChecks2.nth(1), 'AC1-7: 再読込で ON が復元される').toBeChecked();
      await expect(hideChecks2.nth(0)).not.toBeChecked();

      // ================= AC1-2: 非参照要素（生 FC）には出ない =================
      await page.evaluate(async ({ uid, poiUidA, poiUidB }: any) => {
        const doc: any = await (window as any).mapedit.request(uid);
        doc.pois = [
          { poiUid: poiUidA, icon: 'builtin:defaultpin' },
          { poiUid: poiUidB, hide: true },
          { type: 'FeatureCollection', id: 'raw-fc', features: [] },
        ];
        const r: any = await (window as any).mapedit.save({ slug: doc.mapID, uid, mapObject: doc, tins: [] });
        if (!r || r.result !== 'Success') throw new Error(`map save (raw fc) failed: ${JSON.stringify(r)}`);
      }, { uid: mapUid, poiUidA, poiUidB });

      await openHash(page, '#/maplist');
      const withRaw = await openPoisTab(page, mapUid, mapSlug);
      await expect(withRaw.cards).toHaveCount(3, { timeout: 30000 });
      await expect(
        withRaw.poisPane.locator('[data-testid="poiref-hide-override"]'),
        'AC1-2: 生 FC 要素には hide UI が出ない（参照2件分のみ）',
      ).toHaveCount(2);

      // ================= AC1-8: 別参照の解除後も残った参照の hide / icon が保持される =================
      // 生 FC（3件目）を削除 → 参照2件が残る。B の hide と A の icon が生き残ること
      await withRaw.cards.nth(2).locator('.btn-outline-danger').click();
      await page.getByTestId('delete-confirm-button').click();
      await expect(withRaw.cards).toHaveCount(2);
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => (await readSavedPois(page, mapUid)).length, { timeout: 30000 })
        .toBe(2);
      {
        const saved = await readSavedPois(page, mapUid);
        expect(saved.find((e: any) => e?.poiUid === poiUidB)?.hide, 'AC1-8: 解除後も B の hide が残る').toBe(true);
        expect(saved.find((e: any) => e?.poiUid === poiUidA)?.icon, 'AC1-8: 解除後も A の icon が残る').toBe('builtin:defaultpin');
      }

      // ================= AC1-10: undo / redo =================
      const afterDelete = await openPoisTab(page, mapUid, mapSlug);
      const hideChecks3 = afterDelete.poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks3).toHaveCount(2, { timeout: 30000 });
      await hideChecks3.nth(1).uncheck();               // ON → OFF
      await expect(hideChecks3.nth(1)).not.toBeChecked();
      // uncheck が mapData へ反映され、履歴スナップショット（scheduleHistorySnapshot の
      // setTimeout(0) デバウンス）が確定するまで状態ベースで待つ。これを挟まないと
      // Playwright の高速操作では push 前に undo が走り、redo 先が変わらない（固定スリープは使わない）
      await expect
        .poll(async () => await page.evaluate(
          () => ((window as any).testDebug?.mapData?.value?.pois?.[1] ?? {}).hide ?? null,
        ), { timeout: 15000 })
        .toBeNull();
      // MapEdit の onHistoryKeydown は isEditableElement（nativeTextUndo.ts:14 — INPUT/TEXTAREA を
      // 無条件に editable 扱い）でグローバル undo を抑止する。チェックボックスも <input> のため
      // フォーカスが載ったままでは Cmd/Ctrl+Z が効かない（既存の全フィールド共通の仕様）。
      // 実利用者と同じく、フォーカスを外してから undo する。
      await historyMark(page, 'after-uncheck');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await expect(hideChecks3.nth(1), 'AC1-10: undo で ON へ戻る').toBeChecked({ timeout: 15000 });
      await historyMark(page, 'after-undo');
      // undo で mapData が差し替わりチェックボックスが再生成されるため、redo 前にも同じ理由で blur する
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      // m1-t6-hotfix-1 (設計 §6.3): redo 押下の直前に履歴状態を記録する。
      // 失敗時に canRedo で「redo 枝が破棄された」か「スタックは健全」かを切り分ける
      const historyBeforeRedo = await historyDebug(page);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
      await historyMark(page, 'after-redo');
      try {
        await expect(hideChecks3.nth(1), 'AC1-10: redo で OFF へ戻る').not.toBeChecked({ timeout: 15000 });
      } catch (e) {
        // 設計 §6.4 の判定に必要な証跡を残してから送出する
        const journalOnFail = await historyJournal(page);
        console.log('[m1-t6-hotfix-1] REDO FAILED historyBeforeRedo=' + JSON.stringify(historyBeforeRedo));
        console.log('[m1-t6-hotfix-1] JOURNAL=' + JSON.stringify(journalOnFail));
        throw e;
      }
      {
        // AC5b: after-undo〜after-redo 区間に unsuppressed な push が無いこと。
        // 基点測定（W2-W4 無効）では発生しうるので、抑止有効時のみ検査する
        const journal = await historyJournal(page);
        const window_ = journal.filter((e: any) => e.phase === 'after-undo' || e.phase === 'after-redo');
        const offending = window_.filter((e: any) => e.kind === 'push' && e.suppressed === false);
        console.log('[m1-t6-hotfix-1] historyBeforeRedo=' + JSON.stringify(historyBeforeRedo));
        console.log('[m1-t6-hotfix-1] undo-redo window=' + JSON.stringify(window_));
        // AC4c: kind:'commit' の suppressed はすべて false（スコープ内から呼ばれていない）
        for (const c of journal.filter((e: any) => e.kind === 'commit')) {
          expect(c.suppressed, 'AC4c: commitHistorySnapshot はスコープ外から呼ばれる').toBe(false);
        }
        if (!NO_HISTORY_SUPPRESS) {
          expect(offending, 'AC5b: undo→redo 区間に unsuppressed な push が無い').toEqual([]);
        }
      }

      // ================= AC1-4: OFF で hide キーごと消える =================
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => {
          const saved = await readSavedPois(page, mapUid);
          const entryB = saved.find((e: any) => e?.poiUid === poiUidB);
          return entryB ? ('hide' in entryB) : true;
        }, { timeout: 30000 })
        .toBe(false);

      // 以降の viewer 検証のため B を再び ON にして保存
      const reON = await openPoisTab(page, mapUid, mapSlug);
      const hideChecks4 = reON.poisPane.locator('[data-testid="poiref-hide-override"] input[type="checkbox"]');
      await expect(hideChecks4).toHaveCount(2, { timeout: 30000 });
      await hideChecks4.nth(1).check();
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      await expect
        .poll(async () => (await readSavedPois(page, mapUid)).filter((e: any) => e?.hide === true).length, { timeout: 30000 })
        .toBe(1);

      // ================= AC1-9: viewer 到達（AppEdit preview harness は t1 の責務）=================
      // 保存地図を source に持つ App を作る。startFrom:true で当該地図を active source に固定する
      // （MaplatCore/src/index.ts:647,701-706 の setInitialMap）
      await page.evaluate(async ({ mapUid }: any) => {
        const slug = `m18-t1-app-${Date.now()}`;
        const saved: any = await (window as any).appedit.save({ slug, document: {
          appID: slug, appName: { ja: 'M18-T1 App' }, title: { ja: 'M18-T1 App' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources: [
            { sourceType: 'maplat', mapUid, role: 'maplat', startFrom: true },
            'osm',
          ],
          appSettings: { homeLng: 141.35, homeLat: 43.06, defaultZoom: 14 },
          pois: [],
          httpSettings: {}, manifestSettings: {},
        } });
        if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
      }, { mapUid });

      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 20000 });
      await page.locator('[data-resource-uid] a').first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 20000 });
      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      const frame = await previewFrame(page);

      // viewer ready + active source が対象地図であることを状態ベースで待機（レビュー v1.2 Minor-1）
      await frame.waitForFunction(() => !!(window as any).__maplatPreview?.core, undefined, { timeout: 90000 });
      await frame.waitForFunction(
        (expected: string) => (window as any).__maplatPreview?.core?.from?.mapID === expected,
        mapSlug,
        { timeout: 90000 },
      );
      await frame.waitForFunction(() => {
        const core = (window as any).__maplatPreview?.core;
        const src = core?.mapObject?.getSource?.('marker');
        return !!src && src.getFeatures().length >= 1;
      }, undefined, { timeout: 90000 });

      // (a) 配信 JSON: 保存地図の pois は maps/{viewerMapID}.json に入る（AppPreviewService:165-196）
      const previewSrc = await page.locator('iframe.preview-map').getAttribute('src');
      const mapJsonUrl = previewSrc!.replace(/\/$/, '') + '/maps/' + mapSlug + '.json';
      const mapJson: any = await page.evaluate(async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
        return await resp.json();
      }, mapJsonUrl);

      // M4-T3: 配信 JSON の pois は外部ファイルへの参照 + 上書き属性になった。
      // hide は FC へ焼き込まれず参照側 (wrapper) に載る（M4-T2 G2）
      const refA = mapJson.pois.find((p: any) => String(p?.layer ?? '').includes(slugA));
      const refB = mapJson.pois.find((p: any) => String(p?.layer ?? '').includes(slugB));
      expect(refA, 'AC1-9(a): maps JSON にレイヤA の参照が存在する').toBeTruthy();
      expect(refB, 'AC1-9(a): maps JSON にレイヤB の参照が存在する').toBeTruthy();
      expect(refA.layer, 'AC1-9(a): A は pois/<slug>.geojson を指す').toBe(`pois/${slugA}.geojson`);
      expect(refB.layer, 'AC1-9(a): B は pois/<slug>.geojson を指す').toBe(`pois/${slugB}.geojson`);
      expect(refB.hide, 'AC1-9(a): B の hide は参照側に載る').toBe(true);
      expect(refA.hide, 'AC1-9(a): A は非表示でない').not.toBe(true);
      for (const p of mapJson.pois) {
        expect(p.type, 'AC1-9(a): 配信 JSON にインライン FC が残らない').not.toBe('FeatureCollection');
      }
      // 上書きが外部ファイルへ焼き込まれていないこと（旧「FC トップレベルに hide が出ない」の後継）
      const previewBase = previewSrc!.replace(/\/$/, '');
      const externalB: any = await page.evaluate(async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
        return await resp.json();
      }, `${previewBase}/${refB.layer}`);
      expect(externalB.type, 'AC1-9(a): 外部ファイルは FeatureCollection').toBe('FeatureCollection');
      expect(externalB.properties?.hide, 'AC1-9(a): 外部ファイルに hide が焼き込まれない').toBeUndefined();
      expect(externalB.hide, 'AC1-9(a): 外部ファイルのトップレベルにも hide が出ない').toBeUndefined();

      // (b)(c)(d) viewer 内部: map source 側 cluster / hidden 一覧の exact 値 / marker 実描画
      const viewerState = await frame.evaluate(({ sa, sb, mapID }: any) => {
        const core = (window as any).__maplatPreview.core;
        const src = core.mapObject.getSource('marker');
        return {
          fromMapID: core.from?.mapID ?? null,
          clusterAHide: core.from?.pois?.[sa]?.hide ?? null,
          clusterBHide: core.from?.pois?.[sb]?.hide ?? null,
          hiddenLayerKeys: core.listPoiLayers(true).map((l: any) => l.namespaceID),
          markerCount: src.getFeatures().length,
          expectedNsA: `${mapID}#${sa}`,
          expectedNsB: `${mapID}#${sb}`,
        };
      }, { sa: slugA, sb: slugB, mapID: mapSlug });

      expect(viewerState.fromMapID, 'AC1-9(b): active source が対象地図').toBe(mapSlug);
      expect(viewerState.clusterBHide, 'AC1-9(b): B の cluster.hide が true').toBe(true);
      expect(viewerState.clusterAHide, 'AC1-9(b): A の cluster.hide は立たない').not.toBe(true);
      // (c) hidden 一覧は B の exact namespaceID のみを含み A を含まない（レビュー v1.2 Minor-2）
      expect(viewerState.hiddenLayerKeys, 'AC1-9(c): hidden 一覧に B の exact 値').toContain(viewerState.expectedNsB);
      expect(viewerState.hiddenLayerKeys, 'AC1-9(c): hidden 一覧に A は含まれない').not.toContain(viewerState.expectedNsA);
      // (d) marker はレイヤA の 1 件のみ（B の分が加算されない）
      expect(viewerState.markerCount, 'AC1-9(d): 描画マーカーは A の 1 件のみ').toBe(1);

      // 人間確認用の一時停止（MAPLAT_E2E_PAUSE=1 のときだけ有効。通常実行は有限時間で終了）
      if (process.env.MAPLAT_E2E_PAUSE === '1') {
        await page.pause();
      }
    } finally {
      await quitElectronApplication(app).catch(() => {});
    }
  });
});
