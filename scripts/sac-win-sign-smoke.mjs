/**
 * SAC（2026-10-03）: Windows 配布物の全 PE 署名フック（scripts/win-sign/win-sign.cjs）の受け入れ検査。
 *
 * 実ビルドと実署名は CI（build.yml）でしか走らないため、ここでは課金も Windows も要らない部分を固める:
 *   [1] WIN_SIGN_MODE の解釈（既定 off・不正値は落とす）
 *   [2] electron-builder.config.cjs の結線（off では従来どおり何も登録しない / record・esigner ではフック・
 *       signExts・sha256 だけの署名・beforePack を登録）と、CPU 別 .node 除外パターンの展開結果
 *   [3] PE の解析と「署名を除いた中身」のハッシュ（未署名と署名済みで一致・中身が違えば不一致）
 *   [4] キャッシュの取り込み関門（未署名・改ざんを拒む）
 *   [5] record モードの判断と記録（PE でない / 署名済み / 署名するはず / 同じ中身の使い回し）
 *   [6] esigner モードは資格情報が無ければ署名せずに落ちる（ファイルを変えない）
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const WIN_SIGN = path.join(projectRoot, 'scripts/win-sign/win-sign.cjs');
const CONFIG = path.join(projectRoot, 'electron-builder.config.cjs');

const loadFresh = (p) => {
  delete require.cache[require.resolve(p)];
  return require(p);
};

// ───────────────────────────────────────────────
// [1] モード
// ───────────────────────────────────────────────
{
  const ws = loadFresh(WIN_SIGN);
  delete process.env.WIN_SIGN_MODE;
  assert.equal(ws.getMode(), 'off', '[1] 未設定は off');
  process.env.WIN_SIGN_MODE = ' Record ';
  assert.equal(ws.getMode(), 'record', '[1] 大文字・空白を許す');
  process.env.WIN_SIGN_MODE = 'esigner';
  assert.equal(ws.getMode(), 'esigner', '[1] esigner');
  process.env.WIN_SIGN_MODE = 'sign';
  assert.throws(() => ws.getMode(), /WIN_SIGN_MODE/, '[1] 不正値は落とす（黙って off にしない）');
  delete process.env.WIN_SIGN_MODE;
  console.log('  [1/6] WIN_SIGN_MODE の解釈: PASS');
}

// ───────────────────────────────────────────────
// [2] 設定の結線
// ───────────────────────────────────────────────
{
  delete process.env.WIN_SIGN_MODE;
  const off = loadFresh(CONFIG);
  assert.equal(off.win.signtoolOptions, undefined, '[2] off: 署名フックを登録しない');
  assert.equal(off.win.signExts, undefined, '[2] off: signExts を足さない');
  assert.equal(off.beforePack, undefined, '[2] off: beforePack を登録しない');
  assert.equal(off.win.files, undefined, '[2] win.files を置かない（root の files を置き換えてしまう）');

  for (const mode of ['record', 'esigner']) {
    process.env.WIN_SIGN_MODE = mode;
    const cfg = loadFresh(CONFIG);
    assert.equal(typeof cfg.win.signtoolOptions?.sign, 'function', `[2] ${mode}: 署名フックを登録`);
    assert.deepEqual(cfg.win.signtoolOptions.signingHashAlgorithms, ['sha256'],
      `[2] ${mode}: sha256 だけ（既定の sha1+sha256 はフックが 1 ファイル 2 回呼ばれ課金が倍）`);
    assert.deepEqual(cfg.win.signExts, ['.dll', '.node'], `[2] ${mode}: .dll と .node もフックへ渡す`);
    assert.ok(!cfg.win.signExts.some((e) => e.startsWith('!')),
      `[2] ${mode}: signExts に除外を書かない（肯定パターンが先に評価され効かない）`);
    assert.equal(typeof cfg.beforePack, 'function', `[2] ${mode}: beforePack（NSIS プラグインの署名）を登録`);
    assert.equal(cfg.afterSign, undefined, `[2] ${mode}: macOS の公証フックに影響しない`);
  }
  delete process.env.WIN_SIGN_MODE;

  // CPU 別 .node 除外: root の files にあり、Windows ビルドでだけ他 CPU 向けを落とす
  const cfg = loadFresh(CONFIG);
  const pat = cfg.files.find((f) => typeof f === 'string' && f.includes('msvc.node'));
  assert.equal(pat, '!**/*.${os}32-!(${arch})-msvc.node', '[2] CPU 別 .node 除外パターン');
  const ebDir = path.dirname(require.resolve('electron-builder/package.json'));
  const ablDir = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [ebDir] }));
  const { Minimatch } = require(require.resolve('minimatch', { paths: [ablDir] }));
  const expand = (os, arch) => new Minimatch(pat.replace('${os}', os).replace('${arch}', arch), { dot: true });
  const X = 'node_modules/extract-zip/index.win32-x64-msvc.node';
  const A = 'node_modules/extract-zip/index.win32-arm64-msvc.node';
  const L = 'node_modules/extract-zip/index.linux-x64-gnu.node';
  // 否定パターンの match() は「除外対象でない」とき true（electron-builder の filter.js と同じ解釈）
  assert.ok(expand('win', 'x64').match(X) && !expand('win', 'x64').match(A), '[2] win x64: x64 を残し arm64 を落とす');
  assert.ok(expand('win', 'arm64').match(A) && !expand('win', 'arm64').match(X), '[2] win arm64: arm64 を残し x64 を落とす');
  assert.ok(expand('win', 'x64').match(L), '[2] win: 非 Windows の .node はこのパターンでは落とさない');
  for (const [os, arch] of [['mac', 'x64'], ['mac', 'arm64'], ['mac', 'universal'], ['linux', 'x64'], ['linux', 'arm64']]) {
    assert.ok(expand(os, arch).match(X) && expand(os, arch).match(A), `[2] ${os} ${arch}: 何も落とさない（macOS・Linux の同梱物は不変）`);
  }
  console.log('  [2/6] electron-builder.config.cjs の結線: PASS');
}

