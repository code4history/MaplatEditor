// The MCP server tab and the header indicator, end to end.
//
// WARNING for local runs: this spec writes to the system clipboard (the copy steps) and clears it. Save
// anything you need from your clipboard before running it.
//
// The native dialogs of the main process are replaced by a recorder that answers with a chosen button, so the
// test can check both "Cancel" and the confirming button. The token is read from the editor's own store file
// in the isolated test root (the renderer never receives it).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { MCP_FEATURE_ENABLED } from './helpers/mcpFeature';

test.skip(!MCP_FEATURE_ENABLED, 'the MCP server is hidden in this build');

const projectRoot = path.resolve(import.meta.dirname, '../..');
const CLIPBOARD_CLEAR_MS = 800;

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      MAPLAT_E2E_ROOT: e2eRoot,
      MAPLAT_E2E_MCP_CLIPBOARD_CLEAR_MS: String(CLIPBOARD_CLEAR_MS),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  await page.evaluate(() => window.settings.set('lang', 'en'));
  return { app, page };
}

/** Replaces dialog.showMessageBox in the main process; every call is recorded and answered with __mcpAnswer. */
async function recordDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as any;
    g.__mcpDialogs = [];
    g.__mcpAnswer = 1;
    (dialog as any).showMessageBox = async (...args: any[]) => {
      const options = args.length > 1 ? args[1] : args[0];
      g.__mcpDialogs.push({ defaultId: options.defaultId, cancelId: options.cancelId, buttons: options.buttons, message: options.message });
      return { response: g.__mcpAnswer, checkboxChecked: false };
    };
  });
}

const answerWith = (app: ElectronApplication, index: number) =>
  app.evaluate((_e, i) => {
    (globalThis as any).__mcpAnswer = i;
  }, index);
const lastDialog = (app: ElectronApplication) =>
  app.evaluate(() => {
    const calls = (globalThis as any).__mcpDialogs as any[];
    return { count: calls.length, last: calls[calls.length - 1] };
  });
const mainClipboard = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

async function readToken(e2eRoot: string): Promise<string> {
  const store = JSON.parse(await readFile(path.join(e2eRoot, 'electron-store', 'settings', 'mcp-server.json'), 'utf8'));
  return store.token;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function listTools(port: number, token: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

async function openMcpTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    location.hash = '#/settings';
  });
  await page.getByTestId('settings-mcp-tab').click();
  await expect(page.getByTestId('settings-mcp-status')).toBeVisible();
}

