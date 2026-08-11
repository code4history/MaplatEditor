// m19-t5 smoke: 512px サムネイルの webp 統一。
// タスク設計 `docs/superpowers/specs/2026-08-10-m19-t5-thumbnail-512-webp-design.md` v1.0 §10 準拠。
//
// 対象パートと対応 AC（設計 §10）:
//   A  THUMB_512_EXT === 'webp' / THUMB_512_TMP_BASENAME の派生                       -> AC-1
//   B  ビルトイン 512px 資産が 335 件・全 webp・合計 45,000,000 B 未満                -> AC-2
//   C  静的検査（インライン派生の集約・符号化点の単一性・読み込み側 fallback の不在） -> AC-3 / AC-4 / AC-10 / AC-13
//   D  単一変化点の不変条件（THUMB_512_EXT を null へ戻すとパスも符号化も戻る）       -> AC-9
//   M  既存ユーザデータ移行（AC-7）は **m19-t7 で撤去**（migration ごと削除。理由は当該箇所のコメント）
//   R  relocate 堅牢化の回帰（順序 + 中止 / ロールバック / 正常系）                    -> 設計 §9
//
// m19-t2 と同型 harness（vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時dir）で、
// 実サービス（SqliteDataService / thumbnail512Codec）を直接呼ぶ。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm19-t5-webp-'));
const entryFile = path.join(workDir, 'm19-t5-webp-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm19-t5-webp-smoke.mjs');

const dataDir = path.join(workDir, 'data');
await mkdir(dataDir, { recursive: true });

const thumbnailPathsFile = path.join(projectRoot, 'src/utils/thumbnailPaths.ts');
const codecFile = path.join(projectRoot, 'electron/utils/thumbnail512Codec.ts');
const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
const appAssetServicePath = path.join(projectRoot, 'electron/services/AppAssetService.ts');
const mapUploadServicePath = path.join(projectRoot, 'electron/services/MapUploadService.ts');

// AC-9 の写し（製品ファイルは書き換えない。THUMB_512_EXT を null へ戻した複製を別ディレクトリへ作る）
const revertDir = path.join(workDir, 'revert');
await mkdir(revertDir, { recursive: true });
const revertedPathsFile = path.join(revertDir, 'thumbnailPaths.ts');

const icon512Dir = path.join(projectRoot, 'public/basemap_icons_512');
const icon52Dir = path.join(projectRoot, 'public/basemap_icons');

// ============================================================================
// Part B: ビルトイン 512px 資産（AC-2）
//   プラットフォーム非依存に Node で集計する（`stat -f %z` は BSD/macOS 専用で CI(Linux) では動かない）
// ============================================================================
{
  const files = await readdir(icon512Dir);
  const exts = [...new Set(files.map((f) => f.split('.').pop()))];
  let total = 0;
  for (const f of files) total += (await stat(path.join(icon512Dir, f))).size;

  assert.equal(files.length, 335, `AC-2: ビルトイン 512px は 335 件（実測 ${files.length}）`);
  assert.deepEqual(exts, ['webp'], `AC-2: 512px は全件 webp（実測 ${JSON.stringify(exts)}）`);
  assert.ok(
    total < 45_000_000,
    `AC-2: 512px 合計サイズが 45,000,000 B 未満（実測 ${total} B）`,
  );

  // 52px は据え置き（凍結契約 §4.3.2-4 の拡張子非対称）。basename 集合は 512px と一致する
  const files52 = await readdir(icon52Dir);
  const exts52 = [...new Set(files52.map((f) => f.split('.').pop()))];
  assert.deepEqual(exts52, ['png'], `AC-2: 52px は据え置き（png のまま。実測 ${JSON.stringify(exts52)}）`);
  const stem = (f) => f.slice(0, f.lastIndexOf('.'));
  assert.deepEqual(
    files512Stems(files),
    files512Stems(files52),
    'AC-2: 52px と 512px の basename 集合が一致する',
  );
  function files512Stems(list) {
    return [...list.map(stem)].sort();
  }

  console.log(`ok: B ビルトイン 512px = ${files.length} 件 / 全 webp / 合計 ${total} B（-${((1 - total / 121682570) * 100).toFixed(1)}% vs png 121682570 B）`);
}

// ============================================================================
// Part C: 静的検査（AC-3 / AC-4 / AC-10 / AC-13）
// ============================================================================
const countMatches = (text, re) => text.split('\n').filter((l) => re.test(l)).length;

