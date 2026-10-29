// IIIF の取り込みのダイアログと、地図の一覧の印の e2e。
//
// 取得は本物のネットワークに出さない。`MAPLAT_E2E_ROOT` の下に応答の表
// (`iiif-responses.json`) を置き、main の取得の 3 つの口（名前解決・分類・要求）を
// その表から応答を作る偽物に差し替える（electron/services/iiifE2EResponses.ts）。
// 表の値は tests/fixtures/iiif の資料をそのまま返す。
//
// 表の URL は前方一致（末尾が `*` の行）も受ける。サムネイルの URL は実装が
// OpenLayers で組み立てるので、画像サービスの下の URL をまとめて JPEG にする。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'iiif');

const MANIFEST_URL = 'https://dl.ndl.go.jp/api/iiif/948741/manifest.json';
const CANVAS_3_INFO_URL = 'https://dl.ndl.go.jp/api/iiif/948741/R0000003/info.json';
const DIRECT_INFO_URL = 'https://iiif.example.test/http-service/info.json';
// 画面の言語ごとに label を持つ Manifest（独の label もある）
const LABELS_MANIFEST_URL = 'https://iiif.example.test/manifest/canvas-labels/manifest.json';
// 1 枚のタイルで全体を覆える段が無い info.json（配信はできるがサムネイルが作れない）
const NO_FULL_COVER_BASE = 'https://iiif.example.test/no-full-cover';
const NO_FULL_COVER_INFO_URL = `${NO_FULL_COVER_BASE}/info.json`;

// 下地の地図に返す 1x1 の透明な PNG（外のタイルを取りに行かせない）
const TRANSPARENT_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function fixturePath(name: string): string {
  return path.join(fixtureDir, name);
}

// 応答の表を e2e の根に書く。`*` で終わる URL は前方一致で使う。
async function writeResponses(root: string): Promise<void> {
  const table = {
    [MANIFEST_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      file: fixturePath('ndl-948741.manifest.json'),
    },
    [CANVAS_3_INFO_URL]: {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      file: fixturePath('ndl-948741-r3.info.json'),
    },
    [DIRECT_INFO_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      file: fixturePath('http-service.info.json'),
    },
    // 画像サービスの下のサムネイルの URL はまとめて JPEG を返す
    'https://dl.ndl.go.jp/api/iiif/948741/R0000003/*': {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      file: fixturePath('thumb-512.jpg'),
    },
    [LABELS_MANIFEST_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      file: fixturePath('canvas-label-languages.manifest.json'),
    },
    [NO_FULL_COVER_INFO_URL]: {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      file: fixturePath('no-full-cover.info.json'),
    },
  };
  await writeFile(path.join(root, 'iiif-responses.json'), JSON.stringify(table), 'utf8');
}

// 取り込みの預かりの下書き（サムネイルの置き場）の一覧
async function iiifDraftFolders(root: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(root, 'draft-tiles'), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('iiif-')).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function forceLanguage(page: Page, lang: string): Promise<void> {
  await page.evaluate((value) => window.settings.set('lang', value), lang);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function forceJapanese(page: Page): Promise<void> {
  await forceLanguage(page, 'ja');
}

async function openMapList(page: Page): Promise<void> {
  await page.evaluate(() => {
    location.hash = '#/maplist';
  });
  await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
}

// ダイアログの中に、その文を自分の文字として持つ要素がいくつあるかを数える。
// 同じ文が 2 か所に出ていないことの確認に使う（親と子で二重に数えない）。
async function textOccurrences(page: Page, rootSelector: string, needle: string): Promise<number> {
  return page.evaluate(
    ({ selector, text }) => {
      const root = document.querySelector(selector);
      if (!root) return 0;
      let count = 0;
      for (const element of Array.from(root.querySelectorAll('*'))) {
        const own = Array.from(element.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent ?? '')
          .join(' ')
          .trim();
        if (own.includes(text)) count += 1;
      }
      return count;
    },
    { selector: rootSelector, text: needle },
  );
}

// 画面全体で、その文を自分の文字として持つ要素を数える。
async function pageTextOccurrences(page: Page, needle: string): Promise<number> {
  return textOccurrences(page, 'body', needle);
}

// ネイティブのダイアログを差し替え、出した文を記録する（確認は「はい」で進める）。
async function installMessageBoxRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as any;
    g.__e2eMessageBoxMessages = [];
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = (args[args.length - 1] ?? {}) as any;
      g.__e2eMessageBoxMessages.push(String(options.message ?? ''));
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

async function messageBoxMessages(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as any).__e2eMessageBoxMessages ?? []);
}

