/**
 * nov26-m7-t3: 署名の資格情報の露出を狭める（eSigner の退路・署名専用ジョブの最小化）の受け入れ検査。
 *
 *   [1] t3/AC1: win-sign.cjs が読み込み時に ES_* を process.env から外す・CodeSignTool の起動の形
 *       （偽の java で引数と env を記録する）・pwsh の子の env・ログの伏せ字・Azure のクライアントシークレットを使わない
 *   [2] t3/AC2: secrets.ES_* を参照するのは eSigner の本番 step だけ・secrets.AZURE_* は署名専用ジョブ（と probe）の
 *       azure/login だけ・署名専用ジョブの permissions は { id-token: write } だけ（signing-job-rules.mjs の規則 1・5）
 *   [3] scripts/ci/eval-gh-if.mjs の自己検査
 *   [4] t3/AC4（eSigner 側 (ii)）: build-win の eSigner の step の if: を評価で断言する
 *   [5] 規則 11（署名の記録を job summary に表で書く）と、拒否語の穴 E1〜E4（NOV26-M7T2-B31-MIN2）の変異の自己検査
 *   [6] t3/AC3: docs/release-signing.md の残るリスク (a)〜(d)
 *
 * 実行: node scripts/nov26-m7-t3-credential-exposure-smoke.mjs（rtk を付けない）
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { evalGhIf, evalGhIfBool, isTruthy } from './ci/eval-gh-if.mjs';
import { checkSigningJob } from './win-sign/signing-job-rules.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WIN_SIGN = path.join(projectRoot, 'scripts/win-sign/win-sign.cjs');
const WORKFLOW = path.join(projectRoot, '.github/workflows/build.yml');
const PROBE = path.join(projectRoot, '.github/workflows/artifact-signing-probe.yml');
const DOC = path.join(projectRoot, 'docs/release-signing.md');
const ES_KEYS = ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET'];
const SIGN_JOBS = ['sign-win-payload', 'sign-win-uninstaller', 'sign-win-installer'];

const wf = yaml.load(readFileSync(WORKFLOW, 'utf8'));
const probe = yaml.load(readFileSync(PROBE, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const runOf = (st) => (typeof st?.run === 'string' ? st.run : '');
const usesOf = (st) => (typeof st?.uses === 'string' ? st.uses : '');

// 試験用の偽の資格情報は実行のたびに乱数で作る（資格情報らしい固定の値をソースにも履歴にも置かない。
// 秘密の検出器（GitGuardian）が直書きの値を秘密として拾うため）
const rnd = (n) => randomBytes(n).toString('hex');
const fakeCredentials = (prefix) => ({
  ES_USERNAME: `${prefix}u-${rnd(6)}`,
  // 記号を含める（引数・伏せ字の扱いで記号が壊れないことを見る）
  ES_PASSWORD: `${prefix}p-${rnd(6)}!#${rnd(3)}`,
  ES_CREDENTIAL_ID: `${prefix}c-${rnd(8)}`,
  ES_TOTP_SECRET: `${prefix}t-${rnd(8)}`,
});

// TMPDIR を尊重し、clone の外の一時ディレクトリに fixture を作る（/tmp を直接使わない）
const work = mkdtempSync(path.join(tmpdir(), 'nov26-m7-t3-'));

// ───────────────────────────────────────────────
// [1] t3/AC1
// ───────────────────────────────────────────────
{
  if (process.platform === 'win32') {
    console.log('  （[1] は POSIX の偽 java を使うため Windows では省略。CI の smoke は macOS で走る）');
  } else {
    // 値は他の文字列の部分にならない長さにする（伏せ字の検査で取り違えない）
    const creds = fakeCredentials('es-');
    // 純関数（buildCodeSignToolInvocation）へ直接渡す値。上の creds とは別に作る
    const fx = fakeCredentials('fx-');
    const fixedCreds = { username: fx.ES_USERNAME, password: fx.ES_PASSWORD, credentialId: fx.ES_CREDENTIAL_ID, totpSecret: fx.ES_TOTP_SECRET };
    // 偽の CodeSignTool: <dir>/jar/code_sign_tool-1.3.0.jar と、引数と env をファイルへ書く POSIX の java
    const tool = path.join(work, 'CodeSignTool');
    mkdirSync(path.join(tool, 'jar'), { recursive: true });
    writeFileSync(path.join(tool, 'jar', 'code_sign_tool-1.3.0.jar'), '');
    const fakeJava = path.join(work, 'fake-java');
    const outArgs = path.join(work, 'java-args.txt');
    const outEnv = path.join(work, 'java-env.txt');
    writeFileSync(fakeJava, [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > '${outArgs}'`,
      `env > '${outEnv}'`,
      // 実物の CodeSignTool は入力の引数をそのまま出すことがある。ログに値が出ないこと（redact）を確かめるため全部出す
      'echo "CodeSignTool (fake): $*"',
      'echo "Code signed successfully"',
      'exit 0',
      '',
    ].join('\n'));
    chmodSync(fakeJava, 0o755);
    const target = path.join(work, 'App.exe');
    writeFileSync(target, 'MZ');

    const child = `
      const ws = require(${JSON.stringify(WIN_SIGN)});
      const leaked = Object.keys(process.env).filter((k) => /^ES_/.test(k));
      const fixedCreds = ${JSON.stringify(fixedCreds)};
      const inv = ws.buildCodeSignToolInvocation(${JSON.stringify(target)}, { dir: '/d', jar: '/d/jar/x.jar', java: '/d/java' }, fixedCreds);
      const pwshEnv = ws.buildPwshEnv('/list.json');
      (async () => {
        await ws.runCodeSignTool(${JSON.stringify(target)});
        process.stdout.write('\\n@@RESULT@@' + JSON.stringify({ leaked, inv, pwshEnvKeys: Object.keys(pwshEnv), pwshList: pwshEnv.WIN_SIGN_LIST }) + '\\n');
      })().catch((e) => { console.error(e); process.exit(3); });
    `;
    const env = { ...process.env, ...creds, CODE_SIGN_TOOL_PATH: tool, CODESIGNTOOL_JAVA: fakeJava, WIN_SIGN_MODE: 'esigner' };
    const r = spawnSync(process.execPath, ['-e', child], { env, encoding: 'utf8', cwd: projectRoot, timeout: 120_000 });
    assert.equal(r.status, 0, `[1] 子プロセスが失敗した: ${r.stderr}\n${r.stdout}`);
    const at = r.stdout.lastIndexOf('@@RESULT@@');
    assert.ok(at >= 0, `[1] 子プロセスの結果が無い: ${r.stdout}`);
    const res = JSON.parse(r.stdout.slice(at + '@@RESULT@@'.length).trim());
    const logs = `${r.stdout.slice(0, at)}\n${r.stderr}`;

    // (a) 読み込みの直後の process.env に ES_* が無い
    assert.deepEqual(res.leaked, [], '[1](a) win-sign.cjs を読み込んだ後の process.env に ES_* が残る');

    // (b) 純関数の起動の形: CodeSignTool v1.3.0 は資格情報を環境変数で受け取れない（task-state の出典）∴ 引数で渡し、env には入れない
    const invEnvText = JSON.stringify(res.inv.env);
    for (const k of ES_KEYS) assert.ok(!(k in res.inv.env), `[1](b) 起動の env に ${k} がある`);
    for (const v of Object.values(fixedCreds)) {
      assert.ok(!invEnvText.includes(v), `[1](b) 起動の env に資格情報の値 ${v} がある`);
    }
    assert.equal(res.inv.command, '/d/java', '[1](b) 起動するのは同梱の java');
    assert.ok(res.inv.args.includes(`-username=${fixedCreds.username}`) && res.inv.args.includes(`-totp_secret=${fixedCreds.totpSecret}`),
      '[1](b) 引数で資格情報を渡す（環境変数で渡せないため）');
    assert.equal(res.inv.env.CODE_SIGN_TOOL_PATH, '/d', '[1](b) CODE_SIGN_TOOL_PATH を子へ渡す');

    // (c) 偽の java が記録した実際の起動: env に資格情報の名前も値も無い・引数は上の形
    const javaEnv = readFileSync(outEnv, 'utf8');
    const javaArgs = readFileSync(outArgs, 'utf8').split('\n');
    for (const k of ES_KEYS) assert.ok(!new RegExp(`^${k}=`, 'm').test(javaEnv), `[1](c) CodeSignTool の子の env に ${k} がある`);
    for (const v of Object.values(creds)) assert.ok(!javaEnv.includes(v), '[1](c) CodeSignTool の子の env に資格情報の値がある');
    assert.ok(javaArgs.includes(`-username=${creds.ES_USERNAME}`), '[1](c) 引数に -username');
    assert.ok(javaArgs.includes(`-password=${creds.ES_PASSWORD}`), '[1](c) 引数に -password');
    assert.ok(javaArgs.includes(`-credential_id=${creds.ES_CREDENTIAL_ID}`), '[1](c) 引数に -credential_id');
    assert.ok(javaArgs.includes(`-totp_secret=${creds.ES_TOTP_SECRET}`), '[1](c) 引数に -totp_secret');
    assert.ok(javaArgs.includes(`-input_file_path=${target}`), '[1](c) 引数に -input_file_path');

    // (d) pwsh（Authenticode）の子の env に ES_* が無い
    for (const k of ES_KEYS) assert.ok(!res.pwshEnvKeys.includes(k), `[1](d) pwsh の子の env に ${k} がある`);
    assert.equal(res.pwshList, '/list.json', '[1](d) pwsh の子へ WIN_SIGN_LIST を渡す');

    // (e) ログ（redact）に値が出ない（偽の java は引数をそのまま出している）
    assert.ok(logs.includes('CodeSignTool (fake)'), '[1](e) 偽の java の出力がログに無い（伏せ字の検査が空振りする）');
    for (const v of Object.values(creds)) assert.ok(!logs.includes(v), `[1](e) ログに資格情報の値が出ている: ${v.slice(0, 4)}…`);
    assert.ok(logs.includes('***'), '[1](e) 伏せ字 *** がログに無い');

    // (e2) 値が重なるとき（username が password の部分文字列）も残りを出さない（B41 MIN-1: 長い値から伏せる）
    // username を生成し、password はその username を接頭辞にして残り（tail）を足す
    const overlap = fakeCredentials('ovl-');
    const tail = `-TAIL!#${rnd(3)}`;
    overlap.ES_PASSWORD = `${overlap.ES_USERNAME}${tail}`;
    const child2 = `
      const ws = require(${JSON.stringify(WIN_SIGN)});
      ws.runCodeSignTool(${JSON.stringify(target)}).catch((e) => { console.error(e); process.exit(3); });
    `;
    const r2 = spawnSync(process.execPath, ['-e', child2], {
      env: { ...process.env, ...overlap, CODE_SIGN_TOOL_PATH: tool, CODESIGNTOOL_JAVA: fakeJava, WIN_SIGN_MODE: 'esigner' },
      encoding: 'utf8', cwd: projectRoot, timeout: 120_000,
    });
    assert.equal(r2.status, 0, `[1](e2) 子プロセスが失敗した: ${r2.stderr}\n${r2.stdout}`);
    const logs2 = `${r2.stdout}\n${r2.stderr}`;
    assert.ok(logs2.includes('CodeSignTool (fake)'), '[1](e2) 偽の java の出力がログに無い');
    assert.ok(!logs2.includes(tail), '[1](e2) 値が重なるとき password の残りがログに出ている（長い値から伏せていない）');
    for (const v of Object.values(overlap)) assert.ok(!logs2.includes(v), `[1](e2) ログに資格情報の値が出ている: ${v.slice(0, 4)}…`);
  }

  // (f) Azure の資格情報はクライアントシークレットを使わない（OIDC だけ）
  const NAME = ['AZURE', 'CLIENT', 'SECRET'].join('_'); // この smoke 自身が git grep に当たらないように組み立てる
  const g = spawnSync('git', ['grep', '-n', NAME], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(g.stdout.trim(), '', `[1](f) git grep -n ${NAME} が 0 件でない:\n${g.stdout}`);
  console.log('  [1/6] t3/AC1 資格情報の閉じ込め・起動の形・伏せ字: PASS');
}

// ───────────────────────────────────────────────
// [2] t3/AC2
// ───────────────────────────────────────────────
/** step（と job）の文字列から secrets.<名前> を拾う */
const secretNames = (v) => [...JSON.stringify(v ?? null).matchAll(/\bsecrets\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*\\?['"]([A-Za-z0-9_]+)\\?['"]\s*\])/g)].map((m) => m[1] ?? m[2]);

function checkSecretPlacement(workflow, { esignerStep, azureJobs }) {
  const v = [];
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    const { steps, ...rest } = job ?? {};
    for (const n of secretNames(rest)) {
      if (/^(ES_|AZURE_)/.test(n)) v.push(`${jobName}: ジョブレベルで secrets.${n} を参照している`);
    }
    (steps ?? []).forEach((st, i) => {
      const label = `${jobName}.steps[${i}]「${st?.name ?? ''}」`;
      for (const n of secretNames(st)) {
        if (n.startsWith('ES_') && !(jobName === esignerStep.job && st?.name === esignerStep.name)) {
          v.push(`${label}: eSigner の本番 step 以外が secrets.${n} を参照している`);
        }
        if (n.startsWith('AZURE_') && !(azureJobs.includes(jobName) && usesOf(st).startsWith('azure/login@'))) {
          v.push(`${label}: 署名専用ジョブの azure/login 以外が secrets.${n} を参照している`);
        }
      }
    });
  }
  return v;
}
const ESIGNER_STEP = { job: 'build-win', name: 'Build and sign Windows (SSL.com eSigner)' };
{
  const v = checkSecretPlacement(wf, { esignerStep: ESIGNER_STEP, azureJobs: SIGN_JOBS });
  v.push(...checkSecretPlacement(probe, { esignerStep: { job: '-', name: '-' }, azureJobs: ['probe-sign'] }));
  const esStep = (wf.jobs['build-win'].steps ?? []).find((st) => st.name === ESIGNER_STEP.name);
  assert.ok(esStep, '[2] eSigner の本番 step が無い');
  assert.deepEqual(secretNames(esStep).filter((n) => n.startsWith('ES_')).sort(), [...ES_KEYS].sort(), '[2] eSigner の本番 step が ES_* の 4 つを参照する');
  for (const name of SIGN_JOBS) {
    assert.deepEqual(wf.jobs[name]?.permissions, { 'id-token': 'write' }, `[2] ${name} の permissions が { id-token: write } だけでない`);
    for (const msg of checkSigningJob(name, wf.jobs[name])) v.push(msg);
  }
  assert.deepEqual(probe.jobs['probe-sign']?.permissions, { 'id-token': 'write' }, '[2] probe-sign の permissions が { id-token: write } だけでない');
  for (const msg of checkSigningJob('probe-sign', probe.jobs['probe-sign'])) v.push(msg);
  assert.deepEqual(v, [], `[2] 違反:\n${v.join('\n')}`);

  // 自己検査: 規則 1 が contents: read を戻した形を落とす・ES_ を他の step へ配ると落ちる
  const w1 = clone(wf);
  w1.jobs['sign-win-payload'].permissions = { contents: 'read', 'id-token': 'write' };
  assert.ok(checkSigningJob('sign-win-payload', w1.jobs['sign-win-payload']).some((m) => /permissions/.test(m)), '[2] 自己検査: contents: read を戻しても規則 1 が落とさない');
  const w2 = clone(wf);
  w2.jobs['build-win'].steps[0].env = { ...(w2.jobs['build-win'].steps[0].env ?? {}), X: '${{ secrets.ES_PASSWORD }}' };
  assert.ok(checkSecretPlacement(w2, { esignerStep: ESIGNER_STEP, azureJobs: SIGN_JOBS }).length > 0, '[2] 自己検査: ES_ を別の step へ配っても落ちない');
  const w3 = clone(wf);
  w3.jobs['build-win'].env = { ...(w3.jobs['build-win'].env ?? {}), X: '${{ secrets.AZURE_CLIENT_ID }}' };
  assert.ok(checkSecretPlacement(w3, { esignerStep: ESIGNER_STEP, azureJobs: SIGN_JOBS }).length > 0, '[2] 自己検査: AZURE_ をジョブレベルへ配っても落ちない');
  console.log('  [2/6] t3/AC2 secrets の置き場所・permissions: PASS');
}

// ───────────────────────────────────────────────
// [3] eval-gh-if.mjs の自己検査
// ───────────────────────────────────────────────
{
  const ctx = {
    github: { event_name: 'workflow_dispatch' },
    inputs: { mode: 'full', flag: true },
    needs: { prepare: { outputs: { win_sign_path: 'esigner' }, result: 'success' } },
  };
  const cases = [
    ["github.event_name == 'workflow_dispatch'", true],
    ["${{ github.event_name == 'workflow_dispatch' }}", true],
    ["github.event_name != 'workflow_dispatch'", false],
    ["inputs.mode == 'FULL'", true], // 文字列は大文字小文字を区別しない
    ["inputs.missing == ''", true], // null と '' は数へ寄せて 0 == 0
    ['inputs.missing == null', true],
    ["inputs.mode == 'full' && false", false],
    ["false || inputs.mode == 'full'", true],
    ["!(inputs.mode == 'full')", false],
    ["!inputs.missing", true],
    ["needs.prepare.result == 'success' && (needs.prepare.outputs.win_sign_path == 'esigner' || inputs.mode == 'x')", true],
    ["needs.prepare.outputs.none != ''", false],
    ["'it''s' == 'IT''S'", true],
    ['1 == true', true],
    ["'abc' == 0", false], // NaN は何とも等しくない
  ];
  for (const [expr, want] of cases) assert.equal(evalGhIfBool(expr, ctx), want, `[3] ${expr}`);
  assert.equal(evalGhIf("inputs.mode && 'x'", ctx), 'x', '[3] && は被演算子の値を返す');
  assert.equal(evalGhIf("inputs.missing || 'y'", ctx), 'y', '[3] || は被演算子の値を返す');
  assert.equal(isTruthy(Number.NaN), false, '[3] NaN は偽');
  for (const bad of [
    'always()', "contains(inputs.mode, 'f')", "steps.x.outputs.count != '0'", "env.VERSION == '1'",
    "secrets.ES_PASSWORD != ''", "inputs.mode == 'full' &&", "(inputs.mode == 'full'", '', "inputs.mode = 'full'",
    "${{ inputs.mode }} == 'full'",
  ]) {
    assert.throws(() => evalGhIf(bad, ctx), /eval-gh-if/, `[3] 受け付けない式を通した: ${bad}`);
  }
  console.log('  [3/6] eval-gh-if の自己検査: PASS');
}

// ───────────────────────────────────────────────
// [4] t3/AC4（eSigner 側 (ii)）
// ───────────────────────────────────────────────
const ESIGNER_STEP_NAMES = [
  'Set up SSL.com CodeSignTool',
  'Build and sign Windows (SSL.com eSigner)',
  'Verify Windows signatures (Authenticode)',
  'Verify Windows payload codec (signed build)',
  'Update auto-update metadata after signing',
];
function esignerIfViolations(workflow) {
  const v = [];
  const steps = workflow.jobs['build-win']?.steps ?? [];
  const ctxOf = (event, mode, pathName) => ({
    github: { event_name: event },
    inputs: event === 'workflow_dispatch' ? { mode, win_signer: pathName } : {},
    needs: { prepare: { outputs: { win_sign_path: pathName }, result: 'success' } },
  });
  for (const name of ESIGNER_STEP_NAMES) {
    const st = steps.find((s) => s.name === name);
    if (!st) { v.push(`build-win に「${name}」が無い`); continue; }
    if (typeof st.if !== 'string') { v.push(`「${name}」に if: が無い`); continue; }
    const expect = [
      [ctxOf('workflow_dispatch', 'full', 'esigner'), true, 'dispatch・full・esigner'],
      [ctxOf('workflow_dispatch', 'full', 'artifact-signing'), false, 'dispatch・full・artifact-signing'],
      [ctxOf('workflow_dispatch', 'sign-check', 'artifact-signing'), false, 'dispatch・sign-check'],
      [ctxOf('workflow_dispatch', 'sign-check', 'esigner'), false, 'dispatch・sign-check・esigner'],
      [ctxOf('workflow_dispatch', 'verify', 'none'), false, 'dispatch・verify'],
      [ctxOf('push', null, 'none'), false, 'push'],
    ];
    for (const [ctx, want, label] of expect) {
      let got;
      try { got = evalGhIfBool(st.if, ctx); } catch (e) { v.push(`「${name}」の if: が評価できない: ${e.message}`); break; }
      if (got !== want) v.push(`「${name}」の if: が ${label} で ${want ? '真' : '偽'}でない`);
    }
  }
  return v;
}
{
  const v = esignerIfViolations(wf);
  assert.deepEqual(v, [], `[4] 違反:\n${v.join('\n')}`);
  // 自己検査: 条件を足して偽にする・== を != にする・条件を外す、をそれぞれ落とす
  const muts = [
    ['&& false を足す', (s) => { s.if = `${s.if} && false`; }],
    ['esigner を artifact-signing にする', (s) => { s.if = s.if.replace("== 'esigner'", "== 'artifact-signing'"); }],
    ["mode == 'full' を外す", (s) => { s.if = s.if.replace(" && inputs.mode == 'full'", ''); }],
    ['event_name の == を != にする', (s) => { s.if = s.if.replace("github.event_name == 'workflow_dispatch'", "github.event_name != 'workflow_dispatch'"); }],
  ];
  for (const [label, mut] of muts) {
    const w = clone(wf);
    mut(w.jobs['build-win'].steps.find((s) => s.name === 'Build and sign Windows (SSL.com eSigner)'));
    assert.ok(esignerIfViolations(w).length > 0, `[4] 自己検査: 変異「${label}」を見逃した`);
  }
  console.log('  [4/6] t3/AC4 eSigner の step の if: の評価: PASS');
}

// ───────────────────────────────────────────────
// [5] 規則 11（job summary の表）と E1〜E4（NOV26-M7T2-B31-MIN2）
// ───────────────────────────────────────────────
{
  for (const name of SIGN_JOBS) {
    const rec = (wf.jobs[name].steps ?? []).find((st) => runOf(st).includes('signing-record.json'));
    assert.ok(rec, `[5] ${name} に署名の記録の step が無い`);
    assert.match(runOf(rec), /GITHUB_STEP_SUMMARY/, `[5] ${name} の署名の記録が job summary へ書かれない`);
    assert.match(runOf(rec), /\| in \(署名前 SHA-256\) \| out \(署名後 SHA-256\) \| status \|/, `[5] ${name} の job summary に記録の表の見出しが無い`);
  }

  const signIdx = (job) => job.steps.findIndex((st) => /\/dlib\b/.test(runOf(st)));
  const prepend = (job, i, text) => { job.steps[i].run = `${text}\n${runOf(job.steps[i])}`; };
  const injectStep = (job, at, run) => job.steps.splice(at, 0, { name: 'Injected', shell: 'pwsh', run });
  const mutations = [
    ['規則 11: 記録の step から job summary を消す', (job) => {
      const i = job.steps.findIndex((st) => runOf(st).includes('signing-record.json'));
      job.steps[i].run = runOf(job.steps[i]).split('\n').filter((l) => !l.includes('GITHUB_STEP_SUMMARY')).join('\n');
    }],
    ['E1: 署名の step で $env:SIGNTOOL を付け替える', (job) => prepend(job, signIdx(job), '$env:SIGNTOOL = (Get-ChildItem sign-in -Filter *.pe)[0].FullName')],
    ['E1: ${env:DLIB} を付け替える', (job) => prepend(job, signIdx(job), '${env:DLIB} = "sign-in\\x.pe"')],
    ['E1: Set-Item env:SIGNTOOL で付け替える', (job) => prepend(job, signIdx(job), 'Set-Item -Path env:SIGNTOOL -Value sign-in\\x.pe')],
    ['E1: SetEnvironmentVariable で付け替える', (job) => prepend(job, signIdx(job), "[Environment]::SetEnvironmentVariable('SIGNTOOL', 'sign-in\\x.pe')")],
    ['E1: 署名の step の env: で SIGNTOOL を上書きする', (job) => { job.steps[signIdx(job)].env = { SIGNTOOL: 'sign-in\\x.pe' }; }],
    ['E2: 別の step で GITHUB_ENV へ SIGNTOOL を書く', (job) => injectStep(job, signIdx(job), '"SIGNTOOL=$PWD\\sign-in\\x.pe" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8')],
    ['E2: 変数経由で GITHUB_ENV へ書く', (job) => injectStep(job, signIdx(job), '$t = $env:GITHUB_ENV\n$x | Out-File -FilePath $t -Append')],
    ['E2: GITHUB_PATH へ足す', (job) => injectStep(job, signIdx(job), '"$PWD\\sign-in" | Out-File -FilePath $env:GITHUB_PATH -Append')],
    ['E2: NuGet の step で GITHUB_ENV へ別の名前を書く', (job) => {
      const i = job.steps.findIndex((st) => /nuget\.org/i.test(runOf(st)));
      job.steps[i].run = `${runOf(job.steps[i])}\n"PATH=$PWD\\sign-in" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8`;
    }],
    ['E2: NuGet の step を 2 つにする', (job) => {
      const i = job.steps.findIndex((st) => /nuget\.org/i.test(runOf(st)));
      job.steps.splice(i + 1, 0, clone(job.steps[i]));
    }],
    // B41 MAJ-2: PowerShell の正規の書き方で抜けていた 5 通り（と、変数に改行を仕込む派生）
    ['E1: Set-Item -Path Env:\\SIGNTOOL（プロバイダーのパス）', (job) => prepend(job, signIdx(job), 'Set-Item -Path Env:\\SIGNTOOL -Value sign-in\\x.pe')],
    ['E1: Set-Item -LiteralPath "Env:/DLIB"', (job) => prepend(job, signIdx(job), 'Set-Item -LiteralPath "Env:/DLIB" -Value sign-in\\x.pe')],
    ['E1: バッククォートの継続行で $env:SIGNTOOL へ代入する', (job) => prepend(job, signIdx(job), '$env:SIGNTOOL `\n  = "sign-in\\x.pe"')],
    ['E2: 許可した形の値に `n で改行を入れて SIGNTOOL を書く', (job) => injectStep(job, signIdx(job), '"UNSIGNED_SHA256=x`nSIGNTOOL=C:\\evil.exe" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8')],
    ['E2: 許可した形の値に $([char]10) で改行を入れて SIGNTOOL を書く', (job) => injectStep(job, signIdx(job), '"UNSIGNED_SHA256=x$([char]10)SIGNTOOL=C:\\evil.exe" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8')],
    ['E2: 改行を仕込んだ変数を許可した形の値に入れる', (job) => injectStep(job, signIdx(job), '$sha = "x`nSIGNTOOL=C:\\evil.exe"\n"UNSIGNED_SHA256=$sha" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8')],
    ['E2: 継続行で GITHUB_ENV の行を割る（SIGNTOOL を書く）', (job) => injectStep(job, signIdx(job), '"SIGNTOOL=C:\\evil.exe" `\n  | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8')],
    ['E3: ドット・ソースで入力を読み込む', (job) => prepend(job, signIdx(job), '. .\\sign-in\\x.ps1')],
    ['E3: 行の途中のドット・ソース', (job) => prepend(job, signIdx(job), '$null; . (Join-Path sign-in x.ps1)')],
    ['E4: New-Object Diagnostics.Process', (job) => prepend(job, signIdx(job), '$p = New-Object Diagnostics.Process')],
    ['E4: New-Object -TypeName System.Diagnostics.Process', (job) => prepend(job, signIdx(job), '$p = New-Object -TypeName System.Diagnostics.Process')],
    ['E4: [Diagnostics.Process]::new()', (job) => prepend(job, signIdx(job), '$p = [System.Diagnostics.Process]::new()')],
  ];
  for (const [label, mut] of mutations) {
    for (const [name, job0] of [['sign-win-payload', wf.jobs['sign-win-payload']], ['probe-sign', probe.jobs['probe-sign']]]) {
      if (label.startsWith('規則 11') && name === 'probe-sign') continue; // 規則 11 は probe を除く
      const job = clone(job0);
      mut(job);
      assert.ok(checkSigningJob(name, job).length > 0, `[5] 自己検査: ${name} で変異「${label}」を見逃した`);
    }
  }
  console.log('  [5/6] 規則 11・E1〜E4 の変異: PASS');
}

// ───────────────────────────────────────────────
// [6] t3/AC3: 残るリスク
// ───────────────────────────────────────────────
{
  const doc = readFileSync(DOC, 'utf8');
  assert.match(doc, /残るリスク/, '[6] docs/release-signing.md に「残るリスク」が無い');
  const sec = doc.slice(doc.indexOf('残るリスク'));
  for (const m of ['(a)', '(b)', '(c)', '(d)']) assert.ok(sec.includes(m), `[6] 残るリスクに ${m} が無い`);
  assert.match(doc, /TOTP の作り直し/, '[6] B-5「TOTP の作り直し」が無い');
  assert.match(doc, /署名履歴の確かめ方/, '[6]「署名履歴の確かめ方」が無い');
  console.log('  [6/6] t3/AC3 文書: PASS');
}

console.log('\nnov26-m7-t3 credential exposure smoke: すべて成功');
