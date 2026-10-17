/**
 * nov26-m7-t4: 署名済みキャッシュ（Release `win-signed-cache`）へ上げる前の検査の受け入れ検査（#140 L-2）。
 *
 *   [A] t4/AC1: build.yml の publish-win-sign-cache の「Check cache candidates」の run: を抜き出し、fixture の
 *       outbox/ で bash に渡して実行する。正しい名前の PE は通り、名前・種類・大きさ・中身の形・件数の外れは落ちる
 *   [B] t4/AC3: publish-win-sign-cache の if: を scripts/ci/eval-gh-if.mjs（t3）で評価し、eSigner の退路の
 *       mode=full で候補があるときだけ真になる
 *   [C] t4/AC2: win-sign.cjs の signFile で、outbox へ置く（outboxDir()）より前に checkSigner(…, 'esigner')（C-3）がある
 *   [D] t4/AC3: publish-win-sign-cache の全 step が checkout・pnpm・setup-node を持たず、run: のコマンド位置に
 *       pnpm・npm・npx・node が無い（m6-t12 AC11 と同じ規則が新しい step にも効く）
 *   [E] t4/AC3: 検査の正規表現が設計の固定値と同じで、win-sign.cjs の assetName の出力がその正規表現に合う
 *
 * 実行: node scripts/nov26-m7-t4-cache-publish-guard-smoke.mjs（rtk を付けない）
 * bash を起動するのは macOS／Linux だけ（Windows では [A] を飛ばす）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { evalGhIfBool } from './ci/eval-gh-if.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKFLOW = path.join(projectRoot, '.github/workflows/build.yml');
const WIN_SIGN = path.join(projectRoot, 'scripts/win-sign/win-sign.cjs');
const JOB = 'publish-win-sign-cache';
const CHECK_STEP = 'Check cache candidates';
const PUBLISH_STEP = 'Publish to the cache release';
// 設計（t4 §3.1・MIN-5）で固定した asset 名の規則。win-sign.cjs の assetName（<SHA-256 64 桁>--<名前>.signed）と同じ形
const NAME_RE_SRC = '^[0-9a-f]{64}--[A-Za-z0-9._-]{1,200}\\.signed$';

const wf = yaml.load(readFileSync(WORKFLOW, 'utf8'));
const job = wf.jobs?.[JOB];
assert.ok(job, `${JOB} ジョブがある`);
const steps = job.steps ?? [];
const runOf = (st) => (typeof st?.run === 'string' ? st.run : '');
const usesOf = (st) => (typeof st?.uses === 'string' ? st.uses : '');
const failures = [];
const check = (label, fn) => {
  try {
    fn();
    console.log(`ok  ${label}`);
  } catch (e) {
    failures.push(label);
    console.error(`NG  ${label}\n    ${e.message.split('\n').join('\n    ')}`);
  }
};

// ─────────────────────────────────────────────
// [A] t4/AC1: 抜き出して実行する
// ─────────────────────────────────────────────
const checkStep = steps.find((st) => st.name === CHECK_STEP);
const checkIdx = steps.indexOf(checkStep);
const publishIdx = steps.findIndex((st) => st.name === PUBLISH_STEP);

check('[A] 「Check cache candidates」step があり、bash で、upload の前にある', () => {
  assert.ok(checkStep, `${JOB} に「${CHECK_STEP}」step が無い`);
  assert.equal(checkStep.shell, 'bash', 'shell: bash');
  assert.ok(publishIdx > checkIdx, '「Check cache candidates」は「Publish to the cache release」より前');
  assert.equal(checkStep.if, undefined, '検査の step に if: を付けない（落ちたら後続の upload が走らない既定の振る舞いに頼る）');
  assert.equal(steps[publishIdx].if, undefined, 'upload の step に if: を付けない（always() 等で検査の失敗を越えない）');
  assert.match(runOf(checkStep), /^set -euo pipefail$/m, 'set -euo pipefail');
});

check('[A] upload は検査と同じ集合（outbox/*）を上げる', () => {
  const pub = runOf(steps[publishIdx]);
  assert.match(pub, /for f in outbox\/\*; do/, 'upload の for は outbox/*');
  assert.doesNotMatch(pub, /outbox\/\*\.signed/, 'upload に outbox/*.signed が残っていない');
  assert.match(runOf(checkStep), /files=\(outbox\/\*\)/, '検査の集合は outbox/*');
});

const HEX = 'a1'.repeat(32);
const HEX2 = 'b2'.repeat(32);
const HEX3 = 'c3'.repeat(32);
const VALID = [`${HEX}--ffmpeg.dll.signed`, `${HEX2}--elevate.exe.signed`, `${HEX3}--index.win32-x64-msvc.node.signed`];
const pe = (n = 1024) => {
  const b = Buffer.alloc(n, 0x41);
  b[0] = 0x4d; // M
  b[1] = 0x5a; // Z
  return b;
};

let work = null;
if (process.platform === 'win32') {
  console.log('skip [A] の実行（Windows では bash を起動しない）');
} else if (checkStep) {
  work = mkdtempSync(path.join(tmpdir(), 'nov26-m7-t4-'));
  // ubuntu-latest の stat は GNU（-c %s）。macOS の BSD stat は -c を持たないため、-c %s だけを受ける代替を PATH の先頭に置く
  const bin = path.join(work, 'bin');
  mkdirSync(bin);
  const stat = path.join(bin, 'stat');
  writeFileSync(stat, `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] !== '-c' || a[1] !== '%s' || a[2] !== '--' || a.length !== 4) { console.error('stat 代替: -c %s -- <file> だけを受ける: ' + a.join(' ')); process.exit(2); }
try { console.log(require('fs').statSync(a[3]).size); } catch (e) { console.error(String(e)); process.exit(1); }
`);
  chmodSync(stat, 0o755);
  const script = runOf(checkStep);
  let caseNo = 0;
  /** outbox を作り（populate が中身を置く）、検査を走らせて { status, out } を返す */
  const runCase = (populate) => {
    const dir = path.join(work, `case-${caseNo++}`);
    mkdirSync(path.join(dir, 'outbox'), { recursive: true });
    populate(path.join(dir, 'outbox'));
    const r = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      encoding: 'utf8',
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const putValid = (o) => VALID.forEach((n) => writeFileSync(path.join(o, n), pe()));

  check('[A] 正しい名前の MZ で始まる 1 KiB のファイル 3 本は通る', () => {
    const r = runCase(putValid);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /検査を通った候補: 3 件/, r.out);
  });
  check('[A] 下限ちょうど（64 バイト）・上限ちょうど（64 MiB）は通る', () => {
    const r = runCase((o) => {
      writeFileSync(path.join(o, VALID[0]), pe(64));
      writeFileSync(path.join(o, VALID[1]), pe(2));
      truncateSync(path.join(o, VALID[1]), 64 * 1024 * 1024);
    });
    assert.equal(r.status, 0, r.out);
  });
  check('[A] 64 本ちょうどは通る', () => {
    const r = runCase((o) => {
      for (let i = 0; i < 64; i++) writeFileSync(path.join(o, `${i.toString(16).padStart(64, '0')}--f${i}.dll.signed`), pe(64));
    });
    assert.equal(r.status, 0, r.out);
  });

  /** 正しい 3 本に 1 本だけ混ぜて、落ちて何を言うかを見る */
  const bad = [
    ['../x.signed（basename にすると x.signed＝64 桁でない）', (o) => writeFileSync(path.join(o, 'x.signed'), pe()), /名前が規則に合わない: x\.signed/],
    ['63 桁の hex', (o) => writeFileSync(path.join(o, `${'a'.repeat(63)}--ffmpeg.dll.signed`), pe()), /名前が規則に合わない/],
    ['65 桁の hex', (o) => writeFileSync(path.join(o, `${'a'.repeat(65)}--ffmpeg.dll.signed`), pe()), /名前が規則に合わない/],
    // 名前の部分を正しい 3 本と変える（macOS の既定の APFS は大文字小文字を区別せず、同じ名前だと上書きになる）
    ['大文字の hex', (o) => writeFileSync(path.join(o, `${'A1'.repeat(32)}--upper.dll.signed`), pe()), /名前が規則に合わない: A1A1/],
    ['.signed 以外（.dll）', (o) => writeFileSync(path.join(o, `${HEX}--ffmpeg.dll`), pe()), /名前が規則に合わない/],
    ['名前の部分に許されない字（空白）', (o) => writeFileSync(path.join(o, `${HEX}--a b.dll.signed`), pe()), /名前が規則に合わない/],
    ['.. を含む名前', (o) => writeFileSync(path.join(o, `${HEX}--a..b.signed`), pe()), /名前に \.\. を含む/],
    ['symlink（正しい名前・正しい中身を指す）', (o) => {
      const real = path.join(o, '..', 'real.bin');
      writeFileSync(real, pe());
      symlinkSync(real, path.join(o, `${HEX}--link.dll.signed`));
    }, /通常のファイルでない/],
    ['ディレクトリ', (o) => mkdirSync(path.join(o, `${HEX}--dir.dll.signed`)), /通常のファイルでない/],
    ['64 MiB＋1 バイト（スパース）', (o) => {
      const f = path.join(o, `${HEX}--big.dll.signed`);
      writeFileSync(f, pe(2));
      truncateSync(f, 64 * 1024 * 1024 + 1);
    }, /大きさが範囲外（67108865）/],
    ['63 バイト', (o) => writeFileSync(path.join(o, `${HEX}--small.dll.signed`), pe(63)), /大きさが範囲外（63）/],
    ['先頭が MZ でない', (o) => {
      const b = pe();
      b[0] = 0x50; // P
      b[1] = 0x4b; // K
      writeFileSync(path.join(o, `${HEX}--zip.dll.signed`), b);
    }, /PE でない/],
    ['空ファイル', (o) => closeSync(openSync(path.join(o, `${HEX}--empty.dll.signed`), 'w')), /大きさが範囲外（0）/],
  ];
  for (const [label, add, want] of bad) {
    check(`[A] 落ちる: ${label}`, () => {
      const r = runCase((o) => {
        putValid(o);
        add(o);
      });
      assert.notEqual(r.status, 0, `通ってしまった:\n${r.out}`);
      assert.match(r.out, /::error::/, r.out);
      assert.match(r.out, want, r.out);
      assert.doesNotMatch(r.out, /検査を通った候補/, r.out);
    });
  }
  check('[A] 落ちる: 65 本（件数の超過）', () => {
    const r = runCase((o) => {
      for (let i = 0; i < 65; i++) writeFileSync(path.join(o, `${i.toString(16).padStart(64, '0')}--f${i}.dll.signed`), pe(64));
    });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /候補が 65 件（上限 64）/, r.out);
  });
  check('[A] 落ちる: 0 本', () => {
    const r = runCase(() => {});
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /候補が 0 件/, r.out);
  });
  check('[A] 落ちる: outbox が無い', () => {
    const r = runCase((o) => rmSync(o, { recursive: true }));
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /候補が 0 件/, r.out);
  });
}

