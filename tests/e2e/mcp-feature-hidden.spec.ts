// The MCP server hidden as a whole (MCP_FEATURE_ENABLED = false): no settings tab, no header indicator, and
// turning it on through IPC is refused. Runs only when the flag is false; skipped otherwise.
import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { MCP_FEATURE_ENABLED } from './helpers/mcpFeature';

test.skip(MCP_FEATURE_ENABLED, 'the MCP server is shown; this spec checks the hidden state');

test('the hidden MCP server has no tab, no indicator and cannot be turned on', async () => {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-mcp-hidden-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await page.evaluate(() => {
      location.hash = '#/settings';
    });
    await expect(page.locator('#langSwitcher')).toBeVisible();
    await expect(page.getByTestId('settings-mcp-tab')).toHaveCount(0);
    await expect(page.getByTestId('header-mcp-listening')).toHaveCount(0);

    const result = await page.evaluate(async () => {
      try {
        await window.mcp.setEnabled(true);
        return 'resolved';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(result).toContain('feature disabled');
    // Nothing else acts either: copying (which would put a token on the clipboard), the port and the token
    const others = await page.evaluate(async () => {
      const attempt = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return 'resolved';
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      };
      return {
        copy: await attempt(() => window.mcp.copyConnectionCommand('claude-code')),
        port: await attempt(() => window.mcp.setPort(45000)),
        regenerate: await attempt(() => window.mcp.regenerateToken()),
      };
    });
    expect(others.copy).toContain('feature disabled');
    expect(others.port).toContain('feature disabled');
    expect(others.regenerate).toContain('feature disabled');
    const status = await page.evaluate(() => window.mcp.getStatus());
    expect(status.featureEnabled).toBe(false);
    expect(status.listening).toBe(false);
  } finally {
    await quitElectronApplication(app);
  }
});
