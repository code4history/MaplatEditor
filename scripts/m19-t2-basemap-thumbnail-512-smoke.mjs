// m19-t2 smoke: ベースマップ管理のサムネイル操作を地図管理と同型にする（512px/52px）。
// タスク設計 `docs/superpowers/specs/2026-08-09-m19-t2-basemap-thumbnail-512-design.md` v1.2 §12.2 準拠。
//
// 対象ケース（設計 §12.2）と対応 AC（設計 §11）:
//   S1  thumb512PathFor の全域性 + ビルトイン 329 件の thumbnail512 明示属性との完全一致   -> AC1
//   S2  public/basemap_icons と basemap_icons_512 の basename 集合一致                     -> AC1
//   S3  replaceMapThumbnail(win, key, '512', true, 'png') が _512.png と .png を書く        -> AC3
//   S4  replaceMapThumbnail(win, key, '512', true)（ext 省略）が .jpg 規約を保つ            -> AC4
//   S5  user ベースマップ書き出しで tmbs/{slug}.png と tmbs/{slug}_512.png の両方が出る     -> AC9
//   S6  BaseMapEditDocument / BaseMapSavePayload に thumbnail512 が無い                      -> AC8
//   S7  11 言語の basemap.thumbnail_* 4 キーが揃い、mapedit.thumbnail_* が消えていない      -> AC10
//   S8  返値セマンティクス（§6.1.1）と規則 U の機械証明 + 禁止形のソーステキスト assert     -> AC15(a)(c)
//   S9  grep 系の受け入れ条件（インライン派生の不在・置換経路の単一性・結線）              -> AC2/AC3/AC14
//
// m6-t10 / m12-t15-r4-export と同型 harness（vite SSR ビルド + electron/electron-store スタブ +
// saveFolder=一時dir）で、実サービス（AppAssetService / AppExportService / SqliteDataService）を直接呼ぶ。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm19-t2-thumb512-'));
const entryFile = path.join(workDir, 'm19-t2-thumb512-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm19-t2-thumb512-smoke.mjs');

const dataDir = path.join(workDir, 'data');
const exportDir = path.join(workDir, 'export-out');
await mkdir(dataDir, { recursive: true });
await mkdir(exportDir, { recursive: true });

// 1x1 PNG（S10 のローカルタイルサーバーが返すタイル）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const thumbnailPathsFile = path.join(projectRoot, 'src/utils/thumbnailPaths.ts');
const builtinFile = path.join(projectRoot, 'electron/builtin_base_maps.json');
const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
const appAssetServicePath = path.join(projectRoot, 'electron/services/AppAssetService.ts');
const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');

await writeFile(
  electronStubFile,
  `
    export const app = {
      getPath(name: string) {
        if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
        if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
        if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
        return ${JSON.stringify(workDir)};
      },
      getName() { return 'MaplatEditorSmoke'; },
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const dialog = {
      // pickImage(): globalThis.__pickImagePath を返す（null でキャンセル扱い）
      async showOpenDialog(_win: any, _opts: any) {
        const p = (globalThis as any).__pickImagePath;
        if (!p) return { canceled: true, filePaths: [] };
        return { canceled: false, filePaths: [p] };
      },
      async showSaveDialog(_win: any, _opts: any) {
        return (globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined };
      },
      async showMessageBox() { return { response: 0 }; },
    };
    export const BrowserWindow = class {
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); }, webRequest: { onBeforeRequest: () => {} } } };
    export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
  `,
);
await writeFile(
  electronStoreStubFile,
  `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `,
);

// ---- ホスト側で先に済ませられる assert（バンドル不要なもの）----------------------

// S2: basemap_icons と basemap_icons_512 の basename 集合一致
{
  const a = (await readdir(path.join(projectRoot, 'public/basemap_icons'))).sort();
  const b = (await readdir(path.join(projectRoot, 'public/basemap_icons_512'))).sort();
  assert.deepEqual(a, b, 'S2: basemap_icons と basemap_icons_512 の basename 集合が一致する');
  console.log(`ok: S2 basemap_icons / basemap_icons_512 basename 完全一致（${a.length} 件）`);
}

