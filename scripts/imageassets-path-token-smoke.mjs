// 画像アセットの新規登録（imageassets:add）が renderer からパスを受け取らず、ファイル選択のダイアログで
// 選ばれたファイル（token）か、既存のアセット（uid）だけを読むことを確かめる。
//
// POI の取り込み（poisource:pickImportFile → importFile）と同じ形:
//   main が選ばれたパスを覚えて token を返し、renderer は token だけを送り返す。
//
// 固定する受け入れ条件:
//   (a) imageassets:pickImageFile の応答は { token, fileName } で、パスを含まない
//   (b) token の経路で PNG・JPEG を登録できる（リポジトリの fixture を使う）。複製は既存アセットの uid で指す
//   (c) ダイアログで選んでいないパス（旧契約の sourcePath・未知の token・未知の uid）は拒否し、アセットを作らない
//   (d) token と一緒に sourcePath を送っても sourcePath は無視する（token の指すファイルを読む）
//   (e) token の規則は POI と同じ（期限内は何度でも使える・30 分で失効・同時に 8 件まで）
//   (f) POI の token は画像の登録に使えない（表は経路ごとに別。実装は 1 つ）
//   (g) 選んだ後でファイルが消えた・画像でない場合も、失敗の応答に絶対パスを載せない
//   (h) 表の実装は 1 つ（pickedPathStore.ts）で、画像と POI の IPC がそれを使う。パスを伏せる関数も 1 つ
//       （redactPathsInResult.ts）で、両方の IPC がそれを使う
//   (i) duplicateFrom は UUID の形だけを受け付ける（絶対パス・'../x'・slug は invalid-request。
//       形の正しい未知の uid は not-found）
//
// 実行方法: node scripts/imageassets-path-token-smoke.mjs
// （vite SSR ビルド＋electron／electron-store のスタブ方式。IPC の handler を実物のまま登録させ、
// ipcMain.handle の登録を拾って呼ぶ）
import { mkdtemp, rm, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'imageassets-path-token-'));
const fixtureDir = path.join(workDir, 'fixtures');
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');
const MARKER = 'imageassets path token smoke passed';

