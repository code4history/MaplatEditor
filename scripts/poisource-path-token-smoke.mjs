// POI の取り込み（poisource:importFile・poisource:detectImportLanguage）が renderer から
// パスを受け取らず、ファイル選択のダイアログで選ばれたファイルだけを token で読むことを確かめる。
//
// 画像の一次表示（imageassets:pickImageFile → imageassets:readPickedSource）と同じ形:
//   main が選ばれたパスを覚えて token を返し、renderer は token だけを送り返す。
//
// 固定する受け入れ条件:
//   (a) poisource:pickImportFile の応答は { token, fileName } で、パスを含まない
//   (b) token の経路で GeoJSON・CSV・KML を読める（リポジトリの fixture を使う）
//   (c) ダイアログで選んでいないパス（旧契約の filePath・未知の token）は拒否し、ソースを作らない
//   (d) token と一緒に filePath を送っても filePath は無視する（token の指すファイルを読む）
//   (e) detectImportLanguage も token だけを受け取り、パスを渡されてもファイルを読まない
//   (f) token の規則は画像と同じ（期限内は何度でも使える・30 分で失効・同時に 8 件まで）
//   (g) 画像の token は POI の取り込みに使えない（表は経路ごとに別。実装は 1 つ）
//   (i) 選んだ後でファイルが消えても、失敗の応答に絶対パスを載せない（GeoJSON・CSV・ZIP の分岐）
//   (h) 表の実装は 1 つ（pickedPathStore.ts）で、画像と POI の IPC がそれを使う
//
// 実行方法: node scripts/poisource-path-token-smoke.mjs
// （vite SSR ビルド＋electron／electron-store のスタブ方式。IPC の handler を
// 実物のまま登録させ、ipcMain.handle の登録を拾って呼ぶ）
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
const workDir = await mkdtemp(path.join(scratchRoot, 'poisource-path-token-'));
const fixtureDir = path.join(workDir, 'fixtures');
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');
const MARKER = 'poisource path token smoke passed';

