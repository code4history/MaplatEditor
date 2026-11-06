#!/usr/bin/env node
// 署名した PE の集合と配布物の中身の突き合わせ。build.yml の verify-win-install（x64 の脚・id-token を持たない・依存を入れない）
// が実行する。Node の組み込みと、ランナーの画像にある 7-Zip だけを使う。
//
//   S（署名した集合）= 署名専用ジョブ 3 つの signing-record.json の out（署名後の SHA-256）の和集合。
//                     全件 status: Valid・件数 1 以上・in と out が 64 桁の hex・uninstaller と installer の記録はちょうど 2 件
//   D（配布物の集合）= Setup.exe そのものの SHA-256 と、Setup.exe を 7-Zip で展開し、中の *.7z（アプリの書庫）をさらに
//                     展開して得た全 PE（拡張子でなく中身で判定。verify-win-install.mjs の listPes）の SHA-256
//   判定 A: S \ D が空（署名したのに配布物に無い PE が 1 件でもあれば赤 ＝ 配布物の外で使える署名済みの PE が作られた）
//   判定 B: D の PE のうち、Authenticode の署名者が Microsoft でないものはすべて S にある（依存なしの網羅。--no-authenticode で飛ばす）
//   「署名した集合と配布物の差が 0」は A・B の両方が緑であること。Microsoft 署名の PE（d3dcompiler_47.dll・dxil.dll）は S に入らないので、
//   素の D \ S は 0 にならない
//
// 実行:
//   node scripts/win-sign/verify-win-sign-set.mjs --records payload=<json> uninstaller=<json> installer=<json>
//     --installers <x64-Setup.exe> <arm64-Setup.exe> [--signer artifact-signing] [--sevenzip <7z の path>] [--work <dir>]
//     [--summary <json>] [--no-authenticode]
//   --records の値は <役>=<path> か <path>（役が無ければ件数は見ない）。--sevenzip の既定は C:\Program Files\7-Zip\7z.exe。
//   出力は JSON（標準出力・GITHUB_STEP_SUMMARY・--summary）。赤なら exit 1
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listPes } from './verify-win-install.mjs';

const require = createRequire(import.meta.url);
const { isMicrosoftSubject, authenticodeFiles } = require('./signer-identity.cjs');

const SHA256_RE = /^[0-9a-f]{64}$/;
const EXACT_TWO = new Set(['uninstaller', 'installer']);
const DEFAULT_SEVENZIP = 'C:\\Program Files\\7-Zip\\7z.exe';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * 純粋な判定（集合の比較）。展開と Authenticode の読み取りは main が行う。
 * @param {{ records: Array<{ role: string|null, file: string, entries: Array<{ in: string, out: string, status: string, subject?: string|null }> }>,
 *           distribution: Array<{ file: string, sha256: string, authenticode: { status: string, subject: string|null } | null }> }} input
 */
export function compareSignSet({ records, distribution }) {
  const errors = [];
  const S = new Set();
  let rows = 0;
  for (const r of records ?? []) {
    const entries = Array.isArray(r?.entries) ? r.entries : [];
    if (r?.role != null && EXACT_TWO.has(r.role) && entries.length !== 2) errors.push(`${r.role} の記録が 2 件でない（${entries.length} 件・${r.file}）`);
    for (const e of entries) {
      rows++;
      if (!SHA256_RE.test(String(e?.in ?? ''))) errors.push(`記録の in が 64 桁の hex でない: ${JSON.stringify(e?.in)}（${r.file}）`);
      if (!SHA256_RE.test(String(e?.out ?? ''))) errors.push(`記録の out が 64 桁の hex でない: ${JSON.stringify(e?.out)}（${r.file}）`);
      if (e?.status !== 'Valid') errors.push(`記録の status が Valid でない: ${e?.in} → ${e?.status ?? '結果なし'}（${r.file}）`);
      if (SHA256_RE.test(String(e?.out ?? ''))) S.add(e.out);
    }
  }
  if (rows === 0) errors.push('署名の記録が空（1 件も無い）');
  const dist = Array.isArray(distribution) ? distribution : [];
  if (dist.length === 0) errors.push('配布物の PE が 1 つも無い（展開に失敗したか、Setup.exe が無い）');
  const D = new Map();
  for (const d of dist) {
    if (!D.has(d.sha256)) D.set(d.sha256, []);
    D.get(d.sha256).push(d);
  }
  const missingFromDistribution = [...S].filter((out) => !D.has(out)).map((out) => ({ out }));
  const authenticodeChecked = dist.length > 0 && dist.every((d) => d.authenticode != null);
  const unsignedInDistribution = [];
  if (authenticodeChecked) {
    for (const d of dist) {
      if (S.has(d.sha256)) continue;
      const a = d.authenticode;
      if (a.status === 'Valid' && isMicrosoftSubject(a.subject)) continue;
      unsignedInDistribution.push({ file: d.file, sha256: d.sha256, status: a.status, subject: a.subject ?? null });
    }
  } else if (dist.some((d) => d.authenticode != null)) {
    errors.push('Authenticode の結果が一部の PE にだけある（全件か無しのどちらかにする）');
  }
  const SD = [...S].filter((out) => D.has(out)).length;
  return {
    ok: errors.length === 0 && missingFromDistribution.length === 0 && unsignedInDistribution.length === 0,
    errors,
    sizes: { records: rows, S: S.size, D: D.size, SD },
    missingFromDistribution,
    unsignedInDistribution,
    authenticodeChecked,
  };
}

