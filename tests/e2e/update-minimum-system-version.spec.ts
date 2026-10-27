// 自動更新の動作環境の下限: latest-mac.yml の minimumSystemVersion で、起動できない macOS の利用者に更新を案内しない。
// electron-updater（AppUpdater.checkIfUpdateSupported）は minimumSystemVersion を os.release()（macOS では Darwin の
// カーネル版。macOS 12 = 21.x・macOS 13 = 22.x）と semver で比べ、下回れば isUpdateAvailable を偽にする。
// 配布済みの版が同梱する electron-updater（6.8.10。package.json と lock の固定は smoke:mac-minimum-system-version）を
// 実 main で動かし、spec の中に立てた模擬の更新元（node:http・127.0.0.1。既存の更新元の e2e と同じ GitHub 形）で確かめる。
//   (a) 向き: minimumSystemVersion が 99.0.0 なら案内されず、20.0.0 なら案内される（実際の Darwin の版のまま）
//   (b) 境目: 実際の値 22.0.0 で、main の os.release を差し替え、21.6.0（macOS 12）なら案内されず、22.1.0（macOS 13）なら案内される
//   (c) 陽性対照: 差し替えの前（実際の Darwin）に 22.0.0 で案内されること・キーが無ければ 21.6.0 でも案内されること・
//       差し替えた値を main の os から読み戻せること
//   (d) main が解決する electron-updater の版が 6.8.10 であること
// Darwin の版を前提にするので macOS だけで走らせる（CI の e2e は macos-26）。
// 実行: node scripts/ensure-electron.mjs && pnpm run build && node_modules/.bin/playwright test tests/e2e/update-minimum-system-version.spec.ts
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
const NEW_VERSION = '9.0.0';

const zipBody = (ver: string, arch: string) => Buffer.from(`fake-update-zip ${ver} ${arch}\n`.repeat(64));
const sha512 = (buf: Buffer) => createHash('sha512').update(buf).digest('base64');

/** electron-builder が書く形の latest-mac.yml。minimumSystemVersion は後処理が末尾に足すのと同じ形で足す */
function latestMacYml(ver: string, minimumSystemVersion: string | null) {
  const files = ['x64', 'arm64'].map((arch) => {
    const body = zipBody(ver, arch);
    return `  - url: MaplatEditor-Mac-${ver}-${arch}.zip\n    sha512: ${sha512(body)}\n    size: ${body.length}\n`;
  }).join('');
  const first = zipBody(ver, 'x64');
  const base = `version: ${ver}\nfiles:\n${files}path: MaplatEditor-Mac-${ver}-x64.zip\nsha512: ${sha512(first)}\nreleaseDate: '2026-12-01T00:00:00.000Z'\n`;
  return minimumSystemVersion == null ? base : `${base}minimumSystemVersion: ${minimumSystemVersion}\n`;
}