try {
  // ---- fixture: リポジトリにある実物を、選ばれる側の場所へ写す ----
  await mkdir(fixtureDir, { recursive: true });
  const poiIo = path.join(projectRoot, 'tests/fixtures/poi-io');
  const fx = {
    geojson: path.join(fixtureDir, 'roundtrip-source.json'),
    csv: path.join(fixtureDir, 'names-utf8bom.csv'),
    kml: path.join(fixtureDir, 'demo.kml'),
    unpicked: path.join(fixtureDir, 'merge-existing.json'),
    png: path.join(fixtureDir, 'fake-osm-tile.png'),
    imageJson: path.join(fixtureDir, 'picked-as-image.json'),
    goneGeojson: path.join(fixtureDir, 'gone.geojson'),
    goneCsv: path.join(fixtureDir, 'gone.csv'),
    goneZip: path.join(fixtureDir, 'gone.zip'),
  };
  await copyFile(path.join(poiIo, 'roundtrip-source.json'), fx.geojson);
  await copyFile(path.join(poiIo, 'names-utf8bom.csv'), fx.csv);
  await copyFile(path.join(poiIo, 'demo.kml'), fx.kml);
  await copyFile(path.join(poiIo, 'merge-existing.json'), fx.unpicked);
  await copyFile(path.join(projectRoot, 'tests/e2e/fixtures/fake-osm-tile.png'), fx.png);
  // (g) 画像のピッカに選ばせる GeoJSON（拡張子の判定では落ちない、POI として読めるファイル）
  await copyFile(path.join(poiIo, 'roundtrip-source.json'), fx.imageJson);
  // (i) 選んだ後で消すファイル（中身は読まれない。消す前に選ぶためだけに置く）
  await copyFile(path.join(poiIo, 'roundtrip-source.json'), fx.goneGeojson);
  await copyFile(path.join(poiIo, 'names-utf8bom.csv'), fx.goneCsv);
  await copyFile(path.join(poiIo, 'demo.kml'), fx.goneZip);
  const expectedCount = {
    geojson: JSON.parse(await readFile(fx.geojson, 'utf8')).features.length,
    unpicked: JSON.parse(await readFile(fx.unpicked, 'utf8')).features.length,
  };
  assert.notEqual(expectedCount.geojson, expectedCount.unpicked, 'fixture: 2 つの GeoJSON の件数が違うこと（(d) の判別に使う）');

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
    import { rm as fsRm } from 'node:fs/promises';
    const workDir = ${JSON.stringify(workDir)};
    const fx = ${JSON.stringify(fx)};
    const expectedCount = ${JSON.stringify(expectedCount)};
    const fixtureDir = ${JSON.stringify(fixtureDir)};
    const realNow = Date.now;
    let clockOffset = 0;
    Date.now = () => realNow() + clockOffset;

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    await SqliteDataService.getDb();
    const { registerPoisourceHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/poisource.ts'))});
    const { registerImageAssetHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/assets-images.ts'))});
    const { PICK_TOKEN_TTL_MS, PICK_TOKEN_MAX } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/pickedPreviewSource.ts'))});
    registerPoisourceHandlers();
    registerImageAssetHandlers();

    const handlers = (globalThis as any).__ipcHandlers as Map<string, (...args: any[]) => any>;
    // 同梱の画面（app://bundle/）の main frame からの呼び出しとして渡す
    const event = { sender: {}, senderFrame: { url: 'app://bundle/index.html', parent: null } };
    const invoke = (channel: string, ...args: any[]) => {
      const fn = handlers.get(channel);
      assert.ok(fn, channel + ' が登録されていない');
      return fn(event, ...args);
    };
    const pick = async (filePath: string, channel = 'poisource:pickImportFile') => {
      (globalThis as any).__pickPath = filePath;
      try { return await invoke(channel); } finally { (globalThis as any).__pickPath = null; }
    };
    const sourceCount = async () => (await invoke('poisource:list', { query: '', page: 1, pageSize: 100 })).total;
    const featureCount = async (uid: string) => (await invoke('poisource:get', uid)).featureCount;
    let seq = 0;
    const importWith = (extra: Record<string, unknown>) =>
      invoke('poisource:importFile', { slug: 'path-token-' + (++seq), title: { ja: 'path token ' + seq }, ...extra });
    const expectRejected = async (label: string, result: any, before: number) => {
      assert.equal(result?.result, 'Error', label + ': 拒否されていない（実際: ' + JSON.stringify(result) + '）');
      assert.equal(result.code, 'invalid-request', label + ': code が invalid-request でない（実際: ' + JSON.stringify(result) + '）');
      assert.equal(JSON.stringify(result).includes(fixtureDir), false, label + ': 応答にパスが含まれる');
      assert.equal(await sourceCount(), before, label + ': ソースが作られた');
    };

    // ---- (a) ピッカの応答にパスを含めない ----
    const pickedGeojson = await pick(fx.geojson);
    assert.equal(typeof pickedGeojson?.token, 'string', '(a) token が返らない（実際: ' + JSON.stringify(pickedGeojson) + '）');
    assert.ok(pickedGeojson.token.length >= 16, '(a) token が短すぎる');
    assert.equal(pickedGeojson.fileName, 'roundtrip-source.json');
    assert.equal('filePath' in pickedGeojson, false, '(a) 応答に filePath が含まれる');
    assert.equal(JSON.stringify(pickedGeojson).includes(fixtureDir), false, '(a) 応答にパスが含まれる');
    assert.equal(await pick(''), null, '(a) キャンセルは null');
    console.log('ok (a): pickImportFile は { token, fileName } だけを返す');

    // ---- (e) detectImportLanguage は token だけを読む ----
    assert.equal(await invoke('poisource:detectImportLanguage', pickedGeojson.token, 'de'), 'ja', '(e) token の経路で言語を判定できる');
    assert.equal(await invoke('poisource:detectImportLanguage', fx.geojson, 'de'), 'de', '(e) パスを渡すとファイルを読まずに既定の言語を返す');
    assert.equal(await invoke('poisource:detectImportLanguage', 'no-such-token', 'de'), 'de', '(e) 未知の token は既定の言語');
    console.log('ok (e): detectImportLanguage は token の指すファイルだけを読む');

    // ---- (c) ダイアログで選んでいないパスは拒否する ----
    {
      const before = await sourceCount();
      await expectRejected('(c) 旧契約の filePath', await importWith({ filePath: fx.unpicked }), before);
      await expectRejected('(c) 未知の token', await importWith({ token: 'no-such-token' }), before);
      await expectRejected('(c) token が文字列でない', await importWith({ token: { filePath: fx.unpicked } }), before);
      await expectRejected('(c) 引数が無い', await invoke('poisource:importFile', undefined), before);
      console.log('ok (c): 選んでいないパス・未知の token は拒否し、ソースを作らない');
    }

    // ---- (b) token の経路で読める（GeoJSON・CSV・KML）----
    {
      const r = await importWith({ token: pickedGeojson.token });
      assert.equal(r.result, 'Success', '(b) GeoJSON: ' + JSON.stringify(r));
      assert.equal(await featureCount(r.uid), expectedCount.geojson, '(b) GeoJSON の件数');
      const csv = await pick(fx.csv);
      const rc = await importWith({ token: csv.token });
      assert.equal(rc.result, 'Success', '(b) CSV: ' + JSON.stringify(rc));
      assert.ok((await featureCount(rc.uid)) > 0, '(b) CSV の件数が 0');
      const kml = await pick(fx.kml);
      // demo.kml は取り込みの試験用に、緯度経度が入れ替わった行（error）と Point 以外（warning）を含む。
      // ∴ 新しいソースは作られず Invalid になるが、行ごとの指摘が返ること = token の指すファイルを読めたこと
      const beforeKml = await sourceCount();
      const rk = await importWith({ token: kml.token });
      assert.equal(rk.result, 'Invalid', '(b) KML: ' + JSON.stringify(rk));
      const kmlCodes = rk.issues.map((i: any) => i.code);
      assert.ok(kmlCodes.includes('kml-non-point-skipped') && kmlCodes.includes('coord-range'), '(b) KML の中身の指摘が返らない: ' + JSON.stringify(rk));
      assert.equal(await sourceCount(), beforeKml, '(b) KML: Invalid なのにソースが作られた');
      console.log('ok (b): token の経路で GeoJSON・CSV を取り込め、KML も中身を読んで行ごとに指摘する');
    }

    // ---- (d) filePath を一緒に送っても無視する ----
    {
      const picked = await pick(fx.geojson);
      const r = await importWith({ token: picked.token, filePath: fx.unpicked });
      assert.equal(r.result, 'Success', '(d) ' + JSON.stringify(r));
      assert.equal(await featureCount(r.uid), expectedCount.geojson, '(d) filePath の指すファイルを読んだ');
      console.log('ok (d): filePath は無視し、token の指すファイルを読む');
    }

    // ---- (f) 画像と同じ規則（期限内は何度でも・30 分で失効・8 件まで）----
    {
      assert.equal(PICK_TOKEN_TTL_MS, 30 * 60 * 1000);
      assert.equal(PICK_TOKEN_MAX, 8);
      const picked = await pick(fx.geojson);
      const first = await importWith({ token: picked.token });
      const second = await importWith({ token: picked.token });
      assert.equal(first.result, 'Success', '(f) 1 回目');
      assert.equal(second.result, 'Success', '(f) 期限内なら同じ token をもう一度使える（画像と同じ）');
      clockOffset += PICK_TOKEN_TTL_MS - 1000;
      assert.equal(await invoke('poisource:detectImportLanguage', picked.token, 'de'), 'ja', '(f) 期限の直前は使える');
      clockOffset += 2000;
      const before = await sourceCount();
      await expectRejected('(f) 期限切れ', await importWith({ token: picked.token }), before);
      assert.equal(await invoke('poisource:detectImportLanguage', picked.token, 'de'), 'de', '(f) 期限切れは読まない');
      clockOffset = 0;

      const tokens: string[] = [];
      for (let i = 0; i < PICK_TOKEN_MAX + 1; i += 1) tokens.push((await pick(fx.csv)).token);
      const beforeEvict = await sourceCount();
      await expectRejected('(f) 上限で追い出された最古の token', await importWith({ token: tokens[0] }), beforeEvict);
      assert.equal((await importWith({ token: tokens[1] })).result, 'Success', '(f) 追い出されていない token は使える');
      console.log('ok (f): 期限内は再利用でき、30 分で失効し、8 件を超えると最古を追い出す（画像と同じ）');
    }

    // ---- (g) 画像の token は POI に使えない ----
    {
      // 画像のピッカに POI として読める .json を選ばせる。表が共有されていれば、拡張子の判定を
      // 素通りして取り込めてしまう ∴ 拒否されることが「表が経路ごとに別」の実効のある確かめになる
      const image = await pick(fx.imageJson, 'imageassets:pickImageFile');
      assert.equal(typeof image?.token, 'string', '(g) 画像のピッカが token を返さない');
      const before = await sourceCount();
      await expectRejected('(g) 画像の token（.json）', await importWith({ token: image.token }), before);
      assert.equal(await invoke('poisource:detectImportLanguage', image.token, 'de'), 'de', '(g) 画像の token で言語を判定できてしまう');
      const poi = await pick(fx.png);
      const read = await invoke('imageassets:readPickedSource', poi.token);
      assert.equal(read.ok, false, '(g) POI の token で画像の一次表示を読めてしまう');
      console.log('ok (g): 画像と POI の token は互いに使えない');
    }

    // ---- (i) 選んだ後でファイルが消えた: 失敗の応答に絶対パスを載せない ----
    {
      for (const [label, file] of [['GeoJSON', fx.goneGeojson], ['CSV', fx.goneCsv], ['ZIP', fx.goneZip]]) {
        const picked = await pick(file);
        await fsRm(file);
        // 言語の判定は投げずに既定の言語へ倒す（例外の原文にはパスが入る）
        assert.equal(await invoke('poisource:detectImportLanguage', picked.token, 'de'), 'de', '(i) ' + label + ': 言語の判定が既定の言語を返さない');
        const before = await sourceCount();
        const r = await importWith({ token: picked.token });
        const text = JSON.stringify(r);
        assert.equal(r?.result, 'Error', '(i) ' + label + ': 失敗にならない（実際: ' + text + '）');
        for (const needle of [fixtureDir, workDir, file]) {
          assert.equal(text.includes(needle), false, '(i) ' + label + ': 応答に絶対パスが含まれる: ' + text);
        }
        assert.equal(/[\\/]/.test(r.message ?? ''), false, '(i) ' + label + ': message にパスらしい文字列が残る: ' + text);
        assert.equal(await sourceCount(), before, '(i) ' + label + ': ソースが作られた');
      }
      console.log('ok (i): 選んだ後でファイルが消えても、応答に絶対パスを載せない');
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
    throw new Error('poisource path token smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
  }

  // ---- (h) 実装は 1 つ（ソーステキスト）----
  {
    const read = (rel) => readFile(path.join(projectRoot, rel), 'utf8');
    const store = await read('electron/utils/pickedPathStore.ts');
    assert.match(store, /export function createPickedPathStore\(/, '(h) pickedPathStore.ts に createPickedPathStore が無い');
    const preview = await read('electron/utils/pickedPreviewSource.ts');
    assert.equal(/function createPickedPathStore\(/.test(preview), false, '(h) pickedPreviewSource.ts に 2 つ目の実装がある');
    for (const rel of ['electron/ipc/poisource.ts', 'electron/ipc/assets-images.ts']) {
      const src = await read(rel);
      assert.match(src, /createPickedPathStore\(\)/, `(h) ${rel} が共通の表を使っていない`);
    }
    console.log('ok (h): token の表の実装は pickedPathStore.ts の 1 つで、画像と POI の IPC が使う');
  }

} finally {
  await rm(workDir, { recursive: true, force: true });
}
