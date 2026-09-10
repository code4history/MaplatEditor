// oct26-m4-t2 AC-7 (#35): CI 成果物検証（m4/AC4 継承・outer rule-0014）。
// 設計書 docs/superpowers/specs/2026-09-10-oct26-m4-t2-design.md §7 AC-7。
//
// `gh run download --dir <tmp>` が展開した成果物ディレクトリを照合する。**照合キーは
// run の headSha ではなく成果物内の build-meta.json.editor_sha**（v3 / MAJ-R2-1 是正）。
//
// 契約:
//   (a) --dir 配下を再帰走査して build-meta.json を発見（0 件なら exit 1）
//   (b) build-meta.json.editor_sha == --expected-sha（不一致 exit 1）
//   (c) build-meta.json.version    == --expected-version（不一致 exit 1）
//   (d) .dmg / .exe / .AppImage / .blockmap について SHA-256 を列挙し、ファイル名が
//       -<expected-version>- を含むことを assert（0 件 / 不一致 exit 1）
//   (e) latest*.yml の version: フィールド == --expected-version（不一致 exit 1）
//   (f) 全 pass で OK 行を出力し exit 0
//
// pure node（node_modules 不要）。終了コードが失敗を伝える（set -euo pipefail と組む）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// --- CLI 引数 ---
function parseArgs(argv) {
  const out = { dir: null, expectedSha: null, expectedVersion: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--expected-sha') out.expectedSha = argv[++i];
    else if (a === '--expected-version') out.expectedVersion = argv[++i];
  }
  return out;
}

function usage() {
  console.error(
    'usage: node scripts/oct26-m4-t2-ci-artifact-verify.mjs ' +
    '--dir <download dir> --expected-sha <40hex> --expected-version <version>'
  );
}

// 再帰走査してファイルの相対パス一覧を返す（正書順でなくても検証には影響しない）
function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, base, acc);
    } else if (st.isFile()) {
      acc.push({ abs, relPath: path.relative(base, abs) });
    }
  }
  return acc;
}

const { dir, expectedSha, expectedVersion } = parseArgs(process.argv.slice(2));
if (!dir || !expectedSha || !expectedVersion) {
  usage();
  process.exit(1);
}

// (a) build-meta.json の発見
let files;
try {
  files = walk(dir);
} catch (e) {
  console.error(`::error::--dir を走査できません（${dir}）: ${e.message}`);
  process.exit(1);
}
const metaRel = files.find((f) => path.basename(f.abs) === 'build-meta.json');
if (!metaRel) {
  console.error('::error::build-meta.json が成果物内に見つかりません（(a) 失敗）');
  process.exit(1);
}

let meta;
try {
  meta = JSON.parse(readFileSync(metaRel.abs, 'utf8'));
} catch (e) {
  console.error(`::error::build-meta.json を parse できません（${metaRel.relPath}）: ${e.message}`);
  process.exit(1);
}

// (b) provenance 照合の正: 成果物内 build commit SHA == 宣言 SHA
if (meta.editor_sha !== expectedSha) {
  console.error(
    `::error::provenance 不一致（build-meta.json.editor_sha=${meta.editor_sha} != expected=${expectedSha}）`
  );
  process.exit(1);
}

// (c) version 照合
if (meta.version !== expectedVersion) {
  console.error(
    `::error::version 不一致（build-meta.json.version=${meta.version} != expected=${expectedVersion}）`
  );
  process.exit(1);
}

// (d) installer / blockmap の SHA-256 列挙 + ファイル名の版 assert
const INSTALLER_RE = /\.(dmg|exe|AppImage|blockmap)$/;
const installers = files
  .filter((f) => INSTALLER_RE.test(f.abs))
  .sort((a, b) => a.relPath.localeCompare(b.relPath));
if (installers.length === 0) {
  console.error('::error::installer / blockmap（.dmg / .exe / .AppImage / .blockmap）が 1 件も無い（(d) 失敗）');
  process.exit(1);
}
for (const f of installers) {
  const hash = createHash('sha256').update(readFileSync(f.abs)).digest('hex');
  console.log(`${hash}  ${f.relPath}`);
  const base = path.basename(f.abs);
  // MIN-R2-1 是正: 版 assert は installer/blockmap のみ（latest*.yml はファイル名に版を含まないため対象外）
  if (!base.includes(`-${expectedVersion}-`)) {
    console.error(`::error::installer/blockmap のファイル名が -${expectedVersion}- を含まない: ${base}`);
    process.exit(1);
  }
}

// (e) latest*.yml の version: フィールド照合（版はここでのみ照合 — MIN-R2-1 是正）
const LATESTS = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
const latestFiles = files.filter((f) => LATESTS.includes(path.basename(f.abs)));
if (latestFiles.length === 0) {
  console.error('::error::latest*.yml（latest.yml / latest-mac.yml / latest-linux.yml）が 1 件も無い（(e) 失敗）');
  process.exit(1);
}
for (const f of latestFiles) {
  const text = readFileSync(f.abs, 'utf8');
  const m = text.match(/^version:\s*(.+)$/m);
  const ver = m ? m[1].trim() : null;
  if (ver !== expectedVersion) {
    console.error(
      `::error::latest*.yml の version 不一致（${path.basename(f.abs)}: ${ver} != ${expectedVersion}）`
    );
    process.exit(1);
  }
}

// (f) 全 pass
console.log(
  `CI artifact verify OK: buildSha=${expectedSha} version=${expectedVersion} ` +
  `files=${installers.length + latestFiles.length}`
);
process.exit(0);