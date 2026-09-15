// oct26-m4-t2s2: 更新前の版で作った未保存下書き（url_ が旧形）を復元したとき、**保存する前から**
// 対応点編集タブの左ペインにタイルが表示されること。
//
// 背景: 公開済み v1.0.0（2026-08-24）で画像を取り込み保存せず終了すると、hot-exit 下書き（electron-store）に mapData が
// 丸ごと残り、url_ は `file:///<userData>/draft-tiles/<uid>/{z}/{x}/{y}.<ext>` のまま復元される。m4-t2（#105）以降の
// renderer（app://bundle・webSecurity 有効）は file:// を読めないので、MapEdit.vue の exchangeTileSource が url_ を
// そのままタイル源に渡すと、保存するまで左ペインが真っ白になった（タイル 4 件すべて `Not allowed to load local resource`。
// 実装再レビュー IR2 §6.2・Minor-2）。真っ白を見て下書きを破棄すると staging ごと画像を失う。
// m4-t2 期（未公開ビルド）の旧 app://local も、同一 origin 化（t2ff 第 2 版）後は別 origin で同じく読めない。
//
// 是正（案 A）: renderer の displayTileUrl（src/utils/appUrl.ts）で、タイル源に渡すときだけ現行形
// app://bundle/__local/<abs> へ変換する。**url_ 自体は書き換えない**（保存時の正規化は main の t2s が担う）。
//
// AC（renderer の request 事象で、この下書きのタイル（/z/x/y.png）の読込を数える）:
//   - current（対照）・legacyFile（v1.0.0）・legacyAppLocal（m4-t2 期）の 3 形で、復元直後（保存前）に
//     200 の読込が 1 件以上・失敗 0 件・`Not allowed to load local resource` 0 件
//   - 保存前の mapData.url_ は旧形のまま（表示のために書き換えていない）
//   - legacyFile は保存 → 再起動 → 再オープンでもタイルが読め、下書きと staging は残らない
//   変更前（94ee275）の実測: legacyFile は 200×0・失敗 4（IR2 §6.2 と同じ）
//
// 一時 e2e（IR2 `evidence/oct26-m4-t2s/ir2-legacy-display.spec.ts.txt`）の昇格。下書きは実 UI で作り、envelope の url_ を
// 旧形に書き換える（下書きの保存形式は v1.0.0..94ee275 で差分が無い: IR2 §6.2）。旧形の符号化は file-url 4.0.0 と同じ
// encodeURI 系を spec 内で独立に書く（製品のビルダーを使わない）。e2eRoot には空白と非 ASCII を含める。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

type Launched = { app: ElectronApplication; page: Page; log: string[] };
type Variant = 'current' | 'legacyFile' | 'legacyAppLocal';

