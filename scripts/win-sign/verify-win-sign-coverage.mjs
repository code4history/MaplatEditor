#!/usr/bin/env node
// Windows インストーラーの中の **すべての Windows PE** が署名の対象になったか（または Microsoft 署名済みか）を
// 機械照合する（2026-10-03・SAC 起動拒否への対処。署名の仕組みは scripts/win-sign/win-sign.cjs）。
//
// インストーラーを 7-Zip で展開し、$PLUGINSDIR/app-*.7z とアンインストーラー（NSIS）の中まで再帰的に開いて、
// 拡張子ではなく中身（MZ + PE ヘッダー）で PE を数える。
//
// 2 つの照合方式:
//   --record <jsonl>（record モードのビルド。課金ゼロ・どの OS でも可）:
//       各 PE の SHA-256 が署名フックの記録（would-sign / signed / cache-hit / skip-already-signed）に
//       あること。skip-already-signed は埋め込み署名の証明書に Microsoft Corporation があること（openssl）。
//       記録に無い PE は「漏れ」。
//   --authenticode（esigner モードのビルド。Windows のみ）:
//       各 PE の Get-AuthenticodeSignature が Valid で、署名者が WIN_SIGN_EXPECTED_CN（既定 NAYUTA, INC.）
//       か Microsoft Corporation であること。
//
// 実行:
//   node scripts/win-sign/verify-win-sign-coverage.mjs --record <jsonl> [--summary <json>] <installer.exe> …
//   node scripts/win-sign/verify-win-sign-coverage.mjs --authenticode [--summary <json>] <installer.exe> …
// 環境変数: WIN_SIGN_7Z … 7-Zip 実行ファイルを明示する（省略時は PATH と既定の導入先を探す）
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { readPeInfo, extractPkcs7, subjectHasCn } = require('./win-sign.cjs');

const die = (msg) => {
  console.error(`win-sign coverage: ${msg}`);
  process.exit(1);
};

// ── 引数 ──
const argv = process.argv.slice(2);
let recordPath = null;
let authenticodeMode = false;
let summaryPath = null;
const installers = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--record') recordPath = argv[++i];
  else if (argv[i] === '--authenticode') authenticodeMode = true;
  else if (argv[i] === '--summary') summaryPath = argv[++i];
  else installers.push(argv[i]);
}
if (installers.length === 0) die('インストーラーを 1 つ以上指定してください');
if ((recordPath == null) === !authenticodeMode) die('--record <jsonl> と --authenticode のどちらか一方を指定してください');
for (const f of installers) if (!existsSync(f)) die(`インストーラーが存在しない: ${f}`);

// ── 7-Zip（無ければ失敗。スキップしない） ──
function resolve7z() {
  const candidates = [process.env.WIN_SIGN_7Z, '7z', '7zz', '7za', 'C:\\Program Files\\7-Zip\\7z.exe'].filter(Boolean);
  for (const cmd of candidates) {
    const r = spawnSync(cmd, [], { encoding: 'utf8' });
    if (r.error == null) return cmd;
  }
  return null;
}
const SEVEN = resolve7z();
if (SEVEN == null) die('7-Zip が見つからない（WIN_SIGN_7Z で指定できる）');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const isNsis = (buf) => buf.includes(Buffer.from('NullsoftInst'));

