// 「書誌だけ IIIF から」で取り込んだ地図の e2e。
//
// 配信できない info.json を指す Manifest のコマを選ぶと、取り込みのダイアログは
// 書誌だけを写して編集画面へ移る。そのとき開くのは地図の画像の選択で、
// 地図データの ZIP の選択ではない。画像を入れた後も写した書誌と IIIF の結び付きが
// 地図に残り、配信の印は付かない。保存して開き直しても同じであること。
//
// 取得は本物のネットワークに出さない。main の取得（Manifest・info.json）は
// `MAPLAT_E2E_ROOT` の応答の表で差し替える。画像の選択は main の
// `dialog.showOpenDialog` を差し替え、画像の拡張子で聞かれたときだけ手元の画像を返す
// （地図データの ZIP で聞かれたら取り消し、その事実を記録して試験で落とす）。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'iiif');

const MANIFEST_URL = 'https://dl.ndl.go.jp/api/iiif/948741/manifest.json';
const CANVAS_3_INFO_URL = 'https://dl.ndl.go.jp/api/iiif/948741/R0000003/info.json';

// 下地の地図に返す 1x1 の透明な PNG（外のタイルを取りに行かせない）
const TRANSPARENT_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function fixturePath(name: string): string {
  return path.join(fixtureDir, name);
}

// main の取得の口が読む応答の表を、e2e の根に置く。
// 3 コマ目の info.json は配信できない形（1 枚のタイルで全体を覆えない）にして、
// 「書誌だけ IIIF から」の判定へ倒す。
async function writeMainResponses(root: string): Promise<void> {
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
      file: fixturePath('no-region.info.json'),
    },
  };
  await writeFile(path.join(root, 'iiif-responses.json'), JSON.stringify(table), 'utf8');
}

// 画像の選択の差し替え。開いたダイアログの拡張子を記録し、
// 画像のときだけ手元の画像を返す（ZIP で聞かれたら取り消す）。
async function installOpenDialog(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selected) => {
    const g = globalThis as any;
    g.__e2eOpenDialogCalls = [];
    dialog.showOpenDialog = (async (...args: any[]) => {
      const options = (args[args.length - 1] ?? {}) as any;
      const extensions = ((options.filters ?? []) as Array<{ extensions?: string[] }>)
        .flatMap((filter) => filter.extensions ?? [])
        .map((entry) => String(entry).toLowerCase());
      const isImage = extensions.some((entry) => ['jpg', 'jpeg', 'png'].includes(entry));
      g.__e2eOpenDialogCalls.push({ extensions, canceled: !isImage });
      if (!isImage) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: [selected] };
    }) as typeof dialog.showOpenDialog;
  }, imagePath);
}

async function openDialogCalls(
  app: ElectronApplication,
): Promise<Array<{ extensions: string[]; canceled: boolean }>> {
  return app.evaluate(() => (globalThis as any).__e2eOpenDialogCalls ?? []);
}

// 保存のときの確認（対応点が足りない等）は「はい」で進める
async function stubMessageBox(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function openMapList(page: Page): Promise<void> {
  await page.evaluate(() => {
    location.hash = '#/maplist';
  });
  await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
}

// 画面の URL の query を読む（編集画面は hash の中に query を持つ）。
async function hashQuery(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const hash = location.hash;
    const index = hash.indexOf('?');
    return Object.fromEntries(new URLSearchParams(index >= 0 ? hash.slice(index + 1) : ''));
  });
}

