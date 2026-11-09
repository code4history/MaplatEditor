#!/usr/bin/env node
/** DMG の署名・公証・更新情報を、実署名や Apple への通信なしで検査する。 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { evalGhIf, evalGhIfBool } from './ci/eval-gh-if.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'dmg-signing-smoke-'));
// 秘密・署名設定・NODE_OPTIONS を引き継がず、dotenv の探索先も空の一時ディレクトリにする。
const safeEnv = { PATH: process.env.PATH, HOME: temp, TMPDIR: temp, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
if (process.platform === 'win32') safeEnv.SystemRoot = process.env.SystemRoot;
const child = (args, env = {}) => spawnSync(process.execPath, args, { cwd: temp, env: { ...safeEnv, ...env }, encoding: 'utf8' });
const sha = (body) => createHash('sha512').update(body).digest('base64');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const macNames = (ext) => ['arm64', 'x64'].map((arch) => `MaplatEditor-Mac-9.0.0-${arch}${ext}`);
let groups = 0;
let failures = 0;
async function check(name, fn) {
  groups++;
  try { await fn(); console.log(`OK ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
function makeMac(dir) {
  mkdirSync(dir, { recursive: true });
  const files = [...macNames('.zip'), ...macNames('.dmg')].map((url) => {
    const body = Buffer.from(`fixture:${url}\n`.repeat(500));
    writeFileSync(path.join(dir, url), body);
    return { url, sha512: sha(body), size: body.length };
  });
  const latest = { version: '9.0.0', files, path: files[0].url, sha512: files[0].sha512, releaseDate: '2026-10-01T00:00:00.000Z' };
  writeFileSync(path.join(dir, 'latest-mac.yml'), yaml.dump(latest, { lineWidth: -1 }));
  return latest;
}
const notarizeIf = "github.event_name == 'workflow_dispatch' && (inputs.mode == 'full' || (inputs.mode == 'sign-check' && inputs.notarize))";
const verifyIf = "env.MAC_SIGN == 'true' || (github.event_name == 'workflow_dispatch' && inputs.mode != '')";
const names = ['Build macOS', 'Notarize and staple the DMGs', 'Refresh latest-mac.yml for the stapled DMGs', 'Verify the DMGs', 'Upload macOS artifacts'];
function checkWorkflow(doc) {
  const job = doc.jobs['build-mac'];
  const steps = job.steps;
  const indices = names.map((name) => {
    assert.equal(steps.filter((step) => step.name === name).length, 1, `step の本数: ${name}`);
    return steps.findIndex((step) => step.name === name);
  });
  indices.slice(1).forEach((index, i) => assert.ok(index > indices[i], 'step の順序'));
  const [notarize, refresh, verify] = indices.slice(1, 4).map((i) => steps[i]);
  assert.equal(steps.find((step) => /notarization/.test(step.name)).if, notarizeIf);
  for (const step of [notarize, refresh]) assert.equal(step.if, notarizeIf);
  for (const step of [notarize, refresh, verify]) assert.doesNotMatch(step.name, /notarization/);
  assert.equal(notarize.run, 'node scripts/notarize/notarize.cjs --dmg release/${{ env.VERSION }}');
  assert.equal(refresh.run, 'node scripts/m6-t12/resign-update-metadata.mjs release/${{ env.VERSION }} --ext .dmg --yml latest-mac.yml');
  assert.equal(verify.if, verifyIf);
  assert.equal(verify.env.EXPECT, "${{ (inputs.mode == 'full' || (inputs.mode == 'sign-check' && inputs.notarize)) && 'notarized' || 'signed' }}");
  assert.equal(verify.run, 'node scripts/notarize/verify-dmg.mjs release/${{ env.VERSION }} --expect "$EXPECT"');
  assert.equal(job['timeout-minutes'], 120);
  const cases = [
    [{ github: { event_name: 'push' }, inputs: {} }, false, 'signed'],
    [{ github: { event_name: 'workflow_dispatch' }, inputs: { mode: 'verify', notarize: false } }, false, 'signed'],
    [{ github: { event_name: 'workflow_dispatch' }, inputs: { mode: 'verify', notarize: true } }, false, 'signed'],
    [{ github: { event_name: 'workflow_dispatch' }, inputs: { mode: 'sign-check', notarize: false } }, false, 'signed'],
    [{ github: { event_name: 'workflow_dispatch' }, inputs: { mode: 'sign-check', notarize: true } }, true, 'notarized'],
    [{ github: { event_name: 'workflow_dispatch' }, inputs: { mode: 'full', notarize: false } }, true, 'notarized'],
    [{ github: { event_name: 'workflow_dispatch' }, inputs: { mode: 'full', notarize: true } }, true, 'notarized'],
  ];
  const envStep = steps.find((step) => /notarization/.test(step.name));
  for (const [ctx, wantNotarize, wantExpect] of cases) {
    for (const step of [envStep, notarize, refresh]) {
      assert.equal(evalGhIfBool(step.if, ctx), wantNotarize, `${step.name}: ${JSON.stringify(ctx)}`);
    }
    assert.equal(evalGhIf(verify.env.EXPECT, ctx), wantExpect, `EXPECT: ${JSON.stringify(ctx)}`);
  }
}

// 拡張前の既定実行から採取した出力。git の参照や実装の写しに依存しない。
const windowsGolden = {
  "stdout": "blockmap 再生成: MaplatEditor-Windows-9.0.0-arm64-Setup.exe.blockmap (125 bytes)\nblockmap 再生成: MaplatEditor-Windows-9.0.0-x64-Setup.exe.blockmap (125 bytes)\nlatest.yml 更新: MaplatEditor-Windows-9.0.0-arm64-Setup.exe sha512/size/blockMapSize\nlatest.yml 更新: MaplatEditor-Windows-9.0.0-x64-Setup.exe sha512/size/blockMapSize\nlatest.yml を書き戻しました（files 2 件）\n",
  "files": {
    "MaplatEditor-Windows-9.0.0-arm64-Setup.exe.blockmap": "H4sIAAAAAAAC/6pWKkstKs7Mz1OyUjJS0lFKy8xJLVayiq5WykvMTVWyAgso6Sjlp6UVp5YoWRnoKCVnpCZnF5fmgpQpeXpkJVkUpAWYePsZFJiHReZbFASmlKZWKMXqKBVnVoHNMjI1NTCIrY2tBQQAAP//ys0mYW0AAAA=",
    "MaplatEditor-Windows-9.0.0-x64-Setup.exe.blockmap": "H4sIAAAAAAAC/6pWKkstKs7Mz1OyUjJS0lFKy8xJLVayiq5WykvMTVWyAgso6Sjlp6UVp5YoWRnoKCVnpCZnF5fmgpQpFeSHF5ZlFXgG5kaVm3n7JOuXlqWkGxmFKMXqKBVnVoHNMjIxNTCIrY2tBQQAAP//ITYc1m0AAAA=",
    "latest.yml": "dmVyc2lvbjogOS4wLjAKZmlsZXM6CiAgLSB1cmw6IE1hcGxhdEVkaXRvci1XaW5kb3dzLTkuMC4wLWFybTY0LVNldHVwLmV4ZQogICAgc2hhNTEyOiBLckk4MFU0RVhJRVpUMk5CK3UvclBmanNoRTlHL3c5eXN1TWdaUHFHWXBwdDlmNTRYTTJYSGFDR21Lb2xOSnFackw0RERUUmNuOEoybzFydFE4TnlEdz09CiAgICBzaXplOiAyNTUwMAogICAgYmxvY2tNYXBTaXplOiAxMjUKICAtIHVybDogTWFwbGF0RWRpdG9yLVdpbmRvd3MtOS4wLjAteDY0LVNldHVwLmV4ZQogICAgc2hhNTEyOiBoNzYxdGhyamRvdk9JbnQvTTdaWFB0cEJlYzEvMm5JNDhLeEN5aG9JRU82Y3Z0enR6TkMvcEdHdFdZY1QxZk1LVkZiTjJFNlc5Z21FTjlOZjJkTDlYQT09CiAgICBzaXplOiAyNDUwMAogICAgYmxvY2tNYXBTaXplOiAxMjUKcGF0aDogTWFwbGF0RWRpdG9yLVdpbmRvd3MtOS4wLjAtYXJtNjQtU2V0dXAuZXhlCnNoYTUxMjogS3JJODBVNEVYSUVaVDJOQit1L3JQZmpzaEU5Ry93OXlzdU1nWlBxR1lwcHQ5ZjU0WE0yWEhhQ0dtS29sTkpxWnJMNEREVFJjbjhKMm8xcnRROE55RHc9PQpyZWxlYXNlRGF0ZTogJzIwMjYtMTAtMDFUMDA6MDA6MDAuMDAwWicK"
  }
};

try {
  await check('[1] 署名設定の環境別判定', () => {
    for (const [env, expected] of [[{}, false], [{ MAC_SIGN: 'true' }, true], [{ APPLE_ID: 'fixture@example.invalid' }, true]]) {
      const result = child(['-e', `console.log(JSON.stringify(require(${JSON.stringify(path.join(root, 'electron-builder.config.cjs'))}).dmg.sign))`], env);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), String(expected));
    }
  });
  const workflow = yaml.load(read('.github/workflows/build.yml'));
  await check('[2] workflow の順序・条件・引数', () => checkWorkflow(workflow));
  await check('[3] workflow 検査自身の変異検査', () => {
    checkWorkflow(workflow);
    const mutations = [
      ...names.slice(1, 4).map((name) => (steps) => steps.splice(steps.findIndex((step) => step.name === name), 1)),
      (steps) => { const i = steps.findIndex((step) => step.name === names[1]); [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]]; },
      ...names.slice(1, 4).map((name) => (steps) => { delete steps.find((step) => step.name === name).if; }),
      (steps) => { steps.find((step) => step.name === names[3]).if = "env.MAC_SIGN == 'true'"; },
      (steps) => { steps.find((step) => step.name === names[3]).run = 'node scripts/notarize/verify-dmg.mjs release/${{ env.VERSION }} --expect signed'; },
      (steps) => { steps.find((step) => step.name === names[3]).env.EXPECT = 'signed'; },
      (steps) => { steps.find((step) => step.name === names[2]).run = 'node scripts/m6-t12/resign-update-metadata.mjs release/${{ env.VERSION }}'; },
      (steps) => { steps.find((step) => /notarization/.test(step.name)).if = "github.event_name == 'workflow_dispatch' && (inputs.mode == 'full' || inputs.mode == 'sign-check')"; },
      (steps) => { steps.find((step) => /notarization/.test(step.name)).if = "github.event_name == 'workflow_dispatch' && (inputs.mode == 'full' || inputs.notarize)"; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(workflow);
      mutate(copy.jobs['build-mac'].steps);
      assert.throws(() => checkWorkflow(copy));
    }
  });
  await check('[4] DMG 更新情報・zip の保存・Windows 既定出力の byte 一致', () => {
    const dir = path.join(temp, 'metadata-mac');
    const latest = makeMac(dir);
    const zipsBefore = latest.files.filter((entry) => entry.url.endsWith('.zip'));
    for (const entry of latest.files.filter((entry) => entry.url.endsWith('.dmg'))) { entry.sha512 = 'stale'; entry.size = 1; entry.blockMapSize = 1; }
    writeFileSync(path.join(dir, 'latest-mac.yml'), yaml.dump(latest, { lineWidth: -1 }));
    const run = child([path.join(root, 'scripts/m6-t12/resign-update-metadata.mjs'), dir, '--ext', '.dmg', '--yml', 'latest-mac.yml']);
    assert.equal(run.status, 0, run.stderr);
    const after = yaml.load(readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8'));
    assert.deepEqual(after.files.filter((entry) => entry.url.endsWith('.zip')), zipsBefore);
    assert.equal(after.sha512, latest.sha512);
    for (const entry of after.files.filter((entry) => entry.url.endsWith('.dmg'))) {
      const body = readFileSync(path.join(dir, entry.url));
      assert.equal(entry.sha512, sha(body));
      assert.equal(entry.size, body.length);
      assert.equal(entry.blockMapSize, readFileSync(path.join(dir, `${entry.url}.blockmap`)).length);
    }
    const winDir = path.join(temp, 'metadata-win');
    mkdirSync(winDir);
    const files = ['MaplatEditor-Windows-9.0.0-arm64-Setup.exe', 'MaplatEditor-Windows-9.0.0-x64-Setup.exe'];
    for (const file of files) writeFileSync(path.join(winDir, file), Buffer.from(`fixture:${file}\n`.repeat(500)));
    writeFileSync(path.join(winDir, 'latest.yml'), yaml.dump({ version: '9.0.0', files: files.map((url) => ({ url, sha512: 'stale', size: 1, blockMapSize: 1 })), path: files[0], sha512: 'stale', releaseDate: '2026-10-01T00:00:00.000Z' }, { lineWidth: -1 }));
    const win = child([path.join(root, 'scripts/m6-t12/resign-update-metadata.mjs'), winDir]);
    assert.equal(win.status, 0, win.stderr);
    assert.equal(win.stdout, windowsGolden.stdout);
    for (const [file, base64] of Object.entries(windowsGolden.files)) assert.deepEqual(readFileSync(path.join(winDir, file)), Buffer.from(base64, 'base64'), file);
  });
  await check('[5] 署名・staple・Gatekeeper 出力の判定表', async () => {
    const { judgeDmgOutputs } = await import('./notarize/verify-dmg.mjs');
    const ok = { codesignVerify: { status: 0, stderr: 'valid on disk\nsatisfies its Designated Requirement\n' }, codesignDisplay: { status: 0, stderr: 'Authority=Developer ID Application: Fixture (FIXTURE)\nAuthority=Developer ID Certification Authority\n' }, staplerValidate: { status: 0, stdout: 'The validate action worked!\n' }, spctl: { status: 0, stderr: 'fixture.dmg: accepted\nsource=Notarized Developer ID\n' } };
    for (const expect of ['signed', 'notarized']) assert.equal(judgeDmgOutputs(ok, expect).ok, true);
    const cases = [
      ['codesignVerify', { status: 1, stderr: 'code object is not signed at all' }, false],
      ['codesignDisplay', { status: 0, stderr: 'Authority=Apple Development: Fixture\nAuthority=Developer ID Application: Fixture\n' }, false],
      ['codesignDisplay', { status: 1, stderr: ok.codesignDisplay.stderr }, false],
      ['staplerValidate', { status: 1, stdout: 'The validate action worked!\n' }, true],
      ['staplerValidate', { status: 0, stdout: 'The validate action failed!\n' }, true],
      ['spctl', { status: 0, stderr: 'fixture.dmg: accepted\nsource=Unnotarized Developer ID\n' }, true],
      ['spctl', { status: 0, stderr: 'fixture.dmg: rejected\nsource=Notarized Developer ID\n' }, true],
      ['spctl', { status: 1, stderr: ok.spctl.stderr }, true],
    ];
    for (const [key, bad, signed] of cases) {
      const input = { ...ok, [key]: bad };
      assert.equal(judgeDmgOutputs(input, 'signed').ok, signed, key);
      assert.equal(judgeDmgOutputs(input, 'notarized').ok, false, key);
    }
    assert.throws(() => judgeDmgOutputs(ok, 'typo'));
  });
  await check('[6] 公証 CLI と afterSign の共通経路・失敗時の終了', () => {
    const script = path.join(root, 'scripts/notarize/notarize.cjs');
    const source = read('scripts/notarize/notarize.cjs');
    assert.doesNotMatch(source, /v2|tool:\s*['"]notarytool['"]|appBundleId,/);
    assert.equal(JSON.parse(read('package.json')).engines?.node, '>=22.12');
    const noCredentials = child([script, '--dmg', temp]);
    assert.equal(noCredentials.status, 1);
    assert.match(noCredentials.stderr, /APPLE_ID/);
    const validDir = path.join(temp, 'notarize-valid');
    makeMac(validDir);
    const prefix = `const assert=require('node:assert/strict'); const path=require('node:path'); const fs=require('node:fs'); const hooks=require(${JSON.stringify(script)}); const env={APPLE_ID:'fixture@example.invalid',APPLE_APP_SPECIFIC_PASSWORD:'fixture-password',APPLE_TEAM_ID:'FIXTURE'};`;
    const valid = child(['-e', prefix + `(async()=>{const calls=[];const deps={env,notarize:async(options)=>{assert.ok(path.isAbsolute(options.appPath));assert.ok(fs.existsSync(options.appPath));assert.deepEqual(Object.keys(options).sort(),['appPath','appleId','appleIdPassword','teamId']);calls.push(options);}};assert.equal(await hooks.runCli(['--dmg','notarize-valid'],deps),0);assert.equal(calls.length,2);const context={electronPlatformName:'darwin',appOutDir:'app-out',packager:{appInfo:{productFilename:'MaplatEditor',id:'jp.maplat.editor'}}};fs.mkdirSync('app-out/MaplatEditor.app',{recursive:true});await hooks.default(context,deps);assert.equal(calls.length,3);await hooks.default(context,{env:{},notarize:async()=>{throw Error('呼ばれない');}});await hooks.default({...context,electronPlatformName:'win32'},deps);assert.equal(calls.length,3);})().catch(e=>{console.error(e);process.exitCode=1;});`]);
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /公証: 完了しました（MaplatEditor-Mac-9\.0\.0-arm64\.dmg: \d+\.\ds）。/);
    assert.match(valid.stdout, /公証: 完了しました（MaplatEditor-Mac-9\.0\.0-x64\.dmg: \d+\.\ds）。/);
    assert.match(valid.stdout, /公証: 完了しました（app-out\/MaplatEditor\.app: \d+\.\ds）。/);
    for (const count of [0, 1, 3]) {
      const dir = path.join(temp, `notarize-count-${count}`);
      mkdirSync(dir);
      for (let i = 0; i < count; i++) writeFileSync(path.join(dir, `fixture-${i}.dmg`), 'fake');
      const run = child(['-e', prefix + `hooks.runCli(['--dmg',${JSON.stringify(dir)}],{env,notarize:async()=>{console.log('UNEXPECTED_CALL');}}).then(code=>{process.exitCode=code;});`]);
      assert.equal(run.status, 1);
      assert.doesNotMatch(run.stdout, /UNEXPECTED_CALL/);
    }
    const failed = child(['-e', prefix + `hooks.runCli(['--dmg','notarize-valid'],{env,notarize:async()=>{throw Error('提出失敗\\nDiagnostics from notarytool log:\\nfixture diagnostic');}}).then(code=>{process.exitCode=code;});`]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /提出失敗\nDiagnostics from notarytool log:\nfixture diagnostic/);
  });
  await check('[7] 実検査経路・更新情報の異常・zip 内 app の staple', async () => {
    const { verifyDmgs } = await import('./notarize/verify-dmg.mjs');
    const dir = path.join(temp, 'verify');
    const good = makeMac(dir);
    const original = readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8');
    const calls = [];
    const ok = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });
    const run = (command, args) => {
      calls.push([command, args]);
      if (command === 'codesign') {
        assert.deepEqual(args.slice(0, -1), args[0] === '--verify' ? ['--verify', '--strict', '--verbose=2'] : ['-dv', '--verbose=2']);
        return ok('', args[0] === '--verify' ? 'valid on disk' : 'Authority=Developer ID Application: Fixture\n');
      }
      if (command === 'spctl') { assert.deepEqual(args.slice(0, -1), ['-a', '-t', 'open', '--context', 'context:primary-signature', '-v']); return ok('', `${args.at(-1)}: accepted\nsource=Notarized Developer ID\n`); }
      if (command === 'ditto') { assert.deepEqual(args.slice(0, 2), ['-x', '-k']); assert.ok(path.isAbsolute(args[2])); mkdirSync(path.join(args[3], 'MaplatEditor.app')); return ok(); }
      if (command === 'xcrun') { assert.deepEqual(args.slice(0, 2), ['stapler', 'validate']); assert.ok(existsSync(args[2])); return ok('The validate action worked!\n'); }
      throw Error(`未定義の外部コマンド: ${command}`);
    };
    verifyDmgs(dir, { expect: 'signed', run });
    assert.equal(calls.length, 4);
    calls.length = 0;
    verifyDmgs(dir, { expect: 'notarized', run });
    assert.equal(calls.filter(([cmd]) => cmd === 'ditto').length, 2);
    assert.equal(calls.filter(([cmd, args]) => cmd === 'xcrun' && args[2].endsWith('.app')).length, 2);
    for (const [, args] of calls.filter(([cmd]) => cmd === 'ditto')) assert.equal(existsSync(args[3]), false, '展開先を後始末する');
    for (const change of [
      (doc) => { doc.files.find((x) => x.url.endsWith('.dmg')).sha512 = sha('broken'); },
      (doc) => { doc.files.find((x) => x.url.endsWith('.dmg')).size++; },
      (doc) => { doc.files = doc.files.filter((x) => !x.url.endsWith('x64.dmg')); },
      (doc) => { doc.files.push(doc.files.find((x) => x.url.endsWith('.dmg'))); },
      (doc) => { doc.files.find((x) => x.url.endsWith('.dmg')).url = '../outside.dmg'; },
    ]) {
      const altered = structuredClone(good); change(altered);
      writeFileSync(path.join(dir, 'latest-mac.yml'), yaml.dump(altered, { lineWidth: -1 }));
      assert.throws(() => verifyDmgs(dir, { expect: 'notarized', run }));
    }
    for (const badText of [original.replace('    size:', '    unsupported:'), `${original}files:\n`, original.replace(/(    sha512: [^\n]+)/, '$1\n$1'), original.replace('files:\n', 'files: &alias\n')]) {
      writeFileSync(path.join(dir, 'latest-mac.yml'), badText);
      assert.throws(() => verifyDmgs(dir, { expect: 'notarized', run }));
    }
    writeFileSync(path.join(dir, 'latest-mac.yml'), original);
    for (const fail of ['codesign', 'spctl', 'ditto', 'dmg-staple', 'app-staple', 'missing-app']) {
      assert.throws(() => verifyDmgs(dir, { expect: 'notarized', run: (cmd, args) => {
        if (cmd === fail || (cmd === 'xcrun' && ((fail === 'dmg-staple' && args[2].endsWith('.dmg')) || (fail === 'app-staple' && args[2].endsWith('.app'))))) return { status: 1, stderr: 'fixture failure' };
        if (cmd === 'ditto' && fail === 'missing-app') return ok();
        return run(cmd, args);
      } }));
    }
    for (const count of [0, 1, 3]) {
      const countDir = path.join(temp, `verify-count-${count}`); mkdirSync(countDir);
      for (let i = 0; i < count; i++) writeFileSync(path.join(countDir, `fixture-${i}.dmg`), 'fake');
      assert.throws(() => verifyDmgs(countDir, { expect: 'signed', run: () => { throw Error('呼ばれない'); } }));
    }
    for (const args of [[], [dir], [dir, '--expect', 'typo']]) {
      assert.equal(child([path.join(root, 'scripts/notarize/verify-dmg.mjs'), ...args]).status, 1);
    }
  });
  await check('[8] 配布手順の DMG 検査・焼き直し', () => {
    const docs = read('docs/release-signing.md');
    const partD = docs.split('## Part D:')[1].split('## Part E:')[0];
    const partF = docs.split('## Part F:')[1].split('## Part G:')[0];
    for (const command of ['codesign --verify --strict --verbose=2', 'stapler validate', 'primary-signature']) assert.ok(partD.includes(command));
    for (const text of ['Notarize and staple the DMGs', 'Verify the DMGs', '--failed', '30 日', '--clobber', '2 回', 'Diagnostics from notarytool log:']) assert.ok(partF.includes(text), text);
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(`DMG smoke: ${groups - failures}/${groups} 群成功`);
process.exitCode = failures ? 1 : 0;
