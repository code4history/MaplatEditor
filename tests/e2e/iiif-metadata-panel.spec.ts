// IIIF の書誌の確認の欄の e2e。
//
// 取得は本物のネットワークに出さない。main の取得（Manifest・info.json・サムネイル）は
// `MAPLAT_E2E_ROOT` の応答の表で差し替え、renderer の取得（Core が編集画面で info.json と
// タイルを取りに行く道）は Playwright の route で資料を返す。地図の下地（OSM・GSI）も
// ローカルの画像に差し替えて、外へ出ない。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'iiif');

const MANIFEST_URL = 'https://dl.ndl.go.jp/api/iiif/948741/manifest.json';
const CANVAS_3_SERVICE_URL = 'https://dl.ndl.go.jp/api/iiif/948741/R0000003';
const CANVAS_3_INFO_URL = `${CANVAS_3_SERVICE_URL}/info.json`;
const CANVAS_3_FOLDER = `${CANVAS_3_SERVICE_URL}/`;

// 資料の Manifest の帰属を、試験の中で作った写しだけ変える（資料のファイルは変えない）
const EDITED_ATTRIBUTION = '試験で変えた帰属';

// 帰属の欄を手で別の値にするときの文字（「IIIF から写す」で Manifest の帰属に戻ることを見る）
const MANUAL_ATTRIBUTION = '手で入れた帰属';

// 下地の地図に返す 1x1 の透明な PNG（外のタイルを取りに行かせない）
const TRANSPARENT_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function fixturePath(name: string): string {
  return path.join(fixtureDir, name);
}

type ManifestFixture = {
  metadata?: Array<{ label?: unknown; value?: unknown; [key: string]: unknown }>;
  [key: string]: unknown;
};

async function readManifestFixture(): Promise<ManifestFixture> {
  return JSON.parse(await readFile(fixturePath('ndl-948741.manifest.json'), 'utf8')) as ManifestFixture;
}

// main の取得の口（名前解決・分類・要求）が読む応答の表を、e2e の根に置く。
// 表は要求のたびに読み直されるので、試験の途中で書き換えれば別の Manifest を返せる。
async function writeMainResponses(
  root: string,
  manifestFile: string = fixturePath('ndl-948741.manifest.json'),
): Promise<void> {
  const table: Record<string, unknown> = {
    [CANVAS_3_INFO_URL]: {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      file: fixturePath('ndl-948741-r3.info.json'),
    },
    // 取り込みのサムネイル 2 種は画像サービスの下の URL で来る
    [`${CANVAS_3_FOLDER}*`]: {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      file: fixturePath('thumb-512.jpg'),
    },
  };
  if (manifestFile !== '') {
    table[MANIFEST_URL] = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      file: manifestFile,
    };
  }
  await writeFile(path.join(root, 'iiif-responses.json'), JSON.stringify(table), 'utf8');
}

// renderer の取得を資料に差し替える。編集画面が info.json とタイルを取りに行く道が対象。
async function routeRendererRequests(page: Page): Promise<void> {
  const infoJson = await readFile(fixturePath('ndl-948741-r3.info.json'));
  const tileJpeg = await readFile(fixturePath('thumb-512.jpg'));

  await page.route(`${CANVAS_3_SERVICE_URL}/**`, async (route) => {
    const url = route.request().url();
    if (url === CANVAS_3_INFO_URL) {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
        body: infoJson,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'access-control-allow-origin': '*',
      },
      body: tileJpeg,
    });
  });

  // 下地の地図は外へ取りに行かせない
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

async function stubDialogOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

// 取り込みのダイアログから NDL の Manifest の 3 コマ目を「IIIF から配信」で開く。
async function importCanvas3(page: Page): Promise<void> {
  await page.getByTestId('map-import-iiif').click();
  await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
  await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
  await page.getByTestId('iiif-import-inspect').click();
  await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
  await page.getByTestId('iiif-canvas-option').nth(2).click();
  await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('IIIF から配信');
  await page.getByTestId('iiif-deliverable').click();
  await page.waitForFunction(
    () => !!(window as any).testDebug?.mapData?.value?.delivery,
    undefined,
    { timeout: 60_000 },
  );
}

async function openMetadataTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'メタデータ編集' }).click();
}

// 保存して、上の帯が「保存済み」になるまで待つ（他の編集画面の e2e と同じ形）。
async function saveNow(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60_000 });
}