// 下地の地図は外へ取りに行かせない
async function routeBaseMaps(page: Page): Promise<void> {
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

// 題名は言語の表でも素の文字列でも来るので、どちらでも比べられる形にする。
function titleText(title: unknown): string {
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object') return String((title as Record<string, string>).ja ?? '');
  return '';
}

test.describe('IIIF metadata only import', () => {
  test('書誌だけ取り込むと画像の選択が開き、写した書誌と結び付きが残って配信にはならない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-metadata-only-'));
    await writeMainResponses(e2eRoot);

    // 取り込む画像（地図の画像として選ぶ 1 枚）
    const imagePath = path.join(e2eRoot, 'metadata-only.png');
    const { Jimp } = await import('jimp');
    await new Jimp({ width: 400, height: 300, color: 0x3366ccff }).write(imagePath as `${string}.${string}`);

    let app: ElectronApplication | null = null;
    try {
      const launched = await launch(e2eRoot);
      app = launched.app;
      const page = launched.page;
      await stubMessageBox(app);
      await installOpenDialog(app, imagePath);
      await routeBaseMaps(page);
      await forceJapanese(page);
      await openMapList(page);

      // 取り込みのダイアログ: Manifest → 3 コマ目（配信できない info.json）→「書誌だけ IIIF から」
      await page.getByTestId('map-import-iiif').click();
      await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
      await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
      await page.getByTestId('iiif-import-inspect').click();
      await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
      await page.getByTestId('iiif-canvas-option').nth(2).click();
      await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('書誌だけ IIIF から');
      await page.getByTestId('iiif-metadata-only').click();

      // 編集画面へ移る。query は地図データの ZIP の取り込み（import=1）と分かれている
      await page.waitForFunction(() => location.hash.startsWith('#/mapedit'), undefined, { timeout: 60_000 });
      await expect.poll(() => hashQuery(page), { timeout: 30_000 }).toMatchObject({ new: '1' });
      const query = await hashQuery(page);
      expect(query.import).toBe('iiif-image');
      expect(query.draft).toBeTruthy();

      // 開いたのは画像の選択だけ。地図データの ZIP の選択は開かない
      await expect.poll(async () => (await openDialogCalls(app!)).length, { timeout: 60_000 }).toBeGreaterThan(0);
      const calls = await openDialogCalls(app);
      expect(calls.some((call) => call.extensions.includes('zip'))).toBe(false);
      expect(
        calls.some((call) => call.extensions.some((entry) => ['jpg', 'jpeg', 'png'].includes(entry))),
      ).toBe(true);

      // 画像が入り、写した書誌と IIIF の結び付きが地図に残る
      await page.waitForFunction(
        () => {
          const md = (window as any).testDebug?.mapData?.value;
          return !!md?.url_ && !!md?.iiif?.copiedAt;
        },
        undefined,
        { timeout: 120_000 },
      );
      const applied = await page.evaluate(() => {
        const md = (window as any).testDebug.mapData.value;
        return {
          title: md.title,
          url: md.url_,
          hasDelivery: Boolean(md.delivery),
          iiif: md.iiif,
        };
      });
      expect(applied.url).toBeTruthy();
      expect(applied.hasDelivery).toBe(false);
      expect(applied.iiif).toBeTruthy();
      expect(applied.iiif.manifest).toBe(MANIFEST_URL);
      expect(applied.iiif.bindings).toBeTruthy();
      expect(applied.iiif.copiedValues).toBeTruthy();
      expect(typeof applied.iiif.copiedAt).toBe('string');
      const copiedTitle = applied.iiif.copiedValues.title as Record<string, string>;
      expect(titleText(applied.title)).toBe(copiedTitle.ja);

      // 画像の取り込みの完了の知らせ（OK で閉じる）を閉じる。開いたままだとクリックが奪われる
      const progressModal = page.locator('.modal.d-block');
      await expect(progressModal).toContainText('正常に地図画像が登録できました。', { timeout: 120_000 });
      await progressModal.getByRole('button', { name: 'OK' }).click();
      await expect(progressModal).toHaveCount(0);

      // 保存する（新規の地図なので ID を入れる。題名は IIIF から写した値をそのまま残す）
      const slug = `iiif-metadata-only-${Date.now()}`;
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

      // 一覧に戻ると、その地図の行に「IIIF から配信」の印は無い
      await openMapList(page);
      await expect(page.locator(`[data-resource-uid="${savedUid}"]`)).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator(`[data-resource-uid="${savedUid}"] [data-testid="map-row-iiif-delivery"]`),
      ).toHaveCount(0);

      // 開き直す前に、前の編集画面が残した観測の口を消す（開き直した画面が作った値を読む）
      await page.evaluate(() => {
        delete (window as any).testDebug;
      });
      // 開き直しても、写した書誌と結び付きが残り、配信にはならない
      await page.evaluate((uid) => {
        location.hash = `#/mapedit?uid=${uid}`;
      }, savedUid);
      await page.waitForFunction(
        () => !!(window as any).testDebug?.mapData?.value?.iiif?.copiedAt,
        undefined,
        { timeout: 60_000 },
      );
      const reopened = await page.evaluate(() => {
        const md = (window as any).testDebug.mapData.value;
        return { uid: md.uid, title: md.title, hasDelivery: Boolean(md.delivery), iiif: md.iiif };
      });
      expect(reopened.uid).toBe(savedUid);
      expect(reopened.hasDelivery).toBe(false);
      expect(reopened.iiif.manifest).toBe(MANIFEST_URL);
      const reopenedCopiedTitle = reopened.iiif.copiedValues.title as Record<string, string>;
      expect(titleText(reopened.title)).toBe(reopenedCopiedTitle.ja);

      // 保存した地図の JSON にも、写した書誌と結び付きが残り、配信の記録は無い
      await quitElectronApplication(app);
      app = null;
      const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
      try {
        const row = db.prepare('SELECT data_json FROM maps WHERE slug = ?').get(slug) as
          | { data_json: string }
          | undefined;
        expect(row).toBeTruthy();
        const saved = JSON.parse(String(row!.data_json));
        expect(saved.delivery).toBeUndefined();
        expect(saved.iiif).toBeTruthy();
        expect(saved.iiif.manifest).toBe(MANIFEST_URL);
        expect(typeof saved.iiif.copiedAt).toBe('string');
        const savedCopiedTitle = saved.iiif.copiedValues.title as Record<string, string>;
        expect(titleText(saved.title)).toBe(savedCopiedTitle.ja);
      } finally {
        db.close();
      }
    } finally {
      if (app) await quitElectronApplication(app);
    }
  });
});
