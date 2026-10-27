/**
 * nov26-m6-t2（#115・#84・#99・#133）: Electron 43 群の受け入れ検査（静的）。
 *
 * 守っている不変条件:
 *   (a) electron は 44 系以上で、(e) の lock の実体と同じ系列（43 系へ戻さない・範囲と lock の食い違いを許さない）
 *   (b) electron-builder は 26.15.6 以上（上流 #9988 の backport #9989。NSIS のペイロードを BCJ に固定）
 *   (c) ci/pnpm-workspace.ci.yaml に electron>extract-zip と patchedDependencies が無く、
 *       @puppeteer/browsers>extract-zip は 1 件だけ残る（pwa-asset-generator 経路の置換 fork）
 *   (d) patches/ に electron@ で始まる patch が無い（Electron 40.10.3 以降は置換 fork を直接使う）
 *   (e) pnpm-lock.yaml の packages: に extract-zip@2 が無く、patchedDependencies 節も
 *       electron>extract-zip の override も無い
 *   (f) electron-builder.config.cjs に ELECTRON_BUILDER_7Z_FILTER が無い（上流が無視する回避策の残骸）
 *   (g) G2（scripts/m19-t13/verify-win-payload-codec.mjs）の ALLOWED がちょうど {Copy, LZMA, LZMA2, BCJ}
 *       （BCJ2 は「同梱の Nsis7z が解けない」と上流が書くので外す。ARM64 等は許可しない。fail-closed）
 *   (h) 既定フォルダを持たなかったダイアログ 2 箇所（Electron 43.0 で defaultPath 省略時が Downloads に
 *       変わった）が、未設定時に app.getPath('documents') へ倒れる
 *
 * 実行: pnpm smoke:nov26-m6-t2-electron43
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(path.join(projectRoot, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** `^1.2.3` / `~1.2.3` / `1.2.3` → [1,2,3]。解釈できなければ null */
function parseRange(range) {
  const m = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/.exec(String(range ?? '').trim());
  return m ? m.slice(1, 4).map(Number) : null;
}
function gte(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

/** `name(args, {` から対応する `})` までを返す（ダイアログの引数の範囲を抜き出す） */
function callBlock(src, opener, label) {
  const start = src.indexOf(opener);
  assert.ok(start >= 0, `${label}: \`${opener}\` が見つからない`);
  const end = src.indexOf('});', start);
  assert.ok(end > start, `${label}: \`${opener}\` の閉じが見つからない`);
  return src.slice(start, end);
}

// (a) electron は 44 系以上（43 系は 2027-01 に EOL。macOS 12 を切った 44 以降へ上げた後は 43 へ戻さない）。
// 系列の固定は (e) で lock の実体と突き合わせる
const ELECTRON_MIN_MAJOR = 44;
const electronRangeMajor = (() => {
  const range = pkg.devDependencies?.electron ?? '';
  const v = parseRange(range);
  assert.ok(v, `(a): devDependencies.electron を解釈できない: ${range}`);
  assert.ok(v[0] >= ELECTRON_MIN_MAJOR, `(a): electron は ${ELECTRON_MIN_MAJOR} 系以上であること（現在: ${range}）`);
  console.log(`  [1/8] (a) electron ${range}: PASS`);
  return v[0];
})();

// (b) electron-builder >= 26.15.6 かつ 26 系
{
  const range = pkg.devDependencies?.['electron-builder'] ?? '';
  const v = parseRange(range);
  assert.ok(v, `(b): devDependencies.electron-builder を解釈できない: ${range}`);
  assert.equal(v[0], 26, `(b): electron-builder は 26 系であること（現在: ${range}）`);
  assert.ok(
    gte(v, [26, 15, 6]),
    `(b): electron-builder は 26.15.6 以上であること（現在: ${range}）。`
      + ' 26.15.6 未満は NSIS のペイロードのフィルタを固定しない（上流 #9988/#9989）'
  );
  console.log(`  [2/8] (b) electron-builder ${range}: PASS`);
}

// (c) CI 用 workspace
{
  const ci = read('ci/pnpm-workspace.ci.yaml');
  assert.ok(!ci.includes('electron>extract-zip'), '(c): ci/pnpm-workspace.ci.yaml に electron>extract-zip が残っている');
  assert.ok(!/^patchedDependencies\s*:/m.test(ci), '(c): ci/pnpm-workspace.ci.yaml に patchedDependencies 節が残っている');
  const puppeteer = ci.split('\n').filter((l) => /^\s*"@puppeteer\/browsers>extract-zip"\s*:/.test(l));
  assert.equal(puppeteer.length, 1, `(c): @puppeteer/browsers>extract-zip は 1 件であること（現在 ${puppeteer.length} 件）`);
  console.log('  [3/8] (c) ci/pnpm-workspace.ci.yaml: PASS');
}

// (d) electron の patch が無い
{
  const dir = path.join(projectRoot, 'patches');
  const left = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('electron@')) : [];
  assert.deepEqual(left, [], `(d): patches/ に electron の patch が残っている: ${left.join(', ')}`);
  console.log('  [4/8] (d) patches/electron@*: PASS');
}

