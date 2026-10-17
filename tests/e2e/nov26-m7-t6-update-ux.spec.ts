// nov26-m7-t6（#141 決めること 1・6）t6/AC1・AC2: 自動更新の形（知らせる → 同意で更新 → 設定で切れる）を、
// spec の中に立てた模擬の更新元（node:http・127.0.0.1。t5 の e2e と同じ GitHub 形）と、実 main の UpdateController で確かめる。
// 知らせる UI は main のネイティブのダイアログ（dialog.showMessageBox）なので、app.evaluate で差し替えて
// 「出たダイアログ」を記録し、押すボタンを決める（UpdateController は dialog をプロパティとして引く）。
//   AC1 (i)(ii)  新しい正式版 9.0.0 → 起動の後に 1 回だけ知らせる。「後で」ならダウンロードの要求 0 件
//   AC1 (iii)    「更新する」→ zip を取りに行き「今すぐ再起動して更新」が出る（「後で」を選ぶ）。その後に失敗のダイアログが出ない（MIN-9）
//   AC1 (iv)     updateCheckEnabled=false で起動すると更新元への要求が 0 件
//   AC2          正式版が現在の版（RC と win-signed-cache だけが新しい）なら起動時は何も出ない。メニュー「更新を確認…」で「最新です」
//   設定画面     基本設定の「起動時に更新を確認する」を切って保存すると updateCheckEnabled が false になる
//   macOS        入れ替え（before-quit-for-update）のときは × の「隠す」に入らず終わる（§3.2 の最後の段）
// 実行: node scripts/ensure-electron.mjs && pnpm run build && node_modules/.bin/playwright test tests/e2e/nov26-m7-t6-update-ux.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const OWNER = 'code4history';
const REPO = 'MaplatEditor';
const RELEASES = `/${OWNER}/${REPO}/releases`;
const CURRENT = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version as string;
const DELAY_MS = 500;
const NEW_VERSION = '9.0.0';

type Scenario = 'new' | 'current';

const zipBody = (ver: string, arch: string) => Buffer.from(`fake-update-zip ${ver} ${arch}\n`.repeat(64));
const sha512 = (buf: Buffer) => createHash('sha512').update(buf).digest('base64');

function latestMacYml(ver: string) {
  const files = ['x64', 'arm64'].map((arch) => {
    const body = zipBody(ver, arch);
    return `  - url: MaplatEditor-Mac-${ver}-${arch}.zip\n    sha512: ${sha512(body)}\n    size: ${body.length}\n`;
  }).join('');
  const first = zipBody(ver, 'x64');
  return `version: ${ver}\nfiles:\n${files}path: MaplatEditor-Mac-${ver}-x64.zip\nsha512: ${sha512(first)}\nreleaseDate: '2026-10-01T00:00:00.000Z'\n`;
}