try {
  // ---- fixture: リポジトリにある実物を、選ばれる側の場所へ写す ----
  await mkdir(fixtureDir, { recursive: true });
  const png = path.join(projectRoot, 'tests/e2e/fixtures/fake-osm-tile.png'); // 256×256
  const jpg = path.join(projectRoot, 'tests/fixtures/iiif/thumb-512.jpg'); // 512×512
  const csv = path.join(projectRoot, 'tests/fixtures/poi-io/names-utf8bom.csv');
  const fx = {
    png: path.join(fixtureDir, 'tile.png'),
    jpg: path.join(fixtureDir, 'thumb.jpg'),
    unpicked: path.join(fixtureDir, 'unpicked.jpg'),
    gone: path.join(fixtureDir, 'gone.png'),
    notImage: path.join(fixtureDir, 'not-image.png'),
  };
  await copyFile(png, fx.png);
  await copyFile(jpg, fx.jpg);
  await copyFile(jpg, fx.unpicked);
  await copyFile(png, fx.gone);
  // 拡張子は画像だが中身は CSV（デコードできない）
  await copyFile(csv, fx.notImage);

  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    const handlers = ((globalThis as any).__ipcHandlers ??= new Map());
    export const app = { isPackaged: true, getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      getVersion() { return '0.0.0'; }, whenReady() { return Promise.resolve(); }, exit() {}, on() {} };
    export const dialog = {
      showOpenDialog() {
        const p = (globalThis as any).__pickPath;
        return Promise.resolve(p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] });
      },
      showSaveDialog() { return Promise.resolve({ canceled: true }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); },
    };
    export const ipcMain = {
      handle(channel: string, fn: unknown) { handlers.set(channel, fn); },
      removeHandler(channel: string) { handlers.delete(channel); },
      on() {}, removeAllListeners() {},
    };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const BrowserWindow = class { static getAllWindows() { return []; } static fromWebContents() { return null; } };
  `);
  await writeFile(storeStub, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { rm as fsRm, readFile as fsReadFile } from 'node:fs/promises';
    import nodePath from 'node:path';
    const fx = ${JSON.stringify(fx)};
    const fixtureDir = ${JSON.stringify(fixtureDir)};
    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const realNow = Date.now;
    let clockOffset = 0;
    Date.now = () => realNow() + clockOffset;

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    await SqliteDataService.getDb();
    const { registerImageAssetHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/assets-images.ts'))});
    const { registerPoisourceHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/poisource.ts'))});
    const { PICK_TOKEN_TTL_MS, PICK_TOKEN_MAX } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/pickedPathStore.ts'))});
    registerImageAssetHandlers();
    registerPoisourceHandlers();

    const handlers = (globalThis as any).__ipcHandlers as Map<string, (...args: any[]) => any>;
    // 同梱の画面（app://bundle/）の main frame からの呼び出しとして渡す
    const event = { sender: {}, senderFrame: { url: 'app://bundle/index.html', parent: null } };
    const invoke = (channel: string, ...args: any[]) => {
      const fn = handlers.get(channel);
      assert.ok(fn, channel + ' が登録されていない');
      return fn(event, ...args);
    };
    const pick = async (filePath: string, channel = 'imageassets:pickImageFile') => {
      (globalThis as any).__pickPath = filePath;
      try { return await invoke(channel); } finally { (globalThis as any).__pickPath = null; }
    };
    const assetCount = async () => (await invoke('imageassets:list')).length;
    let seq = 0;
    const addWith = (extra: Record<string, unknown>) => {
      seq += 1;
      return invoke('imageassets:add', { slug: 'path-token-' + seq, title: { ja: 'path token ' + seq }, lang: 'ja', sourceName: 'x.png', ...extra });
    };
    const noPath = (label: string, result: any, file?: string) => {
      const text = JSON.stringify(result);
      for (const needle of [fixtureDir, workDir, dataDir, ...(file ? [file] : [])]) {
        assert.equal(text.includes(needle), false, label + ': 応答に絶対パスが含まれる: ' + text);
      }
    };
    const expectRejected = async (label: string, result: any, before: number) => {
      assert.equal(result?.result, 'Error', label + ': 拒否されていない（実際: ' + JSON.stringify(result) + '）');
      assert.equal(result.code, 'invalid-request', label + ': code が invalid-request でない（実際: ' + JSON.stringify(result) + '）');
      noPath(label, result);
      assert.equal(await assetCount(), before, label + ': アセットが作られた');
    };

    // ---- (a) ピッカの応答にパスを含めない ----
    const pickedPng = await pick(fx.png);
    assert.equal(typeof pickedPng?.token, 'string', '(a) token が返らない（実際: ' + JSON.stringify(pickedPng) + '）');
    assert.equal(pickedPng.fileName, 'tile.png');
    assert.equal('filePath' in pickedPng, false, '(a) 応答に filePath が含まれる（実際: ' + JSON.stringify(pickedPng) + '）');
    noPath('(a)', pickedPng);
    assert.equal(await pick(''), null, '(a) キャンセルは null');
    console.log('ok (a): pickImageFile は { token, fileName } だけを返す');

    // ---- (c) ダイアログで選んでいないパスは拒否する ----
    {
      const before = await assetCount();
      await expectRejected('(c) 旧契約の sourcePath', await addWith({ sourcePath: fx.unpicked }), before);
      await expectRejected('(c) 未知の token', await addWith({ token: 'no-such-token' }), before);
      await expectRejected('(c) token が文字列でない', await addWith({ token: { sourcePath: fx.unpicked } }), before);
      await expectRejected('(c) 引数が無い', await invoke('imageassets:add', undefined), before);
      const unknownDup = await addWith({ duplicateFrom: '00000000-0000-4000-8000-000000000000' });
      assert.equal(unknownDup?.result, 'Error', '(c) 未知の複製元: ' + JSON.stringify(unknownDup));
      assert.equal(unknownDup.code, 'not-found', '(c) 未知の複製元は not-found: ' + JSON.stringify(unknownDup));
      noPath('(c) 未知の複製元', unknownDup);
      assert.equal(await assetCount(), before, '(c) 未知の複製元: アセットが作られた');
      console.log('ok (c): 選んでいないパス・未知の token・未知の複製元は拒否し、アセットを作らない');
    }

    // ---- (b) token の経路で PNG・JPEG を登録できる。複製は uid で指す ----
    let pngUid = '';
    {
      const r = await addWith({ token: pickedPng.token });
      assert.equal(r.result, 'Success', '(b) PNG: ' + JSON.stringify(r));
      assert.deepEqual([r.ext, r.width, r.height], ['png', 256, 256], '(b) PNG の大きさ');
      pngUid = r.uid;
      const pickedJpg = await pick(fx.jpg);
      const rj = await addWith({ token: pickedJpg.token });
      assert.equal(rj.result, 'Success', '(b) JPEG: ' + JSON.stringify(rj));
      assert.deepEqual([rj.ext, rj.width, rj.height], ['jpg', 512, 512], '(b) JPEG の大きさ');
      const dup = await addWith({ duplicateFrom: pngUid });
      assert.equal(dup.result, 'Success', '(b) 複製: ' + JSON.stringify(dup));
      assert.deepEqual([dup.ext, dup.width, dup.height], ['png', 256, 256], '(b) 複製の大きさ');
      const original = await fsReadFile(nodePath.join(dataDir, 'assets', pngUid + '.png'));
      const copied = await fsReadFile(nodePath.join(dataDir, 'assets', dup.uid + '.png'));
      assert.ok(original.equals(copied), '(b) 複製の実体が元と一致しない');
      console.log('ok (b): token の経路で PNG・JPEG を登録でき、複製は既存アセットの uid で指せる');
    }

    // ---- (d) sourcePath を一緒に送っても無視する ----
    {
      const picked = await pick(fx.png);
      const r = await addWith({ token: picked.token, sourcePath: fx.unpicked });
      assert.equal(r.result, 'Success', '(d) ' + JSON.stringify(r));
      assert.deepEqual([r.ext, r.width], ['png', 256], '(d) sourcePath の指すファイルを読んだ');
      const d = await addWith({ duplicateFrom: pngUid, sourcePath: fx.unpicked });
      assert.deepEqual([d.result, d.ext, d.width], ['Success', 'png', 256], '(d) 複製でも sourcePath を読んだ');
      console.log('ok (d): sourcePath は無視し、token・複製元の指すファイルを読む');
    }

    // ---- (e) POI と同じ規則（期限内は何度でも・30 分で失効・8 件まで）----
    {
      assert.equal(PICK_TOKEN_TTL_MS, 30 * 60 * 1000);
      assert.equal(PICK_TOKEN_MAX, 8);
      const picked = await pick(fx.png);
      assert.equal((await addWith({ token: picked.token })).result, 'Success', '(e) 1 回目');
      assert.equal((await addWith({ token: picked.token })).result, 'Success', '(e) 期限内なら同じ token をもう一度使える');
      clockOffset += PICK_TOKEN_TTL_MS + 1000;
      await expectRejected('(e) 期限切れ', await addWith({ token: picked.token }), await assetCount());
      clockOffset = 0;
      const tokens: string[] = [];
      for (let i = 0; i < PICK_TOKEN_MAX + 1; i += 1) tokens.push((await pick(fx.png)).token);
      await expectRejected('(e) 上限で追い出された最古の token', await addWith({ token: tokens[0] }), await assetCount());
      assert.equal((await addWith({ token: tokens[1] })).result, 'Success', '(e) 追い出されていない token は使える');
      console.log('ok (e): 期限内は再利用でき、30 分で失効し、8 件を超えると最古を追い出す（POI と同じ）');
    }

    // ---- (f) POI の token は画像の登録に使えない ----
    {
      // POI のピッカに画像を選ばせる。表が共有されていれば、そのまま登録できてしまう
      const poi = await pick(fx.png, 'poisource:pickImportFile');
      assert.equal(typeof poi?.token, 'string', '(f) POI のピッカが token を返さない');
      await expectRejected('(f) POI の token', await addWith({ token: poi.token }), await assetCount());
      console.log('ok (f): POI の token は画像の登録に使えない');
    }

    // ---- (g) 失敗の応答に絶対パスを載せない ----
    {
      const gone = await pick(fx.gone);
      await fsRm(fx.gone);
      const before = await assetCount();
      const r = await addWith({ token: gone.token });
      assert.equal(r?.result, 'Error', '(g) 消えたファイル: ' + JSON.stringify(r));
      assert.equal(r.code, 'not-found', '(g) 消えたファイルは not-found: ' + JSON.stringify(r));
      noPath('(g) 消えたファイル', r, fx.gone);
      // 伏せ方は POI の取り込みと同じ（選んだパスは <file>）
      assert.equal(r.message, 'File not found: <file>', '(g) 伏せ方が POI と違う: ' + JSON.stringify(r));
      const bad = await pick(fx.notImage);
      const rb = await addWith({ token: bad.token });
      assert.equal(rb?.result, 'Error', '(g) 画像でない: ' + JSON.stringify(rb));
      assert.equal(rb.code, 'invalid-request', '(g) 画像でないものは invalid-request: ' + JSON.stringify(rb));
      noPath('(g) 画像でない', rb, fx.notImage);
      assert.equal(await assetCount(), before, '(g) アセットが作られた');
      console.log('ok (g): 選んだ後で消えた・画像でない場合も、応答に絶対パスを載せない');
    }

    // ---- (i) duplicateFrom は UUID の形だけを受け付ける ----
    {
      const before = await assetCount();
      await expectRejected('(i) duplicateFrom に絶対パス', await addWith({ duplicateFrom: fx.unpicked }), before);
      await expectRejected("(i) duplicateFrom に '../x'", await addWith({ duplicateFrom: '../x' }), before);
      const existing = (await invoke('imageassets:list'))[0];
      assert.ok(existing?.slug, '(i) 前提: 既存のアセットがある');
      await expectRejected('(i) duplicateFrom に slug', await addWith({ duplicateFrom: existing.slug }), before);
      console.log("ok (i): duplicateFrom の絶対パス・'../x'・slug は invalid-request で拒否し、アセットを作らない");
    }

    console.log(${JSON.stringify(MARKER)});
    process.exit(0);
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [
      { find: 'electron', replacement: electronStub },
      { find: 'electron-store', replacement: storeStub },
    ]},
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: {
        external: ['jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [bundled], {
      cwd: projectRoot, timeout: 300000, maxBuffer: 1024 * 1024 * 16,
    }));
  } catch (e) {
    if (e && e.stdout) process.stdout.write(e.stdout);
    if (e && e.stderr) process.stderr.write(e.stderr);
    throw e;
  }
  process.stdout.write(stdout);
  if (!stdout.includes(MARKER)) {
    throw new Error('imageassets path token smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
  }

  // ---- (h) 実装は 1 つ（ソーステキスト）----
  {
    const read = (rel) => readFile(path.join(projectRoot, rel), 'utf8');
    const store = await read('electron/utils/pickedPathStore.ts');
    assert.match(store, /export function createPickedPathStore\(/, '(h) pickedPathStore.ts に createPickedPathStore が無い');
    const redact = await read('electron/utils/redactPathsInResult.ts');
    assert.match(redact, /export function redactPathsInResult[<(]/, '(h) redactPathsInResult.ts に redactPathsInResult が無い');
    for (const rel of ['electron/ipc/assets-images.ts', 'electron/ipc/poisource.ts']) {
      const src = await read(rel);
      assert.match(src, /createPickedPathStore\(\)/, `(h) ${rel} が共通の表を使っていない`);
      assert.match(src, /redactPathsInResult\(/, `(h) ${rel} が共通のパスを伏せる関数を使っていない`);
      assert.equal(/function (withoutPathInMessage|maskPathInResult)\(/.test(src), false, `(h) ${rel} に 2 つ目のパスを伏せる実装がある`);
    }
    console.log('ok (h): token の表（pickedPathStore.ts）とパスを伏せる関数（redactPathsInResult.ts）はそれぞれ 1 つで、画像と POI の IPC が使う');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