// ───────────────────────────────────────────────
// 合成 PE（PE32+）
// ───────────────────────────────────────────────
function makePe({ body = 'hello', magic = 0x20b } = {}) {
  const peOff = 0x80;
  const opt = peOff + 24;
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const size = dirs + 16 * 8 + 64;
  const buf = Buffer.alloc(size);
  buf.write('MZ', 0, 'latin1');
  buf.writeUInt32LE(peOff, 0x3c);
  buf.writeUInt32LE(0x00004550, peOff);
  buf.writeUInt16LE(magic, opt);
  buf.writeUInt32LE(16, opt + (magic === 0x20b ? 108 : 92));
  buf.writeUInt32LE(0x1234, opt + 64); // CheckSum
  return Buffer.concat([buf, Buffer.from(body + 'X', 'latin1')]); // 末尾は 0 でない
}
/** 署名と同じ変形: 8 バイト境界へ 0 詰め → WIN_CERTIFICATE を末尾へ → 証明書表と CheckSum を書き換える */
function fakeSign(unsigned, magic = 0x20b) {
  const pad = (8 - (unsigned.length % 8)) % 8;
  const cert = Buffer.alloc(24);
  cert.writeUInt32LE(24, 0);
  cert.write('PKCS7DATA!', 8, 'latin1');
  const out = Buffer.concat([unsigned, Buffer.alloc(pad), cert]);
  const opt = out.readUInt32LE(0x3c) + 24;
  const sec = opt + (magic === 0x20b ? 112 : 96) + 32;
  out.writeUInt32LE(unsigned.length + pad, sec);
  out.writeUInt32LE(cert.length, sec + 4);
  out.writeUInt32LE(0xbeef, opt + 64);
  return out;
}

