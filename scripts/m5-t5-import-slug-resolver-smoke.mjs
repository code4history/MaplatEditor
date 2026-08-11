// m5-t5 AC1: import の slug 解決を唯一の正本へ集約する（タスク設計 v1.4 §5.1）。
//
// 固定する受け入れ条件:
//   AC1(a) 共有 API `resolveImportSlug` が **1つだけ** 定義されている
//   AC1(b) §5.1 の4経路すべてが共有 API を呼ぶ
//          1 POI .zip / 2 POI .geojson / 3 地図ZIP同梱 managed POI 復元 / 4 地図 ZIP
//   AC1(c) `PoiSourceService` の private 実装が **残っていない**
//   AC1(d) 契約 — 空入力は素通し / 枯渇は null / 予約はしない
//
// 【なぜソース assert を併用するか】
// 挙動だけを見ると「4経路が同じ結果を返す」ことは確かめられるが、
// **同じ規則を4箇所に書いても同じ結果になる**。二重実装が残っていないことは
// 挙動からは証明できない ∴ 定義の一意性はソースで固定する。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const resolverPath = path.join(projectRoot, 'electron/services/importSlugResolver.ts');

// ---- AC1(a): 共有 API が実在し、定義が1つだけ ----
assert.equal(existsSync(resolverPath), true,
  'AC1(a): electron/services/importSlugResolver.ts が存在すること（import 方針の唯一の正本）');
const resolverSrc = await readFile(resolverPath, 'utf8');
assert.match(resolverSrc, /export async function resolveImportSlug/,
  'AC1(a): resolveImportSlug を export していること');
assert.equal(/base2|base3|base100/.test(resolverSrc), false,
  'AC1(a): 新規モジュールに旧採番規則の記述が無いこと');

// 定義の一意性: リポジトリ全体で `resolveImportSlug` の **定義** は1つだけ
const definitionOwners = [];
for (const dir of ['electron', 'src']) {
  const { stdout } = await execFileAsync('grep', [
    '-rn', '--include=*.ts', '--include=*.vue', '-E',
    '(async +)?function +resolveImportSlug|private +async +resolveImportSlug|resolveImportSlug *\\(.*\\) *: *Promise',
    path.join(projectRoot, dir),
  ]).catch((e) => ({ stdout: e.stdout || '' }));
  for (const line of stdout.split('\n').filter(Boolean)) definitionOwners.push(line);
}
assert.equal(definitionOwners.length, 1,
  'AC1(a): resolveImportSlug の定義はリポジトリ全体で1つだけであること（実際:\n'
    + definitionOwners.join('\n') + '\n）');
assert.match(definitionOwners[0], /importSlugResolver\.ts/,
  'AC1(a): その唯一の定義が importSlugResolver.ts にあること（実際: ' + definitionOwners[0] + '）');
console.log('ok AC1(a): 共有 API の定義が1つだけ');

// ---- AC1(c): PoiSourceService の private 実装が残っていない ----
const poiSourceSrc = await readFile(path.join(projectRoot, 'electron/services/PoiSourceService.ts'), 'utf8');
assert.equal(/private\s+async\s+resolveImportSlug/.test(poiSourceSrc), false,
  'AC1(c): PoiSourceService の private resolveImportSlug が削除されていること');
assert.equal(/findAvailableSlug/.test(poiSourceSrc), false,
  'AC1(c): PoiSourceService が候補生成を直接呼ばないこと（共有 API 経由にする）');
assert.match(poiSourceSrc, /from '\.\/importSlugResolver'/,
  'AC1(c): PoiSourceService が共有 API を import していること');
console.log('ok AC1(c): private 実装が残っていない');

