// 保存先フォルダの DB を開けないとき、地図一覧が理由（権限が無い／読み取り専用の場所／
// 場所が無い）と直し方を示すことの E2E。権限の無い一時フォルダ（chmod 000）・存在しない
// パス・読み取り専用でつないだディスクイメージ（macOS だけ）を保存先にして、一覧の画面を撮る。
// 実データ（書類フォルダの DB 等）は開かない。ディスクイメージは必ず外して消す。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { takeScreenshot } from './helpers/screenshot';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const evidenceDir = path.join(projectRoot, '.tmp-evidence');
const evidenceTag = process.env.MAPLAT_E2E_EVIDENCE_TAG ?? 'run';
const execFileAsync = promisify(execFile);

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function openMapList(page: Page): Promise<void> {
  await page.evaluate(() => { location.hash = '#/maplist'; });
  await expect(page.locator('[data-resource-list="map"]')).toBeVisible({ timeout: 30_000 });
}

async function expectDbOpenFailure(
  page: Page,
  reasonText: string,
  fixFragments: string[],
  shotName: string,
): Promise<void> {
  await expect(page.locator('[data-resource-status]')).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
  // 証拠の画面写真は、判定の前に撮る（直す前でも同じ画面が残るようにする）
  await takeScreenshot(page, path.join(evidenceDir, `db-open-reason-${evidenceTag}-${shotName}.png`));
  await expect(page.locator('[data-resource-status]')).toContainText('読み込みに失敗しました');
  await expect(page.locator('[data-load-failure-reason]')).toHaveText(reasonText);
  const fix = page.locator('[data-load-failure-fix]');
  for (const fragment of fixFragments) await expect(fix).toContainText(fragment);
}

test.describe('保存先フォルダが開けないときの地図一覧', () => {
  test('理由と直し方を示す', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-db-open-reason-'));
    const lockedFolder = path.join(e2eRoot, 'locked-store');
    const goneLink = path.join(e2eRoot, 'gone-link');
    await mkdir(lockedFolder, { recursive: true });
    await mkdir(evidenceDir, { recursive: true });
    await symlink(path.join(e2eRoot, 'gone-target'), goneLink);
    await chmod(lockedFolder, 0o000);
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      await openMapList(page);
      await expect(page.locator('[data-resource-status]')).not.toHaveAttribute('data-state', 'error');

      // 直し方の文言を OS ごとに選ぶため、preload が OS の種類を渡していること
      expect(await page.evaluate(() => window.runtimeInfo?.platform)).toBe(process.platform);

      // 権限の無い一時フォルダを保存先にする（chmod 000）。直し方はこの OS の言い方になる
      const permissionFix: Record<string, string> = {
        darwin: 'システム設定で',
        win32: 'Windows セキュリティ',
      };
      await page.evaluate((folder) => window.settings.set('saveFolder', folder), lockedFolder);
      await expectDbOpenFailure(
        page,
        'データフォルダを開く権限がありません',
        [permissionFix[process.platform] ?? '書き込みの権限', '設定でデータフォルダを変えてください'],
        'permission',
      );

      // 存在しないパスを保存先にする
      await page.evaluate((folder) => window.settings.set('saveFolder', folder), goneLink);
      await expectDbOpenFailure(
        page,
        'データフォルダが見つかりません',
        ['設定でデータフォルダを指定し直してください'],
        'not-found',
      );

      // 読み取り専用でつないだディスクイメージを保存先にする（hdiutil のある macOS だけ）。
      // 権限を足しても直らないので、許可の場所を案内せず、書き込める場所へ変えることだけを示す
      if (process.platform === 'darwin') {
        const imageSrc = path.join(e2eRoot, 'ro-image-src');
        const imageFile = path.join(e2eRoot, 'ro-image.dmg');
        const mountPoint = path.join(e2eRoot, 'ro-image-mnt');
        await mkdir(imageSrc, { recursive: true });
        await writeFile(path.join(imageSrc, 'README.txt'), 'read-only test image\n');
        await mkdir(mountPoint, { recursive: true });
        await execFileAsync('hdiutil', ['create', '-quiet', '-srcfolder', imageSrc, '-format', 'UDRO', '-volname', 'maplat-ro-e2e', '-ov', imageFile]);
        let attached = false;
        try {
          await execFileAsync('hdiutil', ['attach', '-quiet', '-readonly', '-nobrowse', '-mountpoint', mountPoint, imageFile]);
          attached = true;
          await page.evaluate((folder) => window.settings.set('saveFolder', folder), mountPoint);
          await expectDbOpenFailure(
            page,
            'データフォルダが読み取り専用の場所にあります',
            ['この場所は読み取り専用です', '設定でデータフォルダを書き込める場所へ変えてください'],
            'readonly-location',
          );
          const fixText = await page.locator('[data-load-failure-fix]').textContent();
          expect(fixText).not.toMatch(/システム設定|権限|許可/);
        } finally {
          // DB を手放してから外す（外す前に保存先を一時フォルダへ戻す）
          await page.evaluate((folder) => window.settings.set('saveFolder', folder), goneLink).catch(() => undefined);
          if (attached) await execFileAsync('hdiutil', ['detach', '-quiet', '-force', mountPoint]).catch(() => undefined);
          await rm(imageFile, { force: true });
        }
      }
    } finally {
      await quitElectronApplication(app);
      await chmod(lockedFolder, 0o700).catch(() => undefined);
      await rm(e2eRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