// S6: BaseMapEditDocument / BaseMapSavePayload に thumbnail512 が無い（ソーステキスト assert）
{
  const docSrc = await readFile(path.join(projectRoot, 'src/utils/baseMapEditorDocument.ts'), 'utf8');
  assert.equal(/thumbnail512/.test(docSrc), false, 'S6: baseMapEditorDocument.ts に thumbnail512 を追加していない');
  const dtsSrc = await readFile(path.join(projectRoot, 'src/electron.d.ts'), 'utf8');
  assert.equal(/thumbnail512/.test(dtsSrc), false, 'S6: electron.d.ts（BaseMapSavePayload 等）に thumbnail512 を追加していない');
  // AC8(c): renderer は thumbnail512 明示属性を一切読まない（thumbnail512Url は ref 名なので除外）
  const srcHits = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/\.(ts|vue|js)$/.test(entry.name)) continue;
      const text = await readFile(full, 'utf8');
      for (const line of text.split('\n')) {
        if (line.includes('thumbnail512') && !line.includes('thumbnail512Url')) srcHits.push(`${full}: ${line.trim()}`);
      }
    }
  };
  await walk(path.join(projectRoot, 'src'));
  assert.deepEqual(srcHits, [], 'S6/AC8(c): renderer(src/) が thumbnail512 明示属性を読んでいない');
  console.log('ok: S6 thumbnail512 属性の非追加（AC8 a/b/c）');
}

