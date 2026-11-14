import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

// M13-T2 (AC-T2-5/SI-6): app.requestSingleInstanceLock() は Electron ネイティブ API の挙動であり
// 実 Electron プロセスでしか検証できない。AC-T2-5 の検証には両インスタンスが「同一 userData path」を
// 共有する構成が必須(--user-data-dir を分離すると requestSingleInstanceLock() は userData path
// 単位でロックを取るため、両者が独立してロックを取得できてしまい second-instance が発火しない)。
//
// 2 つ目のプロセスは Playwright の _electron.launch() ではなく、Electron の実行ファイルを直接
// spawn する。ロックを取れなかったプロセスは app.quit() を呼ぶが、Electron は message loop が
// 立つまで終了を待つので、その間に "DevTools listening" を出す。_electron.launch() はそこで
// CDP の接続を始めるため、終了との競争で「解決する」「reject する」「内部の
// Runtime.evaluate が session closed で未処理の reject になり試験そのものが落ちる」の
// どれにもなりうる(CI で後ろの 2 つを観測)。launch の成否ではなく、
// 「2 つ目が自分で終了すること」と「1 つ目に second-instance が届くこと」を状態として待つ。

const projectRoot = path.resolve(import.meta.dirname, '../..');
const electronExecutable = createRequire(import.meta.url)('electron') as string;
const SECOND_INSTANCE_EXIT_TIMEOUT_MS = 30_000;

type ExitResult = { code: number | null; signal: NodeJS.Signals | null; stderr: string };

function runSecondInstance(env: Record<string, string>, userDataDir: string): Promise<ExitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronExecutable, [projectRoot, `--user-data-dir=${userDataDir}`], {
      cwd: projectRoot,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `second instance did not exit within ${SECOND_INSTANCE_EXIT_TIMEOUT_MS}ms ` +
            `(single-instance lock did not make it quit)\n${stderr}`,
        ),
      );
    }, SECOND_INSTANCE_EXIT_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
}

test('second Electron process sharing the same userData path is excluded by single-instance lock', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m13-t2-single-instance-'));
  // AC-T2-5/§8.1: 両インスタンスで同一の userData path を明示的に共有する(m11-t7-multi の
  // per-instance 分離パターンとは意図的に逆。分離するとロックスコープが分かれ検証にならない)
  const sharedUserDataDir = path.join(e2eRoot, 'shared-user-data');
  await mkdir(sharedUserDataDir, { recursive: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env.VITE_DEV_SERVER_URL = '';
  env.MAPLAT_E2E_ROOT = e2eRoot;

  let appA: ElectronApplication | null = null;

  try {
    // --- instance A: 通常起動、ロックを取得して window を開く ---
    appA = await electron.launch({
      args: [projectRoot, `--user-data-dir=${sharedUserDataDir}`],
      cwd: projectRoot,
      env,
    });
    const pageA = await appA.firstWindow();
    await pageA.waitForLoadState('domcontentloaded');
    // instance A が実際に起動しウィンドウを持つことを確認(基準点)
    await expect(pageA.locator('body')).toBeVisible();

    // instance A に届く second-instance を数える(届いたこと = B がロックを取れず A に引き渡したこと)
    await appA.evaluate(({ app }) => {
      const g = globalThis as { __maplatSecondInstanceCount?: number };
      g.__maplatSecondInstanceCount = 0;
      app.on('second-instance', () => {
        g.__maplatSecondInstanceCount = (g.__maplatSecondInstanceCount ?? 0) + 1;
      });
    });

    // --- instance B: instance A と同一 userData path で起動し、自分で終了するのを待つ ---
    // タスク設計 §6.5/Info 6: B は requestSingleInstanceLock() が false を返して app.quit() するため
    // window を開かずに終了する。
    const result = await runSecondInstance(env, sharedUserDataDir);
    expect(
      result.signal,
      `second instance should exit by itself, not by a signal\n${result.stderr}`,
    ).toBeNull();
    expect(result.code, `second instance should quit normally\n${result.stderr}`).toBe(0);

    await expect
      .poll(
        () =>
          appA!.evaluate(
            () => (globalThis as { __maplatSecondInstanceCount?: number }).__maplatSecondInstanceCount ?? 0,
          ),
        { timeout: 10_000 },
      )
      .toBe(1);

    // instance A は排除された側ではないため、引き続き生存し応答できることを確認する
    // (single-instance lock が誤って両方を道連れにしていないことの確認)
    const saveFolderStillWorks = await pageA.evaluate(() => window.settings.get('saveFolder'));
    expect(typeof saveFolderStillWorks).toBe('string');
  } finally {
    if (appA) {
      await quitElectronApplication(appA).catch(() => {});
    }
  }
});
