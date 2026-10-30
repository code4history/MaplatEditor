/* global URL, console, process */
// IPC の送信元の検査と settings の許可キーの smoke。
//
// 固定すること:
//   (a) 生の ipcMain と webContents.ipc の登録が electron/ipc/registry.ts の外に無い
//   (b) handle の送信元の検査（正当な frame だけ通る。dev の origin は渡したときだけ）
//   (c) on の拒否と例外でも event.returnValue が書かれる（sendSync を待たせない）
//   (d) 同じ channel を 2 回登録しても 1 件（登録の直前に解除する）
//   (e) settings の許可キーの判定
//   (f) saveFolder の形の検査
//   (f2) saveFolder はフォルダのダイアログの返り値に結びつく（handler を実際に呼ぶ）
//   (g) 許可キーの表が renderer の使うキーと一致し、e2e が表の外のキーを使わない
//   (h) 設定画面はダイアログのキャンセルで未保存の選択を捨てる（main の覚えた値と揃える）
//   (i) saveFolder の保存の失敗は画面に出し、ほかの設定を途中まで保存しない
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`NG ${name}: ${e?.message ?? e}`);
  }
}

async function walk(dir, predicate, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(projectRoot, file).split(path.sep).join('/');
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

// ---- (a) 登録はすべて registry.ts を通る ----
await check('(a) no raw ipcMain or webContents.ipc outside the registry', async () => {
  const files = await walk(path.join(projectRoot, 'electron'), (f) => f.endsWith('.ts'));
  const raw = [];
  let registered = 0;
  for (const file of files) {
    const name = rel(file);
    if (name === 'electron/ipc/registry.ts') continue;
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      if (/\bipcMain\b/.test(line) || /\.ipc\.(handle|on|once|handleOnce|addListener)\(/.test(line)) {
        raw.push(`${name}:${i + 1}`);
      }
      if (/\bipc\.(handle|on)\(/.test(line)) registered += 1;
    });
  }
  console.log(`registered channels through ipc: ${registered}`);
  assert.deepEqual(raw, [], `raw registrations: ${raw.length}`);
  assert.ok(registered >= 90, `expected at least 90 registrations, got ${registered}`);
});

// settings:set の handler が保存の前に検査する（ソースの順序。挙動は (f2) が見る）
await check('(e0) settings:set validates before it stores', async () => {
  const source = await readFile(path.join(projectRoot, 'electron/ipc/settings.ts'), 'utf8');
  const stored = source.indexOf('SettingsService.set(key, value)');
  assert.ok(stored > 0, 'SettingsService.set(key, value) was not found');
  for (const guard of ['assertRendererSettingsKey(key)', 'validateRendererSettingsValue(key, value', 'consumePickedSaveFolder(value)']) {
    const at = source.indexOf(guard);
    assert.ok(at >= 0 && at < stored, `${guard} must come before the store is written`);
  }
});

// ---- (g) 表と renderer・e2e の一致 ----
/** `settings.get(` / `settings.set(` の第 1 引数の字面を返す（括弧の深さを数えて複数行にも対応する） */
function firstArguments(source, pattern) {
  const out = [];
  for (const match of source.matchAll(pattern)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    let quote = null;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      else if (c === ',' && depth === 1) break;
    }
    out.push(source.slice(start, i).trim());
  }
  return out;
}
const literalsIn = (text) => [...text.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
/** 三項演算子なら、条件の中の比較の字面を数えない */
const keyLiteralsIn = (arg) => literalsIn(arg.includes('?') ? arg.slice(arg.indexOf('?')) : arg);

async function rendererKeys() {
  const files = await walk(path.join(projectRoot, 'src'), (f) => /\.(vue|ts)$/.test(f));
  const keys = new Set();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const arg of firstArguments(source, /\bsettings\.(?:get|set)\(/g)) {
      for (const literal of keyLiteralsIn(arg)) keys.add(literal);
    }
  }
  const settingsVue = await readFile(path.join(projectRoot, 'src/views/Settings.vue'), 'utf8');
  const fields = /const BASEMAP_KEY_FIELDS = \[([\s\S]*?)\]/.exec(settingsVue);
  assert.ok(fields, 'BASEMAP_KEY_FIELDS was not found');
  for (const literal of literalsIn(fields[1])) keys.add(literal);
  const recent = await readFile(path.join(projectRoot, 'src/utils/recentSearches.ts'), 'utf8');
  const store = /RECENT_SEARCH_STORE_KEY = ["']([^"']+)["']/.exec(recent);
  assert.ok(store, 'RECENT_SEARCH_STORE_KEY was not found');
  keys.add(store[1]);
  return keys;
}

