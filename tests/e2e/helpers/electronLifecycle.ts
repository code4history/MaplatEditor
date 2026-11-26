import type { ElectronApplication } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { evalMain } from './evalMain';

const QUIT_TIMEOUT_MS = 30_000;

/**
 * The child process behind a Playwright ElectronApplication, or null when Playwright has already
 * disposed the application object.
 *
 * Playwright disposes the object when the child emits 'close', that is after the process has
 * exited and its stdio has closed. From then on app.process() throws
 * "TypeError: Cannot read properties of undefined (reading '_object')" (Playwright 1.64).
 * Whether 'close' arrives in the same turn as 'exit' depends on when the helper processes let go
 * of the inherited stdio, so a test that waited for 'exit' may or may not still hold a live object.
 *
 * Only that TypeError means "disposed". Any other failure of process() is a problem in the harness
 * and is rethrown, so that a quit is never skipped silently. If a Playwright upgrade changes the
 * error, electron-helpers-exited-and-busy.spec.ts (real Electron) turns red and this must follow.
 */
function childProcessOf(app: ElectronApplication): ChildProcess | null {
  try {
    return app.process() ?? null;
  } catch (error) {
    if (isDisposedApplicationError(error)) return null;
    throw error;
  }
}

function isDisposedApplicationError(error: unknown): boolean {
  return error instanceof TypeError && /\(reading '_object'\)/.test(error.message);
}

/**
 * ElectronApplication.close() closes the Playwright connection, but MaplatEditor intentionally
 * turns a macOS window close into hide. Request a real application quit and wait for the child
 * process so a successful E2E cannot leave an orphaned Electron process behind.
 *
 * A quit timeout is cleaned up with SIGKILL and only reported as a warning; it does not change
 * the result of the test (#145). The warning line carries the fixed marker
 * `maplat-e2e-quit-timeout`, which scripts/ci/judge-test-results.mjs counts into the CI summary.
 *
 * An application that has already exited is left alone, including one whose object Playwright has
 * disposed (see childProcessOf). Tests in which the app quits by itself can therefore call this
 * helper in a finally block.
 */
export async function quitElectronApplication(
  app: ElectronApplication,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? QUIT_TIMEOUT_MS;
  const child = childProcessOf(app);
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await evalMain(app, ({ app: electronApp }) => {
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
    console.warn(`[maplat-e2e-quit-timeout] Electron did not exit within ${timeoutMs}ms; sent SIGKILL and continued`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
