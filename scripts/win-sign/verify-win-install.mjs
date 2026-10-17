#!/usr/bin/env node
// nov26-m7-t2（§3.10・マイルストーン設計 §9.3 の機械の行）: 署名済みの x64 Setup.exe を runner に入れ、
// 入った全 PE の署名を確かめ、アプリを起動して生きていることを確かめ、アンインストールして消えたことを確かめる。
// build.yml の verify-win-install ジョブ（id-token を持たない）だけが実行する。依存を入れずに Node 組み込みと pwsh で動く。
//
//   1. Setup.exe /S を起動し終了を待つ（300 秒）
//   2. インストール先（既定 %LOCALAPPDATA%\Programs\MaplatEditor）の全 PE（拡張子でなく MZ＋PE\0\0 で判定）の
//      Authenticode が Valid で、署名者が signer-identity.json の --signer のモードか Microsoft
//   3. MaplatEditor.exe --user-data-dir=<RUNNER_TEMP の下> を起動し、10 秒後にプロセスが生きていることを確かめて終了させる
//   2b. （nov26-m7-t5・§3.6）入った resources/app-update.yml の publisherName が signer-identity.json の
//      --signer の publisherSubject と文字列として一致し、インストールに使った Setup.exe（＝更新のときに electron-updater が
//      照らすファイル）の生の SignerCertificate.Subject とも文字列として一致し、electron-updater の判定の写し
//      （updater-publisher-match.cjs の matchesPublisher）で真。Subject は electron-updater と同じコマンド
//      （set "PSModulePath=" & chcp 65001 >NUL & powershell.exe … Get-AuthenticodeSignature | ConvertTo-Json -Compress）で取る
//      （R2-INFO-3: 取得経路の違いを疑う余地を消す）。正規化した値どうしでは比べない（S と ST の食い違いを見逃すため）
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
const { matchesPublisher } = require('./updater-publisher-match.cjs');

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

// ───────────────────────────────────────────────
// app-update.yml の publisherName（nov26-m7-t5・§3.6）
// ───────────────────────────────────────────────

/** js-yaml の dump が書く 1 つのスカラー（素・'…'・"…"）を読む。依存を入れないジョブで使うための最小の読み取り */
function readYamlScalar(text) {
  const t = text.trim();
  if (t.startsWith("'")) {
    if (!t.endsWith("'") || t.length < 2) throw new Error(`引用符が閉じていない: ${t}`);
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t.startsWith('"')) return JSON.parse(t);
  return t;
}

/**
 * app-update.yml（electron-builder の serializeToYaml＝js-yaml の dump の出力）から publisherName を読む。
 * 無ければ null。1 つの文字列なら長さ 1 の配列にする（electron-updater と同じ扱い）
 * @returns {string[] | null}
 */
export function readPublisherNames(yml) {
  const lines = String(yml).split(/\r?\n/);
  const i = lines.findIndex((l) => /^publisherName:/.test(l));
  if (i < 0) return null;
  const inline = lines[i].slice('publisherName:'.length).trim();
  if (inline !== '') {
    if (inline === 'null' || inline === '~') return null;
    if (inline.startsWith('[')) throw new Error(`publisherName の flow 形式は読まない: ${inline}`);
    return [readYamlScalar(inline)];
  }
  const out = [];
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^\s+- (.*)$/);
    if (!m) break;
    out.push(readYamlScalar(m[1]));
  }
  return out;
}

/**
 * @param {{appUpdateYml: string|null, subject: string|null, identity: object, signer: string}} input
 *   subject は Setup.exe の Get-AuthenticodeSignature の SignerCertificate.Subject（生の文字列）
 * @returns {{publisherName: string[]|null, publisherSubject: string|null, subject: string|null, failures: string[]}}
 */
