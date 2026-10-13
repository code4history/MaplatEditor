#!/usr/bin/env node
// nov26-m7-t2: 署名専用ジョブ（Azure Artifact Signing）へ渡す PE を、win-sign.cjs の記録（collect）から選んで並べる。
//
// phase の順は payload < uninstaller < installer（MIN-1）:
//   payload     … NSIS プラグイン（kind: nsis-plugin）・*-unpacked の中のファイル・elevate.exe
//                 （electron-builder 26.17.0 は elevate.exe を NSIS の組み立ての中で一時ディレクトリから署名する。
//                 app-builder-lib out/targets/nsis/nsisUtil.js の CopyElevateHelper.addToArchive）
//   uninstaller … basename が __uninstaller.exe で終わるもの（NsisTarget.js:366。実物は …-x64-Setup.__uninstaller.exe）
//   installer   … basename が -Setup.exe で終わるもの
// 記録の decision: would-sign のうち、今の phase のものを並べる。前の phase の would-sign が残っていたら赤
// （pack-win-1 でプラグインの would-sign ＝ 差し替えられていない・pack-win-2 でアンインストーラーの would-sign ＝
// U-1 不成立）。後の phase のもの（その段ではまだ署名できない）は数だけ出す。どの phase にも属さないものは赤。
//
// 出力: --out に <SHA-256>.pe（同じ中身は 1 本）、--manifest に [{ sha256, name, kind, size, comparable, paths[] }]
//   paths は作業ディレクトリからの相対パス（/ 区切り）。comparable は署名と TimeDateStamp を除いた中身のハッシュ
//   （apply-signed.mjs が署名済みの照合に使う）
//
// 実行: node scripts/win-sign/collect-sign-set.mjs --phase payload|uninstaller|installer --record <jsonl>
//         --collect-dir <dir> --out <dir> --manifest <json>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { comparableDigest } = require('./win-sign.cjs');

export const PHASES = ['payload', 'uninstaller', 'installer'];

/** 記録の 1 行が属する phase（属さなければ null） */
export function phaseOf(e) {
  const name = e.name ?? path.basename(String(e.file ?? ''));
  if (e.kind === 'nsis-plugin') return 'payload';
  if (/__uninstaller\.exe$/i.test(name)) return 'uninstaller';
  if (/-Setup\.exe$/i.test(name)) return 'installer';
  if (name.toLowerCase() === 'elevate.exe') return 'payload';
  if (String(e.file ?? '').split(/[\\/]/).some((seg) => /-unpacked$/.test(seg))) return 'payload';
  return null;
}

const toRel = (cwd, f) => path.relative(cwd, path.resolve(cwd, f)).split(path.sep).join('/');

/**
 * @returns {{selected: object[], later: number, errors: string[]}}
 */
export function collectSignSet({ phase, record, collectDir, out, manifest, cwd = process.cwd() }) {
  const idx = PHASES.indexOf(phase);
  if (idx < 0) throw new Error(`phase が不正: ${phase}（${PHASES.join(' / ')}）`);
  const errors = [];
  if (!existsSync(record)) return { selected: [], later: 0, errors: [`記録が無い: ${record}`] };
  const entries = readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const bySha = new Map();
  let later = 0;
  for (const e of entries) {
    if (e.decision !== 'would-sign') continue;
    const p = phaseOf(e);
    if (p == null) {
      errors.push(`どの phase にも属さない would-sign: ${e.file}`);
      continue;
    }
    const pi = PHASES.indexOf(p);
    if (pi < idx) {
      errors.push(`前の phase（${p}）の would-sign が残っている（署名済みに差し替えられていない）: ${e.file}`);
      continue;
    }
    if (pi > idx) {
      later++;
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(String(e.sha256))) {
      errors.push(`記録の sha256 が不正: ${e.file}`);
      continue;
    }
    const cur = bySha.get(e.sha256);
    if (cur) {
      cur.paths.push(toRel(cwd, e.file));
      continue;
    }
    bySha.set(e.sha256, { sha256: e.sha256, name: e.name ?? path.basename(e.file), kind: e.kind ?? 'electron-builder',
      collected: e.collected ?? `${e.sha256}.pe`, paths: [toRel(cwd, e.file)] });
  }
  if (bySha.size === 0 && errors.length === 0) errors.push(`phase ${phase} で並べるものが 0 本（記録 ${record}）`);
  const selected = [];
  if (errors.length === 0) {
    mkdirSync(out, { recursive: true });
    for (const s of bySha.values()) {
      const src = path.join(collectDir, s.collected);
      if (!existsSync(src)) {
        errors.push(`収集した複写が無い: ${src}（${s.name}）`);
        continue;
      }
      const buf = readFileSync(src);
      copyFileSync(src, path.join(out, `${s.sha256}.pe`));
      selected.push({ sha256: s.sha256, name: s.name, kind: s.kind, size: buf.length, comparable: comparableDigest(buf), paths: s.paths });
    }
    if (errors.length === 0) {
      mkdirSync(path.dirname(path.resolve(manifest)), { recursive: true });
      writeFileSync(manifest, JSON.stringify(selected, null, 2));
    }
  }
  return { selected, later, errors };
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`引数が不正: ${k}`);
    opt[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  for (const k of ['phase', 'record', 'collectDir', 'out', 'manifest']) {
    if (!opt[k]) throw new Error(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} が要る`);
  }
  const r = collectSignSet(opt);
  for (const s of r.selected) console.log(`  ${s.sha256}.pe  ${s.name}（${s.paths.length} か所）`);
  console.log(`collect-sign-set: phase=${opt.phase} 並べた ${r.selected.length} 本・後の phase ${r.later} 件`);
  if (r.errors.length > 0) {
    for (const e of r.errors) console.error(`::error::${e}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`::error::collect-sign-set: ${e.message}`);
    process.exit(1);
  }
}
