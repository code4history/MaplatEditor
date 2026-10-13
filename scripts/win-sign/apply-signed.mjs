#!/usr/bin/env node
// nov26-m7-t2: 署名専用ジョブ（Azure Artifact Signing）が返した <SHA-256>.pe を、照合してから元の場所へ戻す。
//
// 照合（1 つでも外れたら何も書かずに赤）:
//   - 証明書表がある（署名されている）
//   - 署名と TimeDateStamp を除いた中身（comparableDigest）が、collect-sign-set.mjs が manifest に書いた署名前の値と一致
//   - Authenticode が Valid で、署名者が signer-identity.json の --signer のモード（Windows でしか確かめられない ∴
//     Windows でなければ赤）
// 置き場所:
//   payload     … *-unpacked の中で SHA-256 が署名前と一致するファイルをすべて書き戻す（記録に無い複写、例えば
//                 win-unpacked/resources/elevate.exe も含む）。さらに全項目を --signed-dir に `<sha>--<名前>.signed`
//                 で置く（NSIS プラグインと elevate.exe は pack の electron-builder の中で win-sign.cjs が差し替える）
//   uninstaller … --signed-dir に `<sha>--<名前>.signed`（pack-win-2 で win-sign.cjs が差し替える）
//   installer   … --release-dir/<名前>
// 書き戻したファイルの mtime は元の値に戻す。
//
// 実行: node scripts/win-sign/apply-signed.mjs --phase <phase> --manifest <json> --signed <dir> --signer <mode>
//         --release-dir <dir> [--signed-dir <WIN_SIGN_SIGNED_DIR>]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { readPeInfo, comparableDigest, assetName } = require('./win-sign.cjs');
const { checkSigner, authenticodeFiles } = require('./signer-identity.cjs');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const defaultDeps = () => ({ platform: process.platform, authenticode: (f) => authenticodeFiles([f]).get(f) });

function writeKeepingTimes(file, buf) {
  const st = existsSync(file) ? statSync(file) : null;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  if (st) utimesSync(file, st.atime, st.mtime);
}

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

/**
 * @returns {{applied: string[], errors: string[]}}
 */
export function applySigned({ phase, manifest, signed, signer, releaseDir, signedDir = null, cwd = process.cwd(), deps = defaultDeps() }) {
  if (!['payload', 'uninstaller', 'installer'].includes(phase)) throw new Error(`phase が不正: ${phase}`);
  if (!['artifact-signing', 'esigner'].includes(signer)) throw new Error(`signer が不正: ${signer}`);
  if (phase !== 'installer' && !signedDir) throw new Error(`phase ${phase} には --signed-dir が要る`);
  const errors = [];
  const items = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!Array.isArray(items) || items.length === 0) return { applied: [], errors: [`manifest が空: ${manifest}`] };
  if (deps.platform !== 'win32') {
    return { applied: [], errors: ['署名済みの照合（Authenticode・署名者）は Windows でしか確かめられない'] };
  }
  // 1 周目: 全部を照合する（1 つでも外れたら何も書かない）
  const ok = [];
  for (const m of items) {
    const f = path.join(signed, `${m.sha256}.pe`);
    if (!existsSync(f)) { errors.push(`署名済みが無い: ${m.sha256}.pe（${m.name}）`); continue; }
    const buf = readFileSync(f);
    const pe = readPeInfo(buf);
    if (pe == null) { errors.push(`PE でない: ${m.sha256}.pe（${m.name}）`); continue; }
    if (!pe.hasCert) { errors.push(`証明書表が無い（署名されていない）: ${m.sha256}.pe（${m.name}）`); continue; }
    if (comparableDigest(buf) !== m.comparable) { errors.push(`署名を除いた中身が署名前と一致しない: ${m.sha256}.pe（${m.name}）`); continue; }
    const a = deps.authenticode(f);
    if (!a || a.status !== 'Valid') { errors.push(`Authenticode が Valid でない（${a?.status}）: ${m.name}`); continue; }
    const why = checkSigner(a, signer);
    if (why != null) { errors.push(`${why}: ${m.name}`); continue; }
    ok.push({ m, buf });
  }
  if (errors.length > 0) return { applied: [], errors };

  // 2 周目: 置く
  const applied = [];
  if (phase === 'payload') {
    const want = new Map(ok.map(({ m, buf }) => [m.sha256, { m, buf }]));
    const sizes = new Set(ok.map(({ m }) => m.size).filter((x) => Number.isInteger(x)));
    const unpackedRoots = existsSync(releaseDir)
      ? readdirSync(releaseDir, { withFileTypes: true }).filter((e) => e.isDirectory() && /-unpacked$/.test(e.name)).map((e) => path.join(releaseDir, e.name))
      : [];
    const written = new Set();
    for (const root of unpackedRoots) {
      for (const f of walk(root)) {
        if (sizes.size > 0 && !sizes.has(statSync(f).size)) continue;
        const hit = want.get(sha256(readFileSync(f)));
        if (!hit) continue;
        writeKeepingTimes(f, hit.buf);
        written.add(path.resolve(f));
        applied.push(path.relative(cwd, f).split(path.sep).join('/'));
      }
    }
    // 記録にある unpacked の中の場所は、すべて書き戻されていなければならない
    for (const { m } of ok) {
      for (const p of m.paths ?? []) {
        if (!p.split('/').some((seg) => /-unpacked$/.test(seg))) continue;
        if (!written.has(path.resolve(cwd, p))) errors.push(`unpacked の中の署名前ファイルが見つからない（書き戻せない）: ${p}`);
      }
    }
    for (const { m, buf } of ok) {
      const dst = path.join(signedDir, assetName(m.sha256, m.name));
      writeKeepingTimes(dst, buf);
      applied.push(dst);
    }
  } else if (phase === 'uninstaller') {
    for (const { m, buf } of ok) {
      const dst = path.join(signedDir, assetName(m.sha256, m.name));
      writeKeepingTimes(dst, buf);
      applied.push(dst);
    }
  } else {
    for (const { m, buf } of ok) {
      const dst = path.join(releaseDir, m.name);
      writeKeepingTimes(dst, buf);
      applied.push(dst);
    }
  }
  return { applied, errors };
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`引数が不正: ${k}`);
    opt[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  for (const k of ['phase', 'manifest', 'signed', 'signer', 'releaseDir']) {
    if (!opt[k]) throw new Error(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} が要る`);
  }
  const r = applySigned({ ...opt, signedDir: opt.signedDir ?? null });
  for (const a of r.applied) console.log(`  置いた: ${a}`);
  console.log(`apply-signed: phase=${opt.phase} ${r.applied.length} 件`);
  if (r.errors.length > 0) {
    for (const e of r.errors) console.error(`::error::${e}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`::error::apply-signed: ${e.message}`);
    process.exit(1);
  }
}