// S7 / S9 は「実装後の最終形」を検査するため、バンドル実行のあとに回す（末尾で呼ぶ）。
const runLateStaticChecks = async () => {

// S7: 11 言語の basemap.thumbnail_* 4 キー + mapedit.thumbnail_* の非削除
{
  const langs = (await readdir(path.join(projectRoot, 'public/locales'))).sort();
  assert.equal(langs.length, 11, `S7: locales は 11 言語（実測 ${langs.length}）`);
  const required = ['thumbnail_manage', 'thumbnail_replace_512', 'thumbnail_replace_52', 'thumbnail_derive_52'];
  for (const lang of langs) {
    const json = JSON.parse(await readFile(path.join(projectRoot, 'public/locales', lang, 'translation.json'), 'utf8'));
    for (const key of required) {
      assert.ok(json.basemap && typeof json.basemap[key] === 'string' && json.basemap[key].length > 0,
        `S7: ${lang} に basemap.${key} が必要`);
      assert.ok(json.mapedit && typeof json.mapedit[key] === 'string',
        `S7: ${lang} の mapedit.${key} を削除していない（共有面 1: t1 のセクションへ侵入しない）`);
    }
  }
  console.log(`ok: S7 basemap.thumbnail_* 4 キー × ${langs.length} 言語 + mapedit.thumbnail_* 温存`);
}

// S9: grep 系の受け入れ条件（AC2 / AC3 / AC14）
{
  const countMatches = (text, re) => text.split('\n').filter((l) => re.test(l)).length;

  // AC2(a): AppAssetService.ts のインライン _512 派生が 0
  const assetSrc = await readFile(appAssetServicePath, 'utf8');
  assert.equal(countMatches(assetSrc, /_512/), 0,
    'AC2(a): AppAssetService.ts に _512 リテラルが残っていない（thumb512PathFor 経由）');

  // AC3: 置換経路の単一性 + 本体に tmbs/ リテラルが無い
  assert.equal(countMatches(assetSrc, /async replaceMapThumbnail/), 1,
    'AC3: replaceMapThumbnail は 1 実装のみ（並行実装なし）');
  assert.equal(countMatches(assetSrc, /['"`]tmbs\//), 0,
    'AC3: AppAssetService.ts の本体に tmbs/ リテラルが無い（thumb52PathFor / thumb512PathFor へ集約）');

  // AC2(b): AppExportService.ts のベースマップ分岐に 512px パスのインライン派生が 0。
  //   needle は `_512\.`（= パスリテラル）。素の `_512` は i18n キー名等も拾うため使わない（v1.2）。
  //   地図分岐の 3 行は t5 所有のため対象外。行番号ではなく節の境界で切り出して判定する。
  const exportSrc = await readFile(appExportServicePath, 'utf8');
  const baseMapThumbStart = exportSrc.indexOf('// 3) ベースマップのサムネイル');
  const baseMapThumbEnd = exportSrc.indexOf('// 3b)');
  assert.ok(baseMapThumbStart > 0 && baseMapThumbEnd > baseMapThumbStart,
    'AC2(b): ベースマップのサムネイル節を特定できる');
  const baseMapThumbSection = exportSrc.slice(baseMapThumbStart, baseMapThumbEnd);
  assert.equal(countMatches(baseMapThumbSection, /_512\./), 0,
    'AC2(b): ベースマップ分岐に 512px パスのインライン派生が無い（thumb512PathFor 経由）');
  assert.equal(countMatches(exportSrc, /_512\./), 3,
    `AC2(b): 残る _512. は地図分岐の 3 行のみ（t5 所有。実測 ${countMatches(exportSrc, /_512\./)}）`);

  // AC2(c): BaseMapEdit.vue に 512px パスのインライン派生が 0。
  //   needle は `_512\.`。i18n キー `basemap.thumbnail_replace_512` と testid は派生ではないため対象外（v1.2）。
  const baseMapEditSrc = await readFile(path.join(projectRoot, 'src/components/basemap/BaseMapEdit.vue'), 'utf8');
  assert.equal(countMatches(baseMapEditSrc, /_512\./), 0,
    'AC2(c): BaseMapEdit.vue に 512px パスのインライン派生が無い');

  // AC2(d)（v1.2 で再定式化）: SqliteDataService.ts の `_512\b` 一致件数が現況 11 から増えない
  const sqliteSrc = await readFile(sqlitePath, 'utf8');
  const sqliteHits = countMatches(sqliteSrc, /_512\b/);
  assert.ok(sqliteHits <= 11,
    `AC2(d): SqliteDataService.ts の _512\\b 一致件数が増えていない（現況 11 / 実測 ${sqliteHits}）`);

  // S8(e) / AC15(c): 規則 U 違反形（禁止形）の再混入防止
  assert.equal(baseMapEditSrc.split('path52 ?? path').length - 1, 0,
    'AC15(c): BaseMapEdit.vue に禁止形 `path52 ?? path` が無い');
  assert.equal(baseMapEditSrc.split('path ?? path52').length - 1, 0,
    'AC15(c): BaseMapEdit.vue に禁止形 `path ?? path52` が無い');

  // AC14 (rule-0012): 新規検証スクリプトが package.json に結線されている
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const wired = Object.entries(pkg.scripts).filter(([, v]) => v.includes('m19-t2'));
  assert.equal(wired.length, 2,
    `AC14: package.json に m19-t2 の smoke / e2e が結線されている（実測 ${wired.length}: ${JSON.stringify(wired)}）`);

  console.log('ok: S9 grep 系 AC（AC2 a/b/c/d・AC3・AC14・AC15(c)）');
}

};

// ---- バンドルして実サービスを直接叩く（S1 / S3 / S4 / S5 / S8）--------------------

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import fs from 'node:fs/promises';
    import fse from 'fs-extra';
    import { Jimp } from 'jimp';
    import AdmZip from 'adm-zip';

    import { THUMB_512_EXT, thumb512PathFor, thumb52PathFor } from ${JSON.stringify(thumbnailPathsFile)};
    import builtin from ${JSON.stringify(builtinFile)};

    const dataDir = ${JSON.stringify(dataDir)};
    const exportDir = ${JSON.stringify(exportDir)};
    const workDir = ${JSON.stringify(workDir)};

    // ============ S1: thumb512PathFor の全域性 + ビルトイン全件との一致 ============
    {
      // (b)(c) 接尾辞規則。ビルトイン 329 件はすべて basemap_icons/ 参照であり実データでは
      //        ディレクトリ差替え規則しか検証されないため、接尾辞規則は合成パターンで担保する
      //        （設計レビュー v1 Info-4）
      assert.equal(thumb512PathFor('tmbs/a.png'), 'tmbs/a_512.png', 'S1(b): tmbs 接尾辞規則（png）');
      assert.equal(thumb512PathFor('tmbs/a.jpg'), 'tmbs/a_512.jpg', 'S1(c): tmbs 接尾辞規則（jpg）');
      // (d) ディレクトリ差替え規則
      assert.equal(thumb512PathFor('basemap_icons/x.png'), 'basemap_icons_512/x.png', 'S1(d): ディレクトリ差替え規則');
      // (e) 全域性（定義域外は null）
      assert.equal(thumb512PathFor('img/x.png'), null, 'S1(e): tmbs/ でも basemap_icons/ でもなければ null');
      assert.equal(thumb512PathFor(''), null, 'S1(e): 空文字は null');
      assert.equal(thumb512PathFor('tmbs/noext'), null, 'S1(e): 拡張子が無ければ null');
      // 二重適用の検出（INV-T が破れた場合に何が起きるかの固定。§6.2.1）
      assert.equal(thumb512PathFor('tmbs/a_512.png'), 'tmbs/a_512_512.png',
        'S1: 512px パスを再適用すると _512_512 になる（INV-T を破ってはならない理由）');
      // thumb52PathFor
      assert.equal(thumb52PathFor('abc', 'png'), 'tmbs/abc.png', 'S1: thumb52PathFor（png）');
      assert.equal(thumb52PathFor('abc', 'jpg'), 'tmbs/abc.jpg', 'S1: thumb52PathFor（jpg。地図の既定）');
      // t5 の吸収点（現行は null = 入力の拡張子を引き継ぐ）
      assert.equal(THUMB_512_EXT, null, 'S1: THUMB_512_EXT の現行値は null（m19-t5 が webp へ変える 1 定数）');

      // (a) ビルトイン全件で 派生 === 明示属性
      const withAttr = builtin.filter((e) => 'thumbnail512' in e);
      assert.ok(withAttr.length > 0, 'S1(a): thumbnail512 を持つビルトインが存在する');
      const mismatch = withAttr.filter((e) => thumb512PathFor(e.thumbnail) !== e.thumbnail512);
      assert.equal(mismatch.length, 0,
        'S1(a): ビルトイン ' + withAttr.length + ' 件すべてで 派生 === thumbnail512（不一致 ' + mismatch.length + '）: '
          + JSON.stringify(mismatch.slice(0, 3)));
      console.log('ok: S1 thumb512PathFor 全域性 + ビルトイン ' + withAttr.length + ' 件と完全一致（不一致 0）');
    }

    // ---- 以降は実サービス（saveFolder = 一時 dir）----
    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('lang', 'ja');
    const { default: AppAssetService } = await import(${JSON.stringify(appAssetServicePath)});

    // 置換のソース画像（600x400。長辺 512 / 52 への縮小を確認できる大きさ）
    const srcImagePath = nodePath.join(workDir, 'source-600x400.png');
    {
      const img = new Jimp({ width: 600, height: 400, color: 0xff0000ff });
      await img.write(srcImagePath as \`\${string}.\${string}\`);
    }
    const fakeWin = { webContents: { send() {} } } as any;
    const exists = (p) => fs.stat(p).then(() => true).catch(() => false);
    const longSide = async (p) => { const i = await Jimp.read(p); return Math.max(i.width, i.height); };

    // ============ S3: ext='png' で tmbs/{key}_512.png と tmbs/{key}.png を書く ============
    {
      (globalThis as any).__pickImagePath = srcImagePath;
      const key = 's3-basemap';
      const r = await AppAssetService.replaceMapThumbnail(fakeWin, key, '512', true, 'png');
      assert.ok(!r.err, 'S3: 成功する: ' + JSON.stringify(r));
      const p512 = nodePath.join(dataDir, 'tmbs', key + '_512.png');
      const p52 = nodePath.join(dataDir, 'tmbs', key + '.png');
      assert.ok(await exists(p512), 'S3: tmbs/{key}_512.png が書かれる');
      assert.ok(await exists(p52), 'S3: tmbs/{key}.png が書かれる（derive52）');
      assert.equal(await longSide(p512), 512, 'S3: 512px 側の長辺は 512');
      assert.equal(await longSide(p52), 52, 'S3: 52px 側の長辺は 52');
      console.log('ok: S3 ext=png の 512/52 同時書き込み');
    }

    // ============ S4: ext 省略時は .jpg 規約（地図側の既定挙動が不変） ============
    {
      (globalThis as any).__pickImagePath = srcImagePath;
      const key = 's4-map-uid';
      const r = await AppAssetService.replaceMapThumbnail(fakeWin, key, '512', true);
      assert.ok(!r.err, 'S4: 成功する: ' + JSON.stringify(r));
      assert.ok(await exists(nodePath.join(dataDir, 'tmbs', key + '_512.jpg')), 'S4: ext 省略で tmbs/{key}_512.jpg');
      assert.ok(await exists(nodePath.join(dataDir, 'tmbs', key + '.jpg')), 'S4: ext 省略で tmbs/{key}.jpg');
      assert.equal(await exists(nodePath.join(dataDir, 'tmbs', key + '_512.png')), false, 'S4: png は書かれない');
      console.log('ok: S4 ext 省略時の .jpg 既定（地図側 parity）');
    }

    // ============ S8: 返値セマンティクス（§6.1.1）と規則 U の機械証明 ============
    {
      // (a) kind='512', derive52=false → path は 512px / path52 は undefined
      (globalThis as any).__pickImagePath = srcImagePath;
      const k = 's8-a';
      const a = await AppAssetService.replaceMapThumbnail(fakeWin, k, '512', false, 'png');
      assert.equal(a.path, 'tmbs/' + k + '_512.png', 'S8(a): path は 512px の相対パス');
      assert.equal(a.path52, undefined, 'S8(a): path52 は undefined（← path52 ?? path が 512px を掴む理由）');
      assert.ok(a.fileUrl && a.fileUrl.includes(k + '_512.png'), 'S8(a): fileUrl は 512px');
      assert.equal(a.fileUrl52, undefined, 'S8(a): fileUrl52 は undefined');
      assert.equal(await exists(nodePath.join(dataDir, 'tmbs', k + '.png')), false, 'S8(a): 52px は書かれない');

      // (b) kind='512', derive52=true → path=512px / path52=52px
      (globalThis as any).__pickImagePath = srcImagePath;
      const kb = 's8-b';
      const b = await AppAssetService.replaceMapThumbnail(fakeWin, kb, '512', true, 'png');
      assert.equal(b.path, 'tmbs/' + kb + '_512.png', 'S8(b): path は 512px');
      assert.equal(b.path52, 'tmbs/' + kb + '.png', 'S8(b): path52 は 52px');

      // (c) kind='52' → path=52px / path52 は undefined（derive52 は無視される）
      (globalThis as any).__pickImagePath = srcImagePath;
      const kc = 's8-c';
      const c = await AppAssetService.replaceMapThumbnail(fakeWin, kc, '52', true, 'png');
      assert.equal(c.path, 'tmbs/' + kc + '.png', 'S8(c): path は 52px');
      assert.equal(c.path52, undefined, 'S8(c): path52 は常に undefined');
      assert.equal(await exists(nodePath.join(dataDir, 'tmbs', kc + '_512.png')), false, 'S8(c): 512px は書かれない');

      // 失敗経路（Canceled）: すべて undefined
      (globalThis as any).__pickImagePath = null;
      const f = await AppAssetService.replaceMapThumbnail(fakeWin, 's8-f', '512', true, 'png');
      assert.equal(f.err, 'Canceled', 'S8: キャンセルは err=Canceled');
      assert.equal(f.path, undefined, 'S8: 失敗時 path は undefined');
      assert.equal(f.path52, undefined, 'S8: 失敗時 path52 は undefined');

      // (d) いずれの経路でも _512_512 は生成されない
      for (const key of [k, kb, kc]) {
        assert.equal(await exists(nodePath.join(dataDir, 'tmbs', key + '_512_512.png')), false,
          'S8(d): ' + key + ' で _512_512 が生成されない');
      }

      // 規則 U のテーブルそのものを固定する（renderer 実装が写すべき式）
      const written52 = (kind, r) => (kind === '52' ? r.path : r.path52);
      assert.equal(written52('512', a), undefined, 'S8/規則U: derive52 OFF の 512px 置換は 52px を書いていない');
      assert.equal(written52('512', b), 'tmbs/' + kb + '.png', 'S8/規則U: derive52 ON では path52 が新しい 52px');
      assert.equal(written52('52', c), 'tmbs/' + kc + '.png', 'S8/規則U: kind=52 では path が新しい 52px');
      console.log('ok: S8 返値セマンティクス 3 組み合わせ + 規則 U の式');
    }

    // ============ S5: user ベースマップ書き出しで 512px も同梱される（ADR-0007 違反 B） ============
    {
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      await SqliteDataService.getDb();

      const UID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
      const SLUG = 'thumb512-export';
      // uid 名で実体を置く（内部ストレージキーは uid。ADR-0007）
      await fse.ensureDir(nodePath.join(dataDir, 'tmbs'));
      const src = await fs.readFile(srcImagePath);
      await fs.writeFile(nodePath.join(dataDir, 'tmbs', UID + '.png'), src);
      await fs.writeFile(nodePath.join(dataDir, 'tmbs', UID + '_512.png'), src);

      await SqliteDataService.saveUserBaseMap({
        uid: UID, slug: SLUG, create: true,
        tms: {
          kind: 'tms', lang: 'ja', title: { ja: '512 書き出し' }, label: { ja: '512' },
          attr: { ja: '作者' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL',
          licenseNote: {}, dataLicenseNote: {},
          url: 'https://tiles.example.test/{z}/{x}/{y}.png',
          minZoom: 5, maxZoom: 18,
          thumbnail: 'tmbs/' + UID + '.png',
          coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null,
        },
      });

      const zipPath = nodePath.join(exportDir, 's5.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
      const doc = {
        appID: 's5_app', title: { ja: 'S5' }, lang: 'ja',
        sources: [{ sourceType: 'tms', mapUid: SLUG, baseMapUid: UID, role: 'base', startFrom: true, overrides: {} }],
        appSettings: {}, httpSettings: {},
      };
      const exported = await AppExportService.exportApp(fakeWin, doc);
      assert.equal(exported.result, 'Success', 'S5: 書き出し成功: ' + JSON.stringify(exported));
      const names = new AdmZip(exported.outDir).getEntries().map((e) => e.entryName);
      assert.ok(names.includes('tmbs/' + SLUG + '.png'),
        'S5: 52px が slug 名で同梱される: ' + JSON.stringify(names.filter((n) => n.startsWith('tmbs/'))));
      assert.ok(names.includes('tmbs/' + SLUG + '_512.png'),
        'S5/AC9: 512px も slug 名で同梱される（uid 名のコピー元から解決。ADR-0007 違反 B の是正）: '
          + JSON.stringify(names.filter((n) => n.startsWith('tmbs/'))));
      assert.equal(names.includes('tmbs/' + UID + '_512.png'), false, 'S5: uid 名は出力へ漏れない（ADR-0007 export 契約）');
      console.log('ok: S5 ベースマップ 512px の package 同梱（uid → slug 解決）');
    }

    // ============ S10: 新規ベースマップの「存在範囲から生成 → 初回保存」で 512px が残る ============
    // 人間検証で見つかった欠陥の回帰。実フロー（生成は暫定名＝slug 名で書かれ、初回保存で
    // uid 名へ付け替わる）を実サービスでそのまま踏む。
    {
      const nodeHttp = await import('node:http');
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      await SqliteDataService.getDb();

      const tilePng = Buffer.from(${JSON.stringify(PNG_B64)}, 'base64');
      const server = nodeHttp.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(tilePng);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const tmsUrl = 'http://127.0.0.1:' + port + '/{z}/{x}/{y}.png';

      const SLUG = 's10-generate-then-save';
      const UID = 'ffffffff-6666-4666-8666-ffffffffffff';
      const coverage = [[139.7, 35.6], [139.8, 35.7]];

      // 未保存の新規ベースマップ: iconFileKey() は slug を返すため暫定名で書かれる
      const gen = await AppAssetService.generateTmsThumbnail(SLUG, { url: tmsUrl, minZoom: 0, maxZoom: 18 }, coverage);
      server.close();
      assert.ok(!gen.err, 'S10: 存在範囲から生成が成功する: ' + JSON.stringify(gen));
      assert.equal(gen.path, 'tmbs/' + SLUG + '.png', 'S10: 生成の返値は 52px の暫定名');
      assert.ok(await exists(nodePath.join(dataDir, 'tmbs', SLUG + '.png')), 'S10: 生成直後は 52px が暫定名で在る');
      assert.ok(await exists(nodePath.join(dataDir, 'tmbs', SLUG + '_512.png')), 'S10: 生成直後は 512px が暫定名で在る');

      // 初回保存（create=true・preset uid）→ relocateBaseMapIcon が uid 名へ付け替える
      const saved = await SqliteDataService.saveUserBaseMap({
        uid: UID, slug: SLUG, create: true,
        tms: {
          kind: 'tms', lang: 'ja', title: { ja: 'S10' }, label: { ja: 'S10' },
          attr: { ja: 'attr' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL',
          licenseNote: {}, dataLicenseNote: {},
          url: 'https://tiles.example.test/{z}/{x}/{y}.png',
          minZoom: 0, maxZoom: 18,
          thumbnail: gen.path,
          coverageLngLats: coverage, tileJsonSourceUrl: null, sourceMapUid: null,
        },
      });
      assert.equal(saved.uid, UID, 'S10: preset uid で保存される');

      // 本欠陥の核心: 52px だけでなく 512px も uid 名へ寄っていること
      assert.ok(await exists(nodePath.join(dataDir, 'tmbs', UID + '.png')),
        'S10: 保存後は 52px が uid 名で在る');
      assert.ok(await exists(nodePath.join(dataDir, 'tmbs', UID + '_512.png')),
        'S10: 保存後は 512px も uid 名で在る（初回保存で 512px が消える欠陥の回帰）');
      assert.equal(await exists(nodePath.join(dataDir, 'tmbs', SLUG + '_512.png')), false,
        'S10: 512px の暫定名が取り残されていない');
      assert.equal(await exists(nodePath.join(dataDir, 'tmbs', SLUG + '.png')), false,
        'S10: 52px の暫定名が取り残されていない');

      // 文書の thumbnail は 52px の uid 名を指す（INV-T）
      const rows = await SqliteDataService.listBaseMaps();
      const row = rows.find((r) => r.uid === UID);
      assert.ok(row, 'S10: 保存されたベースマップが一覧に居る');
      assert.equal(row.data.thumbnail, 'tmbs/' + UID + '.png', 'S10: thumbnail は 52px の uid 名');
      console.log('ok: S10 生成 → 初回保存で 512px が uid 名へ寄る');
    }

    console.log('m19-t2 basemap thumbnail 512 smoke: ALL PASS');
  `,
);

await build({
  configFile: false,
  logLevel: 'silent',
  resolve: {
    alias: [
      { find: 'electron', replacement: electronStubFile },
      { find: 'electron-store', replacement: electronStoreStubFile },
    ],
  },
  build: {
    emptyOutDir: true,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/],
      output: { entryFileNames: 'm19-t2-thumb512-smoke.mjs', format: 'es' },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 180000,
  maxBuffer: 1024 * 1024 * 8,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

await runLateStaticChecks();
console.log('m19-t2 basemap thumbnail 512 smoke: 静的検査も含め ALL PASS');
