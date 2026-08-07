// m6-t10: 差分保持ストレージモデル（ADR-0017 / ADR-0018）の E2E。
//
//   AC12: 未上書きフィールドの入力欄は空で、placeholder にマスタの実効値が出る。
//         上書きすると解除ボタンが現れ、押すとマスタ値（＝空欄+placeholder）へ戻る
//   AC13: builtin（osm）にも tms と同一の編集フォームが出る。加えて builtin への上書きが
//         **実際に viewer へ届く**（ADR-0017 で文字列のみ指定をやめた効果の本丸）
//   AC14: url の入力欄は全種別で出ない（§3.3）。代わりに「マスタで管理する」注記が出る
//   AC25: label の操作子は AppSourceEditor 側にあり、**上書きが無くても表示される**。
//         上書き可能フィールドはすべて data-testid="app-source-override-<key>" を持つ
//
// 設計 `docs/superpowers/specs/2026-08-07-m6-t10-app-source-diff-model-design.md` §6 準拠。
//
// NOTE (AC26 との順序): 本 spec の AC13 は出荷バンドル（public/preview 経由の
// maplat_ui.umd.js）で走る。MaplatCore の label マージ修正（§3.5.2）が伝搬鎖の全ホップへ
// 到達していることは `pnpm run smoke:m6-t10-preview-bundle-guard` が固定する。src だけ直して
// dist を再生成し忘れると、ここは旧バンドルで通ってしまう。
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const OSM_TILE_FIXTURE_ROOT = path.resolve(import.meta.dirname, 'fixtures/osm-tiles');
const FAKE_TILE_PATH = path.resolve(import.meta.dirname, 'fixtures/fake-osm-tile.png');