// 保存が通って地図の uid が決まるまで待ち、その uid を返す（保存済みの文書を読み戻すのに使う）。
async function savedUid(page: Page): Promise<string> {
  await page.waitForFunction(
    () => !!(window as any).testDebug?.mapData?.value?.uid,
    undefined,
    { timeout: 60_000 },
  );
  return await page.evaluate(() => (window as any).testDebug.mapData.value.uid as string);
}

// 保存済みの地図の文書を保存の口から読み戻す（画面の値ではなく、保存した中身を見る）。
async function savedMap(page: Page, uid: string): Promise<any> {
  return await page.evaluate(async (target: string) => await window.mapedit.request(target), uid);
}

test.describe('IIIF metadata panel', () => {
  test('IIIF の書誌の確認の欄が全件を別の見出しで出し、写し直しの成否でも表示が正しい', async () => {
    // 保存を何度かはさむので、待ちの上限を広げる。
    test.setTimeout(420_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-iiif-metadata-panel-'));
    const manifest = await readManifestFixture();
    const metadataCount = Array.isArray(manifest.metadata) ? manifest.metadata.length : 0;
    expect(metadataCount).toBeGreaterThan(0);
    // 帰属の欄が「IIIF から写す」で戻る先（Manifest の attribution）
    const manifestAttribution = typeof manifest.attribution === 'string' ? manifest.attribution : '';
    expect(manifestAttribution.length).toBeGreaterThan(0);

    // 試験の中で作る「帰属を変えた Manifest の写し」。資料のファイルは変えない。
    const editedManifest = JSON.parse(JSON.stringify(manifest)) as ManifestFixture;
    editedManifest.attribution = EDITED_ATTRIBUTION;
    const editedManifestFile = path.join(e2eRoot, 'edited-manifest.json');
    await writeFile(editedManifestFile, JSON.stringify(editedManifest), 'utf8');

    await writeMainResponses(e2eRoot);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await stubDialogOk(app);
      await routeRendererRequests(page);
      await forceJapanese(page);
      await openMapList(page);
      await importCanvas3(page);
      await openMetadataTab(page);

      // (a) 確認の欄が出て、Manifest の書誌が資料の全件そろっている。
      // 直す前のコードには欄そのものが無いので、この最初の assert で落ちる。
      const table = page.getByTestId('iiif-metadata-table');
      await expect(table).toBeVisible({ timeout: 30_000 });
      const manifestSection = page.getByTestId('iiif-metadata-manifest');
      await expect(manifestSection).toContainText('Manifest の書誌');
      const manifestRows = manifestSection.getByTestId('iiif-metadata-row');
      await expect(manifestRows).toHaveCount(metadataCount);
      // 項目名も値も、資料のとおりの文字で出る（HTML の印を画面に出さない）
      const titleRow = manifestRows.filter({ hasText: '新潟市圖' });
      await expect(titleRow).toHaveCount(1);
      await expect(titleRow).toContainText('Title');
      // この Manifest のコマには書誌が無いので、このコマの見出しには「項目がありません」が出る。
      // 行が 0 件でも見出しの区画は出る、という所を直す前のコードと区別する。
      const canvasSection = page.getByTestId('iiif-metadata-canvas');
      await expect(canvasSection).toContainText('このコマの書誌');
      await expect(canvasSection).toContainText('項目がありません');
      await expect(canvasSection.getByTestId('iiif-metadata-row')).toHaveCount(0);
      // 1.0.0 で廃止した属性の欄は、結び付けの一覧に出さない。
      // 直す前のコードでは鍵の名前のまま欄が出るので、この assert で落ちる。
      await expect(page.getByTestId('iiif-binding-officialTitle')).toHaveCount(0);

      // 取り込んだだけでは何も保存していない。まず 1 度保存して、保存済みを基準にする。
      // 新規の地図なので ID を入れ、題名と帰属は IIIF から写した値のまま保存する。
      await page.getByTestId('map-slug').fill(`iiif-metadata-panel-${Date.now()}`);
      await saveNow(page);
      const mapUid = await savedUid(page);

      // (a2) 「IIIF から写す」: 手で別の値にした帰属が Manifest の帰属に戻り、写しただけでは保存しない。
      // 取り込んだ直後の値のままだと写しても変わらない（変わらなければ未保存にもならない）ので、
      // 先に手で別の値にして保存し、「保存済み」を基準に戻しておく。
      await page.getByTestId('map-attr').fill(MANUAL_ATTRIBUTION);
      await saveNow(page);
      await page.getByTestId('iiif-copy').click();
      // 写し終わりは、写した値（Manifest の帰属）が欄に出たことで見る。
      await expect(page.getByTestId('map-attr')).toHaveValue(manifestAttribution, { timeout: 30_000 });
      // 直す前（写した結果をそのまま保存する実装）では帯が「保存済み」のままなので、この assert で落ちる。
      await expect(page.getByTestId('editor-save-state')).toHaveText(/未保存/, { timeout: 30_000 });
      await saveNow(page);

      // (b) 写し直し: 題名を手で直し、Manifest を帰属だけ変えた写しに差し替えてから写し直す。
      const editedTitle = '手で直した題名';
      await page.getByTestId('map-title').fill(editedTitle);
      // 題名を手で直しただけでも未保存になるので、ここで保存して「保存済み」を基準に戻す。
      // 保存せずに写し直すと、上書きが即保存する実装でも「未保存」になり、見分けられない。
      await saveNow(page);
      await writeMainResponses(e2eRoot, editedManifestFile);
      await page.getByTestId('iiif-recopy').click();

      const titleRecopyRow = page.getByTestId('iiif-recopy-row-title-ja');
      await expect(titleRecopyRow).toBeVisible({ timeout: 60_000 });
      // 題名の行は「人が直した」。直す前のコードではこの行の理由が違う（IIIF の側が変わった扱いになる）。
      await expect(titleRecopyRow).toContainText('人が直した');
      // 帰属の行は「IIIF の側が変わった」。直す前のコードでは写し直しの一覧自体が出ない。
      const attrRecopyRow = page.getByTestId('iiif-recopy-row-attr-ja');
      await expect(attrRecopyRow).toContainText('IIIF の側が変わった');
      // 既定のチェックは「IIIF の側が変わった」行（帰属）だけ。題名は選ばれていない。
      await expect(page.getByTestId('iiif-recopy-pick-attr-ja')).toBeChecked();
      await expect(page.getByTestId('iiif-recopy-pick-title-ja')).not.toBeChecked();

      // 上書きの直前に、保存済みの文書を控えておく（上書きで保存していないことを見る）。
      const savedBeforeApply = await savedMap(page, mapUid);
      await page.getByTestId('iiif-recopy-apply').click();
      // 題名は手で直した値のまま、帰属は新しい値になる。
      // 直す前のコードでは「選んだ行だけ上書き」が無く、題名も上書きされてここで落ちる。
      await expect(page.getByTestId('map-title')).toHaveValue(editedTitle);
      await expect(page.getByTestId('map-attr')).toHaveValue(EDITED_ATTRIBUTION);
      // 写し直しただけでは保存しないので、画面は「未保存」のまま。
      // 直す前（選んだ行の上書きをそのまま保存する実装）では帯が「保存済み」になるので、この assert で落ちる。
      const saveState = page.getByTestId('editor-save-state');
      await expect(saveState).toBeVisible({ timeout: 30_000 });
      await expect(saveState).toHaveText(/未保存/);
      // 画面ではなく保存の口からも、上書きだけでは保存していないことを見る（保存済みの文書は変わらない）。
      // 直す前（上書きをそのまま保存する実装）では、この assert でも落ちる。
      const savedAfterApply = await savedMap(page, mapUid);
      expect(savedAfterApply.title, '保存済みの題名は変わらない').toEqual(savedBeforeApply.title);
      expect(savedAfterApply.attr, '保存済みの帰属は変わらない').toEqual(savedBeforeApply.attr);
      expect(savedAfterApply.iiif.copiedAt, '保存済みの写した日時は変わらない').toEqual(savedBeforeApply.iiif.copiedAt);

      // (c) 写し直しの失敗: 表から Manifest の行を消すと、取得に失敗する。
      await writeMainResponses(e2eRoot, '');
      await page.getByTestId('iiif-recopy').click();
      const error = page.getByTestId('iiif-recopy-error');
      await expect(error).toBeVisible({ timeout: 60_000 });
      // 代わりの手は「書誌の欄で手で直す」。取り込み直しは案内しない。
      // 直す前のコードでは失敗の案内が出ない（この assert で落ちる）。
      await expect(error).toContainText('書誌の欄で手で直してください');
      // 写し直しは配信の話ではないので、取り込みの判定の文（配信できません）を流用しない。
      // 直す前のコードではこの 2 つの assert で落ちる。
      await expect(error).not.toContainText('配信');
      await expect(error).toContainText('Manifest を取得できませんでした');
      // 失敗したときは、題名も帰属も 1 つも変わらない。
      await expect(page.getByTestId('map-title')).toHaveValue(editedTitle);
      await expect(page.getByTestId('map-attr')).toHaveValue(EDITED_ATTRIBUTION);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
