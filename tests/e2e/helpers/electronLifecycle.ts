import type { ElectronApplication } from '@playwright/test';

const QUIT_TIMEOUT_MS = 30_000;

/**
 * ElectronApplication.close() closes the Playwright connection, but MaplatEditor intentionally
 * turns a macOS window close into hide. Request a real application quit and wait for the child
 * process so a successful E2E cannot leave an orphaned Electron process behind.
 *
 * A quit timeout is cleaned up with SIGKILL and only reported as a warning; it does not change
 * the result of the test (#145).
 */
export async function quitElectronApplication(
  app: ElectronApplication,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? QUIT_TIMEOUT_MS;
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await app.evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.quit(), 0);
    });
  } catch {
    // firstWindow/evaluate失敗時にもcleanupを完遂する。
    child.kill('SIGTERM');
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Electron did not exit within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    child.kill('SIGKILL');
    await exited;
    console.warn(`Electron did not exit within ${timeoutMs}ms; sent SIGKILL and continued`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
