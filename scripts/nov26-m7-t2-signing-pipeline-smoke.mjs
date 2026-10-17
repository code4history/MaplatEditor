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
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
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
// eSigner の実物（nov26-m7-t2 U-1・run 38369214775 の artifact u1-esigner-identity/esigner-identity.json の chain）
const ES_REAL_CHAIN = [
  { subject: 'CN="NAYUTA, INC.", O="NAYUTA, INC.", L=Osaka, S=Ōsaka Prefecture, C=JP', thumbprint: '7625D11EF2D21CB8133CF1E60A2DBEC2B33938B6' },
  { subject: 'CN=SSL.com Code Signing Intermediate CA RSA R1, O=SSL Corp, L=Houston, S=Texas, C=US', thumbprint: 'BC1E0FF366EEAD57F872622A0A5903706B7420F4' },
  { subject: 'CN=SSL.com Root Certification Authority RSA, O=SSL Corporation, L=Houston, S=Texas, C=US', thumbprint: 'B7AB3308D1EA4477BA1480125A6FBDA936490CBB' },
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
  // 値の実在（U-1 の実測・B31 MAJ-2）: eSigner は run 38369214775 の measure-esigner-identity（v1.1.0 の x64 Setup.exe）の
  // 葉の Subject と chain の index 2（SSL.com Root）。index 1（Intermediate）は §3.5 の規則で issuerAllow に入れない
  const es = identity.esigner;
  assert.equal(es.publisherSubject, ES_REAL_CHAIN[0].subject, '[1] esigner.publisherSubject は U-1 の SignerCertificate.Subject そのもの');
  assert.deepEqual(es.issuerAllow.map((a) => a.thumbprint), [ES_REAL_CHAIN[2].thumbprint],
    '[1] esigner.issuerAllow は U-1 の chain の index 2（SSL.com Root Certification Authority RSA）だけ');
  assert.match(es.source, /38369214775/, '[1] esigner.source は U-1 の run を指す');
  assert.equal(si.checkSigner({ subject: ES_REAL_CHAIN[0].subject, chain: ES_REAL_CHAIN }, 'esigner'), null,
    '[1] 正本の esigner で U-1 の実物（SSL.com のチェーン）が通る');
  assert.match(si.checkSigner({ subject: ES_REAL_CHAIN[0].subject, chain: ES_REAL_CHAIN.slice(0, 2) }, 'esigner') ?? '', /上位/,
    '[1] 正本の esigner でも Root が無いチェーンは落ちる');

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
// Windows の C: のキャッシュと D: の作業場所を、実際の準備関数と path.win32 で検査する。
// ファイル操作は記録だけにし、複写先の列挙で止める（プラグインの差し替えは下の実ファイル fixture で検査）。
{
  const winPath = path.win32;
  const workDir = String.raw`D:\a\MaplatEditor\MaplatEditor\release\.win-sign`;
  const root = winPath.join(workDir, 'nsis-collect');
  const source = readFileSync(WIN_SIGN, 'utf8');
  const realRequire = createRequire(WIN_SIGN);
  const check = async (nsisSrc, pluginsSrc, rejected = false) => {
    const copies = [];
    const removals = [];
    const fakeFs = {
      rmSync: (p) => removals.push(p),
      cpSync: (from, to, opts) => copies.push({ from, to, opts }),
      readdirSync: () => { throw new Error('NSIS パス fixture: 複写先の列挙まで到達'); },
    };
    const mod = { exports: {} };
    const evaluate = runInNewContext(`(function(require, module, exports) { ${source}\n})`, {
      process: { env: { WIN_SIGN_MODE: 'collect', WIN_SIGN_WORK_DIR: workDir }, platform: 'win32' },
      Buffer, console,
    });
    evaluate((id) => id === 'node:path' ? winPath : id === 'node:fs' ? fakeFs : realRequire(id), mod, mod.exports);
    mod.exports.__setDepsForTest({ toolsetSources: { nsisSrc, pluginsSrc } });
    await assert.rejects(() => mod.exports.prepareSignedNsisToolset({ config: {} }),
      rejected ? /複写元が複写先の中にある/ : /NSIS パス fixture: 複写先の列挙まで到達/,
      `[2](o) Windows の複写元判定: ${nsisSrc} / ${pluginsSrc}`);
    if (rejected) {
      assert.equal(removals.length, 0, '[2](o) 複写先自身・子孫の入力は消す前に拒む');
      assert.equal(copies.length, 0, '[2](o) 拒んだ入力は複写しない');
    } else {
      assert.deepEqual(removals, [root], '[2](o) 再生成する対象は複写先だけ');
      assert.equal(copies[0].from, nsisSrc, '[2](o) NSIS 本体の複写元');
      assert.equal(copies[0].to, winPath.join(root, 'nsis'), '[2](o) NSIS 本体の複写先');
      return copies;
    }
  };
  const separate = await check(String.raw`C:\cache\nsis-3.0.4.1`, String.raw`C:\cache\nsis-resources-3.4.1\plugins`);
  assert.equal(separate.length, 2, '[2](o) C: の別梱包は D: へ本体・resources の 2 回複写');
  assert.equal(separate[1].to, winPath.join(root, 'nsis-resources'), '[2](o) 別梱包の resources を別の複写先へ');
  const crossDrive = await check(String.raw`C:\cache\nsis`, String.raw`E:\cache\nsis-resources\plugins`);
  assert.equal(crossDrive.length, 2, '[2](o) resources も別ドライブなら統合バンドルと誤判定しない');
  const bundled = await check(String.raw`C:\cache\nsis`, String.raw`C:\cache\nsis\windows\Plugins`);
  assert.equal(bundled.length, 1, '[2](o) 統合バンドルは本体の複写 1 回');
  await check(root, String.raw`C:\cache\plugins`, true);
  await check(winPath.join(root, 'nsis'), String.raw`C:\cache\plugins`, true);
  await check(String.raw`C:\cache\nsis`, winPath.join(root, 'nsis-resources', 'plugins'), true);
  await check(winPath.join(root, '..cache'), String.raw`C:\cache\plugins`, true);
  await check(`${root}-old`, String.raw`C:\cache\plugins`);
  console.log('  [2] Windows の別ドライブ・統合バンドル・自己複写拒否（8 ケース）: PASS');
}
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
  // 変異（B31 MIN-1）: manifest の name が basename でなければ、どの phase でも 1 周目で赤・何も書かない
  for (const bad of ['../escape-Setup.exe', '..\\escape-Setup.exe', 'sub/escape-Setup.exe']) {
    writeFileSync(path.join(d, 'manifest-installer-bad.json'), JSON.stringify([{ sha256: sha256(files.setup[1]), name: bad,
      kind: 'electron-builder', comparable: ws.comparableDigest(files.setup[1]), paths: [] }]));
    const escRel = path.join(d, 'esc', 'release', '1.2.0');
    const rb = apply({ phase: 'installer', manifest: path.join(d, 'manifest-installer-bad.json'), signed: instSigned, releaseDir: escRel, signedDir: null });
    assert.ok(rb.errors.some((x) => /basename/.test(x)), `[3] apply installer: name が basename でなければ赤（${bad}）: ${rb.errors}`);
    assert.deepEqual(rb.applied, [], `[3] apply installer: name が basename でなければ何も書かない（${bad}）`);
    assert.ok(!existsSync(path.join(d, 'esc')), `[3] apply installer: release-dir の外へ書かない（${bad}）`);
  }
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
  // 静的（B31 MAJ-1）: Windows のジョブで node が起動する scripts/win-sign/ の下に `new URL(import.meta.url).pathname` の形が無い
  // （Windows では pathname が /D:/… になり、path.resolve が D:\\D:\\… を作る。fileURLToPath を使う）
  const winSignDir = path.join(projectRoot, 'scripts/win-sign');
  for (const f of readdirSync(winSignDir).filter((n) => /\.(c|m)?js$/.test(n))) {
    const src = readFileSync(path.join(winSignDir, f), 'utf8');
    assert.ok(!/import\.meta\.url\s*\)\s*\.pathname/.test(src),
      `[3] scripts/win-sign/${f} に new URL(…import.meta.url).pathname がある（Windows でパスが壊れる・fileURLToPath を使う）`);
  }
  console.log('  [3/6] collect-sign-set・apply-signed・verify-win-install・prepare-nsis-toolset: PASS');
}