// (e) lock
{
  const lock = read('pnpm-lock.yaml');
  assert.ok(!/^patchedDependencies\s*:/m.test(lock), '(e): pnpm-lock.yaml に patchedDependencies 節が残っている');
  assert.ok(!lock.includes('electron>extract-zip'), '(e): pnpm-lock.yaml の overrides に electron>extract-zip が残っている');
  const pkgStart = lock.search(/^packages:\s*$/m);
  const snapStart = lock.search(/^snapshots:\s*$/m);
  assert.ok(pkgStart >= 0 && snapStart > pkgStart, '(e): pnpm-lock.yaml の packages:/snapshots: 節が見つからない');
  const packages = lock.slice(pkgStart, snapStart);
  const ez2 = packages.split('\n').filter((l) => /^\s+'?extract-zip@2/.test(l));
  assert.deepEqual(ez2, [], `(e): packages: に extract-zip@2 の実体がある: ${ez2.join(' / ')}`);
  const electronKeys = packages.split('\n').filter((l) => /^\s+electron@\d/.test(l)).map((l) => l.trim());
  const lockMajors = electronKeys.map((l) => Number(/^electron@(\d+)\./.exec(l)?.[1]));
  assert.ok(
    electronKeys.length > 0 && lockMajors.every((m) => m === electronRangeMajor && m >= ELECTRON_MIN_MAJOR),
    `(e): packages: の electron が package.json の範囲と同じ ${electronRangeMajor} 系だけであること`
      + `（${ELECTRON_MIN_MAJOR} 以上。現在: ${electronKeys.join(' / ')}）`
  );
  console.log(`  [5/8] (e) pnpm-lock.yaml（${electronKeys.join(' ')}）: PASS`);
}

// (f) 回避策の環境変数が設定ファイルに無い
{
  const cfg = read('electron-builder.config.cjs');
  assert.ok(
    !cfg.includes('ELECTRON_BUILDER_7Z_FILTER'),
    '(f): electron-builder.config.cjs に ELECTRON_BUILDER_7Z_FILTER が残っている（26.15.6 以降は NSIS に効かない）'
  );
  console.log('  [6/8] (f) ELECTRON_BUILDER_7Z_FILTER 不在: PASS');
}

// (g) G2 の許可集合
{
  const g2 = read('scripts/m19-t13/verify-win-payload-codec.mjs');
  const m = /const ALLOWED = new Set\(\[([^\]]*)\]\)/.exec(g2);
  assert.ok(m, '(g): G2 の `const ALLOWED = new Set([...])` が見つからない');
  const tokens = [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
  assert.deepEqual(
    [...tokens].sort(), ['BCJ', 'Copy', 'LZMA', 'LZMA2'],
    `(g): G2 の ALLOWED はちょうど {Copy, LZMA, LZMA2, BCJ} であること（現在: ${tokens.join(', ')}）`
  );
  console.log('  [7/8] (g) G2 ALLOWED = {Copy, LZMA, LZMA2, BCJ}: PASS');
}

// (h) nov26-m6-t7: 2ダイアログの退避責務はdialogFoldersへ移った。
// 呼出しの結線とdocumentsの退避を固定する。実物storeでの消失/不正値はt7 smokeが検証する。
{
  const settings = read('electron/services/SettingsService.ts');
  const sBlock = callBlock(settings, 'dialog.showOpenDialog(mainWindow, {', '(h) SettingsService');
  assert.match(sBlock, /defaultPath:\s*dialogDefaultPath\('saveFolder'\)/,
    '(h): SettingsService が保存フォルダの共通経路を通らない');
  const asset = read('electron/services/AppAssetService.ts');
  const aBlock = callBlock(asset, 'dialog.showOpenDialog(win, {', '(h) AppAssetService');
  assert.match(aBlock, /defaultPath:\s*dialogDefaultPath\('image'\)/,
    '(h): AppAssetService が画像用の共通経路を通らない');
  const helper = read('electron/utils/dialogFolders.ts');
  assert.match(helper, /availableFolder\(remembered\)\s*\?\s*remembered\s*:\s*app\.getPath\('documents'\)/,
    '(h): 記憶したフォルダが使えないときdocumentsへ倒れない');
  for (const caller of [settings, asset]) assert.match(caller,
    /import\s*\{[^}]*dialogDefaultPath[^}]*\}\s*from\s*['"]\.\.\/utils\/dialogFolders['"]/,
    '(h): 共通経路のimportがない');
  console.log('  [8/8] (h) ダイアログ2箇所の共通経路とdocuments退避: PASS');
}

console.log('nov26-m6-t2 electron43 smoke: PASS');