// サムネイルを作れない info.json を配信で取り込んだ後、編集画面の側で警告が
// 何回見えるか（画面の文と、ネイティブのダイアログの文の合計）。
async function warningOccurrences(app: ElectronApplication, page: Page, warning: string): Promise<number> {
  const onPage = await pageTextOccurrences(page, warning);
  const messages = await messageBoxMessages(app);
  return onPage + messages.filter((message) => message.includes(warning)).length;
}

// renderer の取得を資料に差し替える（編集画面が info.json とタイルを取りに行く道）。
// 下地の地図もローカルの画像にして、外へ出ない。
async function routeNoFullCover(page: Page): Promise<void> {
  const infoJson = await readFile(fixturePath('no-full-cover.info.json'));
  const tileJpeg = await readFile(fixturePath('thumb-512.jpg'));
  await page.route(`${NO_FULL_COVER_BASE}/**`, async (route) => {
    const url = route.request().url();
    if (url.endsWith('/info.json')) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: infoJson,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*' },
      body: tileJpeg,
    });
  });
  for (const pattern of [
    '**/tile.openstreetmap.org/**',
    '**/cyberjapandata.gsi.go.jp/**',
    '**/t.tilemap.jp/**',
    '**/basemaps.cartocdn.com/**',
  ]) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_TILE }),
    );
  }
}