await check('(g) e2e only touches allowed settings keys', async () => {
  const known = await rendererKeys();
  const files = await walk(path.join(projectRoot, 'tests/e2e'), (f) => f.endsWith('.ts'));
  const outside = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const arg of firstArguments(source, /\bwindow\.settings\.(?:get|set)\(/g)) {
      for (const literal of literalsIn(arg)) {
        if (!known.has(literal)) outside.push(`${rel(file)}: ${literal}`);
      }
    }
  }
  assert.deepEqual(outside, [], 'e2e reads keys the renderer does not use');
});

await check('(h) the settings screen drops the unsaved choice when the dialog is cancelled', async () => {
  const source = await readFile(path.join(projectRoot, 'src/views/Settings.vue'), 'utf8');
  const body = /const showFolderDialog = async \(\) => \{([\s\S]*?)\n\};/.exec(source);
  assert.ok(body, 'showFolderDialog was not found');
  assert.match(body[1], /else[\s\S]*state\.saveFolder = original\.saveFolder/);
});

await check('(i) a refused saveFolder is reported before anything else is saved', async () => {
  const source = await readFile(path.join(projectRoot, 'src/views/Settings.vue'), 'utf8');
  const body = /const saveSettings = async \(\) => \{([\s\S]*?)\n\};/.exec(source);
  assert.ok(body, 'saveSettings was not found');
  const folder = body[1].indexOf('window.settings.set("saveFolder"');
  const lang = body[1].indexOf('window.settings.set("lang"');
  assert.ok(folder >= 0 && folder < lang, 'saveFolder must be saved first');
  assert.match(body[1], /catch[\s\S]*showMessageBox[\s\S]*settings\.save_folder_failed[\s\S]*return;/);
  const locales = await readdir(path.join(projectRoot, 'public/locales'));
  assert.equal(locales.length, 11);
  for (const locale of locales) {
    const text = await readFile(path.join(projectRoot, 'public/locales', locale, 'translation.json'), 'utf8');
    assert.ok(JSON.parse(text).settings?.save_folder_failed, `${locale}: settings.save_folder_failed`);
  }
});

// ---- (b)〜(f2) は TS を読むので vite で束ねる ----
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'ipc-sender-guard-'));
const p = (r) => JSON.stringify(path.join(projectRoot, r));

