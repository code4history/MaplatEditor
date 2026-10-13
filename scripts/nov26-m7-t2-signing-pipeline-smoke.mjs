/**
 * nov26-m7-t2: Windows 署名を Azure Artifact Signing の署名専用ジョブへ移した経路の受け入れ検査（t2/AC1）。
 *
 * 実署名は CI（build.yml の dispatch・承認つき）でしか走らないため、ここでは Windows も課金も要らない部分を固める:
 *   [1] 署名者の正本（scripts/win-sign/signer-identity.{json,cjs}）— AC1 (c)(d)(e)
 *   [2] win-sign.cjs の collect・同じ実行の署名済みでの差し替え・fail-closed — AC1 (f) の一部・(o)(p)
 *   [3] collect-sign-set.mjs・apply-signed.mjs の phase の規則と照合 — MIN-1
 *   [4] build.yml の静的検査 — AC1 (a)(b)(f)(g)(h)(i)(j)(k)(l)(n)
 *   [5] 祖先の確認の shell を fixture のリポジトリで実行 — AC1 (h)
 *   [6] 変異の自己検査 — AC1 (m)
 *
 * 実行: node scripts/nov26-m7-t2-signing-pipeline-smoke.mjs（rtk を付けない）
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync, readdirSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const SIGNER_JSON = path.join(projectRoot, 'scripts/win-sign/signer-identity.json');
const SIGNER = path.join(projectRoot, 'scripts/win-sign/signer-identity.cjs');
const WIN_SIGN = path.join(projectRoot, 'scripts/win-sign/win-sign.cjs');
const WORKFLOW = path.join(projectRoot, '.github/workflows/build.yml');

const loadFresh = (p) => {
  delete require.cache[require.resolve(p)];
  return require(p);
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ───────────────────────────────────────────────
// fixture: 署名者
// ───────────────────────────────────────────────
// .NET（Get-AuthenticodeSignature）の形の Subject と、X509Chain の段（0 は葉・1 は直接の発行者・2 以降が上位）
const AS_SUBJECT = 'CN="Nayuta, Inc.", O="Nayuta, Inc.", L=Osaka-shi, S=Osaka-fu, C=JP';
const AS_CHAIN = [
  { subject: AS_SUBJECT, thumbprint: '279840BE7BA10A552A8185D0438E7883E55F42B6' },
  { subject: 'CN=Microsoft ID Verified CS EOC CA 03, O=Microsoft Corporation, C=US', thumbprint: 'C1E16A2011AA98EAA598F759A13BDA2E742D8881' },
  { subject: 'CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US', thumbprint: '8E750F459DAF9A79D6370DB747AD2226866AD818' },
  { subject: 'CN=Microsoft Identity Verification Root Certificate Authority 2020, O=Microsoft Corporation, C=US', thumbprint: 'F40042E2E5F7E8EF8189FED15519AECE42C3BFA2' },
];
// eSigner（SSL.com）の fixture。値は docs/release-signing.md Part G の記録の DN を .NET の形にしたもの・チェーンは架空
const ES_SUBJECT = 'CN="NAYUTA, INC.", O="NAYUTA, INC.", L=Osaka, S=Ōsaka Prefecture, C=JP';
const ES_ROOT = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ES_CHAIN = [
  { subject: ES_SUBJECT, thumbprint: '1111111111111111111111111111111111111111' },
  { subject: 'CN=SSL.com Code Signing Intermediate CA RSA R1, O=SSL Corp, C=US', thumbprint: '2222222222222222222222222222222222222222' },
  { subject: 'CN=SSL.com Root Certification Authority RSA, O=SSL Corporation, L=Houston, S=Texas, C=US', thumbprint: ES_ROOT },
];
const FIXTURE_IDENTITY = {
  'artifact-signing': {
    publisherSubject: AS_SUBJECT,
    subject: { CN: 'Nayuta, Inc.', O: 'Nayuta, Inc.', L: 'Osaka-shi', ST: 'Osaka-fu', C: 'JP' },
    issuerAllow: [
      { subject: 'CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US', thumbprint: '8E750F459DAF9A79D6370DB747AD2226866AD818' },
      { subject: 'CN=Microsoft Identity Verification Root Certificate Authority 2020, O=Microsoft Corporation, C=US', thumbprint: 'F40042E2E5F7E8EF8189FED15519AECE42C3BFA2' },
    ],
  },
  esigner: {
    publisherSubject: ES_SUBJECT,
    subject: { CN: 'NAYUTA, INC.', O: 'NAYUTA, INC.', L: 'Osaka', ST: 'Ōsaka Prefecture', C: 'JP' },
    issuerAllow: [{ subject: 'CN=SSL.com Root Certification Authority RSA', thumbprint: ES_ROOT }],
  },
};

// ───────────────────────────────────────────────
// [1] 署名者の正本 — AC1 (c)(d)(e)
// ───────────────────────────────────────────────
{
  assert.ok(existsSync(SIGNER_JSON), '[1] scripts/win-sign/signer-identity.json がある');
  const si = loadFresh(SIGNER);
  const identity = JSON.parse(readFileSync(SIGNER_JSON, 'utf8'));

  // parseDn: .NET 形式（引用符・S=）と RFC 4514 形式（\, のエスケープ・ST=）を同じ属性の集合に読む
  const net = si.parseDn(AS_SUBJECT);
  const rfc = si.parseDn('CN=Nayuta\\, Inc.,O=Nayuta\\, Inc.,L=Osaka-shi,ST=Osaka-fu,C=JP');
  assert.deepEqual(net, { CN: 'Nayuta, Inc.', O: 'Nayuta, Inc.', L: 'Osaka-shi', ST: 'Osaka-fu', C: 'JP' }, '[1] parseDn: .NET 形式');
  assert.deepEqual(rfc, net, '[1] parseDn: RFC 4514 形式も同じ集合');
  assert.deepEqual(si.parseDn('E=a@example.com, CN=x'), { EMAIL: 'a@example.com', CN: 'x' }, '[1] parseDn: E を EMAIL に揃える');
  assert.equal(si.parseDn('CN="a ""b"""').CN, 'a "b"', '[1] parseDn: 引用符の中の "" は " 1 つ');
  assert.throws(() => si.parseDn('CN="unterminated'), /DN/, '[1] parseDn: 閉じない引用符は落とす');

  // (d) 照合（fixture の正本）: 各モードの DN＋チェーンはそのモードで通り、他のモードで落ちる
  const check = (subject, chain, mode) => si.checkSigner({ subject, chain }, mode, FIXTURE_IDENTITY);
  assert.equal(check(AS_SUBJECT, AS_CHAIN, 'artifact-signing'), null, '[1](d) Artifact Signing の DN＋チェーンは artifact-signing で通る');
  assert.match(check(AS_SUBJECT, AS_CHAIN, 'esigner') ?? '', /署名者/, '[1](d) Artifact Signing の DN は esigner で落ちる');
  assert.equal(check(ES_SUBJECT, ES_CHAIN, 'esigner'), null, '[1](d) eSigner の DN＋SSL.com のチェーンは esigner で通る');
  assert.match(check(ES_SUBJECT, ES_CHAIN, 'artifact-signing') ?? '', /署名者/, '[1](d) eSigner の DN は artifact-signing で落ちる');
  // 表記の揺れ（RFC 4514・ST=・順序）は通る。属性の過不足は落ちる
  assert.equal(check('C=JP, ST=Osaka-fu, L=Osaka-shi, O=Nayuta\\, Inc., CN=Nayuta\\, Inc.', AS_CHAIN, 'artifact-signing'), null,
    '[1](d) 順序・ST=・エスケープの揺れは通る');
  assert.match(check(`${AS_SUBJECT}, OU=Extra`, AS_CHAIN, 'artifact-signing') ?? '', /署名者/, '[1](d) 属性が多いと落ちる');
  assert.match(check('CN="Nayuta, Inc.", O="Nayuta, Inc.", C=JP', AS_CHAIN, 'artifact-signing') ?? '', /署名者/, '[1](d) 属性が少ないと落ちる');
  assert.match(check('CN="Nayuta, Inc. X", O="Nayuta, Inc.", L=Osaka-shi, S=Osaka-fu, C=JP', AS_CHAIN, 'artifact-signing') ?? '', /署名者/,
    '[1](d) 値の前方一致は落ちる');
  assert.match(si.checkSigner({ subject: null, chain: AS_CHAIN }, 'artifact-signing', FIXTURE_IDENTITY) ?? '', /署名者/, '[1](d) 署名者なしは落ちる');
  assert.match(si.checkSigner({ subject: AS_SUBJECT, chain: AS_CHAIN }, 'unknown-mode', FIXTURE_IDENTITY) ?? '', /unknown-mode/, '[1](d) 未知のモードは落ちる');

  // (e) 上位（index ≥ 2）の thumbprint: 集合外は落ち、集合内なら直接の発行者（index 1）が別の値でも通る
  const otherEoc = AS_CHAIN.map((c, i) => (i === 1 ? { subject: 'CN=Microsoft ID Verified CS EOC CA 01, O=Microsoft Corporation, C=US', thumbprint: 'DEADBEEF00000000000000000000000000000000' } : c));
  assert.equal(check(AS_SUBJECT, otherEoc, 'artifact-signing'), null, '[1](e) 直接の発行者（EOC CA）が替わっても通る');
  const foreignRoot = AS_CHAIN.map((c, i) => (i >= 2 ? { ...c, thumbprint: '0000000000000000000000000000000000000000' } : c));
  assert.match(check(AS_SUBJECT, foreignRoot, 'artifact-signing') ?? '', /上位/, '[1](e) 上位が集合外なら落ちる');
  // index 1 にだけ許可の thumbprint があっても通さない（index ≥ 2 だけを見る）
  const allowAtOne = [AS_CHAIN[0], AS_CHAIN[2]];
  assert.match(check(AS_SUBJECT, allowAtOne, 'artifact-signing') ?? '', /上位/, '[1](e) 許可の thumbprint が index 1 にしか無ければ落ちる');
  assert.match(check(AS_SUBJECT, [], 'artifact-signing') ?? '', /上位/, '[1](e) チェーンが無ければ落ちる');
  // 許可リストが空のモードは必ず落ちる（未測定の値で通さない）
  const emptyAllow = { esigner: { ...FIXTURE_IDENTITY.esigner, issuerAllow: [] } };
  assert.match(si.checkSigner({ subject: ES_SUBJECT, chain: ES_CHAIN }, 'esigner', emptyAllow) ?? '', /issuerAllow/, '[1](e) issuerAllow が空なら落ちる');

  // (d) 正本の 2 つの形が食い違わない: publisherSubject（electron-updater 用の生の文字列）を parseDn で読むと subject と一致
  for (const mode of ['artifact-signing', 'esigner']) {
    const id = identity[mode];
    assert.ok(id, `[1](d) 正本に ${mode} がある`);
    assert.equal(typeof id.publisherSubject, 'string', `[1](d) ${mode}.publisherSubject は文字列`);
    assert.ok(id.publisherSubject.length > 0, `[1](d) ${mode}.publisherSubject が空でない`);
    assert.deepEqual(si.parseDn(id.publisherSubject), si.normalizeSubject(id.subject),
      `[1](d) ${mode}: publisherSubject を parseDn で読むと subject と属性の集合として一致`);
    assert.ok(Array.isArray(id.issuerAllow), `[1](d) ${mode}.issuerAllow は配列`);
    for (const a of id.issuerAllow) assert.match(a.thumbprint, /^[0-9A-F]{40}$/, `[1](d) ${mode}.issuerAllow の thumbprint は 40 桁の大文字 hex`);
  }
  // 値の実在（H-B1 の実測）: Artifact Signing は H-B1 の chain の index ≥ 2 の全段・葉の Subject が実物と同じ
  const as = identity['artifact-signing'];
  assert.equal(as.publisherSubject, AS_SUBJECT, '[1] artifact-signing.publisherSubject は H-B1 の SignerCertificate.Subject そのもの');
  assert.deepEqual(as.issuerAllow.map((a) => a.thumbprint).sort(), [AS_CHAIN[2].thumbprint, AS_CHAIN[3].thumbprint].sort(),
    '[1] artifact-signing.issuerAllow は H-B1 の chain の index ≥ 2（PCA とルート）');
  assert.equal(si.checkSigner({ subject: AS_SUBJECT, chain: AS_CHAIN }, 'artifact-signing'), null, '[1] 正本で H-B1 の実物が通る');
  // eSigner は未測定なら issuerAllow が空で、照合は必ず落ちる（fail-closed）。測定済みなら空でない
  if (identity.esigner.issuerAllow.length === 0) {
    assert.match(si.checkSigner({ subject: identity.esigner.publisherSubject, chain: ES_CHAIN }, 'esigner') ?? '', /issuerAllow/,
      '[1] esigner の上位が未測定のあいだは、eSigner の照合は必ず落ちる');
  }

  // (c) 署名者の文字列・WIN_SIGN_EXPECTED_CN は正本と smoke の fixture にしか無い
  const r = spawnSync('git', ['grep', '-n', '--untracked', 'NAYUTA, INC\\|WIN_SIGN_EXPECTED_CN', '--', 'scripts', 'electron-builder.config.cjs'],
    { cwd: projectRoot, encoding: 'utf8' });
  const files = [...new Set(r.stdout.split('\n').filter(Boolean).map((l) => l.split(':')[0]))].sort();
  const allowed = ['scripts/win-sign/signer-identity.json', 'scripts/sac-win-sign-smoke.mjs', 'scripts/nov26-m7-t2-signing-pipeline-smoke.mjs'];
  for (const f of files) assert.ok(allowed.includes(f), `[1](c) 署名者の文字列が正本・smoke の fixture 以外にある: ${f}`);
  console.log('  [1/6] 署名者の正本（parseDn・checkSigner・2 つの形の整合）: PASS');
}

// ───────────────────────────────────────────────
// 合成 PE（scripts/sac-win-sign-smoke.mjs と同じ形・TimeDateStamp を指定できる）
// ───────────────────────────────────────────────
function makePe({ body = 'hello', magic = 0x20b, timeDateStamp = 0 } = {}) {
  const peOff = 0x80;
  const opt = peOff + 24;
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const size = dirs + 16 * 8 + 64;
  const buf = Buffer.alloc(size);
  buf.write('MZ', 0, 'latin1');
  buf.writeUInt32LE(peOff, 0x3c);
  buf.writeUInt32LE(0x00004550, peOff);
  buf.writeUInt32LE(timeDateStamp, peOff + 8);
  buf.writeUInt16LE(magic, opt);
  buf.writeUInt32LE(16, opt + (magic === 0x20b ? 108 : 92));
  buf.writeUInt32LE(0x1234, opt + 64); // CheckSum
  return Buffer.concat([buf, Buffer.from(`${body}X`, 'latin1')]);
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
const VALID_AS = () => ({ status: 'Valid', subject: AS_SUBJECT, chain: AS_CHAIN });
const work = mkdtempSync(path.join(tmpdir(), 'nov26-m7-t2-'));
const resetEnv = () => {
  for (const k of ['WIN_SIGN_MODE', 'WIN_SIGN_WORK_DIR', 'WIN_SIGN_RECORD_FILE', 'WIN_SIGN_COLLECT_DIR', 'WIN_SIGN_SIGNED_DIR',
    'WIN_SIGN_CACHE_URL', 'WIN_SIGN_CACHE_DIR', 'WIN_SIGN_CACHE_SIMULATE_DIR', 'ELECTRON_BUILDER_NSIS_DIR', 'ELECTRON_BUILDER_NSIS_RESOURCES_DIR']) {
    delete process.env[k];
  }
};
const readRecord = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const OLD = new Date('2020-01-02T03:04:05Z');

// ───────────────────────────────────────────────
// [2] win-sign.cjs の collect・差し替え・fail-closed — AC1 (f)(o)(p)
// ───────────────────────────────────────────────
{
  // (f) collect はキャッシュを引かない（WIN_SIGN_CACHE_URL・CACHE_DIR・SIMULATE_DIR があっても見ない）
  {
    resetEnv();
    const d = path.join(work, 'f');
    mkdirSync(d, { recursive: true });
    const dll = path.join(d, 'ffmpeg.dll');
    const u = makePe({ body: 'ffmpeg' });
    writeFileSync(dll, u);
    const key = sha256(u);
    mkdirSync(path.join(d, 'cache'), { recursive: true });
    writeFileSync(path.join(d, 'cache', `${key}--ffmpeg.dll.signed`), fakeSign(u));
    mkdirSync(path.join(d, 'sim'), { recursive: true });
    writeFileSync(path.join(d, 'sim', `${key}--ffmpeg.dll.signed`), '');
    Object.assign(process.env, {
      WIN_SIGN_MODE: 'collect', WIN_SIGN_WORK_DIR: path.join(d, 'ws'), WIN_SIGN_RECORD_FILE: path.join(d, 'rec.jsonl'),
      WIN_SIGN_COLLECT_DIR: path.join(d, 'collect'), WIN_SIGN_CACHE_URL: 'https://example.invalid/cache',
      WIN_SIGN_CACHE_DIR: path.join(d, 'cache'), WIN_SIGN_CACHE_SIMULATE_DIR: path.join(d, 'sim'),
    });
    const ws = loadFresh(WIN_SIGN);
    const realFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; throw new Error('collect がキャッシュを引いた'); };
    try {
      assert.equal(await ws.signFile(dll), 'would-sign', '[2](f) collect: キャッシュに当たらず would-sign');
      assert.equal(await ws.signFile(dll), 'would-sign', '[2](f) collect: 同じ中身の 2 回目も session のキャッシュを使わない');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(fetches, 0, '[2](f) collect: WIN_SIGN_CACHE_URL を引かない（呼び出し 0）');
    const rec = readRecord(process.env.WIN_SIGN_RECORD_FILE);
    assert.ok(rec.every((e) => e.decision === 'would-sign' && e.mode === 'collect'), '[2](f) 記録は would-sign・mode collect');
    assert.equal(rec[0].collected, `${key}.pe`, '[2] 記録に collected: <SHA-256>.pe');
    assert.deepEqual(readFileSync(path.join(d, 'collect', `${key}.pe`)), u, '[2] collect: 署名前の中身を <SHA-256>.pe で複写する');
    assert.deepEqual(readFileSync(dll), u, '[2] collect: 成果物を変えない');
  }

  // (o) 同じ実行の署名済みでの差し替え（NSIS プラグイン 7 つ・Windows の偽物の下）
  const prepareFixture = (name, { skip = [] } = {}) => {
    resetEnv();
    const d = path.join(work, name);
    const nsisSrc = path.join(d, 'toolset', 'nsis');
    const pluginsSrc = path.join(d, 'toolset', 'nsis-resources', 'plugins');
    mkdirSync(nsisSrc, { recursive: true });
    writeFileSync(path.join(nsisSrc, 'elevate.exe'), makePe({ body: 'elevate' }));
    mkdirSync(path.join(pluginsSrc, 'x86-unicode'), { recursive: true });
    mkdirSync(path.join(d, 'signed'), { recursive: true });
    const ws0 = loadFresh(WIN_SIGN);
    const originals = {};
    for (const n of ws0.NSIS_PLUGINS_TO_SIGN) {
      const p = path.join(pluginsSrc, 'x86-unicode', n);
      const u = makePe({ body: `plugin-${n}` });
      writeFileSync(p, u);
      utimesSync(p, OLD, OLD);
      originals[n] = u;
      if (!skip.includes(n)) writeFileSync(path.join(d, 'signed', `${sha256(u)}--${n}.signed`), fakeSign(u));
    }
    Object.assign(process.env, {
      WIN_SIGN_MODE: 'collect', WIN_SIGN_WORK_DIR: path.join(d, 'ws'), WIN_SIGN_RECORD_FILE: path.join(d, 'rec.jsonl'),
      WIN_SIGN_COLLECT_DIR: path.join(d, 'collect'), WIN_SIGN_SIGNED_DIR: path.join(d, 'signed'),
    });
    return { d, nsisSrc, pluginsSrc, originals };
  };
  {
    const fx = prepareFixture('o-all');
    const ws = loadFresh(WIN_SIGN);
    let authCalls = 0;
    ws.__setDepsForTest({
      platform: 'win32',
      authenticode: () => { authCalls++; return VALID_AS(); },
      toolsetSources: { nsisSrc: fx.nsisSrc, pluginsSrc: fx.pluginsSrc },
    });
    const r = await ws.prepareSignedNsisToolset({ config: {} });
    ws.__setDepsForTest(null);
    assert.equal(r.plugins.length, ws.NSIS_PLUGINS_TO_SIGN.length, '[2](o) プラグインは 7 つ');
    assert.ok(r.plugins.every((p) => p.decision === 'signed-substituted'), `[2](o) 7 つ全部が signed-substituted: ${JSON.stringify(r.plugins)}`);
    assert.ok(authCalls >= ws.NSIS_PLUGINS_TO_SIGN.length, '[2](o) 差し替えは Authenticode を確かめてから');
    for (const n of ws.NSIS_PLUGINS_TO_SIGN) {
      const p = path.join(r.resourcesDir, 'plugins', 'x86-unicode', n);
      assert.deepEqual(readFileSync(p), fakeSign(fx.originals[n]), `[2](o) ツールセットの中の ${n} が署名済みのバイト列`);
      assert.equal(statSync(p).mtime.getTime(), OLD.getTime(), `[2](o) ${n} の mtime が元のファイルと同じ`);
    }
    const marker = JSON.parse(readFileSync(path.join(r.root, ws.PREPARED_MARKER), 'utf8'));
    assert.equal(marker.mode, 'collect', '[2](o) 印（.win-sign-prepared.json）の mode');
    assert.equal(marker.resourcesDir, r.resourcesDir, '[2](o) 印の resourcesDir');
    assert.equal(process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR, r.resourcesDir, '[2](o) ELECTRON_BUILDER_NSIS_RESOURCES_DIR を設定する');
    const rec = readRecord(process.env.WIN_SIGN_RECORD_FILE);
    assert.equal(rec.filter((e) => e.kind === 'nsis-plugin' && e.decision === 'signed-substituted').length, 7, '[2](o) 記録に nsis-plugin の signed-substituted が 7 件');
  }
  {
    // 署名済みの複写を 1 つ欠くと、その 1 つが would-sign になる（後段の collect-sign-set が赤にする。[3]）
    const fx = prepareFixture('o-missing', { skip: ['nsExec.dll'] });
    const ws = loadFresh(WIN_SIGN);
    ws.__setDepsForTest({ platform: 'win32', authenticode: VALID_AS, toolsetSources: { nsisSrc: fx.nsisSrc, pluginsSrc: fx.pluginsSrc } });
    const r = await ws.prepareSignedNsisToolset({ config: {} });
    ws.__setDepsForTest(null);
    const by = Object.fromEntries(r.plugins.map((p) => [p.name, p.decision]));
    assert.equal(by['nsExec.dll'], 'would-sign', '[2](o) 署名済みを欠いたプラグインは would-sign');
    assert.equal(Object.values(by).filter((x) => x === 'signed-substituted').length, 6, '[2](o) 残り 6 つは差し替え');
  }
  {
    // Windows でないとき・Authenticode が Valid でないとき・署名者が違うときは差し替えない
    for (const [what, depsOverride, re] of [
      ['Windows でない', { platform: 'darwin' }, /Windows でしか/],
      ['Valid でない', { platform: 'win32', authenticode: () => ({ ...VALID_AS(), status: 'HashMismatch' }) }, /Valid でない/],
      ['署名者が eSigner', { platform: 'win32', authenticode: () => ({ status: 'Valid', subject: ES_SUBJECT, chain: ES_CHAIN }) }, /署名者/],
    ]) {
      const fx = prepareFixture(`o-no-${what.length}-${Math.random().toString(16).slice(2, 8)}`);
      const ws = loadFresh(WIN_SIGN);
      ws.__setDepsForTest({ ...depsOverride, toolsetSources: { nsisSrc: fx.nsisSrc, pluginsSrc: fx.pluginsSrc } });
      const r = await ws.prepareSignedNsisToolset({ config: {} });
      ws.__setDepsForTest(null);
      assert.ok(r.plugins.every((p) => p.decision === 'would-sign'), `[2](o) ${what}: 差し替えない`);
      const rec = readRecord(process.env.WIN_SIGN_RECORD_FILE);
      assert.match(rec[0].detail ?? '', re, `[2](o) ${what}: 差し替えなかった理由を記録する`);
    }
  }
  {
    // アンインストーラー: 作り直すと TimeDateStamp だけが違う（SHA-256 が違う）→ 名前の候補を関門にかけて差し替える。
    // 中身が違えば差し替えない
    resetEnv();
    const d = path.join(work, 'uninst');
    mkdirSync(path.join(d, 'signed'), { recursive: true });
    const NAME = 'MaplatEditor-Windows-1.2.0-x64-Setup.__uninstaller.exe';
    const first = makePe({ body: 'uninstaller', timeDateStamp: 1111 });
    writeFileSync(path.join(d, 'signed', `${sha256(first)}--${NAME}.signed`), fakeSign(first));
    // 印のある NSIS ツールセット（fail-closed の確かめを通すため）
    mkdirSync(path.join(d, 'nsis-collect', 'nsis-resources'), { recursive: true });
    writeFileSync(path.join(d, 'nsis-collect', '.win-sign-prepared.json'), JSON.stringify({ mode: 'collect' }));
    Object.assign(process.env, {
      WIN_SIGN_MODE: 'collect', WIN_SIGN_WORK_DIR: path.join(d, 'ws'), WIN_SIGN_RECORD_FILE: path.join(d, 'rec.jsonl'),
      WIN_SIGN_COLLECT_DIR: path.join(d, 'collect'), WIN_SIGN_SIGNED_DIR: path.join(d, 'signed'),
      ELECTRON_BUILDER_NSIS_RESOURCES_DIR: path.join(d, 'nsis-collect', 'nsis-resources'),
    });
    const ws = loadFresh(WIN_SIGN);
    ws.__setDepsForTest({ platform: 'win32', authenticode: VALID_AS });
    const second = makePe({ body: 'uninstaller', timeDateStamp: 2222 });
    assert.notEqual(sha256(second), sha256(first), '[2] 前提: TimeDateStamp が違えば SHA-256 が違う');
    assert.equal(ws.comparableDigest(fakeSign(first)), ws.comparableDigest(second), '[2] comparableDigest は署名と TimeDateStamp を除いて一致');
    assert.notEqual(ws.strippedDigest(fakeSign(first)), ws.strippedDigest(second), '[2] strippedDigest は TimeDateStamp を除かない');
    const p2 = path.join(d, NAME);
    writeFileSync(p2, second);
    await ws.sign({ path: p2 });
    assert.deepEqual(readFileSync(p2), fakeSign(first), '[2] TimeDateStamp だけ違うアンインストーラーは署名済みに差し替える');
    const other = path.join(d, 'other', NAME);
    mkdirSync(path.dirname(other), { recursive: true });
    writeFileSync(other, makePe({ body: 'uninstallEr', timeDateStamp: 1111 }));
    await ws.sign({ path: other });
    ws.__setDepsForTest(null);
    const rec = readRecord(process.env.WIN_SIGN_RECORD_FILE);
    assert.deepEqual(rec.map((e) => e.decision), ['signed-substituted', 'would-sign'], '[2] 中身が違うアンインストーラーは差し替えない');
    assert.match(rec[1].detail ?? '', /一致しない/, '[2] 差し替えなかった理由');
  }

  // (p) fail-closed: collect で印の無い（mode の違う）ELECTRON_BUILDER_NSIS_RESOURCES_DIR の下で NSIS の出力を署名しようとすると落ちる
  {
    resetEnv();
    const d = path.join(work, 'p');
    const res = path.join(d, 'nsis-collect', 'nsis-resources');
    mkdirSync(res, { recursive: true });
    const uninst = path.join(d, 'MaplatEditor-Windows-1.2.0-x64-Setup.__uninstaller.exe');
    const setup = path.join(d, 'MaplatEditor-Windows-1.2.0-x64-Setup.exe');
    const app = path.join(d, 'MaplatEditor.exe');
    for (const f of [uninst, setup, app]) writeFileSync(f, makePe({ body: path.basename(f) }));
    Object.assign(process.env, {
      WIN_SIGN_MODE: 'collect', WIN_SIGN_WORK_DIR: path.join(d, 'ws'), WIN_SIGN_RECORD_FILE: path.join(d, 'rec.jsonl'),
      WIN_SIGN_COLLECT_DIR: path.join(d, 'collect'),
    });
    const ws = loadFresh(WIN_SIGN);
    ws.__setDepsForTest({ platform: 'darwin' });
    await assert.rejects(() => ws.sign({ path: uninst }), /NSIS ツールセットが用意されていない/, '[2](p) 環境変数が無ければ落ちる');
    process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR = res;
    await assert.rejects(() => ws.sign({ path: uninst }), /祖先に/, '[2](p) 印が無ければ落ちる（アンインストーラー）');
    await assert.rejects(() => ws.sign({ path: setup }), /祖先に/, '[2](p) 印が無ければ落ちる（インストーラー）');
    assert.equal(existsSync(path.join(d, 'collect')), false, '[2](p) 落ちたとき収集しない');
    writeFileSync(path.join(d, 'nsis-collect', '.win-sign-prepared.json'), JSON.stringify({ mode: 'record' }));
    await assert.rejects(() => ws.sign({ path: uninst }), /モード/, '[2](p) 印の mode が違えば落ちる');
    writeFileSync(path.join(d, 'nsis-collect', '.win-sign-prepared.json'), JSON.stringify({ mode: 'collect' }));
    await ws.sign({ path: uninst });
    await ws.sign({ path: setup });
    // NSIS の出力でないファイルは確かめない（印が無くても落ちない）
    delete process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR;
    await ws.sign({ path: app });
    // collect 以外のモードでは確かめない（record・esigner は beforePack が用意する従来の経路）
    process.env.WIN_SIGN_MODE = 'record';
    await ws.sign({ path: uninst });
    ws.__setDepsForTest(null);
    const rec = readRecord(process.env.WIN_SIGN_RECORD_FILE);
    assert.deepEqual(rec.map((e) => e.decision), ['would-sign', 'would-sign', 'would-sign', 'would-sign'], '[2](p) 印があれば収集する');
  }
  resetEnv();
  console.log('  [2/6] win-sign.cjs の collect・差し替え・fail-closed: PASS');
}

// ───────────────────────────────────────────────
// [3] collect-sign-set.mjs・apply-signed.mjs — phase の順の規則（MIN-1）と照合
// ───────────────────────────────────────────────
{
  const { collectSignSet, phaseOf } = await import('./win-sign/collect-sign-set.mjs');
  const { applySigned } = await import('./win-sign/apply-signed.mjs');
  const ws = loadFresh(WIN_SIGN);
  const d = path.join(work, 'phase');
  const rel = path.join(d, 'release', '1.2.0');
  const files = {
    plugin: [path.join(d, 'ws', 'nsis-collect', 'nsis-resources', 'plugins', 'x86-unicode', 'nsExec.dll'), makePe({ body: 'nsExec' })],
    appX: [path.join(rel, 'win-unpacked', 'MaplatEditor.exe'), makePe({ body: 'app-x64' })],
    appA: [path.join(rel, 'win-arm64-unpacked', 'MaplatEditor.exe'), makePe({ body: 'app-arm64' })],
    dllX: [path.join(rel, 'win-unpacked', 'ffmpeg.dll'), makePe({ body: 'ffmpeg' })],
    dllA: [path.join(rel, 'win-arm64-unpacked', 'ffmpeg.dll'), makePe({ body: 'ffmpeg' })], // x64 と同じ中身
    elevate: [path.join(d, 'tmp', 'elevate-staging-1', 'resources', 'elevate.exe'), makePe({ body: 'elevate' })],
    uninst: [path.join(rel, 'MaplatEditor-Windows-1.2.0-x64-Setup.__uninstaller.exe'), makePe({ body: 'uninst' })],
    setup: [path.join(rel, 'MaplatEditor-Windows-1.2.0-x64-Setup.exe'), makePe({ body: 'setup' })],
  };
  const collectDir = path.join(d, 'collect');
  mkdirSync(collectDir, { recursive: true });
  for (const [f, b] of Object.values(files)) {
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, b);
    utimesSync(f, OLD, OLD);
    writeFileSync(path.join(collectDir, `${sha256(b)}.pe`), b);
  }
  // elevate.exe は stage 1 の後で win-unpacked にも複写される（フックを通らない）。同じ中身
  mkdirSync(path.join(rel, 'win-unpacked', 'resources'), { recursive: true });
  writeFileSync(path.join(rel, 'win-unpacked', 'resources', 'elevate.exe'), files.elevate[1]);
  const entry = (k, decision, extra = {}) => {
    const [f, b] = files[k];
    return { file: f, name: path.basename(f), kind: k === 'plugin' ? 'nsis-plugin' : 'electron-builder', sha256: sha256(b), decision,
      ...(decision === 'would-sign' ? { collected: `${sha256(b)}.pe` } : {}), ...extra };
  };
  const writeRec = (name, entries) => {
    const p = path.join(d, name);
    writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return p;
  };
  assert.equal(phaseOf(entry('plugin', 'would-sign')), 'payload', '[3] NSIS プラグインは payload');
  assert.equal(phaseOf(entry('appX', 'would-sign')), 'payload', '[3] *-unpacked の中は payload');
  assert.equal(phaseOf(entry('elevate', 'would-sign')), 'payload', '[3] elevate.exe（NSIS の組み立てで一時ディレクトリから署名される）は payload');
  assert.equal(phaseOf(entry('uninst', 'would-sign')), 'uninstaller', '[3] …__uninstaller.exe はアンインストーラー');
  assert.equal(phaseOf(entry('setup', 'would-sign')), 'installer', '[3] …-Setup.exe はインストーラー（__uninstaller.exe は入らない）');
  assert.equal(phaseOf({ file: path.join(d, 'stray', 'foo.exe'), name: 'foo.exe' }), null, '[3] どの phase にも属さないもの');

  const stage1 = writeRec('rec-stage1.jsonl', ['plugin', 'appX', 'appA', 'dllX', 'dllA', 'elevate', 'uninst', 'setup']
    .map((k) => entry(k, 'would-sign')).concat([{ ...entry('dllX', 'skip-already-signed'), name: 'd3dcompiler_47.dll' }]));
  const run = (phase, record, name) => collectSignSet({
    phase, record, collectDir, out: path.join(d, `out-${name}`), manifest: path.join(d, `manifest-${name}.json`), cwd: d,
  });
  const p1 = run('payload', stage1, 'payload');
  assert.deepEqual(p1.errors, [], '[3] build-win（payload）: 後の phase の would-sign は正常');
  assert.equal(p1.later, 2, '[3] build-win（payload）: 後の phase の数（アンインストーラーとインストーラー）');
  assert.equal(p1.selected.length, 5, '[3] payload: SHA-256 で重ねて 5 本（x64/arm64 の同じ DLL は 1 本）');
  const outNames = readdirSync(path.join(d, 'out-payload')).sort();
  assert.ok(outNames.every((n) => /^[0-9a-f]{64}\.pe$/.test(n)), '[3] 署名の入力は <SHA-256>.pe だけ');
  const manifest = JSON.parse(readFileSync(path.join(d, 'manifest-payload.json'), 'utf8'));
  const ff = manifest.find((m) => m.name === 'ffmpeg.dll');
  assert.deepEqual(ff.paths.sort(), ['release/1.2.0/win-arm64-unpacked/ffmpeg.dll', 'release/1.2.0/win-unpacked/ffmpeg.dll'],
    '[3] manifest の paths は作業ディレクトリからの相対パス（/ 区切り）');
  assert.equal(ff.comparable, ws.comparableDigest(files.dllX[1]), '[3] manifest に署名前の comparableDigest');

  // pack-win-1（uninstaller）: プラグインの would-sign が残る＝差し替えられていない（MAJ-1 の再発）→ 赤
  const pack1Bad = writeRec('rec-pack1-bad.jsonl', [entry('plugin', 'would-sign'), entry('uninst', 'would-sign'), entry('setup', 'would-sign')]);
  const e1 = run('uninstaller', pack1Bad, 'p1bad').errors;
  assert.ok(e1.some((x) => /前の phase/.test(x) && /nsExec\.dll/.test(x)), `[3] uninstaller でプラグインの would-sign が残れば赤: ${e1}`);
  const pack1 = writeRec('rec-pack1.jsonl', [entry('plugin', 'signed-substituted'), entry('elevate', 'signed-substituted'),
    entry('uninst', 'would-sign'), entry('setup', 'would-sign')]);
  const r1 = run('uninstaller', pack1, 'p1');
  assert.deepEqual(r1.errors, [], '[3] pack-win-1: 差し替え済みのプラグインとアンインストーラー・インストーラーは正常');
  assert.deepEqual(r1.selected.map((s) => s.name), [path.basename(files.uninst[0])], '[3] pack-win-1: アンインストーラーだけを並べる');
  assert.equal(r1.later, 1, '[3] pack-win-1: インストーラーは後の phase');
  // pack-win-2（installer）: アンインストーラーの would-sign が残る＝U-1 不成立 → 赤
  const pack2Bad = writeRec('rec-pack2-bad.jsonl', [entry('uninst', 'would-sign'), entry('setup', 'would-sign')]);
  assert.ok(run('installer', pack2Bad, 'p2bad').errors.some((x) => /前の phase/.test(x) && /__uninstaller/.test(x)),
    '[3] installer でアンインストーラーの would-sign が残れば赤（U-1 不成立の検出）');
  // どの phase にも属さない would-sign・並べるものが 0 本・収集した複写が無い → 赤
  const stray = writeRec('rec-stray.jsonl', [{ file: path.join(d, 'stray', 'foo.exe'), name: 'foo.exe', sha256: 'f'.repeat(64), decision: 'would-sign' }, entry('setup', 'would-sign')]);
  assert.ok(run('installer', stray, 'stray').errors.some((x) => /どの phase/.test(x)), '[3] どの phase にも属さない would-sign は赤');
  const none = writeRec('rec-none.jsonl', [entry('setup', 'signed-substituted')]);
  assert.ok(run('installer', none, 'none').errors.some((x) => /0 本/.test(x)), '[3] 並べるものが 0 本なら赤');
  assert.throws(() => collectSignSet({ phase: 'bogus', record: none, collectDir, out: path.join(d, 'x'), manifest: path.join(d, 'x.json'), cwd: d }),
    /phase/, '[3] 未知の phase は落とす');

  // apply-signed: 署名済みの .pe を照合してから書き戻す
  const signedIn = path.join(d, 'signed-payload');
  mkdirSync(signedIn, { recursive: true });
  for (const m of manifest) {
    const orig = Object.values(files).find(([, b]) => sha256(b) === m.sha256)[1];
    writeFileSync(path.join(signedIn, `${m.sha256}.pe`), fakeSign(orig));
  }
  const signedDirOut = path.join(d, 'signed');
  const apply = (over = {}) => applySigned({
    phase: 'payload', manifest: path.join(d, 'manifest-payload.json'), signed: signedIn, signer: 'artifact-signing',
    releaseDir: rel, signedDir: signedDirOut, cwd: d, deps: { platform: 'win32', authenticode: VALID_AS }, ...over,
  });
  assert.ok(apply({ deps: { platform: 'darwin' } }).errors.some((x) => /Windows/.test(x)), '[3] apply: Windows でなければ赤（署名者を確かめられない）');
  assert.ok(apply({ deps: { platform: 'win32', authenticode: () => ({ status: 'Valid', subject: ES_SUBJECT, chain: ES_CHAIN }) } })
    .errors.some((x) => /署名者/.test(x)), '[3] apply: 署名者が artifact-signing でなければ赤');
  assert.deepEqual(readFileSync(files.appX[0]), files.appX[1], '[3] apply: 赤のときは書き戻さない');
  const res = apply();
  assert.deepEqual(res.errors, [], `[3] apply: 照合が通れば書き戻す: ${res.errors}`);
  for (const k of ['appX', 'appA', 'dllX', 'dllA']) {
    assert.deepEqual(readFileSync(files[k][0]), fakeSign(files[k][1]), `[3] apply: ${k} を署名済みに書き戻す`);
    assert.equal(statSync(files[k][0]).mtime.getTime(), OLD.getTime(), `[3] apply: ${k} の mtime を保つ`);
  }
  assert.deepEqual(readFileSync(path.join(rel, 'win-unpacked', 'resources', 'elevate.exe')), fakeSign(files.elevate[1]),
    '[3] apply: unpacked の中で SHA-256 が一致するファイル（記録に無い elevate.exe の複写）も書き戻す');
  for (const k of ['plugin', 'elevate', 'dllX']) {
    const [f, b] = files[k];
    assert.deepEqual(readFileSync(path.join(signedDirOut, ws.assetName(sha256(b), f))), fakeSign(b),
      `[3] apply: ${k} を WIN_SIGN_SIGNED_DIR に <sha>--<名前>.signed で置く`);
  }
  // 中身の違う署名済み（取り違え・改ざん）は赤
  writeFileSync(path.join(signedIn, `${sha256(files.appX[1])}.pe`), fakeSign(makePe({ body: 'evil' })));
  assert.ok(apply().errors.some((x) => /一致しない/.test(x)), '[3] apply: 中身の違う署名済みは赤');
  writeFileSync(path.join(signedIn, `${sha256(files.appX[1])}.pe`), files.appX[1]);
  assert.ok(apply().errors.some((x) => /証明書表/.test(x)), '[3] apply: 署名されていない .pe は赤');
  // installer: release-dir/<名前> へ置く
  const instSigned = path.join(d, 'signed-installer');
  mkdirSync(instSigned, { recursive: true });
  writeFileSync(path.join(instSigned, `${sha256(files.setup[1])}.pe`), fakeSign(files.setup[1]));
  writeFileSync(path.join(d, 'manifest-installer.json'), JSON.stringify([{ sha256: sha256(files.setup[1]), name: path.basename(files.setup[0]),
    kind: 'electron-builder', comparable: ws.comparableDigest(files.setup[1]), paths: [] }]));
  const finalRel = path.join(d, 'final', '1.2.0');
  const ri = apply({ phase: 'installer', manifest: path.join(d, 'manifest-installer.json'), signed: instSigned, releaseDir: finalRel, signedDir: null });
  assert.deepEqual(ri.errors, [], `[3] apply installer: ${ri.errors}`);
  assert.deepEqual(readFileSync(path.join(finalRel, path.basename(files.setup[0]))), fakeSign(files.setup[1]), '[3] apply installer: release/<版>/<名前> に置く');
  // verify-win-install.mjs の判定（PE の列挙は中身で・署名者は artifact-signing か Microsoft）
  const { listPes, judgeSigners } = await import('./win-sign/verify-win-install.mjs');
  const inst = path.join(d, 'installed');
  mkdirSync(path.join(inst, 'resources'), { recursive: true });
  writeFileSync(path.join(inst, 'MaplatEditor.exe'), makePe({ body: 'a' }));
  writeFileSync(path.join(inst, 'resources', 'app.node'), makePe({ body: 'n' })); // 拡張子でなく中身で数える
  writeFileSync(path.join(inst, 'resources', 'app.asar'), Buffer.from('not a pe'));
  assert.deepEqual(listPes(inst).map((f) => path.relative(inst, f)).sort(), ['MaplatEditor.exe', path.join('resources', 'app.node')],
    '[3] verify-win-install: PE は中身で数える');
  const judged = judgeSigners(new Map([
    ['ok', VALID_AS()],
    ['ms', { status: 'Valid', subject: 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US', chain: [] }],
    ['es', { status: 'Valid', subject: ES_SUBJECT, chain: ES_CHAIN }],
    ['bad', { ...VALID_AS(), status: 'NotSigned' }],
  ]), 'artifact-signing');
  assert.deepEqual(judged.map((r) => [r.file, r.ok]), [['ok', true], ['ms', true], ['es', false], ['bad', false]],
    '[3] verify-win-install: artifact-signing か Microsoft だけを通す');
  // prepare-nsis-toolset.mjs: collect 以外では何もしない（$GITHUB_ENV に書かない）
  for (const m of ['off', 'record', 'esigner']) {
    const envFile = path.join(d, `github-env-${m}`);
    writeFileSync(envFile, '');
    const r = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/win-sign/prepare-nsis-toolset.mjs')],
      { env: { ...process.env, WIN_SIGN_MODE: m, GITHUB_ENV: envFile }, encoding: 'utf8' });
    assert.equal(r.status, 0, `[3] prepare-nsis-toolset: ${m} は exit 0`);
    assert.equal(readFileSync(envFile, 'utf8'), '', `[3] prepare-nsis-toolset: ${m} は $GITHUB_ENV に書かない`);
  }
  console.log('  [3/6] collect-sign-set・apply-signed・verify-win-install・prepare-nsis-toolset: PASS');
}