test('the MCP tab turns the server on and off, copies safely and survives a restart', async () => {
  test.setTimeout(240_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-mcp-settings-'));
  const port = await freePort();
  let { app, page } = await launch(e2eRoot);
  try {
    await recordDialogs(app);
    await openMcpTab(page);
    await expect(page.getByTestId('settings-mcp-status')).toContainText('Stopped');
    await expect(page.getByTestId('header-mcp-listening')).toHaveCount(0);
    // Off by default, and the notice about what may be sent is always on the tab
    await expect(page.getByTestId('settings-mcp-enabled')).not.toBeChecked();
    await expect(page.getByTestId('settings-mcp-external-notice')).toContainText('GCPs');

    // Use a free port so a real editor on the default port is never touched
    await page.getByTestId('settings-mcp-port').fill(String(port));
    await page.getByTestId('settings-mcp-port-save').click();
    await expect.poll(() => page.evaluate(() => window.mcp.getStatus().then((s) => s.port))).toBe(port);

    // Cancel keeps it off; both the default and the cancel button of the dialog are "Cancel"
    await answerWith(app, 1);
    await page.getByTestId('settings-mcp-enabled').click();
    await expect.poll(async () => (await lastDialog(app)).count).toBe(1);
    const enableDialog = (await lastDialog(app)).last;
    expect(enableDialog.defaultId).toBe(enableDialog.cancelId);
    expect(enableDialog.buttons[enableDialog.cancelId]).toBe('Cancel');
    await expect(page.getByTestId('settings-mcp-enabled')).not.toBeChecked();
    expect((await page.evaluate(() => window.mcp.getStatus())).listening).toBe(false);
    await expect(page.getByTestId('header-mcp-listening')).toHaveCount(0);

    // Confirming turns it on: the header shows it and a client can list the tools
    await answerWith(app, 0);
    await page.getByTestId('settings-mcp-enabled').click();
    await expect(page.getByTestId('header-mcp-listening')).toHaveText(`MCP 127.0.0.1:${port}`);
    await expect(page.getByTestId('settings-mcp-status')).toContainText(`Listening: 127.0.0.1:${port}`);
    const token = await readToken(e2eRoot);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(page.getByTestId('settings-mcp-token-tail')).toContainText(token.slice(-4));
    const tools = await listTools(port, token);
    expect(tools.status).toBe(200);
    expect(await tools.text()).toContain('editor.ping');
    // The whole token is not in the page
    expect(await page.locator('body').innerText()).not.toContain(token);

    // Copy, cancelled: nothing reaches the clipboard
    await app.evaluate(({ clipboard }) => clipboard.writeText('clipboard before the copy'));
    await answerWith(app, 1);
    expect(await page.evaluate(() => window.mcp.copyConnectionCommand('claude-code'))).toEqual({ copied: false });
    expect(await mainClipboard(app)).toBe('clipboard before the copy');

    // Copy, confirmed: the main process clipboard has the command, the renderer cannot read it back
    await answerWith(app, 0);
    expect(await page.evaluate(() => window.mcp.copyConnectionCommand('claude-code'))).toEqual({ copied: true });
    const copied = await mainClipboard(app);
    expect(copied.startsWith(`claude mcp add --transport http maplat-editor http://127.0.0.1:${port}/mcp --header "Authorization: Bearer `)).toBe(true);
    const rendererRead = await page.evaluate(async () => {
      const viaApi = await Promise.race([
        navigator.clipboard.readText().then((text) => `read:${text}`, (e) => `rejected:${e?.name ?? 'error'}`),
        new Promise<string>((resolve) => setTimeout(() => resolve('no answer'), 3000)),
      ]);
      const area = document.createElement('textarea');
      document.body.appendChild(area);
      area.focus();
      const pasted = document.execCommand('paste');
      const viaPaste = area.value;
      area.remove();
      return { viaApi, pasted, viaPaste };
    });
    expect(rendererRead.viaApi.startsWith('read:')).toBe(false);
    expect(rendererRead.viaPaste).toBe('');
    // ...and the command is cleared after the delay
    await expect.poll(() => mainClipboard(app), { timeout: CLIPBOARD_CLEAR_MS + 5000 }).not.toContain('Bearer');

    // Turning it off closes the port and hides the indicator
    await page.getByTestId('settings-mcp-enabled').click();
    await expect(page.getByTestId('header-mcp-listening')).toHaveCount(0);
    await expect(page.getByTestId('settings-mcp-status')).toContainText('Stopped');
    await expect(listTools(port, token)).rejects.toThrow();

    // A port taken by another program is reported, and the message goes away once the port is free
    const blocker = net.createServer((s) => s.destroy());
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', () => resolve()));
    await answerWith(app, 0);
    await page.getByTestId('settings-mcp-enabled').click();
    await expect(page.getByTestId('settings-mcp-port-in-use')).toBeVisible();
    expect((await page.evaluate(() => window.mcp.getStatus())).listening).toBe(false);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await page.getByTestId('settings-mcp-enabled').click();
    await expect(page.getByTestId('header-mcp-listening')).toBeVisible();
    await expect(page.getByTestId('settings-mcp-port-in-use')).toHaveCount(0);

    // macOS: closing the window only hides the app, and the server keeps listening
    if (process.platform === 'darwin') {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
      expect((await listTools(port, token)).status).toBe(200);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    }

    // After a restart it listens again (it was left on) with the same token
    await quitElectronApplication(app);
    ({ app, page } = await launch(e2eRoot));
    await expect.poll(() => page.evaluate(() => window.mcp.getStatus().then((s) => s.listening)), { timeout: 20_000 }).toBe(true);
    expect(await readToken(e2eRoot)).toBe(token);
    expect((await listTools(port, token)).status).toBe(200);
    await expect(page.getByTestId('header-mcp-listening')).toBeVisible();
  } finally {
    await quitElectronApplication(app);
  }
});