function extract(archive, outDir) {
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(SEVEN, ['x', '-y', `-o${outDir}`, archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) die(`展開に失敗: ${archive}\n${r.stdout}\n${r.stderr}`);
}

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let containerSeq = 0; // 展開先の通し番号（インストーラーをまたいで重ならない）

/** インストーラーの中の PE を全部集める（入れ子の 7z と NSIS も開く）。 */
function collectPes(installer, workRoot) {
  const pes = [];
  const seenContainers = new Set(); // 中身が同じ入れ子（x64/arm64 で同じアンインストーラー等）は 1 回だけ開く
  const visit = (file, displayPath, depth) => {
    const buf = readFileSync(file);
    const pe = readPeInfo(buf);
    if (pe != null) pes.push({ display: displayPath, file, buf, pe });
    if (depth > 4) return;
    const lower = file.toLowerCase();
    const openable = lower.endsWith('.7z') || (pe != null && isNsis(buf));
    if (!openable) return;
    const key = sha256(buf);
    if (seenContainers.has(key)) return;
    seenContainers.add(key);
    const outDir = path.join(workRoot, `x${++containerSeq}-${path.basename(file).replace(/[^A-Za-z0-9._-]/g, '_')}`);
    extract(file, outDir);
    for (const child of walk(outDir)) {
      visit(child, `${displayPath}!/${path.relative(outDir, child).split(path.sep).join('/')}`, depth + 1);
    }
  };
  visit(path.resolve(installer), path.basename(installer), 0);
  return pes;
}

// ── 署名者（埋め込み PKCS#7 の証明書。openssl で読む） ──
function embeddedSubjects(buf, workRoot) {
  const p7 = extractPkcs7(buf);
  if (p7 == null) return [];
  const f = path.join(workRoot, `sig-${sha256(p7).slice(0, 16)}.p7b`);
  writeFileSync(f, p7);
  const r = spawnSync('openssl', ['pkcs7', '-inform', 'DER', '-in', f, '-print_certs', '-noout'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter((l) => l.startsWith('subject=')).map((l) => l.slice('subject='.length).trim());
}
const isMicrosoftSubject = (s) => /O\s*=\s*"?Microsoft Corporation\b/.test(s);

function authenticodeMany(files) {
  const script = "$ErrorActionPreference='Stop'; $files = Get-Content -LiteralPath $env:WIN_SIGN_LIST | ConvertFrom-Json; "
    + "$files | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{ file = $_; status = [string]$s.Status; "
    + "subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null } } } | ConvertTo-Json -Compress -Depth 3";
  const listFile = path.join(tmpdir(), `win-sign-list-${process.pid}.json`);
  writeFileSync(listFile, JSON.stringify(files));
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WIN_SIGN_LIST: listFile }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) die(`Get-AuthenticodeSignature が失敗: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout.trim() || '[]');
  return new Map((Array.isArray(parsed) ? parsed : [parsed]).map((e) => [e.file, e]));
}

// ── 照合 ──
const COVERED = new Set(['would-sign', 'signed', 'cache-hit', 'skip-already-signed']);
const recordBySha = new Map();
let recordEntries = [];
if (recordPath != null) {
  if (!existsSync(recordPath)) die(`記録ファイルが無い: ${recordPath}`);
  recordEntries = readFileSync(recordPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const e of recordEntries) {
    if (!recordBySha.has(e.sha256)) recordBySha.set(e.sha256, []);
    recordBySha.get(e.sha256).push(e);
  }
}

const workRoot = mkdtempSync(path.join(tmpdir(), 'win-sign-coverage-'));
const expectedCn = process.env.WIN_SIGN_EXPECTED_CN || 'NAYUTA, INC.';
const failures = [];
const summary = { installers: [], workRoot };

for (const installer of installers) {
  const pes = collectPes(installer, workRoot);
  const rows = [];
  const acMap = authenticodeMode ? authenticodeMany(pes.map((p) => p.file)) : null;
  for (const p of pes) {
    const sha = sha256(p.buf);
    let status;
    let detail = '';
    if (authenticodeMode) {
      const a = acMap.get(p.file);
      const okSigner = a && (subjectHasCn(a.subject, expectedCn) || isMicrosoftSubject(a.subject ?? ''));
      status = a && a.status === 'Valid' && okSigner ? 'ok' : 'FAIL';
      detail = a ? `${a.status} ${a.subject ?? ''}` : 'no result';
    } else {
      const hits = (recordBySha.get(sha) ?? []).filter((e) => COVERED.has(e.decision));
      if (hits.length > 0) {
        const decisions = [...new Set(hits.map((e) => e.decision))];
        detail = decisions.join('+');
        status = 'ok';
        if (decisions.length === 1 && decisions[0] === 'skip-already-signed') {
          const subjects = embeddedSubjects(p.buf, workRoot);
          if (!subjects.some(isMicrosoftSubject)) {
            status = 'FAIL';
            detail += `（署名者が Microsoft でない: ${subjects.join(' | ') || '読めない'}）`;
          } else detail += '（Microsoft 署名済み）';
        }
      } else if (p.pe.hasCert && embeddedSubjects(p.buf, workRoot).some(isMicrosoftSubject)) {
        status = 'ok';
        detail = 'フックを通らないが Microsoft 署名済み';
      } else {
        status = 'FAIL';
        detail = '署名フックに渡っていない（漏れ）';
      }
    }
    rows.push({ path: p.display, sha256: sha, status, detail });
    if (status !== 'ok') failures.push(`${p.display}: ${detail}`);
  }
  summary.installers.push({ installer: path.basename(installer), peCount: rows.length, rows });
  console.log(`\n== ${path.basename(installer)}（PE ${rows.length} 個）`);
  for (const r of rows) console.log(`  [${r.status}] ${r.path} — ${r.detail}`);
}

if (recordPath != null) {
  const count = (d) => recordEntries.filter((e) => e.decision === d).length;
  summary.record = {
    wouldSign: count('would-sign'), signed: count('signed'), cacheHit: count('cache-hit'),
    skipAlreadySigned: count('skip-already-signed'), skipNotPe: count('skip-not-pe'),
  };
  console.log(`\n記録: 署名 ${summary.record.wouldSign + summary.record.signed} 回`
    + `（would-sign ${summary.record.wouldSign} / signed ${summary.record.signed}）・キャッシュ ${summary.record.cacheHit}`
    + `・署名済みで省略 ${summary.record.skipAlreadySigned}・PE でない ${summary.record.skipNotPe}`);
}
if (summaryPath) writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  console.error(`\nwin-sign coverage: ${failures.length} 件の PE が署名されない`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nwin-sign coverage: すべての Windows PE が署名対象（または Microsoft 署名済み）');