// ─────────────────────────────────────────────
// [B] t4/AC3: 起動条件を評価する
// ─────────────────────────────────────────────
check('[B] publish-win-sign-cache の if: は eSigner の退路・mode=full・候補ありのときだけ真', () => {
  const cond = String(job.if ?? '').trim();
  // eval-gh-if は関数呼び出しを受け付けない。always() は「needs が失敗しても評価する」の意味で、評価の時点では常に真
  // ∴ 先頭の `always() &&` を確かめて外し、残りを評価する（always() が先頭以外に現れたら評価器が例外で止める）
  assert.match(cond, /^always\(\) && /, 'if: は always() && で始まる（build-win が失敗しても署名できた分は保管する）');
  const rest = cond.replace(/^always\(\) && /, '');
  const base = () => ({
    github: { event_name: 'workflow_dispatch' },
    inputs: { mode: 'full' },
    needs: {
      prepare: { result: 'success', outputs: { win_sign_path: 'esigner' } },
      'build-win': { result: 'success', outputs: { win_sign_cache_new: '3' } },
    },
  });
  const cases = [
    ['eSigner の退路・mode=full・候補 3', (c) => c, true],
    ['build-win が失敗しても候補があれば真（always）', (c) => { c.needs['build-win'].result = 'failure'; return c; }, true],
    ['Artifact Signing の経路', (c) => { c.needs.prepare.outputs.win_sign_path = 'artifact-signing'; return c; }, false],
    ['win_sign_path が空', (c) => { c.needs.prepare.outputs.win_sign_path = ''; return c; }, false],
    ['mode=sign-check', (c) => { c.inputs.mode = 'sign-check'; return c; }, false],
    ['mode=verify', (c) => { c.inputs.mode = 'verify'; return c; }, false],
    ['push', (c) => { c.github.event_name = 'push'; c.inputs = {}; return c; }, false],
    ['prepare が failure', (c) => { c.needs.prepare.result = 'failure'; return c; }, false],
    ['prepare が skipped', (c) => { c.needs.prepare.result = 'skipped'; return c; }, false],
    ['候補 0', (c) => { c.needs['build-win'].outputs.win_sign_cache_new = '0'; return c; }, false],
    ['候補が空（出力が無い）', (c) => { c.needs['build-win'].outputs.win_sign_cache_new = ''; return c; }, false],
  ];
  for (const [label, mut, want] of cases) {
    assert.equal(evalGhIfBool(rest, mut(base())), want, `${label}: ${rest}`);
  }
});

