// The MCP read tools against a running editor: a map saved through the renderer is listed, read and its
// points converted by an MCP client over HTTP.
//
// The token is read from the editor's own store file in the isolated test root (the renderer never receives
// it) and is never printed.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { MCP_FEATURE_ENABLED } from './helpers/mcpFeature';

test.skip(!MCP_FEATURE_ENABLED, 'the MCP server is hidden in this build');

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
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

const HALF = 20037508.342789244;
const toMerc = ([lon, lat]: number[]) => [
  (lon * HALF) / 180,
  ((Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * HALF) / 180,
];
const GCPS_LONLAT: [number[], number[]][] = [
  [[0, 0], [139.7, 35.7]],
  [[1000, 0], [139.8, 35.7]],
  [[1000, 800], [139.8, 35.62]],
  [[0, 800], [139.7, 35.62]],
  [[500, 400], [139.752, 35.661]],
];

test('an MCP client lists, reads and converts points of a saved map', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-mcp-read-tools-'));
  const port = await freePort();
  const { app, page } = await launch(e2eRoot);
  try {
    // A map with a compiled transformation, saved the way the edit screen saves it
    const gcps = GCPS_LONLAT.map(([img, ll]) => [img, toMerc(ll)]);
    const saved = await page.evaluate(async ({ gcps }) => {
      const slug = `mcp-read-${Date.now()}`;
      const [, compiled] = await window.mapedit.updateTin(gcps, [], 0, [1000, 800], 'auto', 'plain');
      if (!compiled || typeof compiled !== 'object') throw new Error(`no compiled transformation: ${String(compiled)}`);
      const r = await window.mapedit.save({
        slug,
        mapObject: {
          mapID: slug, title: { en: 'MCP read test' }, officialTitle: {}, author: {}, era: {}, createdAt: {},
          contributor: {}, mapper: {}, attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC0',
          reference: '', url: '', lang: 'en', imageExtension: 'jpg', width: 1000, height: 800, gcps, edges: [],
          sub_maps: [], strictMode: 'auto', vertexMode: 'plain', status: 'New',
        },
        tins: [compiled],
      });
      if (!r || (r as any).result !== 'Success') throw new Error(`save: ${JSON.stringify(r)}`);
      return { uid: (r as any).uid as string, slug };
    }, { gcps });

    // Turn the server on (the confirmation dialog is answered with the confirming button)
    await app.evaluate(({ dialog }) => {
      (dialog as any).showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.evaluate((p) => window.mcp.setPort(p), port);
    const status = await page.evaluate(() => window.mcp.setEnabled(true));
    expect(status.listening).toBe(true);
    const store = JSON.parse(await readFile(path.join(e2eRoot, 'electron-store', 'settings', 'mcp-server.json'), 'utf8'));
    const token: string = store.token;

    let id = 0;
    const call = async (name: string, args: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.result.isError ?? false).toBe(false);
      return body.result.structuredContent;
    };

    const list = await call('maps.list', { query: saved.slug });
    expect(list.maps).toContainEqual({ uid: saved.uid, slug: saved.slug, title: 'MCP read test', width: 1000, height: 800, maxZoom: 2 });

    const map = await call('maps.get', { map: saved.uid });
    expect(map.slug).toBe(saved.slug);
    expect(map.hasCompiled).toBe(true);
    expect(map.gcps).toHaveLength(GCPS_LONLAT.length);
    map.gcps.forEach((g: number[][], i: number) => {
      expect(g[0]).toEqual(GCPS_LONLAT[i][0]);
      expect(g[1][0]).toBeCloseTo(GCPS_LONLAT[i][1][0], 9);
      expect(g[1][1]).toBeCloseTo(GCPS_LONLAT[i][1][1], 9);
    });

    const forward = await call('maps.transform', { map: saved.slug, direction: 'forward', points: [[500, 400], [250, 600], [-1, 0]] });
    expect(forward.points[0][0]).toBeCloseTo(139.752, 7);
    expect(forward.points[0][1]).toBeCloseTo(35.661, 7);
    expect(forward.points[2]).toBeNull();
    const back = await call('maps.transform', { map: saved.uid, direction: 'backward', points: [forward.points[1]] });
    expect(Math.abs(back.points[0][0] - 250)).toBeLessThan(0.5);
    expect(Math.abs(back.points[0][1] - 600)).toBeLessThan(0.5);

    // Turned off, the tools are unreachable
    await page.evaluate(() => window.mcp.setEnabled(false));
    await expect(fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' })).rejects.toThrow();
  } finally {
    await quitElectronApplication(app);
    await rm(e2eRoot, { recursive: true, force: true });
  }
});
