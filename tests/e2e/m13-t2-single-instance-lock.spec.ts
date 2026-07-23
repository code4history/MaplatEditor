import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

// M13-T2 (AC-T2-5/SI-6): app.requestSingleInstanceLock() は Electron ネイティブ API の挙動であり
// 実 Electron プロセスでしか検証できない。既存の m11-t7-slug-reservation-multi.spec.ts と同じ
// _electron launch ヘルパーを再利用するが、タスク設計 §8.1 の実測結果どおり、AC-T2-5 の検証には
// 両インスタンスが「同一 userData path」を共有する構成が必須(--user-data-dir を分離すると
// requestSingleInstanceLock() は userData path 単位でロックを取るため、両者が独立してロックを
// 取得できてしまい second-instance が発火しない)。

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

test('second Electron process sharing the same userData path is excluded by single-instance lock', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m13-t2-single-instance-'));
  // AC-T2-5/§8.1: 両インスタンスで同一の userData path を明示的に共有する(m11-t7-multi の
  // per-instance 分離パターンとは意図的に逆。分離するとロックスコープが分かれ検証にならない)
  const sharedUserDataDir = path.join(e2eRoot, 'shared-user-data');
  await mkdir(sharedUserDataDir, { recursive: true });

  let appA: ElectronApplication | null = null;
  let pageA: Page | null = null;
  let appB: ElectronApplication | null = null;
  let secondLaunchRejected = false;
  let secondLaunchRejectionMessage = '';

  try {
    // --- instance A: 通常起動、ロックを取得して window を開く ---
    appA = await electron.launch({
      args: [projectRoot, `--user-data-dir=${sharedUserDataDir}`],
      cwd: projectRoot,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
    });
    pageA = await appA.firstWindow();
    await pageA.waitForLoadState('domcontentloaded');
    // instance A が実際に起動しウィンドウを持つことを確認(基準点)
    await expect(pageA.locator('body')).toBeVisible();

    // --- instance B: instance A と同一 userData path で起動を試みる ---
    // タスク設計 §6.5/Info 6: second instance は requestSingleInstanceLock() が false を返し
    // app.quit() を whenReady 前に呼ぶため、window はおろか BrowserWindow すら作られない。
    // Playwright の _electron.launch() は CDP ハンドシェイクの完了を待つため、この場合は
    // reject または timeout する(手順として確定: 実装時に固定)。
    try {
      appB = await withTimeout(
        electron.launch({
          args: [projectRoot, `--user-data-dir=${sharedUserDataDir}`],
          cwd: projectRoot,
          env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
        }),
        20_000,
        'second instance launch',
      );
    } catch (error) {
      secondLaunchRejected = true;
      secondLaunchRejectionMessage = error instanceof Error ? error.message : String(error);
    }

    expect(
      secondLaunchRejected,
      `second instance launch should fail (reject/timeout) because requestSingleInstanceLock() ` +
        `causes it to quit before opening a window, but it resolved successfully instead`,
    ).toBe(true);
    expect(secondLaunchRejectionMessage.length).toBeGreaterThan(0);

    // instance A は排除された側ではないため、引き続き生存し応答できることを確認する
    // (single-instance lock が誤って両方を道連れにしていないことの確認)
    const saveFolderStillWorks = await pageA.evaluate(() => window.settings.get('saveFolder'));
    expect(typeof saveFolderStillWorks).toBe('string');
  } finally {
    if (appB) {
      // 万一 launch が例外を投げずに解決してしまった場合(想定外)でも後始末する
      await quitElectronApplication(appB).catch(() => {});
    }
    if (appA) {
      await quitElectronApplication(appA).catch(() => {});
    }
  }
});