function atom(base: string, tags: string[]) {
  const entries = tags.map((tag) => `  <entry>
    <id>tag:github.com,2008:Repository/1/${tag}</id>
    <updated>2026-10-01T00:00:00Z</updated>
    <link rel="alternate" type="text/html" href="${base}${RELEASES}/tag/${tag}"/>
    <title>${tag}</title>
    <content type="html">notes of ${tag}</content>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">\n  <id>tag:github.com,2008:/${OWNER}/${REPO}/releases</id>\n  <title>Release notes from ${REPO}</title>\n${entries}\n</feed>\n`;
}

async function startFeed(scenario: Scenario) {
  const state = { paths: [] as string[] };
  let base = '';
  const latestTag = scenario === 'new' ? `v${NEW_VERSION}` : `v${CURRENT}`;
  // GitHub の releases.atom は新しい順。win-signed-cache（prerelease）と RC が正式版より上に来る
  const tags = ['win-signed-cache', 'v9.1.0-rc.1', latestTag];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', base);
    state.paths.push(url.pathname);
    const send = (code: number, body: string | Buffer, type = 'text/plain') => {
      res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    };
    if (url.pathname === `${RELEASES}.atom`) return send(200, atom(base, tags), 'application/atom+xml');
    if (url.pathname === `/api/v3/repos/${OWNER}/${REPO}/releases/latest`) {
      return send(200, JSON.stringify({ tag_name: latestTag }), 'application/json');
    }
    const m = url.pathname.match(new RegExp(`^${RELEASES}/download/([^/]+)/(.+)$`));
    if (m) {
      const [, tag, file] = m;
      const ver = tag.replace(/^v/, '');
      if (tag !== latestTag) return send(404, 'not found');
      if (file === 'latest-mac.yml') return send(200, latestMacYml(ver), 'text/yaml');
      const z = file.match(/^MaplatEditor-Mac-(.+)-(x64|arm64)\.zip$/);
      if (z && z[1] === ver) return send(200, zipBody(ver, z[2]), 'application/zip');
    }
    return send(404, 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  const feedJson = JSON.stringify({ provider: 'github', owner: OWNER, repo: REPO, host: `127.0.0.1:${port}`, protocol: 'http' });
  return { server, state, feedJson, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** 試験の root を作る。設定（electron-store）を先に置き、更新器のキャッシュを root の下へ向ける */
async function makeRoot(settings: Record<string, unknown>) {
  const fixtureRoot = path.join(projectRoot, '.tmp-smoke');
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(path.join(fixtureRoot, 'nov26-m7-t6-e2e-'));
  const storeDir = path.join(root, 'electron-store', 'settings');
  await mkdir(storeDir, { recursive: true });
  // 言語を en に固定（CI の Electron は ja・手元は OS 次第。文言は版番号で照らすが、ボタンの数・順を言語に依らず見る）
  await writeFile(path.join(storeDir, 'config.json'), JSON.stringify({ lang: 'en', ...settings }));
  const cacheBase = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches')
    : process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'));
  await writeFile(path.join(root, 'dev-app-update.yml'),
    `updaterCacheDirName: ${JSON.stringify(path.relative(cacheBase, path.join(root, 'updater-cache')))}\n`);
  return root;
}

type DialogCall = { type?: string; message: string; detail?: string; buttons: string[]; defaultId?: number; cancelId?: number; response: number };

/**
 * dialog.showMessageBox を差し替える。responses は呼ばれた順に返すボタンの番号（尽きたら cancelId）。
 * launch の直後（窓ができて起動の確認の遅延が始まるより前）に置く
 */
async function stubDialog(app: ElectronApplication, responses: number[]) {
  await app.evaluate(({ dialog }, queue: number[]) => {
    const g = globalThis as any;
    g.__t6Dialogs = [] as unknown[];
    g.__t6Queue = [...queue];
    dialog.showMessageBox = (async (...args: any[]) => {
      const opts = (args.length > 1 ? args[1] : args[0]) ?? {};
      const response = g.__t6Queue.length > 0 ? g.__t6Queue.shift() : (opts.cancelId ?? 0);
      g.__t6Dialogs.push({ type: opts.type, message: String(opts.message ?? ''), detail: opts.detail, buttons: opts.buttons ?? [], defaultId: opts.defaultId, cancelId: opts.cancelId, response });
      return { response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, responses);
}

const dialogs = (app: ElectronApplication) => app.evaluate(() => ((globalThis as any).__t6Dialogs ?? []) as DialogCall[]);

async function launch(root: string, feedJson: string) {
  return electron.launch({
    args: [projectRoot, `--user-data-dir=${path.join(root, 'profile')}`],
    cwd: projectRoot,
    env: {
      ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: root,
      MAPLAT_E2E_UPDATE_FEED: feedJson, MAPLAT_E2E_UPDATE_DELAY_MS: String(DELAY_MS),
    },
  });
}

async function firstPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const zipRequests = (paths: string[]) => paths.filter((p) => p.endsWith('.zip'));
const prereleaseRequests = (paths: string[]) => paths.filter((p) => p.includes('/download/v9.1.0-rc.1/') || p.includes('/download/win-signed-cache/'));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('nov26-m7-t6 更新のお知らせ', () => {
  test.skip(process.platform !== 'darwin', '模擬の更新元は latest-mac.yml の形（e2e の CI は macOS）');

  test('t6/AC1 (i)(ii): 新しい正式版を起動の後に 1 回だけ知らせ、「後で」ならダウンロードしない', async () => {
    test.setTimeout(120_000);
    const feed = await startFeed('new');
    const root = await makeRoot({});
    const app = await launch(root, feed.feedJson);
    try {
      await stubDialog(app, [1]); // [更新する][後で] の「後で」
      await firstPage(app);
      await expect.poll(async () => (await dialogs(app)).length, { timeout: 30_000 }).toBe(1);
      await sleep(DELAY_MS * 3);
      const calls = await dialogs(app);
      expect(calls).toHaveLength(1);
      expect(calls[0].message).toContain(NEW_VERSION);
      expect(calls[0].buttons).toHaveLength(2);
      expect(calls[0].cancelId).toBe(1);
      expect(calls[0].response).toBe(1);
      expect(zipRequests(feed.state.paths)).toEqual([]);
      expect(prereleaseRequests(feed.state.paths)).toEqual([]);
      expect(feed.state.paths).toContain(`${RELEASES}/download/v${NEW_VERSION}/latest-mac.yml`);
    } finally {
      await quitElectronApplication(app);
      await feed.close();
    }
  });

  test('t6/AC1 (iii): 「更新する」で zip を取りに行き「今すぐ再起動して更新」が出る。その後に失敗のダイアログが出ない', async () => {
    test.setTimeout(120_000);
    const feed = await startFeed('new');
    const root = await makeRoot({});
    const app = await launch(root, feed.feedJson);
    try {
      // 1 つ目 [更新する][後で] → 更新する。2 つ目 [今すぐ再起動して更新][後で] → 後で（quitAndInstall を呼ばない）
      await stubDialog(app, [0, 1]);
      await firstPage(app);
      await expect.poll(async () => (await dialogs(app)).length, { timeout: 60_000 }).toBe(2);
      // MIN-9: autoInstallOnAppQuit が偽なのでダウンロードの後に Squirrel は動かない ∴ 偽の zip で error は来ない
      await sleep(DELAY_MS * 3);
      const calls = await dialogs(app);
      expect(calls).toHaveLength(2);
      expect(calls[0].message).toContain(NEW_VERSION);
      expect(calls[0].response).toBe(0);
      expect(calls[1].message).toContain(NEW_VERSION);
      expect(calls[1].buttons).toHaveLength(2);
      // 未保存の変更の扱い（§3.2 の最後の段）: 既定のボタンは「後で」
      expect(calls[1].defaultId).toBe(1);
      expect(calls[1].cancelId).toBe(1);
      const zips = zipRequests(feed.state.paths);
      expect(zips.length).toBeGreaterThan(0);
      for (const p of zips) expect(p.startsWith(`${RELEASES}/download/v${NEW_VERSION}/`)).toBe(true);
      expect(prereleaseRequests(feed.state.paths)).toEqual([]);
      // アプリは終わっていない（入れ替えを呼んでいない）
      expect(app.process().exitCode).toBeNull();
    } finally {
      await quitElectronApplication(app);
      await feed.close();
    }
  });

  test('t6/AC1 (iv): updateCheckEnabled=false で起動すると更新元への要求が 0 件', async () => {
    test.setTimeout(120_000);
    const feed = await startFeed('new');
    const root = await makeRoot({ updateCheckEnabled: false });
    const app = await launch(root, feed.feedJson);
    try {
      await stubDialog(app, []);
      const page = await firstPage(app);
      await sleep(DELAY_MS * 3);
      expect(feed.state.paths).toEqual([]);
      expect(await dialogs(app)).toEqual([]);
      // 設定画面の項目も切れて見える
      await page.evaluate(() => { location.hash = '#/settings'; });
      await expect(page.getByTestId('settings-update-check')).not.toBeChecked();
      expect(feed.state.paths).toEqual([]);
    } finally {
      await quitElectronApplication(app);
      await feed.close();
    }
  });

  test('t6/AC2: 正式版が現在の版なら起動時は何も出さず、メニュー「更新を確認…」で「最新です」。設定で切れる', async () => {
    test.setTimeout(120_000);
    const feed = await startFeed('current');
    const root = await makeRoot({});
    const app = await launch(root, feed.feedJson);
    try {
      await stubDialog(app, []);
      const page = await firstPage(app);
      // 起動時の確認は走る（latest-mac.yml を取りに行く）が、ダイアログは出ない
      await expect.poll(() => feed.state.paths.includes(`${RELEASES}/download/v${CURRENT}/latest-mac.yml`), { timeout: 30_000 }).toBe(true);
      await sleep(DELAY_MS * 3);
      expect(await dialogs(app)).toEqual([]);

      // メニュー（最初の submenu の id: 'check-updates'）
      await app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('check-updates');
        if (!item) throw new Error('check-updates の項目が無い');
        item.click();
      });
      await expect.poll(async () => (await dialogs(app)).length, { timeout: 30_000 }).toBe(1);
      const [upToDate] = await dialogs(app);
      expect(upToDate.message).toContain(CURRENT);
      expect(upToDate.buttons.length).toBeLessThanOrEqual(1);
      // About の隣（最初の submenu）にある
      const labels = await app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items[0].submenu?.items ?? []).map((i) => i.id ?? i.label));
      expect(labels.indexOf('check-updates')).toBeGreaterThan(-1);
      expect(zipRequests(feed.state.paths)).toEqual([]);
      expect(prereleaseRequests(feed.state.paths)).toEqual([]);

      // 設定画面: 既定はオン。切って保存すると false
      await page.evaluate(() => { location.hash = '#/settings'; });
      const sw = page.getByTestId('settings-update-check');
      await expect(sw).toBeChecked();
      await sw.uncheck();
      await page.locator('#basic button.btn-primary').click();
      await expect.poll(() => page.evaluate(() => window.settings.get('updateCheckEnabled'))).toBe(false);
    } finally {
      await quitElectronApplication(app);
      await feed.close();
    }
  });

  test('macOS: 入れ替え（before-quit-for-update）のときは × で隠さずにアプリが終わる', async () => {
    test.setTimeout(120_000);
    const root = await makeRoot({ updateCheckEnabled: false });
    const app = await launch(root, '');
    const child = app.process();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      await firstPage(app);
      await app.evaluate(({ autoUpdater, BrowserWindow }) => {
        // electron-updater の quitAndInstall は、窓を閉じる前にこのイベントを出す（MacUpdater は Squirrel が・BaseUpdater は自前で）
        autoUpdater.emit('before-quit-for-update');
        BrowserWindow.getAllWindows()[0]?.close();
      }).catch(() => undefined); // 終わるのが速いと evaluate の応答が届かない
      const result = await Promise.race([exited.then(() => 'exited'), sleep(30_000).then(() => 'still-running')]);
      expect(result).toBe('exited');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