export function judgeAppUpdatePublisher({ appUpdateYml, subject, identity, signer }) {
  const failures = [];
  const publisherSubject = identity?.[signer]?.publisherSubject ?? null;
  let publisherName = null;
  if (appUpdateYml == null) {
    failures.push('app-update.yml が無い（electron-updater は publisherName を照らさずに通す）');
  } else {
    try {
      publisherName = readPublisherNames(appUpdateYml);
    } catch (e) {
      failures.push(`app-update.yml の publisherName が読めない（${e.message}）`);
    }
    if (publisherName == null && failures.length === 0) {
      failures.push('app-update.yml に publisherName が無い（electron-updater は署名者を照らさずに通す）');
    }
  }
  if (typeof publisherSubject !== 'string' || publisherSubject === '') {
    failures.push(`signer-identity.json の ${signer}.publisherSubject が空`);
  }
  if (publisherName != null) {
    if (publisherName.length === 0) failures.push('publisherName が空の配列');
    for (const n of publisherName) {
      if (n !== publisherSubject) failures.push(`publisherName の要素が ${signer}.publisherSubject と文字列として一致しない（${JSON.stringify(n)}）`);
    }
  }
  if (typeof subject !== 'string' || subject === '') {
    failures.push('Setup.exe の SignerCertificate.Subject が取れない');
  } else if (publisherName != null && publisherName.length > 0) {
    if (publisherName[0] !== subject) failures.push('publisherName[0] が Setup.exe の Subject と文字列として一致しない');
    let ok = false;
    try {
      ok = matchesPublisher(publisherName, subject);
    } catch (e) {
      failures.push(`matchesPublisher が失敗した（${e.message}）`);
    }
    if (!ok) failures.push('electron-updater の判定（matchesPublisher）で publisherName が Setup.exe の Subject に一致しない');
  }
  return { publisherName, publisherSubject, subject: subject ?? null, failures };
}

/** electron-updater 6.8.10（windowsExecutableCodeSignatureVerifier.js 14・47 行）と同じコマンドで Subject を取る */
function updaterStyleSubject(file) {
  const literal = file.replace(/'/g, "''");
  const r = spawnSync('set "PSModulePath=" & chcp 65001 >NUL & powershell.exe',
    ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-Command', `"Get-AuthenticodeSignature -LiteralPath '${literal}' | ConvertTo-Json -Compress"`],
    { shell: true, timeout: 20_000, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0 || r.stderr) {
    throw new Error(`Get-AuthenticodeSignature が失敗した（status ${r.status}・${r.error?.message ?? ''}・${(r.stderr ?? '').trim()}）`);
  }
  const data = JSON.parse(r.stdout);
  return { status: data.Status, subject: data.SignerCertificate?.Subject ?? null };
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

  // 2b. app-update.yml の publisherName と、インストールに使った Setup.exe の生の Subject（nov26-m7-t5・§3.6）
  {
    const ymlPath = path.join(installDir, 'resources', 'app-update.yml');
    const appUpdateYml = existsSync(ymlPath) ? readFileSync(ymlPath, 'utf8') : null;
    let subject = null;
    let subjectError = null;
    try {
      ({ subject } = updaterStyleSubject(installer));
    } catch (e) {
      subjectError = e.message;
    }
    const identity = JSON.parse(readFileSync(new URL('./signer-identity.json', import.meta.url), 'utf8'));
    const judged = judgeAppUpdatePublisher({ appUpdateYml, subject, identity, signer: opt.signer });
    result.steps.appUpdatePublisher = { ...judged, subjectError };
    for (const f of judged.failures) failures.push(`app-update.yml: ${f}`);
    if (subjectError) failures.push(`app-update.yml: ${subjectError}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const cell = (v) => `\`${String(v ?? '(無し)').replace(/`/g, "'")}\``;
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        '## app-update.yml の publisherName と Setup.exe の Subject（生の文字列）', '',
        '| 項目 | 値 |', '|---|---|',
        `| app-update.yml の publisherName[0] | ${cell(judged.publisherName?.[0])} |`,
        `| Setup.exe の SignerCertificate.Subject | ${cell(subject)} |`,
        `| signer-identity.json の ${opt.signer}.publisherSubject | ${cell(judged.publisherSubject)} |`,
        `| 判定 | ${judged.failures.length === 0 && !subjectError ? '一致' : '不一致'} |`, '', '',
      ].join('\n'));
    }
  }

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
