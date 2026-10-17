// nov26-m7-t5（#141）t5/AC4 (a)〜(c): 自動更新の基盤を、spec の中に立てた模擬の更新元（node:http・127.0.0.1）で確かめる。
// 実 main の electron-updater（macOS では MacUpdater）を、試験用の注入点（MAPLAT_E2E_ROOT と MAPLAT_E2E_UPDATE_FEED・
// app.isPackaged が偽のときだけ有効）で模擬の更新元へ向け、globalThis.__maplatUpdateTest から確認・ダウンロードを呼ぶ。
//   (a) 正式版 v9.0.0・RC v9.1.0-rc.1・win-signed-cache がある GitHub 形の更新元で、結果が 9.0.0。RC と win-signed-cache の資産への要求が 0 件
//   (b) latest-mac.yml の sha512 を壊した zip は downloadUpdate() が sha512 の不一致で拒む
//   (c) 現在より古い版（0.9.0）だけの更新元では更新なし
// 実行: node scripts/ensure-electron.mjs && pnpm run build && node_modules/.bin/playwright test tests/e2e/nov26-m7-t5-update-feed.spec.ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
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

type Scenario = 'normal' | 'broken-sha512' | 'older-only';

// 模擬の zip（中身は zip でなくてよい。sha512 の照合までしか進めない）
const zipBody = (ver: string, arch: string) => Buffer.from(`fake-update-zip ${ver} ${arch}\n`.repeat(64));
const sha512 = (buf: Buffer) => createHash('sha512').update(buf).digest('base64');