// builtin_base_maps.json（ビルトインの正本）が持つ osm の実効値。
// 期待値をここへハードコードせず、カタログから読んで組み立てる（ハードコード禁止）。
async function osmCatalogEntry(): Promise<Record<string, any>> {
  const list = JSON.parse(await readFile(path.join(projectRoot, 'electron/builtin_base_maps.json'), 'utf8'));
  const entry = (Array.isArray(list) ? list : list.list).find((item: any) => String(item?.mapID) === 'osm');
  if (!entry) throw new Error('builtin_base_maps.json に osm が見つかりません');
  return entry;
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
  // 外部 OSM タイルをローカル fixture へ差し替える（m18-t1/t2/t5 と同一方式）
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

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next: string) => { location.hash = next; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function seedBaseMap(page: Page, slug: string, tms: Record<string, unknown>): Promise<string> {
  const result = await page.evaluate(
    async ({ slug: s, tms: t }) => await (window as any).baseMaps.saveUser({
      slug: s, create: true, uid: crypto.randomUUID(), tms: t,
    }),
    { slug, tms },
  );
  expect(result?.result, `seedBaseMap(${slug}) failed: ${JSON.stringify(result)}`).toBe('Success');
  return result.uid as string;
}

// AppEdit の既定言語（AppEdit.vue currentLang = 'ja'）に揃える
const masterTmsDoc = {
  lang: 'ja',
  kind: 'tms',
  maptype: null,
  url: 'https://example.com/{z}/{x}/{y}.png',
  title: { ja: 'マスタタイトル' },
  label: { ja: 'マスタラベル' },
  attr: { ja: '© マスタ帰属' },
  dataAttr: {},
  license: '',
  dataLicense: '',
  licenseNote: {},
  dataLicenseNote: {},
  minZoom: 3,
  maxZoom: 15,
  thumbnail: '',
  coverageLngLats: null,
};

// 新規アプリを立ち上げ、ソースタブでベースマップを1件選ぶところまで進める
async function newAppWithSource(page: Page, appSlug: string, masterSlug: string) {
  await openHash(page, '#/appedit');
  await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('app-id').fill(appSlug);
  await page.getByTestId('app-id').press('Tab');
  await page.getByTestId('app-title').fill('M6T10 App');
  await page.getByTestId('app-title').press('Tab');

  await page.getByTestId('app-sources-tab').click();
  await page.getByTestId('app-basemap-mode').click();
  await page.getByTestId('app-basemap-search').fill(masterSlug);
  await expect(page.getByTestId(`app-basemap-row-${masterSlug}`)).toBeVisible({ timeout: 30000 });
  await page.getByTestId(`app-basemap-row-${masterSlug}`).click();
  const card = page.getByTestId(`app-selected-source-${masterSlug}`);
  await expect(card).toBeVisible();
  return card;
}

test('m6-t10 AC12/AC14/AC25: 差分保持フォーム（プレースホルダ・解除ボタン・url 撤去・操作子の所在）', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t10-ui-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const tmsSlug = `m6t10-tms-${Date.now()}`;
    await seedBaseMap(page, tmsSlug, { ...masterTmsDoc });

    const card = await newAppWithSource(page, `m6t10-app-${Date.now()}`, tmsSlug);

    // ---- AC25: 上書き可能フィールドの操作子がすべて AppSourceEditor 側に存在する ----
    // role=base のため mercatorXShift / mercatorYShift は出ない（overlay 専用・§3.8）
    for (const key of ['label', 'title', 'attr', 'minZoom', 'maxZoom', 'thumbnail', 'envelopeLngLats']) {
      await expect(card.getByTestId(`app-source-override-${key}`), `AC25: ${key} の操作子が存在する`).toBeVisible();
    }
    // AC25 の本丸: label は**上書きが無くても**操作子が出る（旧実装は v-if="source.label" で消えていた）
    await expect(card.getByTestId('app-source-override-label')).toHaveValue('');

    // ---- AC12: 未上書き → 入力欄は空・placeholder にマスタの実効値 ----
    await expect(card.getByTestId('app-source-override-label')).toHaveAttribute('placeholder', 'マスタラベル');
    await expect(card.getByTestId('app-source-override-title')).toHaveValue('');
    await expect(card.getByTestId('app-source-override-title')).toHaveAttribute('placeholder', 'マスタタイトル');
    await expect(card.getByTestId('app-source-override-attr')).toHaveAttribute('placeholder', '© マスタ帰属');
    await expect(card.getByTestId('app-source-override-minZoom')).toHaveValue('');
    await expect(card.getByTestId('app-source-override-minZoom')).toHaveAttribute('placeholder', '3');
    await expect(card.getByTestId('app-source-override-maxZoom')).toHaveAttribute('placeholder', '15');
    // 未上書きのうちは解除ボタンが出ない
    await expect(card.getByTestId('app-source-reset-title')).toHaveCount(0);

    // ---- AC12: 上書きすると解除ボタンが出る → 押すとマスタ値へ戻る ----
    await card.getByTestId('app-source-override-title').fill('アプリ上書きタイトル');
    await expect(card.getByTestId('app-source-reset-title')).toBeVisible();
    await card.getByTestId('app-source-reset-title').click();
    await expect(card.getByTestId('app-source-override-title')).toHaveValue('');
    await expect(card.getByTestId('app-source-override-title')).toHaveAttribute('placeholder', 'マスタタイトル');
    await expect(card.getByTestId('app-source-reset-title')).toHaveCount(0);

    // 数値フィールドは空へ戻すこと自体が解除（§3.8-2）。マスタ値の placeholder が復活する
    await card.getByTestId('app-source-override-maxZoom').fill('12');
    await card.getByTestId('app-source-override-maxZoom').press('Tab');
    await expect(card.getByTestId('app-source-override-maxZoom')).toHaveValue('12');
    await card.getByTestId('app-source-override-maxZoom').fill('');
    await card.getByTestId('app-source-override-maxZoom').press('Tab');
    await expect(card.getByTestId('app-source-override-maxZoom')).toHaveValue('');
    await expect(card.getByTestId('app-source-override-maxZoom')).toHaveAttribute('placeholder', '15');

    // ---- AC14: url の入力欄は tms でも出ない。代わりに「マスタで管理する」注記が出る ----
    await expect(card.getByTestId('app-source-url-field'), 'AC14: url 入力欄は撤去済み').toHaveCount(0);
    await expect(card.getByTestId('app-source-url'), 'AC14: url 入力欄は撤去済み').toHaveCount(0);
    await expect(card.getByTestId('app-source-url-note'), 'AC14: マスタ管理の注記が出る').toBeVisible();

    // ---- overlay へ切り替えると、アプリ所有キー（mercator shift）の操作子が現れる ----
    await card.locator('select.form-select-sm').selectOption('overlay');
    await expect(card.getByTestId('app-source-override-mercatorXShift')).toBeVisible();
    await expect(card.getByTestId('app-source-override-mercatorYShift')).toBeVisible();

    // ---- AC13(UI 面): builtin osm にも tms と同一のフォームが出る ----
    await page.getByTestId('app-basemap-search').fill('osm');
    await expect(page.getByTestId('app-basemap-row-osm')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-basemap-row-osm').click();
    const osmCard = page.getByTestId('app-selected-source-osm');
    await expect(osmCard).toBeVisible();
    const osm = await osmCatalogEntry();
    for (const key of ['label', 'title', 'attr', 'minZoom', 'maxZoom', 'thumbnail', 'envelopeLngLats']) {
      await expect(osmCard.getByTestId(`app-source-override-${key}`), `AC13: builtin にも ${key} の操作子が出る`).toBeVisible();
    }
    await expect(osmCard.getByTestId('app-source-override-title')).toHaveAttribute('placeholder', String(osm.title.ja));
    await expect(osmCard.getByTestId('app-source-override-maxZoom')).toHaveAttribute('placeholder', String(osm.maxZoom));
    await expect(osmCard.getByTestId('app-source-url-field'), 'AC14: builtin でも url 入力欄は出ない').toHaveCount(0);
    await expect(osmCard.getByTestId('app-source-url-note')).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

test('m6-t10 AC13: builtin(osm) への上書きが配信 JSON と viewer の両方へ届く', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t10-viewer-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    // AppEdit の保存は main 側の確認ダイアログを挟む（m18-t2 と同一の stub）
    await app.evaluate(async ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });

    const osm = await osmCatalogEntry();
    const appSlug = `m6t10-viewer-${Date.now()}`;

    await openHash(page, '#/appedit');
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-id').fill(appSlug);
    await page.getByTestId('app-id').press('Tab');
    await page.getByTestId('app-title').fill('M6T10 Viewer App');
    await page.getByTestId('app-title').press('Tab');

    await page.getByTestId('app-sources-tab').click();
    await page.getByTestId('app-basemap-mode').click();
    await page.getByTestId('app-basemap-search').fill('osm');
    await expect(page.getByTestId('app-basemap-row-osm')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-basemap-row-osm').click();
    const osmCard = page.getByTestId('app-selected-source-osm');
    await expect(osmCard).toBeVisible();

    // builtin へ上書きを入れる（旧実装＝文字列のみ指定では、これが viewer へ一切届かなかった）
    await osmCard.getByTestId('app-source-override-title').fill('上書きタイトル');
    await osmCard.getByTestId('app-source-override-label').fill('上書きラベル');
    await osmCard.getByTestId('app-source-override-maxZoom').fill('17');
    await osmCard.getByTestId('app-source-override-maxZoom').press('Tab');

    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30000 });
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // ---- プレビューを開く ----
    await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
    await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60000 });
    const previewSrc = (await page.locator('iframe.preview-map').getAttribute('src'))!;
    const previewBase = previewSrc.replace(/\/$/, '');
    const token = previewSrc.match(/\/preview\/([^/]+)\//)![1];

    const fetchJson = async (url: string) => await page.evaluate(async (u: string) => {
      const resp = await fetch(u);
      if (!resp.ok) throw new Error(`fetch ${u} failed: ${resp.status}`);
      return await resp.json();
    }, url);

    // ---- (a) 配信アプリ JSON: ID 参照 + settingFile + 上書き分だけ（ADR-0017）----
    const appJson: any = await fetchJson(`${previewBase}/apps/${token}.json`);
    const element = appJson.sources.find((s: any) => s && typeof s === 'object' && s.mapID === 'osm');
    expect(element, 'AC13: osm ソースが**オブジェクト**として出る（文字列のみ指定は廃止）').toBeTruthy();
    expect(element.settingFile, 'AC13: 定義は maps/osm.json を指す').toBe('maps/osm.json');
    expect(element.maptype, 'AC13: maptype を出してはならない（source_ex.ts:126 が settingFile を読まなくなる）').toBeUndefined();
    expect(element.url, 'AC13: url はアプリ JSON に出ない（マスタ管理・§3.3）').toBeUndefined();
    expect(element.maxZoom, 'AC13: スカラー上書きが載る').toBe(17);
    expect(element.title?.ja, 'AC13: 言語別上書きは編集した言語だけ差し替わる').toBe('上書きタイトル');
    expect(element.title?.en, 'AC13: 未編集の言語はマスタ値が保たれる（§3.5.5 のキー単位全置換対策）').toBe(String(osm.title.en));
    expect(element.label?.ja).toBe('上書きラベル');

    // ---- (b) 設定ファイル: マスタの定義がそのまま出る ----
    const settingJson: any = await fetchJson(`${previewBase}/maps/osm.json`);
    expect(settingJson.maptype, 'AC13: 設定ファイル側が maptype を持つ').toBe('base');
    expect(settingJson.url, 'AC13: タイル URL はマスタ由来').toBe(String(osm.url));
    expect(settingJson.title?.ja, 'AC13: 設定ファイルはマスタ値のまま（上書きを焼き込まない）').toBe(String(osm.title.ja));
    expect(settingJson.maxZoom, 'AC13: 設定ファイルはマスタ値のまま').toBe(osm.maxZoom);

    // ---- (c) viewer 実体: マージ後の値がソースへ載っている ----
    const handle = await page.locator('iframe.preview-map').elementHandle();
    const frame = (await handle!.contentFrame()) as Frame;
    await frame.waitForFunction(() => !!(window as any).__maplatPreview?.core?.cacheHash?.osm, undefined, { timeout: 120_000 });
    const viewerState = await frame.evaluate(() => {
      const source: any = (window as any).__maplatPreview.core.cacheHash.osm;
      return {
        maxZoom: source.maxZoom,
        label: source.label,
        title: source.get('title'),
        attr: source.get('attr'),
      };
    });
    expect(viewerState.maxZoom, 'AC13: 上書きした maxZoom が viewer のソースへ届く').toBe(17);
    expect(viewerState.title?.ja, 'AC13: 上書きした title が viewer のソースへ届く').toBe('上書きタイトル');
    expect(viewerState.label?.ja, 'AC13: 上書きした label が viewer のソースへ届く').toBe('上書きラベル');
    // §3.5.2 の欠陥（label が undefined で潰れる）の回帰止め — 未上書きの言語がマスタ値のまま残ること
    expect(viewerState.label?.en, 'AC13: label が settingFile 側の値を undefined で潰さない').toBe(String(osm.label.en));
    expect(viewerState.attr?.ja, 'AC13: 未上書きの帰属はマスタ値が効く').toBe(String(osm.attr.ja));

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