// ───────────────────────────────────────────────
// main（展開・Authenticode・出力）
// ───────────────────────────────────────────────

const LIST_OPTS = new Set(['records', 'installers']);
const VALUE_OPTS = new Set(['signer', 'sevenzip', 'work', 'summary']);

export function parseArgs(argv) {
  const opt = { records: [], installers: [], signer: 'artifact-signing', sevenzip: DEFAULT_SEVENZIP, work: null, summary: null, authenticode: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`引数の置き場所が無い: ${a}`);
    const key = a.slice(2);
    if (key === 'no-authenticode') { opt.authenticode = false; continue; }
    if (LIST_OPTS.has(key)) {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[key].push(argv[++i]);
      continue;
    }
    if (VALUE_OPTS.has(key)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${a} に値が無い`);
      opt[key] = argv[++i];
      continue;
    }
    throw new Error(`不明な引数: ${a}`);
  }
  if (opt.records.length === 0) throw new Error('--records <役=path>… が要る');
  if (opt.installers.length === 0) throw new Error('--installers <Setup.exe>… が要る');
  return opt;
}

/** `<役>=<path>` か `<path>` */
function readRecord(spec) {
  const m = /^(payload|uninstaller|installer)=(.+)$/.exec(spec);
  const role = m ? m[1] : null;
  const file = path.resolve(m ? m[2] : spec);
  if (!existsSync(file)) throw new Error(`署名の記録が無い: ${file}`);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return { role, file, entries };
}

function sevenZipVersion(sevenzip) {
  const r = spawnSync(sevenzip, [], { encoding: 'utf8', timeout: 60_000 });
  if (r.error) throw new Error(`7-Zip を起動できない（${sevenzip}）: ${r.error.message}`);
  const m = /7-Zip[^\n]*?(\d+\.\d+)/.exec(`${r.stdout}\n${r.stderr}`);
  return m ? m[1] : '(不明)';
}

/** 7-Zip で archive を dest へ展開する。終了コード 1 は警告（署名つきの NSIS では「末尾にデータがある」が出る）として続ける。2 以上は赤 */
function extract(sevenzip, archive, dest) {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync(sevenzip, ['x', '-y', `-o${dest}`, archive], { encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`7-Zip を起動できない（${sevenzip}）: ${r.error.message}`);
  if (r.status !== 0 && r.status !== 1) throw new Error(`7-Zip が ${path.basename(archive)} の展開に失敗した（exit ${r.status}）: ${(r.stderr || r.stdout).trim()}`);
  const warn = r.status === 1 ? (r.stderr || r.stdout).trim().split(/\r?\n/).filter((l) => /WARN|Error|data after/i.test(l)).join(' / ') : null;
  return { status: r.status, warning: warn || null };
}

/** dest の下の *.7z（electron-builder のアプリの書庫）を列挙する */
function listInnerArchives(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && /\.7z$/i.test(ent.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

async function main(argv) {
  const opt = parseArgs(argv);
  const records = opt.records.map(readRecord);
  const installers = opt.installers.map((p) => path.resolve(p));
  for (const i of installers) if (!existsSync(i)) throw new Error(`Setup.exe が無い: ${i}`);
  if (!existsSync(opt.sevenzip)) throw new Error(`7-Zip が無い: ${opt.sevenzip}（--sevenzip で場所を渡す）`);
  const version = sevenZipVersion(opt.sevenzip);
  const work = opt.work ? path.resolve(opt.work) : mkdtempSync(path.join(os.tmpdir(), 'win-sign-set-'));
  mkdirSync(work, { recursive: true });

  // D: Setup.exe そのものと、展開して得た全 PE
  const distribution = [];
  const extraction = [];
  for (const inst of installers) {
    const name = path.basename(inst, '.exe');
    distribution.push({ file: path.basename(inst), path: inst, sha256: sha256(readFileSync(inst)) });
    const dest = path.join(work, name);
    const outer = extract(opt.sevenzip, inst, dest);
    const inner = listInnerArchives(dest);
    const innerResults = [];
    for (const a of inner) {
      const r = extract(opt.sevenzip, a, path.join(work, `${name}__${path.basename(a, '.7z')}`));
      innerResults.push({ archive: path.relative(dest, a), ...r });
    }
    const pes = [dest, ...inner.map((a) => path.join(work, `${name}__${path.basename(a, '.7z')}`))].flatMap((d) => listPes(d));
    for (const p of pes) distribution.push({ file: `${name}/${path.relative(work, p).split(path.sep).join('/')}`, path: p, sha256: sha256(readFileSync(p)) });
    extraction.push({ installer: path.basename(inst), outer, inner: innerResults, pes: pes.length });
  }

  // 判定 B の材料（Windows の pwsh。--no-authenticode なら飛ばす）
  if (opt.authenticode) {
    const results = authenticodeFiles(distribution.map((d) => d.path));
    for (const d of distribution) {
      const a = results.get(d.path);
      if (!a) throw new Error(`Authenticode の結果が無い: ${d.path}`);
      d.authenticode = { status: a.status, subject: a.subject ?? null };
    }
  } else {
    for (const d of distribution) d.authenticode = null;
  }

  const verdict = compareSignSet({ records, distribution });
  const signed = new Set(records.flatMap((r) => r.entries.map((e) => e.out)));
  const result = {
    ok: verdict.ok,
    signer: opt.signer,
    sevenZip: { path: opt.sevenzip, version },
    records: records.map((r) => ({ role: r.role, file: path.basename(path.dirname(r.file)) + '/' + path.basename(r.file), entries: r.entries.length })),
    installers: installers.map((i) => path.basename(i)),
    extraction,
    sizes: verdict.sizes,
    verdictA: { ok: verdict.missingFromDistribution.length === 0, missingFromDistribution: verdict.missingFromDistribution },
    verdictB: { checked: verdict.authenticodeChecked, ok: verdict.unsignedInDistribution.length === 0, unsignedInDistribution: verdict.unsignedInDistribution },
    errors: verdict.errors,
    distribution: distribution.map((d) => ({ file: d.file, sha256: d.sha256, inSignedSet: signed.has(d.sha256), authenticode: d.authenticode })),
  };
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (opt.summary) {
    mkdirSync(path.dirname(path.resolve(opt.summary)), { recursive: true });
    writeFileSync(path.resolve(opt.summary), json + '\n');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const head = `## 署名した集合と配布物の突き合わせ（${result.ok ? '緑' : '赤'}）\n\n`
      + `- |S| = ${verdict.sizes.S}・|D| = ${verdict.sizes.D}・|S∩D| = ${verdict.sizes.SD}・判定 A ${result.verdictA.ok ? '緑' : '赤'}・判定 B ${!verdict.authenticodeChecked ? '未実施' : result.verdictB.ok ? '緑' : '赤'}・7-Zip ${version}\n\n`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${head}\`\`\`json\n${json}\n\`\`\`\n`);
  }
  if (!result.ok) {
    for (const e of verdict.errors) console.error(`::error::${e}`);
    for (const m of verdict.missingFromDistribution) console.error(`::error::判定 A: 署名したのに配布物に無い: ${m.out}`);
    for (const u of verdict.unsignedInDistribution) console.error(`::error::判定 B: 署名した集合に無い PE: ${u.file}（${u.status}・${u.subject ?? '署名者なし'}）`);
    process.exit(1);
  }
  console.log(`verify-win-sign-set: 判定 A・B 緑（|S| = ${verdict.sizes.S}・|D| = ${verdict.sizes.D}${verdict.authenticodeChecked ? '' : '・判定 B は未実施'}）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`::error::verify-win-sign-set: ${e.message}`);
    process.exit(1);
  });
}
