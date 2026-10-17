/**
 * nov26-m7-t5（#141 決めること 2〜5）: 自動更新の基盤（形に依存しない部分）の受け入れ検査。
 * 設計書: docs/superpowers/specs/2026-10-11-nov26-m7-t5-task-design.md（outer の integration worktree）
 *
 *   [1] 依存（electron-updater が dependencies にあり、electron-builder と同じ builder-util-runtime を引く）
 *   [2] t5/AC1 更新器の設定（updaterSettings・applyUpdaterSettings を本物の electron-updater の更新器に当てる）
 *   [3] t5/AC1 electron-builder.config.cjs の publish と publisherName（i）〜（iv）（MAJ-2）
 *   [4] t5/AC1 vite.config.ts の main の external（MIN-8）
 *   [5] t5/AC2 製品のコードに更新の確認を起動する呼び出しが無い
 *   [6] t5/AC3 resolveUpdateFeed のマトリクスと、SettingsService・process.argv を読まないこと
 *   [7] t5/AC4 (d) Windows の x64／arm64 の更新ファイルの選び方（§3.5 の判定 (A)）
 *   [8] mac の zip・build.yml の artifact と注記・verify-win-install の publisherName の検査（§3.2・§3.6）
 *   [9] MacUpdater がダウンロードの後に Squirrel を呼ぶ条件（MIN-9。入れた版のソースで確かめる）
 *
 * 実行: node scripts/nov26-m7-t5-update-foundation-smoke.mjs（rtk を付けない）
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(path.join(projectRoot, rel), 'utf8');
const git = (...args) => spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });

let step = 0;
const TOTAL = 9;
const pass = (label) => console.log(`  [${++step}/${TOTAL}] ${label}: PASS`);

// ───────────────────────────────────────────────
// [1] 依存
// ───────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
const updaterRange = pkg.dependencies?.['electron-updater'];
assert.ok(updaterRange, 'package.json の dependencies に electron-updater が無い');
assert.match(updaterRange, /^\^6\./, `electron-updater は ^6.x で書く（実物 ${updaterRange}）`);
assert.equal(pkg.devDependencies?.['electron-updater'], undefined, 'electron-updater は devDependencies に置かない（配布物に入らない）');
const updaterMain = require.resolve('electron-updater');
const updaterRequire = createRequire(updaterMain);
const updaterPkg = updaterRequire('../package.json');
const updaterRuntime = updaterRequire('builder-util-runtime');
const updaterRuntimeVersion = updaterRequire('builder-util-runtime/package.json').version;
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json', { paths: [path.dirname(require.resolve('electron-builder/package.json'))] }));
const builderRuntimeVersion = builderRequire('builder-util-runtime/package.json').version;
assert.equal(updaterRuntimeVersion, builderRuntimeVersion,
  `electron-updater の builder-util-runtime（${updaterRuntimeVersion}）が electron-builder の側（${builderRuntimeVersion}）と違う`);
pass(`依存（electron-updater ${updaterPkg.version}・builder-util-runtime ${updaterRuntimeVersion}）`);

// ───────────────────────────────────────────────
// [2] t5/AC1 更新器の設定
// ───────────────────────────────────────────────
const feed = await import('../electron/utils/updateFeed.ts');
{
  const s = feed.updaterSettings();
  assert.equal(s.autoDownload, false, 'autoDownload');
  assert.equal(s.autoInstallOnAppQuit, false, 'autoInstallOnAppQuit');
  assert.equal(s.allowPrerelease, false, 'allowPrerelease');
  assert.equal(s.allowDowngrade, false, 'allowDowngrade');
  assert.equal(s.fullChangelog, false, 'fullChangelog');
  // 呼ぶたびに新しいオブジェクト（呼んだ側が書き換えても次の呼び出しに漏れない）
  s.allowDowngrade = true;
  assert.equal(feed.updaterSettings().allowDowngrade, false, 'updaterSettings() が共有のオブジェクトを返している');

  // 本物の electron-updater の更新器に当てる（electron の app を AppAdapter の形で差し替えて作る）
  const { NsisUpdater } = updaterRequire('./NsisUpdater.js');
  const fakeApp = {
    version: '1.1.0', name: 'MaplatEditor', isPackaged: true, appUpdateConfigPath: '/nonexistent/app-update.yml',
    userDataPath: '/nonexistent', baseCachePath: '/nonexistent', whenReady: () => Promise.resolve(),
    quit() {}, relaunch() {}, onQuit() {},
  };
  {
    const updater = new NsisUpdater(null, fakeApp);
    // 既定値が逆（真）であることを先に確かめる（当て忘れを検出できる検査であることの確かめ）
    assert.equal(updater.autoDownload, true, '本物の既定値 autoDownload が真でない（検査の前提が崩れた）');
    assert.equal(updater.autoInstallOnAppQuit, true, '本物の既定値 autoInstallOnAppQuit が真でない');
    feed.applyUpdaterSettings(updater);
    for (const [k, v] of Object.entries(feed.updaterSettings())) {
      assert.equal(updater[k], v, `applyUpdaterSettings 後の ${k}`);
    }
    assert.equal(updater.allowDowngrade, false, `allowDowngrade`);
    assert.equal(updater.allowPrerelease, false, `allowPrerelease`);
    // §3.5 の判定 (A): channel を設定しない（設定すると electron-updater が allowDowngrade を真にする）
    assert.equal(updater.channel, null, `channel を設定していない`);
  }
  // channel を後から設定されても allowDowngrade を偽に戻す口を持つ（§3.4。channel を使う形へ変えたときの安全網）
  {
    const updater = new NsisUpdater(null, fakeApp);
    updater.channel = 'arm64';
    assert.equal(updater.allowDowngrade, true, '本物の electron-updater が channel の設定で allowDowngrade を真にしない（前提が崩れた）');
    feed.applyUpdaterSettings(updater);
    assert.equal(updater.allowDowngrade, false, 'channel の設定の後に allowDowngrade が偽へ戻らない');
  }
  // UpdateService が updaterSettings を当てていること（ソース）
  const svc = read('electron/services/UpdateService.ts');
  assert.match(svc, /applyUpdaterSettings\(\s*updater\s*\)/, 'UpdateService が applyUpdaterSettings(updater) を呼んでいない');
  assert.match(svc, /logger\s*=\s*console/, 'UpdateService が logger を console にしていない');
  assert.doesNotMatch(svc, /allowDowngrade\s*=\s*true/, 'UpdateService に allowDowngrade = true がある');
  assert.doesNotMatch(svc, /allowPrerelease\s*=\s*true/, 'UpdateService に allowPrerelease = true がある');
  pass('t5/AC1 更新器の設定（本物の NsisUpdater に当てた・channel の設定の後も allowDowngrade が偽）');
}

// ───────────────────────────────────────────────
// [3] t5/AC1 publish と publisherName（MAJ-2・正規化前の生の値で比べる）
// ───────────────────────────────────────────────
// electron-updater 6.8.10 out/windowsExecutableCodeSignatureVerifier.js の判定（本物の parseDn で両側を読み、
// publisherName 側の全キーで値が完全一致）。verifySignature は powershell を起動するので判定の部分だけを同じ形で書く
const realParseDn = updaterRuntime.parseDn;
assert.equal(typeof realParseDn, 'function', 'builder-util-runtime に parseDn が無い');
// 写し元の 70〜87 行: 属性があれば全キーで完全一致・属性が無ければ CN と文字列で比べる（ここは本物の parseDn を使う）
function realJudge(publisherNames, subject) {
  const subjectDn = realParseDn(subject);
  return publisherNames.some((name) => {
    const dn = realParseDn(name);
    if (!dn.size) return name === subjectDn.get('CN');
    return [...dn.keys()].every((key) => dn.get(key) === subjectDn.get(key));
  });
}
// 判定の行が写し元から動いていないこと（版を上げたら写しを見直す合図）
{
  const verifierSrc = readFileSync(updaterRequire.resolve('./windowsExecutableCodeSignatureVerifier.js'), 'utf8');
  assert.match(verifierSrc, /const subject = \(0, builder_util_runtime_1\.parseDn\)\(data\.SignerCertificate\.Subject\);/, 'electron-updater の照合の形が変わった（写しを見直す）');
  assert.match(verifierSrc, /match = allKeys\.every\(key => \{\s*return dn\.get\(key\) === subject\.get\(key\);/, 'electron-updater の全キー一致の形が変わった');
  assert.match(verifierSrc, /else if \(name === subject\.get\("CN"\)\)/, 'electron-updater の CN だけの分岐の形が変わった');
  assert.match(verifierSrc, /chcp 65001 >NUL & powershell\.exe/, 'electron-updater の Subject の取り方（powershell.exe・chcp 65001）が変わった');
}
const { matchesPublisher } = require('./win-sign/updater-publisher-match.cjs');
const identity = JSON.parse(read('scripts/win-sign/signer-identity.json'));
{
  const config = require('../electron-builder.config.cjs');
  assert.ok(Array.isArray(config.publish) && config.publish.length === 1, 'publish が長さ 1 の配列でない');
  const pub = config.publish[0];
  assert.equal(pub.provider, 'github');
  assert.equal(pub.owner, 'code4history');
  assert.equal(pub.repo, 'MaplatEditor');
  assert.equal(pub.releaseType, 'release');
  // (i) 生の Subject の文字列そのもの
  const want = identity['artifact-signing'].publisherSubject;
  assert.ok(typeof want === 'string' && want.length > 0, 'signer-identity.json の artifact-signing.publisherSubject が空');
  assert.ok(Array.isArray(pub.publisherName) && pub.publisherName.length === 1, 'publish[0].publisherName が長さ 1 の配列でない');
  assert.equal(pub.publisherName[0], want, 'publisherName が publisherSubject と文字列として一致しない（加工している）');
  // win.signtoolOptions には置かない（WIN_SIGN_MODE=off で落ちるため。§3.2）
  assert.equal(config.win?.signtoolOptions?.publisherName, undefined, 'win.signtoolOptions.publisherName に置いている');
  // (ii) キーが CN だけでない
  const keys = [...realParseDn(want).keys()];
  assert.ok(keys.length >= 2 && keys.some((k) => k !== 'CN'), `publisherName のキーが CN だけ（${keys.join(',')}）`);
  // (iii) electron-updater の判定そのもの
  assert.equal(realJudge(pub.publisherName, want), true, 'publisherName と publisherSubject が electron-updater の判定で一致しない');
  // .NET 形で S= を含む fixture は eSigner の名義（signer-identity.json の esigner.publisherSubject・U-1 の実測）。
  // 署名者の文字列は正本にだけ置く（nov26-m7-t2 smoke [1](c)）ので、ここでは正本から読む
  const esignerLike = identity.esigner.publisherSubject;
  assert.match(esignerLike, /, S=/, 'eSigner の名義の fixture が S= を含まない（S／ST の罠を確かめられない）');
  const esignerCn = realParseDn(esignerLike).get('CN');
  // O= の値の最後の 1 文字だけを変える
  const oneCharOff = esignerLike.replace(/O="([^"]*)(.)"/, (_m, a, b) => `O="${a}${b === 'X' ? 'Y' : 'X'}"`);
  assert.notEqual(oneCharOff, esignerLike);
  assert.equal(realJudge([esignerLike], esignerLike), true, '.NET 形の fixture が自分自身と一致しない');
  assert.equal(realJudge([esignerLike.replace('S=', 'ST=')], esignerLike), false, 'S= を ST= に書き換えても一致してしまう（罠を検出できない）');
  assert.equal(realJudge([oneCharOff], esignerLike), false, 'O= を 1 文字変えても一致してしまう');
  assert.equal(realJudge([want.replace(/(^|, )S=/, '$1ST=')], want), want.includes('S=') ? false : true, 'artifact-signing の S= を ST= にした値で判定が変わらない');
  assert.equal(realJudge(['CN="Nayuta, Inc."'], want), true, '（参考）CN だけなら通る＝CN だけに落とすと照合が弱まる');
  assert.equal(realJudge(['Nayuta, Inc.'], want), true, '（参考）= の無い名前は CN と文字列で比べる');
  // (iv) 写し（updater-publisher-match.cjs）と本物の突き合わせ
  const subjects = [
    want, esignerLike,
    'CN=a\\, b, O=x',
    'CN="quoted \\"x\\"", O=y',
    'CN=hex\\41\\42, O=z',
    'CN=multi+O=plus, C=JP',
    'CN=semi; O=colon',
    '  CN = spaced ,  O = val  ',
    esignerLike.replace('S=', 'ST='),
    oneCharOff,
    'CN="Nayuta, Inc.", O="Nayuta, Inc.", L=Osaka-shi, S=Osaka-fu, C=US',
    'CN=,O=empty',
    'CN=part\\4z, O=q',
    'CN=trail\\',
    '',
  ];
  const names = [
    [want], [esignerLike], [esignerLike.replace('S=', 'ST=')], [`CN="${esignerCn}"`], ['CN=a\\, b'], ['CN="a, b"'],
    ['CN="quoted \\"x\\""'], ['CN=hexAB'], ['CN=multi', 'O=nomatch'], ['O=plus'], ['CN=semi'], ['CN=spaced, O=val'],
    [''], ['O=zzz'], [want, esignerLike], [], [esignerCn], ['Nayuta, Inc.'], ['spaced'],
  ];
  let compared = 0;
  for (const s of subjects) {
    for (const n of names) {
      let expected;
      let realThrew = false;
      try { expected = realJudge(n, s); } catch { realThrew = true; }
      let got;
      let copyThrew = false;
      try { got = matchesPublisher(n, s); } catch { copyThrew = true; }
      assert.equal(copyThrew, realThrew, `写しと本物で例外の有無が違う: names=${JSON.stringify(n)} subject=${JSON.stringify(s)}`);
      if (!realThrew) assert.equal(got, expected, `写しと本物で判定が違う: names=${JSON.stringify(n)} subject=${JSON.stringify(s)}（本物 ${expected}・写し ${got}）`);
      compared++;
    }
  }
  // 写しが本物の parseDn と同じ Map を返す（素の読み取りも突き合わせる）
  const { parseDn: copyParseDn } = require('./win-sign/updater-publisher-match.cjs');
  for (const s of subjects) {
    let a; let b; let ta = false; let tb = false;
    try { a = [...realParseDn(s)]; } catch { ta = true; }
    try { b = [...copyParseDn(s)]; } catch { tb = true; }
    assert.equal(tb, ta, `parseDn の例外の有無が違う: ${JSON.stringify(s)}`);
    if (!ta) assert.deepEqual(b, a, `parseDn の結果が違う: ${JSON.stringify(s)}`);
  }
  pass(`t5/AC1 publish・publisherName (i)〜(iv)（写しと本物を ${compared} 通りで突き合わせ）`);
}

// ───────────────────────────────────────────────
// [4] t5/AC1 vite.config.ts の main の external（MIN-8）
// ───────────────────────────────────────────────
function mainExternal(src) {
  const m = src.match(/external:\s*\[([^\]]*)\]/);
  assert.ok(m, 'vite.config.ts に main の external の配列が無い');
  const items = [...m[1].matchAll(/'([^']+)'|\/((?:\\.|[^/])+)\//g)].map((x) => x[1] ?? `/${x[2]}/`);
  return new Set(items);
}
{
  const head = mainExternal(read('vite.config.ts'));
  assert.ok(head.has('electron-updater'), 'external に electron-updater が無い');
  // 不在の断言の needle は m18-t8-packaging-smoke と同じく分割して書く（同 smoke の scripts/ の残骸検査に当たらないため）
  const DUCK = '@' + 'duckdb';
  for (const x of head) assert.ok(!x.includes(DUCK), `external に ${DUCK} が残っている（${x}）`);
  const hasBase = git('rev-parse', '--verify', '--quiet', 'origin/master').status === 0;
  if (hasBase) {
    const base = mainExternal(git('show', 'origin/master:vite.config.ts').stdout);
    const want = new Set([...base, 'electron-updater']);
    assert.deepEqual([...head].sort(), [...want].sort(), 'external(HEAD) が external(origin/master) ∪ {electron-updater} でない');
    pass(`t5/AC1 vite external = origin/master ∪ {electron-updater}（${[...head].join(', ')}）`);
  } else {
    // CI の浅い checkout には origin/master が無い。m6 t1 の後の master の期待値（MIN-8）で比べる
    const want = new Set(['node:sqlite', 'jimp', '@jsquash/webp', 'pwa-asset-generator', 'electron-updater']);
    assert.deepEqual([...head].sort(), [...want].sort(), 'external が MIN-8 の期待値と違う');
    pass('t5/AC1 vite external（origin/master が無いので MIN-8 の期待値で比べた）');
  }
}

// ───────────────────────────────────────────────
// [5] t5/AC2 更新の確認を起動する呼び出しは UpdateService.ts の中だけ
// ───────────────────────────────────────────────
{
  const r = git('grep', '--untracked', '-n', '-E', 'checkForUpdates|downloadUpdate|quitAndInstall', '--', 'electron', 'src');
  assert.ok(r.status === 0 || r.status === 1, `git grep が失敗した: ${r.stderr}`);
  const files = new Set(r.stdout.split('\n').filter(Boolean).map((l) => l.split(':')[0]));
  assert.deepEqual([...files], ['electron/services/UpdateService.ts'], `該当が UpdateService.ts の中だけでない: ${[...files].join(', ')}`);
  pass('t5/AC2 checkForUpdates・downloadUpdate・quitAndInstall の該当は UpdateService.ts だけ');
}

// ───────────────────────────────────────────────
// [6] t5/AC3 resolveUpdateFeed
// ───────────────────────────────────────────────
{
  const { resolveUpdateFeed } = feed;
  const gh = JSON.stringify({ provider: 'github', owner: 'code4history', repo: 'MaplatEditor', host: '127.0.0.1:41234', protocol: 'http' });
  const generic = JSON.stringify({ provider: 'generic', url: 'http://127.0.0.1:41234/feed/' });
  const root = '/tmp/e2e-root';
  const github = { kind: 'github' };
  const cases = [
    // isPackaged: true は env に何を入れても github
    [true, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: gh }, github],
    [true, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: generic }, github],
    [true, {}, github],
    // MAPLAT_E2E_ROOT が無い・空
    [false, { MAPLAT_E2E_UPDATE_FEED: gh }, github],
    [false, { MAPLAT_E2E_ROOT: '', MAPLAT_E2E_UPDATE_FEED: gh }, github],
    // 127.0.0.1 以外の host・http://127.0.0.1:<port>/ で始まらない URL・JSON として読めない値
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'github', host: 'evil.example:80', protocol: 'http' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'github', host: 'localhost:41234', protocol: 'http' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'github', host: '127.0.0.1', protocol: 'http' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'github', host: '127.0.0.1:41234', protocol: 'https' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'github', host: '127.0.0.1.evil.example:41234', protocol: 'http' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'generic', url: 'https://127.0.0.1:41234/' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'generic', url: 'http://127.0.0.1.evil.example:41234/' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'generic', url: 'http://127.0.0.1:41234' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'generic', url: 'http://127.0.0.1@evil.example:41234/' }) }, github],
    // 先頭の固定（LOOPBACK_HOST・LOOPBACK_URL の ^）を外す退行を検出する（B40 MIN-1）
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'github', host: 'evil.example127.0.0.1:41234', protocol: 'http' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 'generic', url: 'http://evil.example/?http://127.0.0.1:41234/' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify({ provider: 's3', bucket: 'x' }) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: JSON.stringify(['http://127.0.0.1:41234/']) }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: 'http://127.0.0.1:41234/' }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: '{not json' }, github],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: '' }, github],
    [false, { MAPLAT_E2E_ROOT: root }, github],
    // 有効な形
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: gh }, { kind: 'test', options: JSON.parse(gh) }],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_FEED: generic }, { kind: 'test', options: JSON.parse(generic) }],
  ];
  for (const [isPackaged, env, expected] of cases) {
    assert.deepEqual(resolveUpdateFeed({ isPackaged, env }), expected, `resolveUpdateFeed(${isPackaged}, ${JSON.stringify(env)})`);
  }
  // isPackaged: true のときは env を読まない（getter で読み取りを検出する）
  let touched = false;
  const spy = new Proxy({}, { get() { touched = true; return undefined; }, has() { touched = true; return false; } });
  assert.deepEqual(resolveUpdateFeed({ isPackaged: true, env: spy }), github);
  assert.equal(touched, false, 'isPackaged: true なのに env を読んだ');
  for (const rel of ['electron/services/UpdateService.ts', 'electron/utils/updateFeed.ts']) {
    const src = read(rel);
    assert.doesNotMatch(src, /SettingsService/, `${rel} が SettingsService を読む`);
    assert.doesNotMatch(src, /process\.argv/, `${rel} が process.argv を読む`);
  }
  // renderer に更新元を渡す IPC を作らない（C-6）
  assert.doesNotMatch(read('electron/services/UpdateService.ts'), /ipcMain|webContents\.send/, 'UpdateService が IPC を持つ');
  // e2e の口は !app.isPackaged && MAPLAT_E2E_ROOT のときだけ
  assert.match(read('electron/services/UpdateService.ts'), /!app\.isPackaged\s*&&\s*process\.env\[?['.]?MAPLAT_E2E_ROOT/, 'e2e の口の条件が !app.isPackaged && MAPLAT_E2E_ROOT でない');
  pass(`t5/AC3 resolveUpdateFeed（${cases.length + 1} 通り）・設定と引数を読まない`);
}

// ───────────────────────────────────────────────
// [7] t5/AC4 (d) Windows の arch の選び方（判定 (A): latest.yml に両 arch が載り、Provider の findFile が process.arch を見る）
// ───────────────────────────────────────────────
{
  const { findFile } = updaterRequire('./providers/Provider.js');
  assert.equal(typeof findFile, 'function', 'electron-updater の Provider に findFile が無い');
  // v1.1.0 の Release の latest.yml の形（2026-10-17 に gh release download で測った。§3.5 の 1）
  const ver = '1.1.0';
  const base = new URL(`https://github.com/code4history/MaplatEditor/releases/download/v${ver}/`);
  const files = [
    { url: new URL(`MaplatEditor-Windows-${ver}-x64-Setup.exe`, base), info: { url: `MaplatEditor-Windows-${ver}-x64-Setup.exe`, sha512: 'x' } },
    { url: new URL(`MaplatEditor-Windows-${ver}-arm64-Setup.exe`, base), info: { url: `MaplatEditor-Windows-${ver}-arm64-Setup.exe`, sha512: 'a' } },
  ];
  const desc = Object.getOwnPropertyDescriptor(process, 'arch');
  const pickWith = (arch, list) => {
    Object.defineProperty(process, 'arch', { ...desc, value: arch });
    try { return findFile(list, 'exe')?.info.url; } finally { Object.defineProperty(process, 'arch', desc); }
  };
  try {
    assert.equal(pickWith('x64', files), `MaplatEditor-Windows-${ver}-x64-Setup.exe`, 'x64 で x64 の Setup.exe が選ばれない');
    assert.equal(pickWith('arm64', files), `MaplatEditor-Windows-${ver}-arm64-Setup.exe`, 'arm64 で arm64 の Setup.exe が選ばれない');
    // 並びを逆にしても同じ（先頭を取っているだけではないことの確かめ）
    const rev = [...files].reverse();
    assert.equal(pickWith('x64', rev), `MaplatEditor-Windows-${ver}-x64-Setup.exe`, '並びを逆にすると x64 で x64 が選ばれない');
    assert.equal(pickWith('arm64', rev), `MaplatEditor-Windows-${ver}-arm64-Setup.exe`, '並びを逆にすると arm64 で arm64 が選ばれない');
  } finally {
    Object.defineProperty(process, 'arch', desc);
  }
  assert.equal(process.arch, desc.value, 'process.arch を戻せていない');
  // artifactName が arch を名前に含み続けること（判定 (A) の前提）
  const config = require('../electron-builder.config.cjs');
  assert.match(config.win.artifactName, /\$\{arch\}/, 'win.artifactName が ${arch} を含まない（判定 (A) の前提が崩れる）');
  assert.deepEqual(config.win.target.find((t) => t.target === 'nsis')?.arch, ['x64', 'arm64']);
  pass('t5/AC4 (d) Windows の arch の選び方（判定 (A)・本物の findFile を process.arch を差し替えて呼んだ）');
}

// ───────────────────────────────────────────────
// [8] mac の zip・build.yml・verify-win-install
// ───────────────────────────────────────────────
{
  const config = require('../electron-builder.config.cjs');
  const zip = config.mac.target.find((t) => t.target === 'zip');
  assert.ok(zip, 'mac.target に zip が無い（Squirrel.Mac は zip を要る）');
  assert.deepEqual(zip.arch, ['x64', 'arm64'], 'mac の zip が x64・arm64 でない');
  assert.ok(config.mac.target.find((t) => t.target === 'dmg'), 'mac.target から dmg が消えた');
  assert.equal(config.mac.artifactName, '${productName}-Mac-${version}-${arch}.${ext}', 'mac.artifactName が変わった');
  const wf = read('.github/workflows/build.yml');
  const macUpload = wf.match(/- name: Upload macOS artifacts[\s\S]*?(?=\n\n|\n {2}#)/)?.[0] ?? '';
  for (const glob of ['*.dmg', '*.dmg.blockmap', '*.zip', '*.zip.blockmap', 'latest-mac.yml']) {
    assert.ok(macUpload.includes(`release/\${{ env.VERSION }}/${glob}\n`) || macUpload.endsWith(`release/\${{ env.VERSION }}/${glob}`),
      `Upload macOS artifacts の path に ${glob} が無い`);
  }
  assert.ok(!wf.includes('アプリは electron-updater を使わない'), 'build.yml に「アプリは electron-updater を使わない」が残っている');
  assert.ok(wf.includes('アプリの自動更新（electron-updater）は `allowPrerelease: false` で prerelease を見ない（#141）'), 'build.yml の注記が直っていない');
  // verify-win-install に app-update.yml の publisherName の検査がある（§3.6）
  const vwi = read('scripts/win-sign/verify-win-install.mjs');
  assert.match(vwi, /app-update\.yml/, 'verify-win-install が app-update.yml を読まない');
  assert.match(vwi, /updater-publisher-match\.cjs/, 'verify-win-install が matchesPublisher を使わない');
  assert.match(vwi, /chcp 65001/, 'verify-win-install が electron-updater と同じ powershell.exe（chcp 65001）で Subject を取らない（R2-INFO-3）');
  const vwiMod = await import('../scripts/win-sign/verify-win-install.mjs');
  const pubSubj = identity['artifact-signing'].publisherSubject;
  // fixture は electron-builder が app-update.yml を書くのと同じ serializeToYaml（app-builder-lib の builder-util）で作る
  const abRequire = createRequire(require.resolve('app-builder-lib/package.json', { paths: [path.dirname(require.resolve('electron-builder/package.json'))] }));
  const { serializeToYaml } = abRequire('builder-util');
  const yaml = abRequire('js-yaml');
  const yml = (names) => serializeToYaml({ owner: 'code4history', repo: 'MaplatEditor', provider: 'github', releaseType: 'release',
    ...(names == null ? {} : { publisherName: names }), updaterCacheDirName: 'maplateditor-updater' });
  // 依存を入れない最小の読み取り（readPublisherNames）が js-yaml の読み取りと同じ値を返す
  for (const names of [[pubSubj], [identity.esigner.publisherSubject], ["a'b: c"], ['"x" y'], ['#hash', ' lead', 'tail '], ['- dash', 'k: v', '@at', 'null', '123', 'true'], [pubSubj, 'CN=extra']]) {
    const text = yml(names);
    assert.deepEqual(vwiMod.readPublisherNames(text), yaml.load(text).publisherName, `readPublisherNames が js-yaml と違う: ${text}`);
  }
  assert.equal(vwiMod.readPublisherNames(yml(null)), null, 'publisherName が無いのに null でない');
  assert.deepEqual(vwiMod.readPublisherNames('publisherName: CN=single\n'), ['CN=single'], '1 つの文字列の publisherName を読めない');
  const judge = vwiMod.judgeAppUpdatePublisher;
  assert.equal(typeof judge, 'function', 'verify-win-install が judgeAppUpdatePublisher を export しない');
  assert.deepEqual(judge({ appUpdateYml: yml([pubSubj]), subject: pubSubj, identity, signer: 'artifact-signing' }).failures, [], '正しい組で赤になる');
  assert.ok(judge({ appUpdateYml: yml(null), subject: pubSubj, identity, signer: 'artifact-signing' }).failures.length > 0, 'publisherName が無いのに赤にならない');
  assert.ok(judge({ appUpdateYml: yml([pubSubj.replace(/(^|, )S=/, '$1ST=')]), subject: pubSubj, identity, signer: 'artifact-signing' }).failures.length > 0, 'S→ST の書き換えで赤にならない');
  assert.ok(judge({ appUpdateYml: yml([pubSubj]), subject: pubSubj.replace('Osaka-shi', 'Osaka'), identity, signer: 'artifact-signing' }).failures.length > 0, 'Setup.exe の Subject が違うのに赤にならない');
  assert.ok(judge({ appUpdateYml: yml([pubSubj, 'CN=extra']), subject: pubSubj, identity, signer: 'artifact-signing' }).failures.length > 0, 'publisherName が 2 要素なのに赤にならない');
  assert.ok(judge({ appUpdateYml: yml([pubSubj]), subject: null, identity, signer: 'artifact-signing' }).failures.length > 0, 'Subject が取れないのに赤にならない');
  pass('mac の zip・build.yml の artifact と注記・verify-win-install の publisherName の検査');
}

// ───────────────────────────────────────────────
// [9] MacUpdater（MIN-9）: ダウンロードの後に Squirrel を呼ぶのは autoInstallOnAppQuit だけで決まる
// ───────────────────────────────────────────────
{
  const mac = readFileSync(updaterRequire.resolve('./MacUpdater.js'), 'utf8');
  const app = readFileSync(updaterRequire.resolve('./AppUpdater.js'), 'utf8');
  assert.ok(!/autoInstallEvent/.test(mac) && !/autoInstallEvent/.test(app), `electron-updater ${updaterPkg.version} に autoInstallEvent がある（§3.5 の 5 の判定をやり直す）`);
  // (a) ダウンロードの後の nativeUpdater.checkForUpdates() は if (this.autoInstallOnAppQuit) の中だけ
  const lines = mac.split('\n');
  const calls = lines.map((l, i) => [i, l]).filter(([, l]) => l.includes('nativeUpdater.checkForUpdates()'));
  assert.ok(calls.length >= 1, 'MacUpdater に nativeUpdater.checkForUpdates() が無い');
  const guarded = calls.filter(([i]) => lines.slice(Math.max(0, i - 6), i).some((l) => /if \(this\.autoInstallOnAppQuit\)/.test(l)));
  assert.ok(guarded.length >= 1, 'ダウンロードの後の nativeUpdater.checkForUpdates() が autoInstallOnAppQuit で守られていない');
  const unguardedOutsideQuit = calls.filter(([i]) => !guarded.some(([g]) => g === i))
    .filter(([i]) => !lines.slice(Math.max(0, i - 30), i).some((l) => /quitAndInstall\(\)\s*\{/.test(l)));
  assert.deepEqual(unguardedOutsideQuit.map(([i]) => i + 1), [], 'autoInstallOnAppQuit と quitAndInstall の外で Squirrel を呼ぶ箇所がある');
  assert.match(mac, /nativeUpdater\.on\("error"/, 'nativeUpdater の error を autoUpdater の error へ流す箇所が無い');
  pass(`MacUpdater（${updaterPkg.version}）: ダウンロード後の Squirrel は autoInstallOnAppQuit だけで決まる（MIN-9）`);
}

assert.ok(existsSync(path.join(projectRoot, 'tests/e2e/nov26-m7-t5-update-feed.spec.ts')), 'e2e（tests/e2e/nov26-m7-t5-update-feed.spec.ts）が無い');
console.log('nov26-m7-t5 update-foundation smoke: PASS');