// ─────────────────────────────────────────────
// [C] t4/AC2: outbox へ置く前の署名者の照合
// ─────────────────────────────────────────────
check("[C] signFile の esigner の分岐で、checkSigner(…, 'esigner') が outboxDir() より前にあり、外れたら throw する", () => {
  const src = readFileSync(WIN_SIGN, 'utf8');
  const start = src.indexOf('async function signFile(');
  assert.ok(start >= 0, 'signFile がある');
  // 本文の終わり = 次の行頭の `}`（関数宣言の閉じ括弧）
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, 'signFile の本文の終わりが見つかる');
  const body = src.slice(start, end);
  const esStart = body.indexOf('// esigner\n');
  assert.ok(esStart >= 0, 'signFile に esigner の分岐の印（// esigner）がある');
  const es = body.slice(esStart);
  const outboxAt = [...es.matchAll(/outboxDir\(\)/g)].map((m) => m.index);
  assert.ok(outboxAt.length >= 1, 'esigner の分岐に outboxDir() がある');
  assert.equal([...body.slice(0, esStart).matchAll(/outboxDir\(\)/g)].length, 0, 'esigner の分岐より前に outboxDir() が無い');
  const signerAt = es.search(/signerIdentity\.checkSigner\(a, 'esigner'\)/);
  assert.ok(signerAt >= 0, "esigner の分岐が signerIdentity.checkSigner(a, 'esigner') を使う（C-3）");
  assert.ok(signerAt < Math.min(...outboxAt), "checkSigner(…, 'esigner') が outboxDir() より前");
  const between = es.slice(signerAt, Math.min(...outboxAt));
  assert.match(between, /if \(why != null\) \{\s*throw new Error/, '照合が外れたら throw する（outbox へ届かない）');
  assert.doesNotMatch(es, /checkSigner\([^)]*'artifact-signing'\)/, 'esigner の分岐で artifact-signing の期待値を使わない');
});

