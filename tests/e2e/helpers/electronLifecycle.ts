import type { ElectronApplication } from '@playwright/test';

const QUIT_TIMEOUT_MS = 30_000;

/**
 * ElectronApplication.close() closes the Playwright connection, but MaplatEditor intentionally
 * turns a macOS window close into hide. Request a real application quit and wait for the child
 * process so a successful E2E cannot leave an orphaned Electron process behind.
 */
export async function quitElectronApplication(app: ElectronApplication): Promise<void> {
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
          () => reject(new Error(`Electron did not exit within ${QUIT_TIMEOUT_MS}ms`)),
          QUIT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    child.kill('SIGKILL');
    await exited;
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
