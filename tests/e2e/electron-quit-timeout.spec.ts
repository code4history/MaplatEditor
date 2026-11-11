import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { quitElectronApplication } from './helpers/electronLifecycle';

// #145: the quit helper must not turn a quit timeout into a test failure.
// This spec does not launch Electron. A plain Node child process stands in for the
// Electron main process, and a minimal fake application exposes only the two members
// the helper uses: process() and evaluate().

const SIGTERM_IGNORING_CHILD = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
const SELF_EXITING_CHILD = 'setTimeout(() => process.exit(0), 200)';
const LONG_RUNNING_CHILD = 'setInterval(() => {}, 1000)';

// Children spawned by the current test. afterEach reaps them, because Playwright
// skips the rest of a test body (including finally blocks) when the test times out.
const spawnedChildren = new Set<ChildProcess>();

async function spawnChild(script: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
  spawnedChildren.add(child);
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
  return child;
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

// Never leave a child behind, even when an assertion failed.
async function reapChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  child.kill('SIGKILL');
  await exited;
}

function fakeApp(
  child: ChildProcess,
  evaluate: () => Promise<void> = async () => {},
): ElectronApplication {
  return { process: () => child, evaluate } as unknown as ElectronApplication;
}

function captureWarnings(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(' '));
  };
  return { messages, restore: () => { console.warn = original; } };
}

test.describe('quitElectronApplication', () => {
  test.setTimeout(30_000);

  test.afterEach(async () => {
    const children = [...spawnedChildren];
    spawnedChildren.clear();
    await Promise.all(children.map((child) => reapChild(child)));
  });

  test('a child that does not quit is killed and the helper returns with a warning', async () => {
    // The fake evaluate() resolves without doing anything: it does not ask the child to quit,
    // and because it succeeds the helper does not send SIGTERM either. The child only stays
    // alive because of its setInterval, so this reproduces "did not exit in time", not
    // "the quit request was ignored". The SIGTERM handler is a guard against stray signals.
    const child = await spawnChild(SIGTERM_IGNORING_CHILD);
    const warnings = captureWarnings();
    try {
      const startedAt = Date.now();
      const promise = quitElectronApplication(fakeApp(child), { timeoutMs: 500 });
      await expect(promise).resolves.toBeUndefined();
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(child.signalCode).toBe('SIGKILL');
      expect(warnings.messages).toHaveLength(1);
      expect(warnings.messages[0]).toContain('did not exit within 500ms');
    } finally {
      warnings.restore();
      await reapChild(child);
    }
  });

  test('a child that exits on its own returns without waiting for the limit', async () => {
    const child = await spawnChild(SELF_EXITING_CHILD);
    const warnings = captureWarnings();
    try {
      const startedAt = Date.now();
      await quitElectronApplication(fakeApp(child), { timeoutMs: 10_000 });
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(child.exitCode).toBe(0);
      expect(warnings.messages).toHaveLength(0);
    } finally {
      warnings.restore();
      await reapChild(child);
    }
  });

  test('a child that has already exited returns immediately', async () => {
    const child = await spawnChild(SELF_EXITING_CHILD);
    await waitForExit(child);
    const warnings = captureWarnings();
    try {
      const startedAt = Date.now();
      await quitElectronApplication(fakeApp(child), { timeoutMs: 10_000 });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(child.exitCode).toBe(0);
      expect(child.signalCode).toBeNull();
      expect(warnings.messages).toHaveLength(0);
    } finally {
      warnings.restore();
      await reapChild(child);
    }
  });

  test('a failing evaluate() still ends the child with SIGTERM', async () => {
    const child = await spawnChild(LONG_RUNNING_CHILD);
    const warnings = captureWarnings();
    try {
      const app = fakeApp(child, async () => {
        throw new Error('no window');
      });
      await expect(quitElectronApplication(app)).resolves.toBeUndefined();
      expect(child.signalCode).toBe('SIGTERM');
      expect(warnings.messages).toHaveLength(0);
    } finally {
      warnings.restore();
      await reapChild(child);
    }
  });
});
