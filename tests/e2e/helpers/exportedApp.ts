// 書き出したアプリをブラウザで開いて確かめる試験の補助（#106・#85）。
//
//   serveExportedZip       書き出しの zip を一時ディレクトリへ展開し、要求の記録つきで静的に配る
//   openInWindow           Electron の BrowserWindow で URL を開き、console の行と pageerror を集める
//   routeOsmTilesToFixture tile.openstreetmap.org への要求を、実在の OSM タイル（fixtures/osm-tiles）を配る
//                          テストの中のサーバへ振り替える（外へ要求を出さない）
//
// 振り替えは Electron の session.defaultSession.webRequest で行う。Service Worker から出る要求は
// page.route では捕まらないが、webRequest は session の要求すべてに掛かる。使った後は必ず外す。
import type { ElectronApplication, Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from './glRender';

export type RequestRecord = { path: string; status: number };

export const OSM_TILE_FIXTURE_ROOT = path.resolve(import.meta.dirname, '../fixtures/osm-tiles');

/** zip を dir へ展開して配る。requests に応答ごとの { path, status } が積まれる */
export async function serveExportedZip(zipPath: string, dir: string): Promise<{
  origin: string; dir: string; requests: RequestRecord[]; close: () => Promise<void>;
}> {
  await mkdir(dir, { recursive: true });
  new AdmZip(zipPath).extractAllTo(dir, true);
  const requests: RequestRecord[] = [];
  const server = await serveStatic(dir, { requests });
  return { origin: server.origin, dir, requests, close: server.close };
}

/** BrowserWindow を作って url を開く。console の行（type と text）と pageerror を集める */
export async function openInWindow(app: ElectronApplication, url: string, size = { width: 1000, height: 700 }): Promise<{
  win: Page; consoleLines: { type: string; text: string }[]; pageErrors: string[];
}> {
  const windowPromise = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = new BrowserWindow({ width: s.width, height: s.height, show: true });
    void w.loadURL('about:blank');
  }, size);
  const win = await windowPromise;
  const consoleLines: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];
  win.on('console', (m) => consoleLines.push({ type: m.type(), text: m.text() }));
  win.on('pageerror', (e) => pageErrors.push(String(e?.stack ?? e)));
  await win.goto(url);
  return { win, consoleLines, pageErrors };
}

/**
 * tile.openstreetmap.org の要求を、fixtures/osm-tiles を CORS つきで配るテストの中のサーバへ振り替える。
 * 戻り値の requests にタイルの要求（{ path: '/z/x/y.png', status }）が積まれる。unroute で振り替えを外し、サーバを止める
 */
export async function routeOsmTilesToFixture(app: ElectronApplication): Promise<{
  origin: string; requests: RequestRecord[]; unroute: () => Promise<void>;
}> {
  const requests: RequestRecord[] = [];
  const server = await serveStatic(OSM_TILE_FIXTURE_ROOT, { cors: true, requests });
  await app.evaluate(({ session }, origin) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://tile.openstreetmap.org/*', 'https://*.tile.openstreetmap.org/*'] }, (details, callback) => {
      const u = new URL(details.url);
      callback({ redirectURL: `${origin}${u.pathname}` });
    });
  }, server.origin);
  return {
    origin: server.origin,
    requests,
    unroute: async () => {
      await app.evaluate(({ session }) => { session.defaultSession.webRequest.onBeforeRequest(null); });
      await server.close();
    },
  };
}