// ───────────────────────────────────────────────
// [3] PE の解析と署名を除いた中身のハッシュ
// ───────────────────────────────────────────────
{
  const ws = loadFresh(WIN_SIGN);
  assert.equal(ws.readPeInfo(Buffer.from('not a pe at all, just bytes......................................')), null, '[3] PE でないものは null');
  assert.equal(ws.readPeInfo(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), null, '[3] ELF（linux の .node）は PE でない');
  for (const magic of [0x20b, 0x10b]) {
    const u = makePe({ magic });
    const s = fakeSign(u, magic);
    const iu = ws.readPeInfo(u);
    const is = ws.readPeInfo(s);
    assert.ok(iu && !iu.hasCert, `[3] 未署名は証明書表なし（magic ${magic.toString(16)}）`);
    assert.ok(is && is.hasCert, `[3] 署名済みは証明書表あり（magic ${magic.toString(16)}）`);
    assert.equal(ws.strippedDigest(s), ws.strippedDigest(u), `[3] 署名を除いた中身は一致（magic ${magic.toString(16)}）`);
    assert.ok(ws.extractPkcs7(s).toString('latin1').startsWith('PKCS7DATA!'), '[3] 埋め込み PKCS#7 を取り出せる');
  }
  const other = fakeSign(makePe({ body: 'hellp' }));
  assert.notEqual(ws.strippedDigest(other), ws.strippedDigest(makePe()), '[3] 中身が 1 バイト違えば不一致');
  assert.ok(ws.assetName('ab'.repeat(32), '/x/ffmpeg.dll').endsWith('--ffmpeg.dll.signed'), '[3] asset 名は .signed で終わる');
  // 署名者 CN の判定（.NET は値にカンマがあると引用符で囲む）
  const CN = 'NAYUTA, INC.';
  assert.ok(ws.subjectHasCn('CN="NAYUTA, INC.", O="NAYUTA, INC.", L=Osaka, C=JP', CN), '[3] 引用符ありの CN');
  assert.ok(ws.subjectHasCn('CN=NAYUTA, INC., O=NAYUTA, INC., C=JP', CN), '[3] 引用符なしの CN');
  assert.ok(!ws.subjectHasCn('CN=Evil, O="NAYUTA, INC."', CN), '[3] O だけ一致は不可');
  assert.ok(!ws.subjectHasCn('CN="NAYUTA, INC. X"', CN), '[3] 前方一致は不可');
  assert.ok(!ws.subjectHasCn(null, CN), '[3] 署名者なしは不可');
  console.log('  [3/6] PE の解析と署名を除いた中身のハッシュ: PASS');
}

// ───────────────────────────────────────────────
// [4] キャッシュの取り込み関門（非 Windows・record での判定）
// ───────────────────────────────────────────────
{
  process.env.WIN_SIGN_MODE = 'record';
  const ws = loadFresh(WIN_SIGN);
  const u = makePe();
  const want = ws.strippedDigest(u);
  assert.match(ws.rejectCachedReason(u, want, '/dev/null') ?? '', /証明書表が無い/, '[4] 未署名の asset を拒む');
  assert.match(ws.rejectCachedReason(fakeSign(makePe({ body: 'evil!' })), want, '/dev/null') ?? '', /一致しない/,
    '[4] 中身の違う署名済み asset（取り違え・改ざん）を拒む');
  assert.match(ws.rejectCachedReason(Buffer.from('zzzz'), want, '/dev/null') ?? '', /PE ではない/, '[4] PE でない asset を拒む');
  if (process.platform !== 'win32') {
    assert.equal(ws.rejectCachedReason(fakeSign(u), want, '/dev/null'), null, '[4] 中身が一致する署名済み asset は通す（record・非 Windows）');
    process.env.WIN_SIGN_MODE = 'esigner';
    assert.match(ws.rejectCachedReason(fakeSign(u), want, '/dev/null') ?? '', /Windows でしか/,
      '[4] esigner は Authenticode を確かめられない環境ではキャッシュを使わない');
  }
  delete process.env.WIN_SIGN_MODE;
  console.log('  [4/6] キャッシュの取り込み関門: PASS');
}