{
  // ---- AC-3: `_512.` を含む製品コードが src/utils/thumbnailPaths.ts の 1 ファイルだけ ----
  // 集約先そのもの（派生規約のコメントと THUMB_512_TMP_BASENAME のテンプレートリテラル）は除外できないため、
  // 「ゼロ件」ではなく「ファイル数 1」を条件とする（設計 §10 AC-3 の注記）。
  const { stdout: grepOut } = await execFileAsync(
    'grep',
    ['-rIl', '_512\\.', 'electron', 'src'],
    { cwd: projectRoot },
  );
  const hits = grepOut.split('\n').filter(Boolean).sort();
  assert.deepEqual(
    hits,
    ['src/utils/thumbnailPaths.ts'],
    `AC-3: _512. を含む製品コードは派生規約の 1 ファイルのみ（実測 ${JSON.stringify(hits)}）`,
  );
  console.log('ok: C/AC-3 製品コードのインライン 512px 派生は集約先 1 ファイルのみ');
}

{
  // ---- AC-4: 512px を書く経路がすべて writeImageByExt を通る ----
  // 対象は設計 §4.3 の W1 / W4 / W8。各関数の本体を切り出し、writeImageByExt( の出現と
  // 生の .write( の不在を assert する（ソーステキスト assert 軸。§6 軸 4 と同型）。
  const sliceFn = (src, startNeedle, endNeedle, label) => {
    const s = src.indexOf(startNeedle);
    assert.ok(s >= 0, `AC-4: ${label} の開始位置を特定できる（needle: ${startNeedle}）`);
    const e = src.indexOf(endNeedle, s + startNeedle.length);
    assert.ok(e > s, `AC-4: ${label} の終了位置を特定できる（needle: ${endNeedle}）`);
    return src.slice(s, e);
  };

  const assetSrc = await readFile(appAssetServicePath, 'utf8');
  const w1 = sliceFn(assetSrc, 'private async writeThumbnail(', '\n  // 非ビルトインTMS', 'W1 writeThumbnail');
  assert.equal(countMatches(w1, /writeImageByExt\(/), 1, 'AC-4/W1: writeThumbnail が writeImageByExt を 1 回呼ぶ');
  assert.equal(countMatches(w1, /\.write\(/), 0, 'AC-4/W1: writeThumbnail に生の .write( が残っていない');

  const uploadSrc = await readFile(mapUploadServicePath, 'utf8');
  const w4 = sliceFn(uploadSrc, 'async function makeThumbnail512(', '\n/**', 'W4 makeThumbnail512');
  assert.equal(countMatches(w4, /writeImageByExt\(/), 1, 'AC-4/W4: makeThumbnail512 が writeImageByExt を 1 回呼ぶ');
  assert.equal(countMatches(w4, /\.write\(/), 0, 'AC-4/W4: makeThumbnail512 に生の .write( が残っていない');

  const sqliteSrc = await readFile(sqlitePath, 'utf8');
  const w8 = sliceFn(
    sqliteSrc,
    'private async generateThumbnail512FromTiles(',
    'private applySearchIndexSchema(',
    'W8 generateThumbnail512FromTiles',
  );
  assert.equal(countMatches(w8, /writeImageByExt\(/), 1, 'AC-4/W8: generateThumbnail512FromTiles が writeImageByExt を 1 回呼ぶ');
  assert.equal(countMatches(w8, /\.write\(/), 0, 'AC-4/W8: generateThumbnail512FromTiles に生の .write( が残っていない');

  // R1: 破損シグネチャ判定は readImageMeta を通る（webp を読めないと catch に落ちて自己修復が黙って死ぬ）
  const r1 = sliceFn(sqliteSrc, 'private async isBrokenThumbnail512(', '\n  // ズーム2タイルを stitch', 'R1 isBrokenThumbnail512');
  assert.equal(countMatches(r1, /readImageMeta\(/), 1, 'AC-4/R1: isBrokenThumbnail512 が 512px を readImageMeta で読む');

  // 符号化点の単一性: 製品コード（electron / src）で webp 符号化器を握るのは codec 1 ファイルだけ。
  // （オフライン生成器 scripts/generate-builtin-basemaps.mjs は配布物の資産を作る別系統であり、
  //   実行時経路には乗らない。値の食い違いは Part B の合計サイズ閾値が検出する）
  const { stdout: encOut } = await execFileAsync(
    'grep',
    ['-rIl', '@jsquash/webp', 'electron', 'src'],
    { cwd: projectRoot },
  );
  const encHits = encOut.split('\n').filter(Boolean).sort();
  assert.deepEqual(
    encHits,
    ['electron/utils/thumbnail512Codec.ts'],
    `AC-4: 製品コードで webp 符号化器を握るのは codec 1 ファイルのみ（実測 ${JSON.stringify(encHits)}）`,
  );
  console.log('ok: C/AC-4 512px の符号化点は writeImageByExt / 復号点は readImageMeta に集約');
}

{
  // ---- AC-10: 読み込み側に旧形式 fallback が無い ----
  // `_512.jpg` / `_512.png` を **探す** コードが electron / src に存在しないこと。
  // 唯一の例外は C7（取り込み）の候補走査であり、そこは「交換形式の過去の正規形式を受容して
  // 正規形（webp）へ書き直す」書き込み側の正規化である（設計 §8.3）。
  const { stdout, stderr } = await execFileAsync(
    'grep',
    ['-rIn', '-E', '_512\\.(jpe?g|png)', 'electron', 'src'],
    { cwd: projectRoot },
  ).catch((e) => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
  assert.equal(stderr, '', 'AC-10: grep が正常終了する');
  const lines = stdout.split('\n').filter(Boolean);
  assert.deepEqual(
    lines,
    [],
    `AC-10: 読み込み側に旧形式（_512.jpg / _512.png）を探す分岐が 1 つも無い（実測 ${JSON.stringify(lines)}）`,
  );

  // C7 の候補走査は「拡張子リストを持つ書き込み側正規化」であり、許可リストとして明示的に検査する
  const dataUploadSrc = await readFile(path.join(projectRoot, 'electron/services/DataUploadService.ts'), 'utf8');
  assert.equal(
    countMatches(dataUploadSrc, /^const THUMB_512_IMPORT_EXT_CANDIDATES/m),
    1,
    'AC-10: C7 の候補リストの宣言は 1 箇所のみ（取り込み時に正規形へ書き直す。読み込み側分岐ではない）',
  );
  assert.equal(
    countMatches(dataUploadSrc, /for \(const ext of THUMB_512_IMPORT_EXT_CANDIDATES\)/),
    1,
    'AC-10: 候補走査は 1 箇所のみ（取り込み経路以外へ広がっていない）',
  );
  assert.equal(
    countMatches(dataUploadSrc, /transcodeImage\(/),
    1,
    'AC-10: C7 は webp 以外の候補を transcodeImage で正規形へ書き直す',
  );
  console.log('ok: C/AC-10 読み込み側の旧形式 fallback は 0 件（C7 の受容は書き込み側正規化）');
}

{
  // ---- AC-13 (rule-0012): 新規検証スクリプトが package.json に結線されている ----
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.ok(
    typeof pkg.scripts['smoke:m19-t5-thumbnail-512-webp'] === 'string',
    'AC-13: smoke:m19-t5-thumbnail-512-webp が package.json へ結線されている',
  );
  // AC-12 の一部: 新規依存が dependencies に宣言されている
  assert.ok(
    typeof pkg.dependencies['@jsquash/webp'] === 'string',
    'AC-12: @jsquash/webp が dependencies に宣言されている',
  );
  // Minor-2: 新規 i18n キーの 11 言語パリティは smoke:editor-locale-parity が担う（AC-6 実走リスト）
  assert.ok(
    typeof pkg.scripts['smoke:editor-locale-parity'] === 'string',
    'AC-6: smoke:editor-locale-parity が実在する（新規 i18n キーの 11 言語パリティ検証）',
  );
  console.log('ok: C/AC-13 結線と依存宣言');
}

{
  // ---- Minor-3: thumbnailPaths.ts 冒頭の失効注釈が是正されている ----
  const src = await readFile(thumbnailPathsFile, 'utf8');
  assert.equal(
    countMatches(src, /この 1 定数を 'webp' へ変えるだけ/),
    0,
    "Minor-3: 失効した注釈（「この 1 定数を 'webp' へ変えるだけで全経路が webp 化する」）が残っていない",
  );
  assert.ok(
    /thumbnail512Codec/.test(src),
    'Minor-3: 注釈が符号化側の対（thumbnail512Codec）に言及している（AC-9 の不変条件と一致する文言）',
  );
  console.log('ok: C/Minor-3 冒頭注釈の是正');
}

// ============================================================================
// Part A / D / M / R: 実体を叩く（vite SSR バンドル経由）
// ============================================================================

// AC-9: THUMB_512_EXT を null へ戻した写しを作る（製品ファイルは書き換えない）
{
  const src = await readFile(thumbnailPathsFile, 'utf8');
  const reverted = src.replace(
    /export const THUMB_512_EXT: string \| null = 'webp';/,
    "export const THUMB_512_EXT: string | null = null;",
  );
  assert.notEqual(reverted, src, 'AC-9: THUMB_512_EXT の宣言を写しの上で null へ戻せる（宣言が 1 箇所であることの証明）');
  await writeFile(revertedPathsFile, reverted, 'utf8');
}

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
      getVersion() { return '0.0.0-smoke'; },
      isPackaged: false,
      on() {},
      whenReady() { return Promise.resolve(); },
    };
    export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
    export const shell = { trashItem: async () => {} };
    export const ipcMain = { handle() {}, on() {} };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
    export default { app, dialog, shell, ipcMain, BrowserWindow };
  `,
  'utf8',
);

await writeFile(
  electronStoreStubFile,
  `
    export default class ElectronStore {
      private data: Record<string, any>;
      constructor(opts: any = {}) { this.data = { ...(opts.defaults ?? {}) }; }
      get(key: string, fallback?: any) { return this.data[key] ?? fallback; }
      set(key: string, value: any) { this.data[key] = value; }
      has(key: string) { return key in this.data; }
      delete(key: string) { delete this.data[key]; }
      get store() { return this.data; }
    }
  `,
  'utf8',
);

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import fse from 'fs-extra';
    import { Jimp } from 'jimp';

    import { THUMB_512_EXT, THUMB_512_TMP_BASENAME, thumb512PathFor, thumb52PathFor } from ${JSON.stringify(thumbnailPathsFile)};
    import { THUMB_512_EXT as REVERTED_EXT, thumb512PathFor as revertedThumb512PathFor } from ${JSON.stringify(revertedPathsFile)};
    import { writeImageByExt, readImageMeta, transcodeImage, THUMB_512_WEBP_QUALITY } from ${JSON.stringify(codecFile)};

    const dataDir = ${JSON.stringify(dataDir)};
    const workDir = ${JSON.stringify(workDir)};

    const isWebpBuffer = (buf: Buffer) =>
      buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

    // ============ Part A: 契約（AC-1） ============
    {
      assert.equal(THUMB_512_EXT, 'webp', 'AC-1: THUMB_512_EXT === "webp"');
      assert.equal(THUMB_512_TMP_BASENAME, 'thumbnail_512.webp',
        'AC-1: 中間ファイル名も同じ 1 定数から導かれる（実測 ' + THUMB_512_TMP_BASENAME + '）');
      // 派生規約は変えていない（拡張子だけが変わる）
      assert.equal(thumb512PathFor('tmbs/a.jpg'), 'tmbs/a_512.webp', 'AC-1: tmbs 接尾辞規則 + webp');
      assert.equal(thumb512PathFor('tmbs/a.png'), 'tmbs/a_512.webp', 'AC-1: 入力拡張子によらず webp');
      assert.equal(thumb512PathFor('basemap_icons/x.png'), 'basemap_icons_512/x.webp', 'AC-1: ディレクトリ差替え規則 + webp');
      assert.equal(thumb512PathFor('img/x.png'), null, 'AC-1: 定義域外は null のまま');
      assert.equal(thumb52PathFor('abc', 'jpg'), 'tmbs/abc.jpg', 'AC-1: 52px は据え置き（拡張子非対称）');
      console.log('ok: A THUMB_512_EXT=webp / 派生規約は不変');
    }

    // ============ Part D: 単一変化点の不変条件（AC-9） ============
    {
      // (1) パス: THUMB_512_EXT を null へ戻した写しは入力拡張子を引き継ぐ挙動へ戻る
      assert.equal(REVERTED_EXT, null, 'AC-9: 写しの THUMB_512_EXT は null');
      assert.equal(revertedThumb512PathFor('tmbs/a.jpg'), 'tmbs/a_512.jpg',
        'AC-9(1): 定数を戻すとパス派生が旧挙動（入力拡張子の引き継ぎ）へ戻る');
      assert.equal(revertedThumb512PathFor('basemap_icons/x.png'), 'basemap_icons_512/x.png',
        'AC-9(1): ディレクトリ差替え規則も旧挙動へ戻る');

      // (2) 符号化: codec は「512px か否か」を判定せず、宛先拡張子だけで符号化器を選ぶ。
      //     ∴ 定数が戻ってパスが .jpg になれば、符号化も自動的に Jimp 経路へ戻る。
      const img = new Jimp({ width: 8, height: 6, color: 0x3366ccff });
      const destWebp = nodePath.join(workDir, 'ac9.webp');
      const destJpg = nodePath.join(workDir, 'ac9.jpg');
      const destPng = nodePath.join(workDir, 'ac9.png');
      await writeImageByExt(img, destWebp);
      await writeImageByExt(img, destJpg);
      await writeImageByExt(img, destPng);
      assert.ok(isWebpBuffer(await fse.readFile(destWebp)), 'AC-9(2): .webp 宛先は wasm 符号化器（RIFF/WEBP）');
      assert.ok(!isWebpBuffer(await fse.readFile(destJpg)), 'AC-9(2): .jpg 宛先は Jimp 経路（webp ではない）');
      assert.equal((await fse.readFile(destJpg)).toString('ascii', 6, 10), 'JFIF', 'AC-9(2): .jpg は JPEG である');
      assert.equal((await fse.readFile(destPng)).toString('ascii', 1, 4), 'PNG', 'AC-9(2): .png は PNG である');

      // 寸法が保存されること（両経路とも）
      assert.deepEqual(await readImageMeta(destWebp), { width: 8, height: 6 }, 'AC-9(2): webp を復号して寸法が読める');
      assert.deepEqual(await readImageMeta(destPng), { width: 8, height: 6 }, 'AC-9(2): 非 webp も同じ API で寸法が読める');
      assert.equal(await readImageMeta(nodePath.join(workDir, 'nope.webp')), null, 'AC-9(2): 不在は null');

      // 品質値の宣言が 1 箇所であること（lossless への切替が 1 定数で済む形）
      assert.equal(typeof THUMB_512_WEBP_QUALITY, 'object', 'AC-9: 品質は符号化オプション 1 定数として宣言される');
      assert.equal(THUMB_512_WEBP_QUALITY.quality, 85, 'AC-9: 採用値は q85（§3.3）');

      console.log('ok: D 単一変化点（パス派生と符号化が同じ 1 定数で切り替わる）');
    }

    // ============ Part R: 実サービス ============
    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});

    const exists = (p: string) => fse.pathExists(p);
    const useSaveFolder = async (dir: string) => {
      await fse.ensureDir(nodePath.join(dir, 'tmbs'));
      SettingsService.set('saveFolder', dir);
      await SqliteDataService.reset();
      return SqliteDataService.getDb();
    };

    // ============ Part M: 既存ユーザデータの移行（AC-7）— m19-t7 で撤去 ============
    // migrateThumbnail512ToWebpIfNeeded（marker '2026-08-10-thumbnail-512-webp-v1'）は
    // 0.7.0 の入力から到達しない段だったため、m19-t7 が起動時パイプラインごと削除した
    //   - 0.7.0 は 512px を構造的に作れない（v0.7.0 のソース全文に 512px 生成機構が無い）
    //   - ZIP 取込は受け取った時点で正規形へ transcode する（本 smoke の Part C が固定）
    //   - マイニングの出力は最初から正規形（thumb512PathFor 経由）
    // ∴ 非正規形の 512px が新たに生じる経路は無く、移行段を公開版へ同梱する意味が無い。
    // 「正規形以外の 512px を作らない」という本質は Part A / C / D が引き続き固定している。
    // ============ Part R: relocate 堅牢化の回帰（設計 §9。m19-t2 実装レビュー v2 Minor-1 の引き受け） ============
    {
      const rDir = nodePath.join(workDir, 'relocate');
      await useSaveFolder(rDir);
      const tmbs = (name: string) => nodePath.join(rDir, 'tmbs', name);
      const rel512Of = (rel52: string) => thumb512PathFor(rel52)!;
      const abs = (rel: string) => nodePath.join(rDir, rel);

      const makeIcon = async (absPath: string) => {
        const img = new Jimp({ width: 16, height: 12, color: 0x336699ff });
        await writeImageByExt(img, absPath);
      };

      const savePayload = (uid: string, slug: string, thumbnail: string) => ({
        uid, slug, create: true,
        tms: {
          kind: 'tms', lang: 'ja', title: { ja: slug }, label: { ja: slug },
          attr: { ja: 'attr' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL',
          licenseNote: {}, dataLicenseNote: {},
          url: 'https://tiles.example.test/{z}/{x}/{y}.png',
          minZoom: 0, maxZoom: 18,
          thumbnail,
          coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null,
        },
      });

      // console.error の呼び出し回数を数える（512px の失敗が warn に埋もれず error で出ること）
      const withErrorCount = async <T>(fn: () => Promise<T>): Promise<{ result: T; errors: number }> => {
        const original = console.error;
        let errors = 0;
        console.error = (...args: unknown[]) => { errors++; original(...args); };
        try {
          const result = await fn();
          return { result, errors };
        } finally {
          console.error = original;
        }
      };

      // ---- R-1: 順序 + 中止 ----
      // 512px の移動先を先に作っておく -> fs.move(overwrite:false) が失敗する。
      // 期待: relocate が null を返し、**52px は暫定名のまま**（対で動かせないなら動かさない）
      {
        const uid = globalThis.crypto.randomUUID();
        const prov52 = 'tmbs/prov-r1.png';
        await makeIcon(abs(prov52));
        await makeIcon(abs(rel512Of(prov52)));
        const dest52 = 'tmbs/' + uid + '.png';
        await makeIcon(abs(rel512Of(dest52))); // 512px の移動先に先客を置く

        const { result: saved, errors } = await withErrorCount(() =>
          SqliteDataService.saveUserBaseMap(savePayload(uid, 'bm-r1', prov52)),
        );

        assert.equal(saved.thumbnail, prov52, 'R-1: 付け替えを中止し thumbnail は暫定名のまま');
        assert.equal(await exists(abs(dest52)), false, 'R-1: **52px は uid 名へ動いていない**（順序と中止が効いている）');
        assert.ok(await exists(abs(prov52)), 'R-1: 52px は暫定名に残る（参照は有効なまま）');
        assert.ok(await exists(abs(rel512Of(prov52))), 'R-1: 512px も暫定名に残る');
        assert.ok(errors >= 1, 'R-1: 512px の失敗は console.error で出る（warn に埋もれない）');
        console.log('ok: R-1 順序 + 中止（512px が動かせなければ 52px も動かさない・error 出力あり）');
      }

      // ---- R-2: ロールバック ----
      // 52px の移動先を先に作っておく -> 512px は一度 uid 名へ動くが 52px の move が失敗する。
      // 期待: 512px が暫定名へ**戻っている**
      {
        const uid = globalThis.crypto.randomUUID();
        const prov52 = 'tmbs/prov-r2.png';
        await makeIcon(abs(prov52));
        await makeIcon(abs(rel512Of(prov52)));
        const dest52 = 'tmbs/' + uid + '.png';
        await makeIcon(abs(dest52)); // 52px の移動先に先客を置く

        const saved = await SqliteDataService.saveUserBaseMap(savePayload(uid, 'bm-r2', prov52));

        assert.equal(saved.thumbnail, prov52, 'R-2: 付け替えは失敗し thumbnail は暫定名のまま');
        assert.ok(await exists(abs(rel512Of(prov52))), 'R-2: **512px が暫定名へロールバックされている**');
        assert.equal(await exists(abs(rel512Of(dest52))), false, 'R-2: 512px は uid 名に残っていない');
        console.log('ok: R-2 ロールバック（52px が失敗したら 512px を戻す）');
      }

      // ---- R-3: 正常系 ----
      {
        const uid = globalThis.crypto.randomUUID();
        const prov52 = 'tmbs/prov-r3.png';
        await makeIcon(abs(prov52));
        await makeIcon(abs(rel512Of(prov52)));
        const dest52 = 'tmbs/' + uid + '.png';

        const saved = await SqliteDataService.saveUserBaseMap(savePayload(uid, 'bm-r3', prov52));

        assert.equal(saved.thumbnail, dest52, 'R-3: 戻り値が uid 名の 52px パス');
        assert.ok(await exists(abs(dest52)), 'R-3: 52px が uid 名へ移動');
        assert.ok(await exists(abs(rel512Of(dest52))), 'R-3: 512px が uid 名へ移動');
        assert.equal(await exists(abs(prov52)), false, 'R-3: 52px の暫定名は残らない');
        assert.equal(await exists(abs(rel512Of(prov52))), false, 'R-3: 512px の暫定名は残らない');
        console.log('ok: R-3 正常系（52px・512px とも uid 名へ移動）');
      }
    }
  `,
  'utf8',
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
      external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, '@jsquash/webp'],
      output: { entryFileNames: 'm19-t5-webp-smoke.mjs', format: 'es' },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 300000,
  maxBuffer: 1024 * 1024 * 8,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

console.log('m19-t5 thumbnail 512 webp smoke: ALL PASS');