// ─────────────────────────────────────────────
// [D] t4/AC3: リポジトリのコードを実行しない規則の維持
// ─────────────────────────────────────────────
check('[D] publish-win-sign-cache の全 step が checkout・pnpm・setup-node を持たず、pnpm・npm・npx・node を実行しない', () => {
  assert.ok(steps.length >= 3, 'download・検査・upload の 3 step 以上');
  for (const st of steps) {
    const u = usesOf(st);
    assert.ok(!u.startsWith('actions/checkout@') && !u.startsWith('pnpm/') && !u.startsWith('actions/setup-node'),
      `checkout・依存の導入をしない: ${st.name ?? u}`);
    assert.ok(!/(^|[\s;&|(])(pnpm|npm|npx|node)\s/m.test(runOf(st)), `リポジトリのコードを実行しない: ${st.name ?? u}`);
  }
  assert.equal(job.permissions?.contents, 'write', 'contents: write は保つ');
});

// ─────────────────────────────────────────────
// [E] t4/AC3: 検査の正規表現と assetName の命名が食い違わない
// ─────────────────────────────────────────────
check('[E] 検査の正規表現は設計の固定値で、assetName の出力がそれに合う', () => {
  const m = runOf(checkStep).match(/^\s*re='([^']+)'\s*$/m);
  assert.ok(m, "検査の run: に re='…' の行がある");
  assert.equal(m[1], NAME_RE_SRC, '正規表現が設計（t4 §3.1）の固定値と同じ');
  const re = new RegExp(NAME_RE_SRC);
  // 名前の部分の上限 200 字（ファイル名の上限 255 バイトの方が先に効くため、fixture のファイルでは作れない ∴ 式で確かめる）
  assert.match(`${HEX}--${'n'.repeat(200)}.signed`, re, '名前の部分 200 字は合う');
  assert.doesNotMatch(`${HEX}--${'n'.repeat(201)}.signed`, re, '名前の部分 201 字は合わない');
  assert.doesNotMatch(`${HEX}--.signed`, re, '名前の部分 0 字は合わない');
  const require = createRequire(import.meta.url);
  const { assetName } = require(WIN_SIGN);
  const files = [
    'C:\\x\\ffmpeg.dll', '/x/ffmpeg.dll', '/w/resources/elevate.exe', '/w/index.win32-x64-msvc.node',
    '/w/libEGL.dll', '/w/MaplatEditor Setup__uninstaller.exe', '/w/日本語.dll', '/w/a b+c.dll', '/w/StdUtils.dll',
  ];
  for (const f of files) {
    const n = assetName(HEX, f);
    assert.match(n, re, `assetName('<64 hex>', ${JSON.stringify(f)}) = ${n} が検査の正規表現に合う`);
  }
});

if (work) rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} 件の検査が落ちた`);
  process.exit(1);
}
console.log('\nnov26-m7-t4 cache publish guard smoke: all passed');