// ───────────────────────────────────────────────
// [5] record モードの判断と記録
// ───────────────────────────────────────────────
const work = mkdtempSync(path.join(tmpdir(), 'sac-win-sign-'));
{
  process.env.WIN_SIGN_MODE = 'record';
  process.env.WIN_SIGN_WORK_DIR = path.join(work, 'ws');
  process.env.WIN_SIGN_RECORD_FILE = path.join(work, 'record.jsonl');
  delete process.env.WIN_SIGN_CACHE_URL;
  delete process.env.WIN_SIGN_CACHE_DIR;
  delete process.env.WIN_SIGN_CACHE_SIMULATE_DIR;
  const ws = loadFresh(WIN_SIGN);
  const put = (name, buf) => { const p = path.join(work, name); writeFileSync(p, buf); return p; };
  const elf = put('index.linux-x64-gnu.node', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]));
  const dllA = put('ffmpeg.dll', makePe({ body: 'ffmpeg' }));
  const dllB = put('ffmpeg-copy.dll', makePe({ body: 'ffmpeg' })); // 同じ中身（x64/arm64 の elevate.exe 相当）
  const exe = put('MaplatEditor.exe', makePe({ body: 'app' }));
  const exe2 = put('MaplatEditor2.exe', makePe({ body: 'app' })); // 同じ中身でもキャッシュ対象外
  const ms = put('d3dcompiler_47.dll', fakeSign(makePe({ body: 'ms' })));
  const before = readFileSync(dllA);

  if (process.platform !== 'win32') {
    assert.equal(await ws.signFile(elf), 'skip-not-pe', '[5] PE でない .node は署名しない');
    assert.equal(await ws.signFile(ms), 'skip-already-signed', '[5] 署名済みは再署名しない');
    assert.equal(await ws.signFile(dllA), 'would-sign', '[5] 未署名 DLL は署名するはず');
    assert.equal(await ws.signFile(dllB), 'cache-hit', '[5] 同じ中身の DLL は同じプロセス内で使い回す');
    assert.equal(await ws.signFile(exe), 'would-sign', '[5] アプリ本体 exe は署名するはず');
    assert.equal(await ws.signFile(exe2), 'would-sign', '[5] アプリ本体 exe はキャッシュしない');
    assert.deepEqual(readFileSync(dllA), before, '[5] record は成果物を変えない');
    const rec = readFileSync(process.env.WIN_SIGN_RECORD_FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rec.map((e) => e.decision),
      ['skip-not-pe', 'skip-already-signed', 'would-sign', 'cache-hit', 'would-sign', 'would-sign'], '[5] 記録の判断');
    assert.equal(rec[2].sha256, createHash('sha256').update(before).digest('hex'), '[5] 記録の SHA-256 は署名前の中身');
    assert.equal(rec[3].cache, 'session', '[5] 使い回しの出どころ');
    assert.ok(rec.every((e) => e.mode === 'record'), '[5] 記録にモードが残る');
  } else {
    console.log('  （[5] は Windows では Authenticode を引くため省略。CI の smoke は macOS で走る）');
  }

  // シミュレーション: 1 回目で印を残し、2 回目（別プロセス相当）で当たる
  process.env.WIN_SIGN_CACHE_SIMULATE_DIR = path.join(work, 'sim');
  const ws1 = loadFresh(WIN_SIGN);
  const dllC = put('libEGL.dll', makePe({ body: 'egl' }));
  if (process.platform !== 'win32') {
    assert.equal(await ws1.signFile(dllC), 'would-sign', '[5] シミュレーション 1 回目は署名');
    const ws2 = loadFresh(WIN_SIGN);
    assert.equal(await ws2.signFile(dllC), 'cache-hit', '[5] シミュレーション 2 回目はキャッシュに当たる');
  }
  delete process.env.WIN_SIGN_CACHE_SIMULATE_DIR;
  console.log('  [5/6] record モードの判断と記録: PASS');
}

// ───────────────────────────────────────────────
// [6] esigner は資格情報が無ければ落ちる（署名しない・ファイルを変えない）
// ───────────────────────────────────────────────
{
  process.env.WIN_SIGN_MODE = 'esigner';
  for (const k of ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET', 'CODE_SIGN_TOOL_PATH']) delete process.env[k];
  const ws = loadFresh(WIN_SIGN);
  const p = path.join(work, 'Uninstall.exe');
  const buf = makePe({ body: 'uninst' });
  writeFileSync(p, buf);
  await assert.rejects(() => ws.signFile(p), /ES_USERNAME/, '[6] 資格情報が無ければ落ちる');
  assert.deepEqual(readFileSync(p), buf, '[6] 落ちたときファイルを変えない');
  assert.ok(!existsSync(path.join(work, 'ws', 'cache-outbox')), '[6] キャッシュ候補を作らない');
  delete process.env.WIN_SIGN_MODE;
  console.log('  [6/6] esigner の資格情報なし: PASS');
}

console.log('\nSAC win-sign smoke: すべて成功');