try {
  const entryFile = path.join(workDir, 'entry.ts');
  const electronStub = path.join(workDir, 'electron-stub.ts');
  const storeStub = path.join(workDir, 'electron-store-stub.ts');
  const mapDataStub = path.join(workDir, 'map-data-stub.ts');
  const outDir = path.join(workDir, 'dist');
  const keysFile = path.join(workDir, 'renderer-keys.json');
  await writeFile(keysFile, JSON.stringify([...(await rendererKeys())]));

  await writeFile(electronStub, `
    const handlers = new Map();
    export const __handlers = handlers;
    export const app = {
      get isPackaged() { return (globalThis as any).__isPackaged === true; },
      getPath(name: string) { return ${JSON.stringify(workDir)} + '/' + name; },
      getName() { return 'MaplatEditor'; },
      getLocale() { return 'ja'; },
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const dialog = {
      showOpenDialog() { return Promise.resolve((globalThis as any).__openDialogResult); },
      showMessageBox() { return Promise.resolve({ response: 0 }); },
    };
    export const ipcMain = {
      handle(channel: string, fn: any) { handlers.set(channel, fn); },
      on(channel: string, fn: any) { handlers.set(channel, fn); },
      removeHandler(channel: string) { handlers.delete(channel); },
      removeAllListeners(channel: string) { handlers.delete(channel); },
    };
    export const BrowserWindow = class {
      static fromWebContents() { return null; }
      static getAllWindows() { return []; }
    };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const net = { fetch() { throw new Error('no network in smoke'); } };
    export const session = { fromPartition() { return {}; }, defaultSession: {} };
    export const nativeImage = {};
  `);
  await writeFile(storeStub, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `);
  await writeFile(mapDataStub, `
    export default { async switchDataFolder() {} };
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import nodeFs from 'node:fs';
    import nodePath from 'node:path';

    const results: string[] = [];
    const failed: string[] = [];
    async function check(name: string, fn: () => void | Promise<void>) {
      try { await fn(); console.log('ok ' + name); }
      catch (e: any) { failed.push(name); console.error('NG ' + name + ': ' + (e?.message ?? e)); }
    }
    const warn = (..._args: unknown[]) => {};

    const { createIpcRegistry, isTrustedSender } = await import(${p('electron/ipc/registry.ts')});
    const {
      RENDERER_SETTINGS_KEYS, assertRendererSettingsKey, validateRendererSettingsValue, SaveFolderGate,
    } = await import(${p('electron/services/settingsKeys.ts')});

    function fakeIpcMain() {
      const handlers = new Map<string, any>();
      const calls = { removeHandler: 0, removeAllListeners: 0 };
      return {
        handlers, calls,
        handle(channel: string, fn: any) {
          if (handlers.has(channel)) throw new Error('second handler for ' + channel);
          handlers.set(channel, fn);
        },
        on(channel: string, fn: any) { handlers.set(channel, fn); },
        removeHandler(channel: string) { calls.removeHandler += 1; handlers.delete(channel); },
        removeAllListeners(channel: string) { calls.removeAllListeners += 1; handlers.delete(channel); },
      };
    }
    const frame = (url: string) => ({ senderFrame: { url, parent: null } });
    const subframe = (url: string) => ({ senderFrame: { url, parent: { url } } });
    const throwingFrame = { senderFrame: { parent: null, get url(): string { throw new Error('disposed'); } } };

    await check('(b) handle checks the sender frame', async () => {
      const ipcMain = fakeIpcMain();
      const ipc = createIpcRegistry({ ipcMain: ipcMain as any, devServerUrl: null, warn });
      let calls = 0;
      ipc.handle('x', (_event: unknown, a: number) => { calls += 1; return a + 1; });
      const invoke = ipcMain.handlers.get('x');
      assert.equal(await invoke(frame('app://bundle/index.html'), 1), 2);
      assert.equal(calls, 1);
      for (const bad of [
        frame('http://evil.example/'),
        frame('data:text/html,x'),
        frame('app://bundle/__local/x.html'),
        frame('http://localhost:5173/'),
        subframe('app://bundle/index.html'),
        { senderFrame: { url: 'app://bundle/index.html' } },
        { senderFrame: null },
        {},
        throwingFrame,
      ]) {
        await assert.rejects(async () => invoke(bad, 1), /untrusted/);
      }
      assert.equal(calls, 1, 'a rejected call never reaches the handler');
    });

    await check('(b) the dev server origin passes only when it is given', async () => {
      const ipcMain = fakeIpcMain();
      const ipc = createIpcRegistry({ ipcMain: ipcMain as any, devServerUrl: 'http://localhost:5173', warn });
      ipc.handle('x', () => 'ok');
      assert.equal(await ipcMain.handlers.get('x')(frame('http://localhost:5173/')), 'ok');
      await assert.rejects(async () => ipcMain.handlers.get('x')(frame('http://localhost:5174/')), /untrusted/);
      assert.equal(isTrustedSender({ url: 'http://localhost:5173/', parent: null }, 'http://localhost:5173'), true);
      assert.equal(isTrustedSender({ url: 'http://localhost:5173/', parent: {} }, 'http://localhost:5173'), false);
      assert.equal(isTrustedSender({ url: 'http://localhost:5173/', parent: null }, null), false);
      assert.equal(isTrustedSender(null), false);
    });

    await check('(c) on always answers sendSync', () => {
      const ipcMain = fakeIpcMain();
      const ipc = createIpcRegistry({ ipcMain: ipcMain as any, devServerUrl: null, warn });
      let calls = 0;
      ipc.on('sync', (event: any) => { calls += 1; event.returnValue = { ok: true }; });
      const send = ipcMain.handlers.get('sync');
      for (const bad of [{ senderFrame: null }, throwingFrame, frame('http://evil.example/'), subframe('app://bundle/index.html')]) {
        const event: any = { ...bad };
        Object.defineProperty(event, 'senderFrame', Object.getOwnPropertyDescriptor(bad, 'senderFrame') ?? { value: undefined });
        send(event);
        assert.equal(event.returnValue?.ok, false);
      }
      assert.equal(calls, 0, 'a rejected call never reaches the listener');
      const good: any = frame('app://bundle/index.html');
      send(good);
      assert.deepEqual(good.returnValue, { ok: true });
      assert.equal(calls, 1);

      const ipcMain2 = fakeIpcMain();
      const ipc2 = createIpcRegistry({ ipcMain: ipcMain2 as any, devServerUrl: null, warn });
      ipc2.on('sync', () => { throw new Error('boom'); });
      const event: any = frame('app://bundle/index.html');
      ipcMain2.handlers.get('sync')(event);
      assert.deepEqual(event.returnValue, { ok: false, error: 'boom' });
    });

    await check('(d) registering a channel twice keeps one handler', async () => {
      const ipcMain = fakeIpcMain();
      const ipc = createIpcRegistry({ ipcMain: ipcMain as any, devServerUrl: null, warn });
      ipc.handle('x', () => 1);
      ipc.handle('x', () => 2);
      assert.equal(ipcMain.handlers.size, 1);
      assert.equal(ipcMain.calls.removeHandler, 2, 'removed before each registration');
      assert.equal(await ipcMain.handlers.get('x')(frame('app://bundle/index.html')), 2);
      ipc.on('y', () => {});
      ipc.on('y', () => {});
      assert.equal(ipcMain.calls.removeAllListeners, 2);
    });

    await check('(e) only the listed settings keys pass', () => {
      assert.equal(RENDERER_SETTINGS_KEYS.size, 10);
      for (const key of RENDERER_SETTINGS_KEYS) assert.doesNotThrow(() => assertRendererSettingsKey(key));
      for (const key of ['evil', 'tmpFolder', 'lastDialogFolders', 'migratedFromLegacy', '__proto__', 'saveFolder.x', 42, null, undefined, ['lang']]) {
        assert.throws(() => assertRendererSettingsKey(key), /not allowed/, String(key));
      }
    });

    await check('(f) saveFolder shape', () => {
      const darwin = { platform: 'darwin' as const };
      const win32 = { platform: 'win32' as const };
      for (const value of ['\\\\\\\\host\\\\share', '//host/share', 'relative/dir', '', 42, null, undefined]) {
        assert.throws(() => validateRendererSettingsValue('saveFolder', value, darwin), undefined, String(value));
      }
      assert.throws(() => validateRendererSettingsValue('saveFolder', 'C:\\\\Users\\\\x', darwin));
      assert.throws(() => validateRendererSettingsValue('saveFolder', '\\\\\\\\host\\\\share', win32));
      assert.throws(() => validateRendererSettingsValue('saveFolder', '/Users/x', win32));
      assert.throws(() => validateRendererSettingsValue('saveFolder', 'C:relative', win32));
      assert.doesNotThrow(() => validateRendererSettingsValue('saveFolder', '/Users/x/Documents/MaplatEditor', darwin));
      assert.doesNotThrow(() => validateRendererSettingsValue('saveFolder', 'C:\\\\Users\\\\x', win32));
      assert.doesNotThrow(() => validateRendererSettingsValue('lang', 'ja'));
    });

    await check('(f) the renderer key list matches the table', () => {
      const renderer = JSON.parse(nodeFs.readFileSync(${JSON.stringify(keysFile)}, 'utf8')).sort();
      assert.deepEqual(renderer, [...RENDERER_SETTINGS_KEYS].sort());
      console.log('keys=' + renderer.length + ' match');
    });

    await check('(f2) SaveFolderGate remembers once', () => {
      const gate = new SaveFolderGate();
      assert.equal(gate.consume('/a'), false);
      gate.remember('/a');
      assert.equal(gate.consume('/b'), false);
      assert.equal(gate.consume('/a'), true);
      assert.equal(gate.consume('/a'), false);
      gate.remember('/a');
      gate.remember(null);
      assert.equal(gate.consume('/a'), false);
    });

    await check('(f2) saveFolder is tied to the folder dialog', async () => {
      const dataDir = ${JSON.stringify(path.join(workDir, 'data'))};
      nodeFs.mkdirSync(dataDir, { recursive: true });
      const { __handlers } = await import(${JSON.stringify(electronStub)});
      const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
      const { registerSettingsHandlers } = await import(${p('electron/ipc/settings.ts')});
      registerSettingsHandlers();
      SettingsService.set('saveFolder', dataDir);
      const event = { senderFrame: { url: 'app://bundle/index.html', parent: null }, sender: {} };
      const call = (channel: string, ...args: any[]) => __handlers.get(channel)(event, ...args);
      const chosen = nodePath.join(dataDir, 'chosen');
      const other = nodePath.join(dataDir, 'other');
      const pick = async (value: string | null) => {
        (globalThis as any).__openDialogResult = value === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [value] };
        return call('settings:select-folder');
      };

      await assert.rejects(call('settings:set', 'saveFolder', chosen), /folder dialog/);
      assert.equal(SettingsService.get('saveFolder'), dataDir, 'a refused value is not stored');

      assert.equal(await pick(chosen), chosen);
      await call('settings:set', 'saveFolder', chosen);
      assert.equal(SettingsService.get('saveFolder'), chosen);
      await call('settings:set', 'saveFolder', chosen); // 今の値と同じ

      await pick(other);
      await assert.rejects(call('settings:set', 'saveFolder', dataDir), /folder dialog/);
      assert.equal(await pick(null), null);
      await assert.rejects(call('settings:set', 'saveFolder', other), /folder dialog/);
      assert.equal(SettingsService.get('saveFolder'), chosen);

      await assert.rejects(async () => call('settings:get', 'tmpFolder'), /not allowed/);
      await assert.rejects(async () => call('settings:set', 'lastDialogFolders', {}), /not allowed/);

      // 今の値と同じなら形の検査の前に通す（保存済みのネットワークフォルダで保存全体が止まらない）
      // （SettingsService.set はフォルダを作りに行くので、ここは保存先を直接書き換える）
      const stored = (SettingsService as any).store;
      stored.set('saveFolder', '//host/share/already-stored');
      const setSpy = SettingsService.set;
      let writes = 0;
      SettingsService.set = () => { writes += 1; };
      await call('settings:set', 'saveFolder', '//host/share/already-stored');
      assert.equal(writes, 1);
      SettingsService.set = setSpy;
      await assert.rejects(call('settings:set', 'saveFolder', '//host/share/other'), /network path/);
      stored.set('saveFolder', chosen);

      // e2e のときだけ、形の検査を残して照合を緩める
      process.env.MAPLAT_E2E_ROOT = ${JSON.stringify(path.join(workDir, 'e2e'))};
      (globalThis as any).__isPackaged = true;
      await assert.rejects(call('settings:set', 'saveFolder', other), /folder dialog/);
      (globalThis as any).__isPackaged = false;
      await call('settings:set', 'saveFolder', other);
      assert.equal(SettingsService.get('saveFolder'), other);
      await assert.rejects(call('settings:set', 'saveFolder', 'relative/dir'));
      delete process.env.MAPLAT_E2E_ROOT;
    });

    if (failed.length > 0) {
      console.error('failed: ' + failed.join(', '));
      process.exitCode = 1;
    }
    void results;
  `);

  const bundled = path.join(outDir, 'entry.mjs');
  let builtOk = false;
  await check('(b)-(f2) the registry and the settings table can be loaded', async () => {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: [
          { find: 'electron', replacement: electronStub },
          { find: 'electron-store', replacement: storeStub },
          { find: /.*\/MapDataService$/, replacement: mapDataStub },
        ],
      },
      build: {
        emptyOutDir: true,
        outDir,
        ssr: entryFile,
        target: 'node22',
        rollupOptions: { external: ['jimp'], output: { entryFileNames: 'entry.mjs', format: 'es' } },
      },
    });
    builtOk = true;
  });
  if (builtOk) {
    await check('(b)-(f2) behaviour', async () => {
      const { stdout, stderr } = await execFileAsync(process.execPath, [bundled], {
        cwd: projectRoot, timeout: 180000, maxBuffer: 1024 * 1024 * 8,
      }).catch((e) => {
        process.stdout.write(e.stdout ?? '');
        process.stderr.write(e.stderr ?? '');
        throw new Error('the bundled checks failed');
      });
      process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    });
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`ipc-sender-guard smoke FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log('ipc-sender-guard smoke PASS');