// v1.0.0 の file-url 4.0.0（POSIX の e2eRoot だけを扱う）
const fileUrlV1 = (abs: string): string => encodeURI(`file://${abs}`).replace(/[?#]/g, encodeURIComponent);
// m4-t2 期の app://local（セグメント単位 encodeURIComponent）
const appLocalUrl = (abs: string): string => `app://local${abs.split('/').map((s) => encodeURIComponent(s)).join('/')}`;

async function launch(e2eRoot: string): Promise<Launched> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  const log: string[] = [];
  page.on('console', (m) => log.push(`console.${m.type()}: ${m.text()}`));
  page.on('requestfinished', async (r) => {
    const res = await r.response().catch(() => null);
    log.push(`finished ${res?.status() ?? '?'} ${r.url()}`);
  });
  page.on('requestfailed', (r) => log.push(`failed ${r.failure()?.errorText} ${r.url()}`));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page, log };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function makeImage(p: string): Promise<void> {
  const { Jimp } = await import('jimp');
  await new Jimp({ width: 400, height: 300, color: 0xff0000ff }).write(p as `${string}.${string}`);
}

const exists = (p: string) => stat(p).then(() => true).catch(() => false);

// この下書き（needle を含む URL）のタイル読込（{z}/{x}/{y}.png の実 URL）を数える
function tileLoads(log: string[], needle: string) {
  const tile = (l: string) => l.includes(needle) && /\/\d+\/\d+\/\d+\.png/.test(l);
  return {
    ok200: log.filter((l) => l.startsWith('finished 200 ') && tile(l)).length,
    failed: log.filter((l) => l.startsWith('failed ') && tile(l)).length,
    notAllowed: log.filter((l) => l.includes('Not allowed to load local resource') && tile(l)).length,
  };
}

// 対応点編集タブを開き、タイル要求が出揃うまで待ってから数える
async function openGcpsTabAndCount(page: Page, log: string[], needle: string) {
  await page.getByTestId('map-tab-gcps').click({ timeout: 10_000 });
  await expect
    .poll(() => { const c = tileLoads(log, needle); return c.ok200 + c.failed + c.notAllowed; }, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(3_000);
  return tileLoads(log, needle);
}

const mapDataUrl = (page: Page) => page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_ as string | undefined);

for (const variant of ['current', 'legacyFile', 'legacyAppLocal'] as Variant[]) {
  test(`oct26-m4-t2s2: 復元した下書き（${variant}）の左ペインのタイルが保存前に読める`, async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), `oct26 t2s2 下書き-${variant}-`));
    const imagePath = path.join(e2eRoot, 'upload.png');
    await makeImage(imagePath);
    let launched: Launched | null = null;
    try {
      // --- 実 UI で画像を取り込み、下書きを作る ---
      launched = await launch(e2eRoot);
      {
        const { app, page } = launched;
        await openHash(page, '#/mapedit');
        await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('map-title').fill(`t2s2 ${variant}`);
        await page.getByTestId('map-slug').fill(`t2s2-${variant.toLowerCase()}-${Date.now()}`);
        await page.getByTestId('map-attr').fill('t2s2 copyright');
        await app.evaluate(async ({ dialog }, img) => {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [img] })) as typeof dialog.showOpenDialog;
        }, imagePath);
        await page.getByRole('button', { name: '地図画像登録' }).click();
        const ok = page.getByRole('button', { name: 'OK' });
        await expect(ok).toBeEnabled({ timeout: 60_000 });
        await ok.click();
      }
      const { page: page0 } = launched;
      const draftUid = await page0.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      expect(draftUid).toBeTruthy();
      const stagingDir = path.join(e2eRoot, 'draft-tiles', draftUid!);
      expect(await exists(stagingDir)).toBe(true);
      await page0.getByTestId('editor-back').click();
      await expect(page0.getByTestId('map-title')).toBeHidden();
      await expect.poll(() => page0.evaluate((u) => window.assetDrafts.get('map', u), draftUid), { timeout: 10_000 }).toBeTruthy();

      // --- envelope の url_ を旧形へ書き換える（更新前の版が残した下書きの代わり） ---
      const legacyUrl = variant === 'legacyFile'
        ? `${fileUrlV1(stagingDir)}/{z}/{x}/{y}.png`
        : variant === 'legacyAppLocal'
          ? `${appLocalUrl(stagingDir)}/{z}/{x}/{y}.png`
          : null;
      if (legacyUrl) {
        await page0.evaluate(async ({ uid, url_ }) => {
          const env = await window.assetDrafts.get('map', uid);
          const c = JSON.parse(JSON.stringify(env));
          c.payload.mapData.url_ = url_;
          c.updatedAt = new Date().toISOString();
          await window.assetDrafts.put(c);
        }, { uid: draftUid!, url_: legacyUrl });
        if (variant === 'legacyFile') expect(legacyUrl).toContain('oct26%20t2s2%20%E4%B8%8B%E6%9B%B8%E3%81%8D');
      }
      await quitElectronApplication(launched.app);
      launched = null;

      // --- 再起動して下書きを復元し、保存せずに対応点編集タブを開く ---
      launched = await launch(e2eRoot);
      {
        const { page, log } = launched;
        await openHash(page, `#/mapedit?draftUid=${draftUid}`);
        await expect(page.getByTestId('map-title')).toHaveValue(`t2s2 ${variant}`, { timeout: 20_000 });
        const beforeSave = await openGcpsTabAndCount(page, log, draftUid!);
        const restoredUrl = await mapDataUrl(page);
        console.log(`[${variant}] 保存前 url_=${restoredUrl}`);
        console.log(`[${variant}] 保存前 タイル読込=${JSON.stringify(beforeSave)}`);
        console.log(`[${variant}] 保存前 事象=${JSON.stringify(log.filter((l) => l.includes(draftUid!)).slice(0, 8))}`);
        if (legacyUrl) expect(restoredUrl, '表示のために url_ を書き換えない').toBe(legacyUrl);
        expect(beforeSave.notAllowed, '旧形の url_ をそのまま読んでいる（Not allowed to load local resource）').toBe(0);
        expect(beforeSave.failed, 'タイルの読込失敗').toBe(0);
        expect(beforeSave.ok200, '保存前に左ペインのタイルが 1 件も読めていない').toBeGreaterThan(0);
      }

      if (variant === 'legacyFile') {
        // --- 保存 → 恒久領域へ移動 → 表示 ---
        const { page } = launched;
        await page.getByTestId('editor-save').click();
        await expect.poll(() => page.evaluate(() => (window as any).testDebug?.mapData?.value?.uid), { timeout: 30_000 }).toBeTruthy();
        const savedUid = await page.evaluate(() => (window as any).testDebug?.mapData?.value?.uid as string);
        await expect.poll(() => mapDataUrl(page), { timeout: 10_000 }).toMatch(/^app:\/\/bundle\/__local\//);
        const saveFolder = path.join(e2eRoot, 'save-folder');
        expect(await exists(path.join(saveFolder, 'tiles', savedUid))).toBe(true);
        expect(await exists(path.join(saveFolder, 'originals', `${savedUid}.png`))).toBe(true);
        await quitElectronApplication(launched.app);
        launched = null;

        // --- 再起動 → 再オープン ---
        launched = await launch(e2eRoot);
        const { page: page2, log: log2 } = launched;
        await openHash(page2, `#/mapedit?uid=${savedUid}`);
        await expect(page2.getByTestId('map-title')).toHaveValue(`t2s2 ${variant}`, { timeout: 20_000 });
        const reopen = await openGcpsTabAndCount(page2, log2, `/tiles/${savedUid}/`);
        console.log(`[${variant}] 再オープン タイル読込=${JSON.stringify(reopen)}`);
        expect(reopen.failed).toBe(0);
        expect(reopen.ok200).toBeGreaterThan(0);
        expect(await page2.evaluate((u) => window.assetDrafts.get('map', u), draftUid)).toBeFalsy();
        expect(await exists(stagingDir)).toBe(false);
      }
    } finally {
      if (launched) await quitElectronApplication(launched.app);
    }
  });
}