function latestMacYml(ver: string, broken: boolean) {
  const files = ['x64', 'arm64'].map((arch) => {
    const body = zipBody(ver, arch);
    const sum = broken ? sha512(Buffer.from('壊した sha512')) : sha512(body);
    return `  - url: MaplatEditor-Mac-${ver}-${arch}.zip\n    sha512: ${sum}\n    size: ${body.length}\n`
      + `  - url: MaplatEditor-Mac-${ver}-${arch}.dmg\n    sha512: ${sum}\n    size: ${body.length}\n`;
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

async function startFeed() {
  const state: { scenario: Scenario; paths: string[] } = { scenario: 'normal', paths: [] };
  let base = '';
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', base);
    state.paths.push(url.pathname);
    const send = (code: number, body: string | Buffer, type = 'text/plain') => {
      res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    };
    const older = state.scenario === 'older-only';
    const latestTag = older ? 'v0.9.0' : 'v9.0.0';
    if (url.pathname === `${RELEASES}.atom`) {
      // GitHub の releases.atom は新しい順。win-signed-cache（prerelease）と RC が正式版より上に来る
      return send(200, atom(base, older ? ['v0.9.0'] : ['win-signed-cache', 'v9.1.0-rc.1', 'v9.0.0']), 'application/atom+xml');
    }
    if (url.pathname === `/api/v3/repos/${OWNER}/${REPO}/releases/latest`) {
      // GitHub の「最新のリリース」は prerelease を含まない
      return send(200, JSON.stringify({ tag_name: latestTag }), 'application/json');
    }
    const m = url.pathname.match(new RegExp(`^${RELEASES}/download/([^/]+)/(.+)$`));
    if (m) {
      const [, tag, file] = m;
      const ver = tag.replace(/^v/, '');
      if (tag !== latestTag) return send(404, 'not found');
      if (file === 'latest-mac.yml') return send(200, latestMacYml(ver, state.scenario === 'broken-sha512'), 'text/yaml');
      const z = file.match(/^MaplatEditor-Mac-(.+)-(x64|arm64)\.zip$/);
      if (z && z[1] === ver) return send(200, zipBody(ver, z[2]), 'application/zip');
      return send(404, 'not found');
    }
    return send(404, 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  return { server, state, port };
}

async function launch(root: string, feedJson: string) {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${path.join(root, 'profile')}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: feedJson },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return app;
}

const hook = {
  inspect: (app: ElectronApplication) => app.evaluate(() => (globalThis as any).__maplatUpdateTest?.inspect() ?? null),
  check: (app: ElectronApplication) => app.evaluate(async () => {
    try {
      const r = await (globalThis as any).__maplatUpdateTest.checkForUpdates();
      return r == null ? { result: null } : { version: r.updateInfo?.version ?? null, isUpdateAvailable: r.isUpdateAvailable };
    } catch (e) {
      return { error: String((e as Error)?.message ?? e) };
    }
  }),
  download: (app: ElectronApplication) => app.evaluate(async () => {
    try {
      return { files: await (globalThis as any).__maplatUpdateTest.downloadUpdate() };
    } catch (e) {
      return { error: String((e as Error)?.message ?? e), code: (e as any)?.code ?? null };
    }
  }),
};

test('t5/AC4 (a)(b)(c): 正式版だけを拾い・壊れた zip を拒み・古い版では更新なし', async () => {
  test.setTimeout(180_000);
  const fixtureRoot = path.join(projectRoot, '.tmp-smoke');
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(path.join(fixtureRoot, 'nov26-m7-t5-e2e-'));
  // electron-updater のダウンロードのキャッシュ（updaterCacheDirName は ~/Library/Caches 等からの相対で読まれる）を
  // この試験の root の下へ向ける。dev-app-update.yml は試験の注入点が MAPLAT_E2E_ROOT の下から読む
  const cacheBase = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches')
    : process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'));
  await writeFile(path.join(root, 'dev-app-update.yml'),
    `updaterCacheDirName: ${JSON.stringify(path.relative(cacheBase, path.join(root, 'updater-cache')))}\n`);
  const feed = await startFeed();
  const feedJson = JSON.stringify({ provider: 'github', owner: OWNER, repo: REPO, host: `127.0.0.1:${feed.port}`, protocol: 'http' });
  const app = await launch(root, feedJson);
  try {
    // 実 main の autoUpdater の設定（t5/AC1 を実物でも確かめる）
    const settings = await hook.inspect(app);
    expect(settings).toEqual({
      autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false,
      fullChangelog: false, forceDevUpdateConfig: true, channel: null, currentVersion: expect.any(String),
    });

    // (a) 正式版だけを拾う
    feed.state.scenario = 'normal';
    feed.state.paths.length = 0;
    const a = await hook.check(app);
    expect(a).toEqual({ version: '9.0.0', isUpdateAvailable: true });
    const aPaths = [...feed.state.paths];
    expect(aPaths).toContain(`${RELEASES}/download/v9.0.0/latest-mac.yml`);
    // RC と win-signed-cache の資産（およびそれ以外の何であれ）への要求が 0 件
    expect(aPaths.filter((p) => p.includes('v9.1.0-rc.1') || p.includes('win-signed-cache'))).toEqual([]);
    // autoDownload が偽なので確認だけでは zip を取りに行かない
    expect(aPaths.filter((p) => p.endsWith('.zip'))).toEqual([]);

    // (b) sha512 を壊した zip は拒む
    feed.state.scenario = 'broken-sha512';
    feed.state.paths.length = 0;
    expect(await hook.check(app)).toEqual({ version: '9.0.0', isUpdateAvailable: true });
    const b = await hook.download(app);
    expect(b).toHaveProperty('error');
    expect(String((b as any).error)).toMatch(/sha512 checksum mismatch/);
    const zipReqs = feed.state.paths.filter((p) => p.endsWith('.zip'));
    expect(zipReqs.length).toBeGreaterThan(0);
    for (const p of zipReqs) expect(p.startsWith(`${RELEASES}/download/v9.0.0/`)).toBe(true);
    expect(feed.state.paths.filter((p) => p.includes('/download/v9.1.0-rc.1/') || p.includes('/download/win-signed-cache/'))).toEqual([]);

    // (c) 現在より古い版だけなら更新なし（allowDowngrade が偽）
    feed.state.scenario = 'older-only';
    feed.state.paths.length = 0;
    const c = await hook.check(app);
    expect(c).toEqual({ version: '0.9.0', isUpdateAvailable: false });
    expect(feed.state.paths.filter((p) => p.endsWith('.zip'))).toEqual([]);
  } finally {
    await quitElectronApplication(app);
    await new Promise<void>((resolve) => feed.server.close(() => resolve()));
  }
});

test('t5/AC3: 更新元の指定が 127.0.0.1 以外なら注入されない（製品の更新元のまま・確認は開発時なので行わない）', async () => {
  test.setTimeout(120_000);
  const fixtureRoot = path.join(projectRoot, '.tmp-smoke');
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(path.join(fixtureRoot, 'nov26-m7-t5-e2e-'));
  const app = await launch(root, JSON.stringify({ provider: 'generic', url: 'http://example.invalid:80/' }));
  try {
    const settings = await hook.inspect(app);
    // 注入されなかった → forceDevUpdateConfig は偽のまま ∴ 開発時の checkForUpdates は null（通信しない）
    expect(settings).toMatchObject({ forceDevUpdateConfig: false, allowPrerelease: false, allowDowngrade: false });
    expect(await hook.check(app)).toEqual({ result: null });
  } finally {
    await quitElectronApplication(app);
  }
});
