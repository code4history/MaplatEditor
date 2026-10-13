#!/usr/bin/env node
// nov26-m7-t2（§3.10・マイルストーン設計 §9.3 の機械の行）: 署名済みの x64 Setup.exe を runner に入れ、
// 入った全 PE の署名を確かめ、アプリを起動して生きていることを確かめ、アンインストールして消えたことを確かめる。
// build.yml の verify-win-install ジョブ（id-token を持たない）だけが実行する。依存を入れずに Node 組み込みと pwsh で動く。
//
//   1. Setup.exe /S を起動し終了を待つ（300 秒）
//   2. インストール先（既定 %LOCALAPPDATA%\Programs\MaplatEditor）の全 PE（拡張子でなく MZ＋PE\0\0 で判定）の
//      Authenticode が Valid で、署名者が signer-identity.json の --signer のモードか Microsoft
//   3. MaplatEditor.exe --user-data-dir=<RUNNER_TEMP の下> を起動し、10 秒後にプロセスが生きていることを確かめて終了させる
//   4. Uninstall MaplatEditor.exe /S を起動し、インストール先の MaplatEditor.exe が消えるまで最大 120 秒待つ
//   5. 結果を JSON で job summary（GITHUB_STEP_SUMMARY）と標準出力に出す
//
// 実行: node scripts/win-sign/verify-win-install.mjs --installer <x64-Setup.exe> --signer artifact-signing [--install-dir <dir>]
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { readPeInfo } = require('./win-sign.cjs');
const { checkSigner, isMicrosoftSubject, authenticodeFiles } = require('./signer-identity.cjs');

/** dir の下の全 PE（拡張子でなく中身で判定） */
export function listPes(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && readPeInfo(readFileSync(p)) != null) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * @param {Map<string, {status: string, subject: string|null, chain: object[]}>} results
 * @returns {Array<{file: string, ok: boolean, detail: string}>}
 */
export function judgeSigners(results, signer, identity) {
  return [...results.entries()].map(([file, a]) => {
    let why = null;
    if (!a || a.status !== 'Valid') why = `Authenticode が ${a?.status ?? '結果なし'}`;
    else if (!isMicrosoftSubject(a.subject)) why = checkSigner(a, signer, identity);
    return { file, ok: why == null, detail: why ?? (a.subject ?? '') };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, '')] = argv[++i];
  if (!opt.installer || !opt.signer) throw new Error('--installer <Setup.exe> と --signer <mode> が要る');
  if (process.platform !== 'win32') throw new Error('Windows でしか実行できない（インストールと Authenticode）');
  const installer = path.resolve(opt.installer);
  if (!existsSync(installer)) throw new Error(`インストーラーが無い: ${installer}`);
  const installDir = path.resolve(opt['install-dir'] ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Programs', 'MaplatEditor'));
  const appExe = path.join(installDir, 'MaplatEditor.exe');
  const result = { installer: path.basename(installer), installDir, steps: {} };
  const failures = [];

  // 1. インストール
  const ins = spawnSync(installer, ['/S'], { timeout: 300_000, windowsHide: true });
  result.steps.install = { status: ins.status, error: ins.error?.message ?? null };
  if (ins.error || ins.status !== 0) throw new Error(`インストーラーが失敗した（status ${ins.status}・${ins.error?.message ?? ''}）`);
  for (let i = 0; i < 60 && !existsSync(appExe); i++) await sleep(1000);
  if (!existsSync(appExe)) throw new Error(`インストール先に MaplatEditor.exe が無い: ${appExe}`);

  // 2. 署名
  const pes = listPes(installDir);
  const rows = judgeSigners(authenticodeFiles(pes), opt.signer);
  result.steps.signatures = { peCount: pes.length, rows: rows.map((r) => ({ ...r, file: path.relative(installDir, r.file) })) };
  for (const r of rows) if (!r.ok) failures.push(`署名: ${path.relative(installDir, r.file)} — ${r.detail}`);
  if (pes.length === 0) failures.push('インストール先に PE が無い');

  // 3. 起動して 10 秒生きている
  const profile = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'maplat-verify-win-install-profile');
  mkdirSync(profile, { recursive: true });
  const child = spawn(appExe, [`--user-data-dir=${profile}`], { stdio: 'ignore', windowsHide: false });
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  child.on('error', (e) => { exited = { error: e.message }; });
  await sleep(10_000);
  result.steps.launch = { aliveAfter10s: exited == null, exited };
  if (exited != null) failures.push(`起動: 10 秒以内に終了した（${JSON.stringify(exited)}）`);
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  for (let i = 0; i < 20 && exited == null; i++) await sleep(500);

  // 4. アンインストール（NSIS のアンインストーラーは自分を一時ディレクトリへ複写して起動し直すので、終了を待たず消えるのを待つ）
  const uninstaller = path.join(installDir, 'Uninstall MaplatEditor.exe');
  if (!existsSync(uninstaller)) {
    failures.push(`アンインストーラーが無い: ${uninstaller}`);
  } else {
    const un = spawnSync(uninstaller, ['/S'], { timeout: 120_000, windowsHide: true });
    let gone = false;
    for (let i = 0; i < 120 && !(gone = !existsSync(appExe)); i++) await sleep(1000);
    result.steps.uninstall = { status: un.status, gone };
    if (!gone) failures.push(`アンインストール: 120 秒待っても ${appExe} が残っている`);
  }

  result.failures = failures;
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## verify-win-install\n\n\`\`\`json\n${json}\n\`\`\`\n`);
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`::error::${f}`);
    process.exit(1);
  }
  console.log('verify-win-install: 入れて・署名を確かめて・起動して・消せた');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`::error::verify-win-install: ${e.message}`);
    process.exit(1);
  });
}