test.describe('IIIF import dialog', () => {
  test('Manifest から canvas を選び、取り込みの判定を出してやめると預かりが消える', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-import-dialog-'));
    await writeResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      await openMapList(page);

      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
      await page.getByTestId('iiif-import-inspect').click();

      // 3 コマ目（label が "3" の canvas）を選べる
      await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
      await page.getByTestId('iiif-canvas-option').nth(2).click();

      await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('IIIF から配信');
      await expect(page.getByTestId('iiif-verdict-detail')).toContainText('level 1');
      await expect(page.getByTestId('iiif-verdict-size')).toHaveText('4074 × 2705');

      await page.getByTestId('iiif-cancel').click();
      await expect(page.getByTestId('iiif-import-dialog')).toHaveCount(0);
      // やめると預かりが消える
      await expect.poll(() => iiifDraftFolders(e2eRoot)).toHaveLength(0);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('info.json の URL を直接入れると書誌だけの判定になる', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-info-direct-'));
    await writeResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      await openMapList(page);

      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill(DIRECT_INFO_URL);
      await page.getByTestId('iiif-import-inspect').click();

      // canvas の選択は飛ばし、判定と理由を 1 行で出す
      await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('書誌だけ IIIF から');
      await expect(page.getByTestId('iiif-verdict-reason')).toContainText('https');
      await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(0);

      await page.getByTestId('iiif-cancel').click();
      await expect(page.getByTestId('iiif-import-dialog')).toHaveCount(0);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('一覧の行に、IIIF から配信する地図の印が出る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-list-mark-'));
    await writeResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);

      const seeded = await page.evaluate(async () => {
        const base = {
          officialTitle: {},
          author: {},
          era: {},
          createdAt: {},
          contributor: {},
          mapper: {},
          attr: {},
          dataAttr: {},
          description: {},
          license: 'PD',
          dataLicense: 'CC BY-SA',
          reference: '',
          url: '',
          lang: 'ja',
          imageExtension: 'jpg',
          width: 4074,
          height: 2705,
          gcps: [],
          edges: [],
          sub_maps: [],
          strictMode: 'strict',
          vertexMode: 'plain',
          status: 'New',
        };
        const deliverySlug = `iiif-delivery-${Date.now()}`;
        const delivery = await window.mapedit.save({
          slug: deliverySlug,
          mapObject: {
            ...base,
            mapID: deliverySlug,
            title: { ja: 'IIIF 配信の地図' },
            delivery: { type: 'iiifImage', url: 'https://dl.ndl.go.jp/api/iiif/948741/R0000003' },
          },
          tins: [],
        });
        if (!delivery || delivery.result !== 'Success') throw new Error(`seed delivery map failed: ${JSON.stringify(delivery)}`);
        const plainSlug = `iiif-plain-${Date.now()}`;
        const plain = await window.mapedit.save({
          slug: plainSlug,
          mapObject: { ...base, mapID: plainSlug, title: { ja: 'ふつうの地図' } },
          tins: [],
        });
        if (!plain || plain.result !== 'Success') throw new Error(`seed plain map failed: ${JSON.stringify(plain)}`);
        return { deliveryUid: delivery.uid, plainUid: plain.uid };
      });

      await openMapList(page);
      const deliveryMark = page.locator(`[data-resource-uid="${seeded.deliveryUid}"] [data-testid="map-row-iiif-delivery"]`);
      await expect(deliveryMark).toBeVisible({ timeout: 30_000 });
      await expect(deliveryMark).toHaveText('IIIF から配信');
      await expect(page.locator(`[data-resource-uid="${seeded.plainUid}"] [data-testid="map-row-iiif-delivery"]`)).toHaveCount(0);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('取り込んだ地図に、最初に写した書誌と結び付きの記録が残る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-metadata-copy-'));
    await writeResponses(e2eRoot);
    let app: ElectronApplication | null = null;
    try {
      const launched = await launch(e2eRoot);
      app = launched.app;
      const page = launched.page;
      // 保存のときの確認（対応点が足りない等）は「はい」で進める
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      await forceJapanese(page);
      await openMapList(page);

      // 取り込みのダイアログ: Manifest → 3 コマ目 → 「IIIF から配信」
      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
      await page.getByTestId('iiif-import-inspect').click();
      await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
      await page.getByTestId('iiif-canvas-option').nth(2).click();
      await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('IIIF から配信');
      await page.getByTestId('iiif-deliverable').click();

      // 編集画面の地図のデータに、写した書誌と結び付きの記録が入っている
      await page.waitForFunction(
        () => !!(window as any).testDebug?.mapData?.value?.iiif?.copiedAt,
        undefined,
        { timeout: 60_000 },
      );
      const applied = await page.evaluate(() => {
        const md = (window as any).testDebug.mapData.value;
        return { title: md.title, attr: md.attr, iiif: md.iiif };
      });
      expect(applied.iiif.bindings).toBeTruthy();
      expect(applied.iiif.copiedValues).toBeTruthy();
      expect(Array.isArray(applied.iiif.copiedMetadata)).toBe(true);
      expect(applied.iiif.copiedMetadata.length).toBeGreaterThan(0);
      expect(typeof applied.iiif.copiedAt).toBe('string');
      // 地図の題名が、写した時点の題名の値と同じ文字列であること
      const copiedTitle = applied.iiif.copiedValues.title as Record<string, string>;
      const appliedTitle = typeof applied.title === 'string' ? applied.title : applied.title?.ja;
      expect(appliedTitle).toBe(copiedTitle.ja);

      // 保存する（新規の地図なので ID を入れる。題名は IIIF から写した値をそのまま残す）
      const slug = `iiif-metadata-${Date.now()}`;
      await page.getByRole('tab', { name: 'メタデータ編集' }).click();
      await page.getByTestId('map-slug').fill(slug);
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('editor-save').click();
      await page.waitForFunction(
        () => !!(window as any).testDebug?.mapData?.value?.uid,
        undefined,
        { timeout: 60_000 },
      );
      const savedUid = await page.evaluate(() => (window as any).testDebug.mapData.value.uid as string);
      expect(savedUid).toBeTruthy();
      const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));

      // 保存のフォルダの地図の JSON を読み、写した書誌が残っていることを確かめる
      await quitElectronApplication(app);
      app = null;
      const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
      try {
        const row = db.prepare('SELECT data_json FROM maps WHERE slug = ?').get(slug) as
          | { data_json: string }
          | undefined;
        expect(row).toBeTruthy();
        const saved = JSON.parse(String(row!.data_json));
        expect(saved.iiif).toBeTruthy();
        expect(saved.iiif.bindings).toBeTruthy();
        // 既定の結び付きは、この Manifest にある項目だけ（題名・帰属・ライセンス）
        expect(Object.keys(saved.iiif.bindings).sort()).toEqual(['attr', 'license', 'title']);
        expect(saved.iiif.copiedValues).toBeTruthy();
        expect(Array.isArray(saved.iiif.copiedMetadata)).toBe(true);
        expect(saved.iiif.copiedMetadata.length).toBeGreaterThan(0);
        expect(typeof saved.iiif.copiedAt).toBe('string');
        // 保存した地図の題名も、写した時点の題名の値と同じ文字列であること
        const copiedTitle = saved.iiif.copiedValues.title as Record<string, string>;
        const savedTitle = typeof saved.title === 'string' ? saved.title : saved.title?.ja;
        expect(savedTitle).toBe(copiedTitle.ja);
      } finally {
        db.close();
      }
    } finally {
      if (app) await quitElectronApplication(app);
    }
  });

  test('取得できない URL では、理由が 1 回だけ出て「書誌だけ」を選べない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-import-failure-'));
    await writeResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      await openMapList(page);

      // https でない URL は取得そのものが失敗する
      const reason = 'https でない URL のため配信できません。';
      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill('http://iiif.example.test/http-service/info.json');
      await page.getByTestId('iiif-import-inspect').click();

      // 同じ理由が赤い行と判定の欄に 2 回出ない（ダイアログの中で 1 回だけ）
      await expect
        .poll(() => textOccurrences(page, '[data-testid="iiif-import-dialog"]', reason), { timeout: 30_000 })
        .toBe(1);
      // 読めていない Manifest・info.json では「書誌だけ IIIF から」を選べない
      await expect(page.getByTestId('iiif-metadata-only')).toHaveCount(0);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('画面の言語が日本語・英語以外でも、コマの一覧はその言語の label で出る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-canvas-labels-'));
    await writeResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      // 独（独の label を持つ Manifest を読む）
      await forceLanguage(page, 'de');
      await openMapList(page);

      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill(LABELS_MANIFEST_URL);
      await page.getByTestId('iiif-import-inspect').click();

      await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(2);
      await expect(page.getByTestId('iiif-canvas-option').nth(0)).toHaveText('Blatt 1');
      await expect(page.getByTestId('iiif-canvas-option').nth(1)).toHaveText('Blatt 2');

      await page.getByTestId('iiif-cancel').click();
      await expect(page.getByTestId('iiif-import-dialog')).toHaveCount(0);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('サムネイルを作れない IIIF を配信で取り込むと、編集画面で警告が 1 回だけ出る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-thumbnail-warning-'));
    await writeResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await installMessageBoxRecorder(app);
      await routeNoFullCover(page);
      await forceJapanese(page);
      await openMapList(page);

      // 1 枚のタイルで全体を覆えない info.json を「IIIF から配信」で取り込む
      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill(NO_FULL_COVER_INFO_URL);
      await page.getByTestId('iiif-import-inspect').click();
      await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('IIIF から配信');
      await page.getByTestId('iiif-deliverable').click();

      // 編集画面に入り、地図に配信先が入る
      await page.waitForFunction(() => location.hash.startsWith('#/mapedit'), undefined, { timeout: 60_000 });
      await page.waitForFunction(
        () => !!(window as any).testDebug?.mapData?.value?.delivery,
        undefined,
        { timeout: 60_000 },
      );

      // サムネイルを作れなかったことが、画面かネイティブのダイアログに 1 回だけ出る
      const warning = 'この画像サービスではサムネイルを作れませんでした。取り込みは続けます。';
      await expect.poll(() => warningOccurrences(app, page, warning), { timeout: 60_000 }).toBe(1);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
