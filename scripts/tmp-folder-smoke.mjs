// スモーク: 一時フォルダの解決と、使う前の所有の確認。
//
// 固定すること:
//   (i)   Linux だけ userData の下。macOS・Windows は利用者ごとの一時領域のまま
//   (ii)  シンボリックリンク・他人の持ち物・ファイルは拒否し、無ければ作る
//   (iii) 解決は 1 か所（SettingsService は tmpFolder.ts を呼ぶ）で、消費者は SettingsService.get のまま。
//         app.getPath をそのまま渡さない（this を失うと Electron が投げる）
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const failures = [];
const check = async (label, fn) => {
  try {
    const note = await fn();
    console.log('ok ' + label + (note ? ': ' + note : ''));
  } catch (e) {
    failures.push(label);
    console.log('NG ' + label + ': ' + String(e?.message ?? e).split('\n')[0].slice(0, 200));
  }
};

async function sourceLines(dir) {
  const lines = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) lines.push(...await sourceLines(full));
    else if (item.name.endsWith('.ts')) {
      for (const line of (await readFile(full, 'utf8')).split('\n')) {
        lines.push({ file: path.relative(projectRoot, full), line });
      }
    }
  }
  return lines;
}
const electronLines = await sourceLines(path.join(projectRoot, 'electron'));
const hits = (needle) => electronLines.filter((l) => l.line.includes(needle));
const perFile = (rows) => rows.reduce((acc, r) => ({ ...acc, [r.file]: (acc[r.file] ?? 0) + 1 }), {});

// ---- (iii) ソース ----
await check("(iii) getPath('temp') は解決の関数 1 行と書き出しの 2 行だけ", () => {
  const rows = perFile(hits("getPath('temp')"));
  assert.deepEqual(rows, { 'electron/services/AppExportService.ts': 2, 'electron/utils/tmpFolder.ts': 1 }, JSON.stringify(rows));
  return JSON.stringify(rows);
});
await check("(iii) get('tmpFolder') は消費者の 7 行と、起動時の確認の 1 行", () => {
  const rows = hits("get('tmpFolder')");
  assert.equal(rows.length, 8, JSON.stringify(perFile(rows)));
  assert.equal(perFile(rows)['electron/main.ts'], 2, JSON.stringify(perFile(rows)));
  return '合計 ' + rows.length + ' 行 ' + JSON.stringify(perFile(rows));
});
await check('(iii) SettingsService の tmpFolder の分岐が resolveTmpFolder を呼ぶ', async () => {
  const source = await readFile(path.join(projectRoot, 'electron/services/SettingsService.ts'), 'utf8');
  assert.match(source, /key === 'tmpFolder'\) \{\s+return resolveTmpFolder\(\{/);
  assert.match(source, /getPath: \(name\) => app\.getPath\(name\)/);
});
await check('(iii) app.getPath をそのまま渡していない', () => {
  assert.deepEqual(hits('getPath: app.getPath'), []);
});
await check('(iii) 起動時の確認が app:// の登録より前にある', async () => {
  const source = await readFile(path.join(projectRoot, 'electron/main.ts'), 'utf8');
  const ready = source.indexOf('app.whenReady().then(');
  const owned = source.indexOf("ensureTmpFolderOwned(SettingsService.get('tmpFolder'))");
  const handler = source.indexOf('protocol.handle(APP_SCHEME');
  assert.ok(ready !== -1 && owned !== -1 && handler !== -1, JSON.stringify({ ready, owned, handler }));
  assert.ok(ready < owned && owned < handler, JSON.stringify({ ready, owned, handler }));
  assert.match(source, /assertOwnedDirectory\(tmpFolder, \{ lstat: fs\.lstat, mkdir: fs\.mkdir, getuid: process\.getuid \}\)/);
});

// ---- (i)(ii) ----
let tmpFolder = null;
await check('tmpFolder.ts を読める', async () => {
  tmpFolder = await import(pathToFileURL(path.join(projectRoot, 'electron/utils/tmpFolder.ts')).href);
});

if (tmpFolder) {
  const { resolveTmpFolder, assertOwnedDirectory } = tmpFolder;
  const paths = { userData: '/home/u/.config/MaplatEditor', temp: '/tmp' };
  const getPath = (name) => paths[name];
  await check('(i) linux は userData/tmp', () => {
    assert.equal(resolveTmpFolder({ platform: 'linux', getPath, appName: 'MaplatEditor' }), path.join(paths.userData, 'tmp'));
  });
  for (const platform of ['darwin', 'win32']) {
    await check('(i) ' + platform + ' は temp/<アプリ名>', () => {
      assert.equal(resolveTmpFolder({ platform, getPath, appName: 'MaplatEditor' }), path.join(paths.temp, 'MaplatEditor'));
    });
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'tmp-folder-smoke-'));
  try {
    const deps = { lstat, mkdir, getuid: process.getuid };
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await check('(ii) 普通のディレクトリは通る', () => assertOwnedDirectory(outside, deps));
    await check('(ii) 無ければ作る', async () => {
      const fresh = path.join(root, 'a', 'b');
      await assertOwnedDirectory(fresh, deps);
      assert.equal((await lstat(fresh)).isDirectory(), true);
    });
    await check('(ii) シンボリックリンクは投げる', async () => {
      const link = path.join(root, 'link');
      await symlink(outside, link);
      await assert.rejects(assertOwnedDirectory(link, deps), /temp folder is a link/);
    });
    await check('(ii) 行き先の無いシンボリックリンクも投げる', async () => {
      const dangling = path.join(root, 'dangling');
      await symlink(path.join(root, 'nowhere'), dangling);
      await assert.rejects(assertOwnedDirectory(dangling, deps));
    });
    await check('(ii) ファイルは投げる', async () => {
      const file = path.join(root, 'file');
      await writeFile(file, 'x');
      await assert.rejects(assertOwnedDirectory(file, deps));
    });
    await check('(ii) 持ち主が違うと投げる', async () => {
      const getuid = () => (process.getuid?.() ?? 0) + 1;
      await assert.rejects(assertOwnedDirectory(outside, { lstat, mkdir, getuid }), /temp folder is owned by another user/);
    });
    await check('(ii) getuid が無い環境（Windows）は持ち主を見ない', async () => {
      const fake = async () => ({ isSymbolicLink: () => false, isDirectory: () => true, uid: 0 });
      await assertOwnedDirectory(outside, { lstat: fake, mkdir: async () => undefined, getuid: undefined });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.log('失敗 ' + failures.length + ' 件');
  process.exit(1);
}
console.log('tmp folder smoke passed');