// ---- AC1(b): 4経路が共有 API を呼ぶ（呼び出し側のソース確認）----
const callSites = [
  { file: 'electron/services/PoiSourceService.ts', min: 3, label: '経路1-3（POI .zip / .geojson / managed POI 復元）' },
  { file: 'electron/services/DataUploadService.ts', min: 1, label: '経路4（地図 ZIP）' },
  { file: 'electron/services/PoiPackageService.ts', min: 1, label: '経路5（画像 asset import）' },
];
for (const { file, min, label } of callSites) {
  const src = await readFile(path.join(projectRoot, file), 'utf8');
  const calls = (src.match(/resolveImportSlug\s*\(/g) || []).length;
  assert.ok(calls >= min,
    `AC1(b): ${file} が共有 API を ${min} 箇所以上呼ぶこと — ${label}（実際: ${calls}）`);
}
console.log('ok AC1(b): 4経路（＋経路5）が共有 API を呼ぶ');

// ---- AC1(d): 契約の実挙動 ----
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t5-resolver-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); } };
    export const ipcMain = { handle() {} };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
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
    import crypto from 'node:crypto';

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { resolveImportSlug } = await import(${JSON.stringify(resolverPath)});
    const { SEQUENCE_MAX_INDEX, slugCandidate } = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/slugSequence.ts'))});

    // (d-1) 空入力は素通し（呼び出し側の invalid-request 検査へ委ねる）
    assert.equal(await resolveImportSlug(''), '',        'AC1(d): 空文字はそのまま返る');
    assert.equal(await resolveImportSlug('   '), '',     'AC1(d): 空白のみは trim して空文字');
    assert.equal(await resolveImportSlug(null), '',      'AC1(d): null は空文字');
    assert.equal(await resolveImportSlug(undefined), '', 'AC1(d): undefined は空文字');

    // (d-2) 空きがあれば素の base
    assert.equal(await resolveImportSlug('free-slug'), 'free-slug', 'AC1(d): 未使用なら base そのもの');

    // (d-3) 衝突すると base-2 へ（実 DB を使う。規則の再実装をしない）
    await SqliteDataService.createMap('taken', { mapID: 'taken', title: 't', gcps: [], edges: [] });
    assert.equal(await resolveImportSlug('taken'), 'taken-2', 'AC1(d): 衝突時は base-2');
    await SqliteDataService.createMap('taken-2', { mapID: 'taken-2', title: 't', gcps: [], edges: [] });
    assert.equal(await resolveImportSlug('taken'), 'taken-3', 'AC1(d): 連続衝突で base-3');

    // (d-4) **予約はしない** — 同じ入力を2回呼べば同じ答えが返る
    assert.equal(await resolveImportSlug('taken'), 'taken-3',
      'AC1(d): 解決しただけでは予約されない ∴ 2回目も同じ候補が返る');

    // (d-5) 枯渇は null（上限を下げず実際に埋める）
    for (let n = 1; n <= SEQUENCE_MAX_INDEX; n++) {
      const s = slugCandidate('full', n);
      await SqliteDataService.createMap(s, { mapID: s, title: 't', gcps: [], edges: [] });
    }
    assert.equal(await resolveImportSlug('full'), null, 'AC1(d): 全候補が埋まっていれば null');

    // (d-6) excludeUid — 自分自身の slug は衝突扱いにしない（POI の上書き保存経路が使う）
    const { uid: ownUid } = await SqliteDataService.createMap('own', { mapID: 'own', title: 't', gcps: [], edges: [] });
    assert.equal(await resolveImportSlug('own', { excludeUid: ownUid }), 'own',
      'AC1(d): excludeUid 指定時は自分の slug をそのまま採れる');
    assert.equal(await resolveImportSlug('own'), 'own-2',
      'AC1(d): excludeUid 無しなら衝突として扱う');

    console.log('ok AC1(d): 契約（空入力素通し / 衝突は base-2 / 予約しない / 枯渇 null / excludeUid）');
    console.log('m5-t5 import slug resolver OK');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 120000, maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  console.log('m5-t5 import slug resolver smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
