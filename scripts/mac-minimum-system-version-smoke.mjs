/**
 * macOS の動作環境の下限（macOS 13 Ventura 以上）と、自動更新の更新情報の下限の受け入れ検査（静的）。
 *
 * Electron 44 で macOS 12 の対応が外れた。macOS 12 の利用者に、起動しない版への更新を案内しないために、
 * 次の 2 か所に下限を書く:
 *   - .app の Info.plist の LSMinimumSystemVersion（electron-builder の mac.minimumSystemVersion = '13.0'）
 *   - latest-mac.yml の minimumSystemVersion（electron-updater は os.release() = Darwin のカーネル版と比べる。
 *     macOS 13 = Darwin 22 ∴ '22.0.0'。'13.0' と書くと macOS 12〔Darwin 21〕でも通ってしまう）
 * electron-builder 26 は latest-mac.yml に minimumSystemVersion を書かない（releaseInfo のスキーマも
 * 追加のキーを許さない）ので、build.yml の build-mac で後処理のスクリプトが足す。
 *
 * 守っている不変条件:
 *   [1] electron-builder.config.cjs の mac.minimumSystemVersion が '13.0'
 *   [2] scripts/release/set-mac-minimum-system-version.mjs が雛形の latest-mac.yml に
 *       minimumSystemVersion: 22.0.0 を足す（他のキーと値はそのまま・2 回目は変えない・既に同じ値なら何もしない・既に違う値なら失敗する・
 *       不正な値と YAML でない入力を拒む）。CLI もファイルを書き換える
 *   [3] build.yml の build-mac で、その step が「Build macOS」の後・「Upload macOS artifacts」の前にあり、
 *       release/${{ env.VERSION }}/latest-mac.yml に 22.0.0 を渡す
 *   [4] electron-updater は上げない: package.json の範囲が ^6.8.10 で、lock の実体が 6.8.10 だけ
 *       （配布済みの 1.2.0 が同梱する判定の実装と同じものを e2e で相手にするため）
 *   [5] 更新情報に署名（updateManifestSignature）を使っていない（使っていれば後処理を署名の前に置く必要がある）
 *
 * 実行: pnpm smoke:mac-minimum-system-version
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const read = (rel) => readFileSync(path.join(projectRoot, rel), 'utf8');
const SCRIPT_REL = 'scripts/release/set-mac-minimum-system-version.mjs';
const MAC_MIN = '13.0';
const DARWIN_MIN = '22.0.0';

// [1] Info.plist の下限
{
  const config = require('../electron-builder.config.cjs');
  assert.equal(config.mac?.minimumSystemVersion, MAC_MIN,
    `[1]: electron-builder.config.cjs の mac.minimumSystemVersion は '${MAC_MIN}' であること（現在: ${config.mac?.minimumSystemVersion}）`);
  console.log(`  [1/5] mac.minimumSystemVersion = '${MAC_MIN}': PASS`);
}

// [2] 後処理のスクリプト
{
  const { addMinimumSystemVersion } = await import(path.join(projectRoot, SCRIPT_REL));
  assert.equal(typeof addMinimumSystemVersion, 'function', `[2]: ${SCRIPT_REL} が addMinimumSystemVersion を export していない`);
  // electron-builder 26 が書く latest-mac.yml の形（files・path・sha512・releaseDate）
  const template = 'version: 1.3.0\n'
    + 'files:\n'
    + '  - url: MaplatEditor-Mac-1.3.0-x64.zip\n    sha512: AAAA\n    size: 100\n'
    + '  - url: MaplatEditor-Mac-1.3.0-arm64.zip\n    sha512: BBBB\n    size: 200\n'
    + 'path: MaplatEditor-Mac-1.3.0-x64.zip\n'
    + 'sha512: AAAA\n'
    + "releaseDate: '2026-12-01T00:00:00.000Z'\n";
  const r1 = addMinimumSystemVersion(template, DARWIN_MIN);
  assert.equal(r1.changed, true, '[2]: 雛形に minimumSystemVersion を足していない');
  const parsed = yaml.load(r1.text);
  assert.equal(parsed.minimumSystemVersion, DARWIN_MIN, `[2]: 足した値が文字列 '${DARWIN_MIN}' として読めない`);
  delete parsed.minimumSystemVersion;
  assert.deepEqual(parsed, yaml.load(template), '[2]: 他のキー・値が変わった');
  assert.ok(r1.text.startsWith(template), '[2]: 既存の本文の文字列を書き換えた（末尾に足すだけであること）');
  // 冪等: 2 回目は変えない
  const r2 = addMinimumSystemVersion(r1.text, DARWIN_MIN);
  assert.equal(r2.changed, false, '[2]: 2 回目で変わった');
  assert.equal(r2.text, r1.text, '[2]: 2 回目で本文が変わった');
  // 既に同じ値があれば何もしない（引用符つきでも同じ値とみなす）
  for (const same of [`minimumSystemVersion: ${DARWIN_MIN}\n`, `minimumSystemVersion: '${DARWIN_MIN}'\n`]) {
    const r3 = addMinimumSystemVersion(template + same, DARWIN_MIN);
    assert.equal(r3.changed, false, `[2]: 既に同じ値がある入力（${JSON.stringify(same)}）で変わった`);
    assert.equal(r3.text, template + same, `[2]: 既に同じ値がある入力（${JSON.stringify(same)}）で本文が変わった`);
  }
  // 既に違う値があれば失敗する（黙って残すと、比べられない値で electron-updater が更新を案内する側に倒れうる）
  for (const other of ['13.0', '21.0.0', '23.0.0', "''"]) {
    assert.throws(() => addMinimumSystemVersion(`${template}minimumSystemVersion: ${other}\n`, DARWIN_MIN),
      `[2]: 既に違う値 ${other} がある入力を拒まない`);
  }
  // 末尾に改行の無い入力でも 1 行として足す
  const r4 = addMinimumSystemVersion(template.trimEnd(), DARWIN_MIN);
  assert.equal(yaml.load(r4.text).minimumSystemVersion, DARWIN_MIN, '[2]: 末尾に改行の無い入力で正しく足せない');
  // 不正な値・YAML の対応表でない入力は拒む
  for (const bad of ['13.0', '22', 'v22.0.0', '', '22.0.0\nfoo: bar']) {
    assert.throws(() => addMinimumSystemVersion(template, bad), `[2]: 不正な値 ${JSON.stringify(bad)} を拒まない`);
  }
  for (const badDoc of ['', '- a\n- b\n', 'just a string\n']) {
    assert.throws(() => addMinimumSystemVersion(badDoc, DARWIN_MIN), `[2]: 対応表でない入力 ${JSON.stringify(badDoc)} を拒まない`);
  }
  // CLI: ファイルを書き換える・ファイルが無ければ失敗する
  const tmpBase = path.join(projectRoot, '.tmp-smoke');
  mkdirSync(tmpBase, { recursive: true });
  const dir = mkdtempSync(path.join(tmpBase, 'mac-min-sysver-'));
  const file = path.join(dir, 'latest-mac.yml');
  writeFileSync(file, template);
  execFileSync(process.execPath, [path.join(projectRoot, SCRIPT_REL), file, DARWIN_MIN], { stdio: 'pipe' });
  assert.equal(yaml.load(readFileSync(file, 'utf8')).minimumSystemVersion, DARWIN_MIN, '[2]: CLI がファイルに足していない');
  assert.throws(() => execFileSync(process.execPath, [path.join(projectRoot, SCRIPT_REL), path.join(dir, 'missing.yml'), DARWIN_MIN], { stdio: 'pipe' }),
    '[2]: CLI が存在しないファイルで失敗しない');
  // CLI: 既に同じ値なら exit 0 で本文を変えない・違う値なら exit 非 0 で本文を変えない
  const afterAdd = readFileSync(file, 'utf8');
  execFileSync(process.execPath, [path.join(projectRoot, SCRIPT_REL), file, DARWIN_MIN], { stdio: 'pipe' });
  assert.equal(readFileSync(file, 'utf8'), afterAdd, '[2]: CLI が既に同じ値のあるファイルを書き換えた');
  for (const other of ['13.0', '21.0.0']) {
    const otherFile = path.join(dir, `latest-mac-${other}.yml`);
    const body = `${template}minimumSystemVersion: ${other}\n`;
    writeFileSync(otherFile, body);
    assert.throws(() => execFileSync(process.execPath, [path.join(projectRoot, SCRIPT_REL), otherFile, DARWIN_MIN], { stdio: 'pipe' }),
      `[2]: CLI が既に違う値 ${other} のあるファイルで失敗しない`);
    assert.equal(readFileSync(otherFile, 'utf8'), body, `[2]: CLI が既に違う値 ${other} のあるファイルを書き換えた`);
  }
  console.log(`  [2/5] ${SCRIPT_REL}（足す・冪等・同じ値は通す・違う値は拒む・不正値を拒む・CLI）: PASS`);
}

// [3] build.yml の step の位置
{
  const wf = read('.github/workflows/build.yml');
  const jobStart = wf.search(/^ {2}build-mac:\s*$/m);
  assert.ok(jobStart >= 0, '[3]: build.yml に build-mac のジョブが無い');
  const nextJob = wf.slice(jobStart + 1).search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
  const job = nextJob >= 0 ? wf.slice(jobStart, jobStart + 1 + nextJob) : wf.slice(jobStart);
  const steps = job.split(/\n(?= {6}- )/).filter((s) => /^ {6}- /.test(s));
  const idx = (re, label) => {
    const hits = steps.map((s, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0);
    assert.equal(hits.length, 1, `[3]: build-mac の ${label} の step はちょうど 1 つであること（現在 ${hits.length}）`);
    return hits[0];
  };
  const build = idx(/name:\s*Build macOS\s*$/m, '「Build macOS」');
  const upload = idx(/name:\s*Upload macOS artifacts\s*$/m, '「Upload macOS artifacts」');
  const setMin = idx(new RegExp(SCRIPT_REL.replaceAll('.', '\\.')), SCRIPT_REL);
  assert.ok(build < setMin && setMin < upload,
    `[3]: ${SCRIPT_REL} の step は「Build macOS」の後・「Upload macOS artifacts」の前であること（順: build=${build} set=${setMin} upload=${upload}）`);
  const step = steps[setMin];
  assert.match(step, /release\/\$\{\{ env\.VERSION \}\}\/latest-mac\.yml/, '[3]: step が release/${{ env.VERSION }}/latest-mac.yml を渡していない');
  assert.match(step, new RegExp(`\\s${DARWIN_MIN.replaceAll('.', '\\.')}(\\s|$)`, 'm'), `[3]: step が ${DARWIN_MIN} を渡していない`);
  assert.doesNotMatch(step, /^\s*if:/m, '[3]: step に条件が付いている（push・dispatch のどちらでも足すこと）');
  assert.doesNotMatch(step, /continue-on-error/, '[3]: step の失敗を無視している');
  console.log('  [3/5] build.yml: Build macOS → 下限を足す → Upload macOS artifacts: PASS');
}

// [4] electron-updater は上げない
{
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies?.['electron-updater'], '^6.8.10', `[4]: package.json の electron-updater が ^6.8.10 でない（現在: ${pkg.dependencies?.['electron-updater']}）`);
  const lock = read('pnpm-lock.yaml');
  const pkgStart = lock.search(/^packages:\s*$/m);
  const snapStart = lock.search(/^snapshots:\s*$/m);
  assert.ok(pkgStart >= 0 && snapStart > pkgStart, '[4]: pnpm-lock.yaml の packages:/snapshots: 節が見つからない');
  const keys = lock.slice(pkgStart, snapStart).split('\n').filter((l) => /^\s+'?electron-updater@/.test(l)).map((l) => l.trim());
  assert.deepEqual(keys, ['electron-updater@6.8.10:'], `[4]: lock の electron-updater の実体は 6.8.10 だけであること（現在: ${keys.join(' / ')}）`);
  console.log('  [4/5] electron-updater ^6.8.10 / lock 6.8.10: PASS');
}

// [5] 更新情報に署名を使っていない
{
  const cfg = read('electron-builder.config.cjs');
  assert.doesNotMatch(cfg, /updateManifestSignature|manifestSignature/i, '[5]: 更新情報の署名の設定がある（後処理を署名の前に置くこと）');
  console.log('  [5/5] 更新情報の署名なし: PASS');
}

console.log('mac-minimum-system-version smoke: PASS');