// ───────────────────────────────────────────────
// [4] build.yml の静的検査 — AC1 (a)(b)(f)(g)(h)(i)(j)(k)(l)(n)
// ───────────────────────────────────────────────
const { checkSigningJob, checkPnpmPin, ENDPOINT } = await import('./win-sign/signing-job-rules.mjs');
const SIGN_JOBS = { 'sign-win-payload': '48', 'sign-win-uninstaller': '2', 'sign-win-installer': '2' };
const PACK_JOBS = ['pack-win-1', 'pack-win-2'];
const RUN_NAME = "${{ github.event_name == 'workflow_dispatch' && format('dispatch mode={0} signer={1} sha={2} ver={3}', inputs.mode, inputs.win_signer, inputs.expected_editor_sha, inputs.expected_version) || format('push {0}', github.sha) }}";
const RELEASE_IF = "${{ !cancelled() && needs.prepare.result == 'success' && needs.build-mac.result == 'success' && needs.build-win.result == 'success' && needs.build-linux.result == 'success' && ((needs.finalize-win.result == 'success' && needs.verify-win-install.result == 'success') || (needs.prepare.outputs.win_sign_path == 'esigner' && needs.finalize-win.result == 'skipped' && needs.verify-win-install.result == 'skipped')) && github.event_name == 'workflow_dispatch' && inputs.mode == 'full' && inputs.platforms == 'all' }}";
const AS_COND = "needs.prepare.outputs.win_sign_path == 'artifact-signing'";
const runOf = (st) => (typeof st?.run === 'string' ? st.run : '');
const usesOf = (st) => (typeof st?.uses === 'string' ? st.uses : '');
const needsOf = (job) => (job?.needs == null ? [] : [].concat(job.needs));
const EB_RE = /(^|[\s;&|(])electron-builder\s/m;

/** AC1 の build.yml の違反の一覧（空なら合格） */
function checkBuildWorkflow(wf) {
  const v = [];
  const jobs = wf?.jobs ?? {};
  // (i) run-name
  if (wf['run-name'] !== RUN_NAME) v.push(`(i) run-name が §3.2 の式と一致しない: ${JSON.stringify(wf['run-name'])}`);
  // (a) id-token を持つのは署名専用ジョブ 3 つだけ（縮退時は pack-sign-win も）・workflow レベルに無い
  if (wf.permissions && 'id-token' in wf.permissions) v.push('(a) workflow レベルに id-token がある');
  const allowedIdToken = new Set([...Object.keys(SIGN_JOBS), ...(jobs['pack-sign-win'] ? ['pack-sign-win'] : [])]);
  for (const [name, job] of Object.entries(jobs)) {
    if (job?.permissions && typeof job.permissions === 'object' && 'id-token' in job.permissions && !allowedIdToken.has(name)) {
      v.push(`(a) ${name} が id-token を持つ`);
    }
  }
  const stepsJson = [];
  for (const [name, max] of Object.entries(SIGN_JOBS)) {
    const job = jobs[name];
    if (!job) { v.push(`(a) 署名専用ジョブ ${name} が無い`); continue; }
    for (const msg of checkSigningJob(name, job)) v.push(`(a) ${msg}`);
    if (String(job.env?.MAX_FILES) !== max) v.push(`(a) ${name} の MAX_FILES が ${max} でない: ${JSON.stringify(job.env?.MAX_FILES)}`);
    const envKeys = Object.keys(job.env ?? {}).sort().join(',');
    if (envKeys !== 'IN_ARTIFACT,MAX_FILES,OUT_ARTIFACT') v.push(`(a) ${name} のジョブ env が IN_ARTIFACT・OUT_ARTIFACT・MAX_FILES だけでない: ${envKeys}`);
    if (job.if !== AS_COND) v.push(`(a) ${name} の if が Artifact Signing の経路でない: ${JSON.stringify(job.if)}`);
    stepsJson.push(JSON.stringify(job.steps));
    // (b) Endpoint のリテラル
    const meta = (job.steps ?? []).filter((st) => /CodeSigningAccountName/.test(runOf(st)));
    if (meta.length !== 1 || !runOf(meta[0]).includes(`'${ENDPOINT}'`) || runOf(meta[0]).includes('${{')) {
      v.push(`(b) ${name} の metadata.json の Endpoint が ${ENDPOINT} のリテラルでない`);
    }
    // (l) 入力の検査
    const check = (job.steps ?? []).find((st) => st.name === 'Check the input');
    const ct = runOf(check);
    for (const needle of ['^[0-9a-f]{64}\\.pe$', 'MAX_FILES', 'Get-FileHash', '-Recurse', 'ReparsePoint', 'Directory']) {
      if (!ct.includes(needle)) v.push(`(l) ${name} の入力の検査に ${needle} が無い`);
    }
    const signStep = (job.steps ?? []).find((st) => /\/dlib\b/.test(runOf(st)));
    if (!/Get-ChildItem -LiteralPath sign-in -Filter \*\.pe/.test(runOf(signStep))) v.push(`(l) ${name} の署名が sign-in の直下の *.pe だけを対象にしていない`);
  }
  if (new Set(stepsJson).size > 1) v.push('(a) 署名専用ジョブ 3 つの step の列が同じでない');

  // (h) 祖先の確認: prepare の checkout の直後の最初の step・scripts/ を呼ばない
  const prep = jobs.prepare?.steps ?? [];
  const coAt = prep.findIndex((st) => usesOf(st).startsWith('actions/checkout@'));
  const anc = prep[coAt + 1];
  if (coAt < 0 || prep[coAt].with?.['fetch-depth'] !== 0) v.push('(h) prepare の checkout に fetch-depth: 0 が無い');
  if (!anc || !/merge-base --is-ancestor/.test(runOf(anc))) v.push('(h) prepare の checkout の直後の step が祖先の確認でない');
  else {
    if (/scripts\//.test(runOf(anc))) v.push('(h) 祖先の確認の run: がリポジトリのファイルを呼ぶ');
    if (runOf(anc).includes('${{')) v.push('(h) 祖先の確認の run: に ${{ がある（env: で渡す）');
  }
  // (h) expected_editor_sha で checkout する全ジョブが needs を推移的にたどって prepare に依存する
  const reaches = (name, seen = new Set()) => {
    if (name === 'prepare') return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return needsOf(jobs[name]).some((n) => reaches(n, seen));
  };
  for (const [name, job] of Object.entries(jobs)) {
    const co = (job?.steps ?? []).some((st) => usesOf(st).startsWith('actions/checkout@') && st.with?.ref === '${{ inputs.expected_editor_sha }}');
    if (co && name !== 'prepare' && !reaches(name)) v.push(`(h) ${name} は expected_editor_sha で checkout するが prepare に依存しない`);
    const cond = String(job?.if ?? '');
    if (/always\(\)|!cancelled\(\)/.test(cond)) {
      const ok = cond.includes("needs.prepare.result == 'success'")
        || (name === 'publish-win-sign-cache' && cond.includes("needs.build-win.outputs.win_sign_cache_new != ''") && needsOf(job).includes('build-win'));
      if (!ok) v.push(`(h) ${name} の if: が always()/!cancelled() を持つのに prepare の成功を要らない`);
    }
  }

  // (f) Artifact Signing の経路の step にキャッシュが無い
  const asJobs = [...Object.keys(SIGN_JOBS), ...PACK_JOBS, 'finalize-win', 'verify-win-install'];
  for (const [name, job] of Object.entries(jobs)) {
    (job?.steps ?? []).forEach((st, i) => {
      const onPath = asJobs.includes(name) || String(st.if ?? '').includes(AS_COND);
      if (onPath && /WIN_SIGN_CACHE_URL|WIN_SIGN_CACHE_DIR|win-signed-cache/.test(JSON.stringify(st))) {
        v.push(`(f) Artifact Signing の経路の ${name}.steps[${i}] がキャッシュを参照する`);
      }
    });
    if (asJobs.includes(name) && /WIN_SIGN_CACHE_URL|WIN_SIGN_CACHE_DIR|win-signed-cache/.test(JSON.stringify(job?.env ?? {}))) {
      v.push(`(f) ${name} のジョブ env がキャッシュを参照する`);
    }
  }
  for (const name of asJobs) {
    if (!jobs[name]) v.push(`(f) ジョブ ${name} が無い`);
    else if (jobs[name].if !== AS_COND) v.push(`(f) ${name} の if が Artifact Signing の経路でない`);
  }

  // (g) sign-check で release・キャッシュの公開・公証・eSigner の step が走らない（式が mode == 'full' を含む）
  const FULL = "inputs.mode == 'full'";
  const gate = [['release', jobs.release?.if], ['publish-win-sign-cache', jobs['publish-win-sign-cache']?.if]];
  for (const st of jobs['build-mac']?.steps ?? []) if (/notarization/.test(st.name ?? '')) gate.push(['公証の env', st.if]);
  for (const st of jobs['build-win']?.steps ?? []) {
    if (/esigner|CodeSignTool|cache-outbox|resign-update-metadata|--authenticode|signed build/i.test(`${st.name ?? ''} ${runOf(st)} ${JSON.stringify(st.env ?? {})}`)
      && !String(st.if ?? '').includes(AS_COND) && st.name !== 'Build Windows') gate.push([`build-win「${st.name}」`, st.if]);
  }
  for (const [what, cond] of gate) if (!String(cond ?? '').includes(FULL)) v.push(`(g) ${what} の if: が mode=full に限られていない`);

  // (j) 受け渡しの artifact は 1 日・win-artifacts は sign-check で 3 日・中身は 3 種類・release は verify-win-install を要る
  for (const [name, job] of Object.entries(jobs)) {
    for (const st of job?.steps ?? []) {
      if (!usesOf(st).startsWith('actions/upload-artifact@')) continue;
      const an = String(st.with?.name ?? '');
      const handoff = /^(win-stage1|win-stage1-meta|win-sign-in-|win-signed-|win-pack\d-record|win-finalize-record)/.test(an) || an.includes('env.OUT_ARTIFACT');
      if (handoff && st.with?.['retention-days'] !== 1) v.push(`(j) ${name} の受け渡し ${an} の retention-days が 1 でない`);
    }
  }
  const fin = (jobs['finalize-win']?.steps ?? []).find((st) => usesOf(st).startsWith('actions/upload-artifact@') && st.with?.name === 'win-artifacts');
  if (!fin) v.push('(j) finalize-win が win-artifacts を上げない');
  else {
    if (fin.with['retention-days'] !== "${{ inputs.mode == 'sign-check' && 3 || 30 }}") v.push('(j) win-artifacts の保持が sign-check で 3 日でない');
    const globs = String(fin.with.path).trim().split('\n').map((x) => x.trim()).sort();
    const want = ['release/${{ env.VERSION }}/*-Setup.exe', 'release/${{ env.VERSION }}/*-Setup.exe.blockmap', 'release/${{ env.VERSION }}/latest.yml'].sort();
    if (JSON.stringify(globs) !== JSON.stringify(want)) v.push(`(j) win-artifacts の path が 3 つの glob でない: ${JSON.stringify(globs)}`);
  }
  const bwUp = (jobs['build-win']?.steps ?? []).find((st) => st.with?.name === 'win-artifacts');
  if (!bwUp || bwUp.if !== "needs.prepare.outputs.win_sign_path != 'artifact-signing'") v.push('(j) build-win の win-artifacts が Artifact Signing の経路でも上がる（二重 upload）');
  if (!needsOf(jobs.release).includes('verify-win-install') || !needsOf(jobs.release).includes('finalize-win')) v.push('(j) release の needs に finalize-win・verify-win-install が無い');
  if (jobs.release?.if !== RELEASE_IF) v.push('(j) release の if: が §3.2 の式と一致しない');

  // (k) 縮退（pack-sign-win）があるときだけ
  if (jobs['pack-sign-win']) {
    const all = (jobs['pack-sign-win'].steps ?? []).map(runOf).join('\n');
    if (!/pnpm install --frozen-lockfile --ignore-scripts/.test(all)) v.push('(k) pack-sign-win の install が --frozen-lockfile --ignore-scripts でない');
    if (/pnpm run|\bvite\b|vue-tsc/.test(all)) v.push('(k) pack-sign-win が pnpm run・vite・vue-tsc を起動する');
  }

  // (n) 準備の step が electron-builder より前・WIN_SIGN_MODE collect
  for (const name of [...PACK_JOBS, ...(jobs['pack-sign-win'] ? ['pack-sign-win'] : [])]) {
    const steps = jobs[name]?.steps ?? [];
    const prepAt = steps.findIndex((st) => runOf(st).includes('node scripts/win-sign/prepare-nsis-toolset.mjs'));
    const ebAt = steps.findIndex((st) => EB_RE.test(runOf(st)));
    if (prepAt < 0) v.push(`(n) ${name} に準備の step（prepare-nsis-toolset.mjs）が無い`);
    else {
      if (ebAt >= 0 && prepAt > ebAt) v.push(`(n) ${name} の準備の step が electron-builder の後にある`);
      const want = name === 'pack-sign-win' ? 'artifact-signing-inline' : 'collect';
      if (steps[prepAt].env?.WIN_SIGN_MODE !== want) v.push(`(n) ${name} の準備の step の WIN_SIGN_MODE が ${want} でない`);
    }
    if (ebAt < 0) v.push(`(n) ${name} が electron-builder を起動しない`);
    for (const st of steps) {
      if (EB_RE.test(runOf(st)) && !/--prepackaged\s/.test(runOf(st))) v.push(`(n) ${name}「${st.name}」が --prepackaged でない`);
      if (EB_RE.test(runOf(st)) && st.env?.WIN_SIGN_MODE !== (name === 'pack-sign-win' ? 'artifact-signing-inline' : 'collect')) {
        v.push(`(n) ${name}「${st.name}」の WIN_SIGN_MODE が collect でない`);
      }
    }
  }
  for (const [name, job] of Object.entries(jobs)) {
    for (const st of job?.steps ?? []) {
      if (!EB_RE.test(runOf(st))) continue;
      if (!runOf(st).includes('--config electron-builder.config.cjs')) v.push(`(n) ${name}「${st.name}」の electron-builder に --config electron-builder.config.cjs が無い`);
      if (!runOf(st).includes('--publish never')) v.push(`(n) ${name}「${st.name}」の electron-builder に --publish never が無い`);
    }
  }
  return v;
}

const wfText = readFileSync(WORKFLOW, 'utf8');
const wf = yaml.load(wfText);
{
  const v = checkBuildWorkflow(wf);
  assert.deepEqual(v, [], `t2/AC1 の build.yml の違反:\n  ${v.join('\n  ')}`);
  assert.deepEqual(checkPnpmPin(wfText), [], '[4] pnpm/action-setup は m10 の PIN（t2/AC4）');
  console.log('  [4/6] build.yml の静的検査（AC1 (a)(b)(f)(g)(h)(i)(j)(k)(l)(n)）: PASS');
}

// ───────────────────────────────────────────────
// [5] 祖先の確認の shell を fixture のリポジトリで実行 — AC1 (h)
// ───────────────────────────────────────────────
{
  const prep = wf.jobs.prepare.steps;
  const anc = prep[prep.findIndex((st) => usesOf(st).startsWith('actions/checkout@')) + 1];
  const repo = path.join(work, 'ancestry');
  mkdirSync(repo, { recursive: true });
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 's', GIT_AUTHOR_EMAIL: 's@example.com', GIT_COMMITTER_NAME: 's', GIT_COMMITTER_EMAIL: 's@example.com' } });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'master');
  const commit = (msg) => { writeFileSync(path.join(repo, 'f.txt'), msg); git('add', 'f.txt'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  const A = commit('A');
  const B = commit('B');
  git('switch', '-q', '-c', 'other', A);
  const C = commit('C');
  git('update-ref', 'refs/remotes/origin/master', B);
  const run = (event, mode, sha, at = sha) => {
    if (/^[0-9a-f]{40}$/.test(at)) git('switch', '-q', '--detach', at);
    return spawnSync('bash', ['-c', runOf(anc)], { cwd: repo, encoding: 'utf8', env: { ...process.env, EVENT: event, MODE: mode, SHA: sha } }).status;
  };
  for (const mode of ['full', 'sign-check']) {
    assert.equal(run('workflow_dispatch', mode, B), 0, `[5](h) ${mode}: master の B は通る`);
    assert.equal(run('workflow_dispatch', mode, A), 0, `[5](h) ${mode}: master の祖先 A は通る`);
    assert.notEqual(run('workflow_dispatch', mode, C), 0, `[5](h) ${mode}: 別 branch の C は落ちる`);
    assert.notEqual(run('workflow_dispatch', mode, 'deadbeef', B), 0, `[5](h) ${mode}: 40 桁でない値は落ちる`);
    assert.notEqual(run('workflow_dispatch', mode, B, A), 0, `[5](h) ${mode}: checkout が SHA を指していなければ落ちる`);
  }
  assert.equal(run('workflow_dispatch', 'verify', C), 0, '[5](h) verify では検査しない');
  assert.equal(run('push', '', '', B), 0, '[5](h) push では検査しない');
  console.log('  [5/6] 祖先の確認（fixture のリポジトリで実行）: PASS');
}

// ───────────────────────────────────────────────
// [6] 変異の自己検査 — AC1 (m)
// ───────────────────────────────────────────────
{
  const steps = (w, job) => w.jobs[job].steps;
  const at = (w, job, pred) => {
    const i = steps(w, job).findIndex(pred);
    assert.ok(i >= 0, `自己検査の前提: ${job} に変異させる step が無い`);
    return i;
  };
  const ebAt = (w, job) => at(w, job, (st) => EB_RE.test(runOf(st)));
  const prepAt = (w, job) => at(w, job, (st) => runOf(st).includes('prepare-nsis-toolset.mjs'));
  const mutations = [
    ['pack-win-1 に id-token を付ける', (w) => { w.jobs['pack-win-1'].permissions = { contents: 'read', 'id-token': 'write' }; }],
    ['workflow レベルに id-token を付ける', (w) => { w.permissions = { contents: 'read', 'id-token': 'write' }; }],
    ['prepare への依存を外したジョブを足す', (w) => {
      w.jobs.rogue = { needs: [], 'runs-on': 'ubuntu-latest', steps: [{ uses: 'actions/checkout@v4', with: { ref: '${{ inputs.expected_editor_sha }}' } }] };
    }],
    ['Endpoint を式にする', (w) => {
      const i = at(w, 'sign-win-payload', (st) => /CodeSigningAccountName/.test(runOf(st)));
      steps(w, 'sign-win-payload')[i].run = runOf(steps(w, 'sign-win-payload')[i]).split(ENDPOINT).join('${{ inputs.endpoint }}');
    }],
    ['MAX_FILES を消す', (w) => { delete w.jobs['sign-win-uninstaller'].env.MAX_FILES; }],
    ['署名専用ジョブの step を 1 か所変える', (w) => { steps(w, 'sign-win-installer')[0].with.path = 'sign-in-x'; }],
    ['pack-win-1 の準備の step を消す', (w) => { steps(w, 'pack-win-1').splice(prepAt(w, 'pack-win-1'), 1); }],
    ['pack-win-2 の準備の step を electron-builder の後へ動かす', (w) => {
      const s = steps(w, 'pack-win-2');
      const [p] = s.splice(prepAt(w, 'pack-win-2'), 1);
      s.splice(ebAt(w, 'pack-win-2') + 1, 0, p);
    }],
    ['pack の electron-builder から --config を消す', (w) => {
      const i = ebAt(w, 'pack-win-1');
      steps(w, 'pack-win-1')[i].run = runOf(steps(w, 'pack-win-1')[i]).replace('--config electron-builder.config.cjs ', '');
    }],
    ['pack の electron-builder から --publish never を消す', (w) => {
      const i = ebAt(w, 'pack-win-2');
      steps(w, 'pack-win-2')[i].run = runOf(steps(w, 'pack-win-2')[i]).replace('--publish never ', '');
    }],
    // 以下は設計の変異に加えた分（各項が効くこと）
    ['準備の step の WIN_SIGN_MODE を record にする', (w) => { steps(w, 'pack-win-1')[prepAt(w, 'pack-win-1')].env.WIN_SIGN_MODE = 'record'; }],
    ['祖先の確認を checkout の直後から動かす', (w) => {
      const s = steps(w, 'prepare');
      const i = s.findIndex((st) => /merge-base --is-ancestor/.test(runOf(st)));
      const [x] = s.splice(i, 1);
      s.push(x);
    }],
    ['祖先の確認がリポジトリのスクリプトを呼ぶ', (w) => {
      const s = steps(w, 'prepare');
      const i = s.findIndex((st) => /merge-base --is-ancestor/.test(runOf(st)));
      s[i].run = `node scripts/x.mjs\n${runOf(s[i])}`;
    }],
    ['run-name を変える', (w) => { w['run-name'] = 'dispatch'; }],
    ['受け渡しの保持を 7 日にする', (w) => {
      const i = at(w, 'pack-win-1', (st) => st.with?.name === 'win-sign-in-uninstaller');
      steps(w, 'pack-win-1')[i].with['retention-days'] = 7;
    }],
    ['win-artifacts に unpacked を足す', (w) => {
      const i = at(w, 'finalize-win', (st) => st.with?.name === 'win-artifacts');
      steps(w, 'finalize-win')[i].with.path += '\nrelease/${{ env.VERSION }}/win-unpacked';
    }],
    ['release の needs から verify-win-install を外す', (w) => { w.jobs.release.needs = w.jobs.release.needs.filter((n) => n !== 'verify-win-install'); }],
    ['release の if から verify-win-install の success を外す', (w) => {
      w.jobs.release.if = w.jobs.release.if.replace(" && needs.verify-win-install.result == 'success'", '');
    }],
    ['Artifact Signing の経路の step にキャッシュの URL を渡す', (w) => {
      steps(w, 'finalize-win')[0].env = { WIN_SIGN_CACHE_URL: 'https://github.com/x/releases/download/win-signed-cache' };
    }],
    ['入力の検査から ReparsePoint を外す', (w) => {
      const i = at(w, 'sign-win-payload', (st) => st.name === 'Check the input');
      steps(w, 'sign-win-payload')[i].run = runOf(steps(w, 'sign-win-payload')[i]).replaceAll('ReparsePoint', 'Archive');
      for (const j of ['sign-win-uninstaller', 'sign-win-installer']) steps(w, j)[i].run = steps(w, 'sign-win-payload')[i].run;
    }],
    ['公証の env の if: から mode == full を外す', (w) => {
      const i = at(w, 'build-mac', (st) => /notarization/.test(st.name ?? ''));
      steps(w, 'build-mac')[i].if = "github.event_name == 'workflow_dispatch'";
    }],
    ['always() のジョブを prepare の成功なしで足す', (w) => { w.jobs.late = { needs: ['prepare'], if: 'always()', steps: [] }; }],
  ];
  for (const [what, mutate] of mutations) {
    const w = structuredClone(wf);
    mutate(w);
    assert.ok(checkBuildWorkflow(w).length > 0, `自己検査: 変異「${what}」で違反が出ない（規則が空振りしている）`);
  }
  console.log(`  [6/6] 自己検査（変異 ${mutations.length} 件がすべて違反を出す）: PASS`);
}

console.log('\nnov26-m7-t2 signing pipeline smoke: すべて成功');