function atom(base: string, tags: string[]) {
  const entries = tags.map((tag) => `  <entry>
    <id>tag:github.com,2008:Repository/1/${tag}</id>
    <updated>2026-12-01T00:00:00Z</updated>
    <link rel="alternate" type="text/html" href="${base}${RELEASES}/tag/${tag}"/>
    <title>${tag}</title>
    <content type="html">notes of ${tag}</content>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">\n  <id>tag:github.com,2008:/${OWNER}/${REPO}/releases</id>\n  <title>Release notes from ${REPO}</title>\n${entries}\n</feed>\n`;
}

async function startFeed() {
  const state: { minimumSystemVersion: string | null; ymlServed: number } = { minimumSystemVersion: null, ymlServed: 0 };
  let base = '';
  const latestTag = `v${NEW_VERSION}`;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', base);
    const send = (code: number, body: string | Buffer, type = 'text/plain') => {
      res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    };
    if (url.pathname === `${RELEASES}.atom`) return send(200, atom(base, [latestTag]), 'application/atom+xml');
    if (url.pathname === `/api/v3/repos/${OWNER}/${REPO}/releases/latest`) {
      return send(200, JSON.stringify({ tag_name: latestTag }), 'application/json');
    }
    if (url.pathname === `${RELEASES}/download/${latestTag}/latest-mac.yml`) {
      state.ymlServed += 1;
      return send(200, latestMacYml(NEW_VERSION, state.minimumSystemVersion), 'text/yaml');
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

/** main の os.release を差し替える（null で元に戻す）。差し替えた後に main の os から読み戻した値を返す */
const setOsRelease = (app: ElectronApplication, value: string | null) => app.evaluate((_electron, v: string | null) => {
  const g = globalThis as any;
  const nodeOs = process.getBuiltinModule('node:os') as typeof import('node:os');
  g.__origOsRelease ??= nodeOs.release;
  nodeOs.release = v == null ? g.__origOsRelease : () => v;
  // electron-updater は CJS の require("os") の release を呼ぶ。同じ組み込みの対象を読み戻す
  const viaRequire = (process.getBuiltinModule('node:module') as typeof import('node:module'))
    .createRequire(process.execPath)('os').release();
  return { viaBuiltin: nodeOs.release(), viaRequire };
}, value);

const check = (app: ElectronApplication) => app.evaluate(async () => {
  try {
    const r = await (globalThis as any).__maplatUpdateTest.checkForUpdates();
    return r == null ? { result: null } : { version: r.updateInfo?.version ?? null, isUpdateAvailable: r.isUpdateAvailable };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
});

test.skip(process.platform !== 'darwin', 'Darwin の版（os.release）を前提にするので macOS だけ');

test('更新情報の minimumSystemVersion: 向き・境目（21.6.0 不可 / 22.1.0 可）・陽性対照・electron-updater 6.8.10', async () => {
  test.setTimeout(180_000);
  const fixtureRoot = path.join(projectRoot, '.tmp-smoke');
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(path.join(fixtureRoot, 'update-min-sysver-e2e-'));
  const cacheBase = path.join(os.homedir(), 'Library', 'Caches');
  await writeFile(path.join(root, 'dev-app-update.yml'),
    `updaterCacheDirName: ${JSON.stringify(path.relative(cacheBase, path.join(root, 'updater-cache')))}\n`);
  const feed = await startFeed();
  const feedJson = JSON.stringify({ provider: 'github', owner: OWNER, repo: REPO, host: `127.0.0.1:${feed.port}`, protocol: 'http' });
  const app = await launch(root, feedJson);
  const available = { version: NEW_VERSION, isUpdateAvailable: true };
  const blocked = { version: NEW_VERSION, isUpdateAvailable: false };
  const ask = async (min: string | null) => {
    feed.state.minimumSystemVersion = min;
    const before = feed.state.ymlServed;
    const r = await check(app);
    // 毎回、更新元から latest-mac.yml を読み直していること（前の結果の使い回しで通らない）
    expect(feed.state.ymlServed).toBe(before + 1);
    return r;
  };
  try {
    // (d) main が解決する electron-updater の版
    const updaterVersion = await app.evaluate((_electron, root: string) =>
      (process.getBuiltinModule('node:module') as typeof import('node:module'))
        .createRequire(`${root}/package.json`)('electron-updater/package.json').version, projectRoot);
    expect(updaterVersion).toBe('6.8.10');

    // 実際の Darwin の版（macOS 13 以上 = 22 以上で走らせる前提。前提が崩れたら陽性対照が意味を失うので落とす）
    const real = await app.evaluate(() => (process.getBuiltinModule('node:os') as typeof import('node:os')).release());
    console.log(`[update-min-sysver] real os.release() = ${real}`);
    expect(Number(real.split('.')[0])).toBeGreaterThanOrEqual(22);

    // (c) 陽性対照（差し替えの前・実際の Darwin）
    expect(await ask(null)).toEqual(available);
    expect(await ask('22.0.0')).toEqual(available);

    // (a) 向き
    expect(await ask('99.0.0')).toEqual(blocked);
    expect(await ask('20.0.0')).toEqual(available);

    // (b) 境目: macOS 12（Darwin 21.6.0）
    expect(await setOsRelease(app, '21.6.0')).toEqual({ viaBuiltin: '21.6.0', viaRequire: '21.6.0' });
    expect(await ask('22.0.0')).toEqual(blocked);
    // (c) 差し替えが効いているのはキーのせいであること: キーが無ければ 21.6.0 でも案内される
    expect(await ask(null)).toEqual(available);

    // (b) 境目: macOS 13（Darwin 22.1.0）
    expect(await setOsRelease(app, '22.1.0')).toEqual({ viaBuiltin: '22.1.0', viaRequire: '22.1.0' });
    expect(await ask('22.0.0')).toEqual(available);

    // 元に戻す
    expect((await setOsRelease(app, null)).viaBuiltin).toBe(real);
  } finally {
    await quitElectronApplication(app);
    await new Promise<void>((resolve) => feed.server.close(() => resolve()));
  }
});
