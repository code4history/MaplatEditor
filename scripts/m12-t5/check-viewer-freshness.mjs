/**
 * oct26-m12-t5a（HR-26/4）: MaplatEditor が「新ビューアを出力」していることを検査する鮮度ガード。
 *
 * 設計: 2026-09-19-oct26-m12-t5-design.md §4.2・§5（t5a）。以下 4 つの入口を持つ。
 *
 *   (A) 依存とビルド（--enforce / --warn / 自動）: 4 パッケージ（transform・tin・core・ui）と
 *       同梱ビューア（public/preview）を個別に検査（A1〜A5）。
 *   (B) 出力物（--export <zip または展開ディレクトリ>）: 書き出しに同梱された
 *       ビューアと maps/*.json の compiled を検査。
 *   (C) --self-test: 合成入力で A1〜A5・(B)・enforce/warn 規則表の判定の向きを確かめる。
 *
 * enforce / warn の選び方（固定。mode では決めない）:
 *   - mode=full（署名・公証・draft Release）→ enforce
 *   - package.json の version に対応する tag v<version> が origin に無い（未公開の版）→ enforce
 *   - tag の有無を確かめられない（git ls-remote の失敗）→ enforce（fail-closed）
 *   - 上のどれでもない（公開済みの版の再ビルド）→ warn（exit 0）
 *
 * 自動判定はスクリプトの中で行う（workflow の入力で弱められない）。CI の prepare ステップは
 * 本スクリプトを引数なしで呼び、MODE env を渡す。
 *
 * 検査の判定ロジックは「facts を入力とする純関数」に分離してあり、--self-test は合成 facts で
 * 各検査の向き（合格入力 → ok / 不合格入力 → ng）を確かめる。実環境の核となる facts は
 * node_modules と pnpm-lock.yaml から集める。
 */
import { readFileSync, existsSync, statSync, readdirSync, appendFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

// 今回の NewTin が書き出すフォーマット版・weight_buffer は空（m12 設計 §1.1 / §4.2）
const FORMAT_V2 = 2.00704;
const FORMAT_V3 = 3.00001;
const OLD_V2 = 2.00703;
const OLD_V3 = 3;

// 依存なし検査（node_modules 無し）では transform/tin/core の中身（weight_buffer / format_version）を
// 検証できないため、解決版の「旧世代拒否」で fail-closed にする。旧版（weight_buffer を残す世代）は
// §4.1 のとおり 1.0.0 までで、純アフィン化（weight_buffer 除去）は次の版（> 1.0.0）で入る。
const OLD_GENERATION_MAX = '1.0.0';

// Editor が地図保存で使う TIN 設定（electron/ipc/mapedit.ts:30 ほかと同一）
const TIN_V2_OPTIONS = { useV2Algorithm: true };

// A2 用の既存 GCP フィクスチャ（Editor の tests にある GCP。
// tests/e2e/m5-t4b-import-draft-cleanup.spec.ts:49-53 の 3 点を再掲）。
const GCP_WH = [400, 300];
const GCP_STRICT = 'loose';
const GCP_VERTEX = 'plain';
const GCP_POINTS = [
  [[0, 0], [135.0, 35.1]],
  [[400, 0], [135.1, 35.1]],
  [[200, 300], [135.05, 35.0]],
];

// ───────────────────────────────────────────────
// 純関数ヘルパー
// ───────────────────────────────────────────────

/** リテラル出現回数（grep -o の 1 行あたり件数と同値）。 */
function countLiteral(str, sub) {
  return String(str).split(sub).length - 1;
}

function isEmptyPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

function parseSemver(v) {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(String(v));
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : undefined,
  };
}

/** semver §11 の prerelease 比較。無いほう（正式版）が大きい。数値識別子 < 英数字識別子、数値は大小、英数字は ASCII 順。 */
function comparePrerelease(a, b) {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // 前置が等しく識別子が少ないほうが小さい（例: rc < rc.0）
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      // 数値識別子は任意長になり得るため Number() では精度落ちする（9007199254740993 が丸まる）。
      // BigInt で正確に比較する（semver §11.4.3 の「数値で比較」を任意精度で満たす）。
      const bx = BigInt(x);
      const by = BigInt(y);
      return bx < by ? -1 : bx > by ? 1 : 0;
    }
    if (xn) return -1; // 数値識別子 < 英数字識別子
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** semver の全順序（major.minor.patch、次いで prerelease）。a < b なら負・a > b なら正。不正値は末尾扱い。 */
function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return (pa.major - pb.major) || (pa.minor - pb.minor) || (pa.patch - pb.patch) || comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * semver.minVersion の限定的代替。
 *
 * 本リポジトリの package.json は maplat 4 パッケージを `^X.Y.Z` で指定している。
 * `semver` パッケージはこの checkout の node_modules に存在せず（install は禁止のため追加
 * できない）、`^`/`~`/`>=`/裸版・`*`/`x` ワイルドカードへ絞って下限を求める。
 * `>X`（開区間）や複雑な比較子は扱わない（本 repo では出現しない）。
 *
 * prerelease（`-rc.0` 等）は保持し、複数比較子の下限は compareSemver（prerelease の
 * 順序を含む）で選ぶ。`^1.1.0-rc.0` の下限は `1.1.0-rc.0`（Major-2 の是正）。
 */
function minVersion(range) {
  const r = String(range ?? '').trim();
  if (!r) return null;
  const candidates = [];
  for (const raw of r.split(/\s+/)) {
    let t = raw.replace(/^(>=|<=|~>|\|\||[~^<>=]{1,2})/, '').replace(/^v/, '');
    const m = /^(\d+)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?(-[0-9A-Za-z.-]+)?/i.exec(t);
    if (!m) continue;
    const minor = !m[2] || /[*xX]/i.test(m[2]) ? 0 : Number(m[2]);
    const patch = !m[3] || /[*xX]/i.test(m[3]) ? 0 : Number(m[3]);
    const prerelease = m[4] ?? '';
    candidates.push(`${m[1]}.${minor}.${patch}${prerelease}`);
  }
  if (!candidates.length) return null;
  candidates.sort(compareSemver);
  return candidates[0];
}

/** "1.0.0(mapbox-gl@...)(...)" → "1.0.0"（lock の peer suffix を落とす）。 */
function baseVersion(v) {
  return String(v ?? '').split('(')[0].trim();
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ───────────────────────────────────────────────
// pnpm-lock.yaml からの facts 抽出
// ───────────────────────────────────────────────

async function loadLock(root) {
  // js-yaml は devDependency。CI の prepare は依存導入前なので、ここを遅延 import にして、
  // --self-test や prepare（node_modules 無し）の経路が js-yaml を要求しないようにする
  // （Major-1 の是正）。
  const { default: yaml } = await import('js-yaml');
  return yaml.load(readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
}

/** lock の packages 節から、パッケージの解決版（重複なし）を返す。 */
function resolvedVersions(lock, pkg) {
  const versions = new Set();
  for (const key of Object.keys(lock.packages ?? {})) {
    if (key.startsWith(pkg + '@')) versions.add(key.slice(pkg.length + 1));
  }
  return [...versions];
}

/** lock の snapshots 節から <pkg>@<resolved> の dependencies[depName] を返す（未解決なら undefined）。 */
function snapshotDep(lock, pkg, resolvedVersion, depName) {
  const prefix = `${pkg}@${resolvedVersion}`;
  const key = Object.keys(lock.snapshots ?? {}).find(
    (k) => k === prefix || k.startsWith(prefix + '(')
  );
  if (!key) return undefined;
  const deps = lock.snapshots[key]?.dependencies ?? {};
  return deps[depName];
}

// ───────────────────────────────────────────────
// pnpm-lock.yaml（テキスト）からの facts 抽出（js-yaml を使わない）
// ───────────────────────────────────────────────

/**
 * pnpm-lock.yaml をテキスト（正規表現）で読み、packages 節にある <pkg> の解決版を重複なく返す。
 * js-yaml の代わり（依存なし prepare で使用）。pnpm-lock v9 の 2 スペースインデントを想定。
 */
function textResolvedVersions(lockText, pkg) {
  const versions = new Set();
  let section = null;
  for (const line of String(lockText ?? '').split('\n')) {
    const sec = /^([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section !== 'packages') continue;
    const m = /^  ['"]?(@[^'"]+)['"]?:\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (!key.startsWith(pkg + '@')) continue;
    versions.add(key.slice(pkg.length + 1).split('(')[0].trim());
  }
  return [...versions];
}

/**
 * pnpm-lock.yaml をテキスト（正規表現）で読み、snapshots 節から <pkg>@<resolved> の
 * dependencies[depName] を返す（未解決なら undefined）。js-yaml の snapshotDep() と同じ基準
 * （dependencies 節だけを読む。optionalDependencies は読まない）。
 */
function textSnapshotDep(lockText, pkg, resolvedVersion, depName) {
  if (!resolvedVersion) return undefined;
  const prefix = `${pkg}@${resolvedVersion}`;
  let section = null;
  let currentKey = null;
  let inDeps = false;
  for (const line of String(lockText ?? '').split('\n')) {
    const sec = /^([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (sec) {
      section = sec[1];
      currentKey = null;
      inDeps = false;
      continue;
    }
    if (section !== 'snapshots') continue;
    const keyM = /^  ['"]?(@[^'"]+)['"]?:\s*$/.exec(line);
    if (keyM) {
      currentKey = keyM[1];
      inDeps = false;
      continue;
    }
    const head = /^    ([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (head) {
      inDeps = head[1] === 'dependencies';
      continue;
    }
    if (!inDeps || !currentKey) continue;
    if (currentKey !== prefix && !currentKey.startsWith(prefix + '(')) continue;
    const d = /^      ['"]?([@][^'"]+)['"]?:\s+([^\s]+)/.exec(line);
    if (d && d[1] === depName) return d[2];
  }
  return undefined;
}

// ───────────────────────────────────────────────
// (B) 出力物の判定
// ───────────────────────────────────────────────

/**
 * compiled の新旧判定。戻り値: 'old' | 'new' | 'invalid'。
 *   old     … version が無い・2.00703 以下・3（旧 V3）。weight_buffer は問わない（HR-26/2）。
 *   new     … 2.00704 / 3.00001 かつ weight_buffer が {}（空）。
 *   invalid … どちらでもない（2.00704 なのに重みあり、3.00001 超の未知版、等）。
 */
function classifyCompiled(compiled) {
  const v = compiled?.version;
  if (v === undefined || v === null) return 'old';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'invalid';
  if (n <= OLD_V2) return 'old';
  if (n === OLD_V3) return 'old';
  if (n === FORMAT_V2 || n === FORMAT_V3) {
    return isEmptyPlainObject(compiled?.weight_buffer) ? 'new' : 'invalid';
  }
  return 'invalid';
}

/** map json から検査対象の compiled（top-level と sub_maps）を集める。 */
function collectCompiled(mapJson) {
  const out = [];
  if (mapJson?.compiled !== undefined) out.push(mapJson.compiled);
  if (Array.isArray(mapJson?.sub_maps)) {
    for (const s of mapJson.sub_maps) {
      if (s?.compiled !== undefined) out.push(s.compiled);
    }
  }
  return out;
}

/** ビューア bundle 内容の新旧判定（weight_buffer 0 件 かつ 2.00704 1 件以上が「新」）。 */
function evaluateViewerBundle(jsContent) {
  const weightBuffer = countLiteral(jsContent ?? '', 'weight_buffer');
  const formatMarkers = countLiteral(jsContent ?? '', String(FORMAT_V2));
  return { viewerOk: weightBuffer === 0 && formatMarkers >= 1, weightBuffer, formatMarkers };
}

/** (B) の判定。jsContent は同梱ビューア全文、mapJsons は [{name, json}]。 */
function evaluateExport({ jsContent, mapJsons }) {
  const viewer = evaluateViewerBundle(jsContent);
  const viewerWb = viewer.weightBuffer;
  const viewerFmt = viewer.formatMarkers;
  const viewerOk = viewer.viewerOk;

  const mapResults = [];
  for (const { name, json } of mapJsons) {
    for (const compiled of collectCompiled(json)) {
      mapResults.push({ name, cls: classifyCompiled(compiled) });
    }
  }
  const invalid = mapResults.filter((r) => r.cls === 'invalid');
  const oldCount = mapResults.filter((r) => r.cls === 'old').length;
  const newCount = mapResults.filter((r) => r.cls === 'new').length;

  return { viewerOk, viewerWb, viewerFmt, mapResults, invalid, oldCount, newCount, ok: viewerOk && invalid.length === 0 };
}

// ───────────────────────────────────────────────
// enforce / warn 規則表（§4.2）
// ───────────────────────────────────────────────

/** git ls-remote の結果から tag 状態を決める。 */
function classifyTagState(stdout, exitCode) {
  if (exitCode !== 0) return 'unknown';
  return String(stdout ?? '').trim() ? 'present' : 'absent';
}

/** 規則表: mode=full / tag 未公開 / tag 不明 は enforce、公開済み再ビルドは warn。 */
function decideEnforceOrWarn({ mode, tagState }) {
  if (mode === 'full') return 'enforce';
  if (tagState !== 'present') return 'enforce';
  return 'warn';
}

// ───────────────────────────────────────────────
// (A) 検査関数（facts → { id, ok, details }）
// ───────────────────────────────────────────────

function lockAndSpecDetails(pkgLabel, specifier, lockVersions) {
  const details = [];
  const unique = lockVersions.length;
  details.push({
    name: `${pkgLabel}: lock で解決版が 1 種類だけ`,
    ok: unique === 1,
    detail: unique === 1 ? `1 種類（${lockVersions[0]}）` : `${unique} 種類（${lockVersions.join(', ')}）`,
  });
  const mv = minVersion(specifier);
  const resolved = lockVersions[0];
  details.push({
    name: `${pkgLabel}: package.json 下限（minVersion）が解決版と一致`,
    ok: mv != null && mv === resolved,
    detail: `minVersion(${JSON.stringify(specifier)}) = ${mv}${mv === resolved ? '' : ' ≠ ' + (resolved ?? '（解決版なし）')}`,
  });
  return details;
}

function checkA1(facts) {
  const details = lockAndSpecDetails('@maplat/transform', facts.specifiers.transform, facts.lockVersions.transform);
  details.push({
    name: '@maplat/transform: format_version === 2.00704',
    ok: facts.content.formatVersion === FORMAT_V2,
    detail: `format_version = ${facts.content.formatVersion}`,
  });
  details.push({
    name: '@maplat/transform: dist/maplat_transform.js に weight_buffer が 0 件',
    ok: facts.content.transformDistWeightBuffer === 0,
    detail: `weight_buffer ${facts.content.transformDistWeightBuffer} 件`,
  });
  return { id: 'A1', ok: details.every((d) => d.ok), details };
}

/**
 * A2〜A4 で使う「lock スナップショットの依存辺が期待版と一致」詳細。
 */
function edgeDetails(details, pkgLabel, depLabel, actualEdge, expectedVersion) {
  const actual = baseVersion(actualEdge);
  const edgeOk = actual !== '' && actual === expectedVersion;
  details.push({
    name: `${pkgLabel}: スナップショットの dependencies['${depLabel}'] が ${expectedVersion} と一致`,
    ok: edgeOk,
    detail: `${depLabel} = ${actualEdge ?? '（なし）'}${edgeOk ? '' : `（base=${actual} ≠ ${expectedVersion}）`}`,
  });
}

function checkA2(facts, transformVersion) {
  const details = lockAndSpecDetails('@maplat/tin', facts.specifiers.tin, facts.lockVersions.tin);
  edgeDetails(details, '@maplat/tin', '@maplat/transform', facts.lockEdges.tinTransform, transformVersion);
  const c = facts.content.tinCompiled;
  const versionOk = c.version === FORMAT_V2;
  const wbOk = c.weightBufferEmpty === true;
  details.push({
    name: '@maplat/tin: getCompiled() が version 2.00704 かつ weight_buffer が {}',
    ok: versionOk && wbOk,
    detail: `version=${c.version}, weight_buffer=${wbOk ? '{}' : '非空/欠落'}`,
  });
  return { id: 'A2', ok: details.every((d) => d.ok), details };
}

function checkA3(facts, transformVersion) {
  const details = lockAndSpecDetails('@maplat/core', facts.specifiers.core, facts.lockVersions.core);
  edgeDetails(details, '@maplat/core', '@maplat/transform', facts.lockEdges.coreTransform, transformVersion);
  details.push({
    name: '@maplat/core: dist/*.js に weight_buffer が 0 件',
    ok: facts.content.coreDistWeightBuffer === 0,
    detail: `dist/*.js に weight_buffer ${facts.content.coreDistWeightBuffer} 件`,
  });
  details.push({
    name: '@maplat/core: src/** に weight_buffer が 0 件',
    ok: facts.content.coreSrcWeightBuffer === 0,
    detail: `src/** に weight_buffer ${facts.content.coreSrcWeightBuffer} 件`,
  });
  return { id: 'A3', ok: details.every((d) => d.ok), details };
}

function checkA4(facts, coreVersion) {
  const details = lockAndSpecDetails('@maplat/ui', facts.specifiers.ui, facts.lockVersions.ui);
  edgeDetails(details, '@maplat/ui', '@maplat/core', facts.lockEdges.uiCore, coreVersion);
  details.push({
    name: '@maplat/ui: dist/maplat_ui.umd.js に weight_buffer が 0 件 かつ 2.00704 が 1 件以上',
    ok: facts.content.uiDistWeightBuffer === 0 && facts.content.uiDistFormatMarkers >= 1,
    detail: `weight_buffer ${facts.content.uiDistWeightBuffer} 件 / 2.00704 ${facts.content.uiDistFormatMarkers} 件`,
  });
  return { id: 'A4', ok: details.every((d) => d.ok), details };
}

function checkA5(facts) {
  const jsMatch = facts.preview.jsSha === facts.preview.distJsSha;
  const cssMatch = facts.preview.cssSha === facts.preview.distCssSha;
  return {
    id: 'A5',
    ok: jsMatch && cssMatch,
    details: [
      {
        name: '同梱ビューア: public/preview/maplat_ui.umd.js の sha256 が ui dist と一致',
        ok: jsMatch,
        detail: jsMatch ? '一致' : `preview=${facts.preview.jsSha} ≠ dist=${facts.preview.distJsSha}`,
      },
      {
        name: '同梱ビューア: public/preview/maplat_ui.css の sha256 が ui dist と一致',
        ok: cssMatch,
        detail: cssMatch ? '一致' : `preview=${facts.preview.cssSha} ≠ dist=${facts.preview.distCssSha}`,
      },
    ],
  };
}

function runA(facts) {
  const transformVersion = facts.lockVersions.transform[0];
  const coreVersion = facts.lockVersions.core[0];
  return [
    checkA1(facts),
    checkA2(facts, transformVersion),
    checkA3(facts, transformVersion),
    checkA4(facts, coreVersion),
    checkA5(facts),
  ];
}

// ───────────────────────────────────────────────
// 実環境の facts 抽出
// ───────────────────────────────────────────────

async function countWeightBufferRecursive(dir) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      total += await countWeightBufferRecursive(p);
    } else if (e.isFile() && /\.(js|mjs|cjs|ts|tsx|d\.ts|map)$/.test(e.name)) {
      total += countLiteral(await readFile(p, 'utf8'), 'weight_buffer');
    }
  }
  return total;
}

async function countWeightBufferDistJs(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const p = path.join(dir, name);
    try {
      if (statSync(p).isFile()) total += countLiteral(readFileSync(p, 'utf8'), 'weight_buffer');
    } catch {
      // skip
    }
  }
  return total;
}

async function buildTinCompiled() {
  const { default: Tin } = await import('@maplat/tin');
  const tin = new Tin(TIN_V2_OPTIONS);
  tin.setWh(GCP_WH);
  tin.setStrictMode(GCP_STRICT);
  tin.setVertexMode(GCP_VERTEX);
  tin.setPoints(GCP_POINTS);
  tin.setEdges([]);
  await tin.updateTinAsync();
  const compiled = tin.getCompiled();
  return {
    version: compiled.version,
    weightBufferEmpty: isEmptyPlainObject(compiled.weight_buffer),
  };
}

async function gatherDepsFacts(root) {
  const lock = await loadLock(root);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const spec = (name) => pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];

  const lockVersions = {
    transform: resolvedVersions(lock, '@maplat/transform'),
    tin: resolvedVersions(lock, '@maplat/tin'),
    core: resolvedVersions(lock, '@maplat/core'),
    ui: resolvedVersions(lock, '@maplat/ui'),
  };

  const lockEdges = {
    tinTransform: snapshotDep(lock, '@maplat/tin', lockVersions.tin[0], '@maplat/transform'),
    coreTransform: snapshotDep(lock, '@maplat/core', lockVersions.core[0], '@maplat/transform'),
    uiCore: snapshotDep(lock, '@maplat/ui', lockVersions.ui[0], '@maplat/core'),
  };

  const transformDist = readFileSync(
    path.join(root, 'node_modules/@maplat/transform/dist/maplat_transform.js'),
    'utf8'
  );
  const transformMod = await import(
    pathToFileURL(path.join(root, 'node_modules/@maplat/transform/dist/maplat_transform.js')).href
  );

  const uiDistPath = path.join(root, 'node_modules/@maplat/ui/dist/maplat_ui.umd.js');
  const uiDist = readFileSync(uiDistPath, 'utf8');

  const tinCompiled = await buildTinCompiled();

  const previewRoot = path.join(root, 'public/preview');
  const dist = (f) => readFileSync(path.join(root, 'node_modules/@maplat/ui/dist', f));

  return {
    specifiers: {
      transform: spec('@maplat/transform'),
      tin: spec('@maplat/tin'),
      core: spec('@maplat/core'),
      ui: spec('@maplat/ui'),
    },
    lockVersions,
    lockEdges,
    content: {
      formatVersion: transformMod.format_version,
      transformDistWeightBuffer: countLiteral(transformDist, 'weight_buffer'),
      tinCompiled,
      coreDistWeightBuffer: await countWeightBufferDistJs(path.join(root, 'node_modules/@maplat/core/dist')),
      coreSrcWeightBuffer: await countWeightBufferRecursive(path.join(root, 'node_modules/@maplat/core/src')),
      uiDistWeightBuffer: countLiteral(uiDist, 'weight_buffer'),
      uiDistFormatMarkers: countLiteral(uiDist, String(FORMAT_V2)),
    },
    preview: {
      jsSha: sha256Hex(readFileSync(path.join(previewRoot, 'maplat_ui.umd.js'))),
      distJsSha: sha256Hex(dist('maplat_ui.umd.js')),
      cssSha: sha256Hex(readFileSync(path.join(previewRoot, 'maplat_ui.css'))),
      distCssSha: sha256Hex(dist('maplat_ui.css')),
    },
  };
}

/**
 * prepare（node_modules 未導入）でも安全に分岐するための依存境界。
 * A1〜A5 の核（transform/tin/core/ui の node_modules と lock 解析用 js-yaml）が
 * 揃っていれば full 検査、無ければ依存なし検査（同梱ビューア直接検査）へ落とす。
 */
function depsAvailableForAuto(root) {
  return [
    'node_modules/@maplat/transform/dist/maplat_transform.js',
    'node_modules/@maplat/tin',
    'node_modules/@maplat/core/dist',
    'node_modules/@maplat/core/src',
    'node_modules/@maplat/ui/dist/maplat_ui.umd.js',
    'node_modules/@maplat/ui/dist/maplat_ui.css',
    'node_modules/js-yaml',
  ].every((p) => existsSync(path.join(root, p)));
}

/**
 * 依存なし検査: package.json（4 パッケージ宣言）と pnpm-lock.yaml（解決版・依存辺）をテキストで
 * 読み、設計 §4.2 の A1〜A4 の lock/spec 基準（解決版 1 種類・下限一致・依存辺一致）を評価し、
 * 依存なしでは中身（node_modules）を検証できないため解決版で旧世代（≤ 1.0.0）を拒否する
 * （fail-closed）。A5 相当は同梱ビューア public/preview/maplat_ui.umd.js の内容を直接検査する。
 * 読めない・見つからない場合は該当 detail を不合格にする（fail-closed。enforce なら exit 1）。
 */
function evaluateDependencyFreeFacts({ pkg, lockText, previewJs }) {
  const pkgMissing = pkg == null;
  const lockMissing = lockText == null;
  const spec = (name) => (pkgMissing ? undefined : pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
  const versionsOf = (name) => (lockMissing ? [] : textResolvedVersions(lockText, name));

  const specifiers = {
    transform: spec('@maplat/transform'),
    tin: spec('@maplat/tin'),
    core: spec('@maplat/core'),
    ui: spec('@maplat/ui'),
  };
  const lockVersions = {
    transform: versionsOf('@maplat/transform'),
    tin: versionsOf('@maplat/tin'),
    core: versionsOf('@maplat/core'),
    ui: versionsOf('@maplat/ui'),
  };
  const lockEdges = {
    tinTransform: lockMissing ? undefined : textSnapshotDep(lockText, '@maplat/tin', lockVersions.tin[0], '@maplat/transform'),
    coreTransform: lockMissing ? undefined : textSnapshotDep(lockText, '@maplat/core', lockVersions.core[0], '@maplat/transform'),
    uiCore: lockMissing ? undefined : textSnapshotDep(lockText, '@maplat/ui', lockVersions.ui[0], '@maplat/core'),
  };

  const declareDetail = (label, specifier) => ({
    name: `${label}: package.json に宣言がある`,
    ok: !pkgMissing && specifier != null,
    detail: pkgMissing ? 'package.json を読めない' : specifier == null ? '宣言なし' : `指定 ${JSON.stringify(specifier)}`,
  });

  const readableDetail = (label, versions) => ({
    name: `${label}: pnpm-lock.yaml を読める・解決版がある`,
    ok: !lockMissing && versions.length >= 1,
    detail: lockMissing ? 'pnpm-lock.yaml を読めない' : versions.length >= 1 ? `解決版 ${versions.join(', ')}` : '解決版なし',
  });

  const generationDetail = (label, versions) => {
    const v = versions.length >= 1 ? baseVersion(versions[0]) : null;
    const okNew = v != null && compareSemver(v, OLD_GENERATION_MAX) > 0;
    return {
      name: `${label}: 解決版が旧世代（≤ ${OLD_GENERATION_MAX}）でない`,
      ok: okNew,
      detail: v == null ? '（解決版なし）' : `${v} ${okNew ? '＞ ' + OLD_GENERATION_MAX : '≤ ' + OLD_GENERATION_MAX + '（旧世代）'}`,
    };
  };

  const A = (id, label, specifier, versions, edgeInfo) => {
    const details = [];
    details.push(declareDetail(label, specifier));
    details.push(readableDetail(label, versions));
    if (!pkgMissing && !lockMissing && specifier != null && versions.length >= 1) {
      details.push(...lockAndSpecDetails(label, specifier, versions));
    } else if (specifier != null) {
      details.push({ name: `${label}: lock で解決版が 1 種類だけ`, ok: false, detail: versions.length === 0 ? '（解決版なし）' : '（読めないため判定不能）' });
      details.push({ name: `${label}: package.json 下限（minVersion）が解決版と一致`, ok: false, detail: '（判定不能）' });
    }
    details.push(generationDetail(label, versions));
    // 依存先（expected）が解決されていない（lock 欠落等）場合は辺の detail は既に fail-closed 済み。
    // expected が無いと辺 detail が「undefined と一致」と表示されるため、その場合のみ省く。
    if (edgeInfo && edgeInfo.expected != null) edgeDetails(details, label, edgeInfo.dep, edgeInfo.edge, edgeInfo.expected);
    return { id, ok: details.every((d) => d.ok), details };
  };

  const preview = evaluateViewerBundle(previewJs ?? '');
  const results = [
    A('A1', '@maplat/transform', specifiers.transform, lockVersions.transform, null),
    A('A2', '@maplat/tin', specifiers.tin, lockVersions.tin, { dep: '@maplat/transform', edge: lockEdges.tinTransform, expected: lockVersions.transform[0] }),
    A('A3', '@maplat/core', specifiers.core, lockVersions.core, { dep: '@maplat/transform', edge: lockEdges.coreTransform, expected: lockVersions.transform[0] }),
    A('A4', '@maplat/ui', specifiers.ui, lockVersions.ui, { dep: '@maplat/core', edge: lockEdges.uiCore, expected: lockVersions.core[0] }),
    {
      id: 'preview',
      ok: preview.viewerOk,
      details: [{
        name: '同梱ビューア: public/preview/maplat_ui.umd.js を依存なしで直接検査（weight_buffer 0 件 かつ 2.00704 1 件以上）',
        ok: preview.viewerOk,
        detail: `weight_buffer ${preview.weightBuffer} 件 / 2.00704 ${preview.formatMarkers} 件`,
      }],
    },
  ];
  return { results, failed: results.some((r) => !r.ok) };
}

/** 依存なし検査の実経路ラッパ: ファイルを読んで evaluateDependencyFreeFacts に渡す（読めなければ fail-closed）。 */
function evaluateDependencyFree(root) {
  let pkg = null;
  let lockText = null;
  let previewJs = '';
  try {
    pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    // 読めない → fail-closed（evaluateDependencyFreeFacts が pkgMissing として扱う）
  }
  try {
    lockText = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  } catch {
    // 読めない → fail-closed
  }
  const previewPath = path.join(root, 'public/preview/maplat_ui.umd.js');
  try {
    if (existsSync(previewPath)) previewJs = readFileSync(previewPath, 'utf8');
  } catch {
    // 読めない → preview は空扱い（evaluateViewerBundle('') は不合格）
  }
  return evaluateDependencyFreeFacts({ pkg, lockText, previewJs });
}

// ───────────────────────────────────────────────
// 出力・実行
// ───────────────────────────────────────────────

function printResults(results, mode) {
  let failed = false;
  for (const r of results) {
    for (const d of r.details) {
      if (d.ok) {
        console.log(`  ✅ ${d.name} — ${d.detail}`);
      } else {
        failed = true;
        console.log(`  ❌ ${d.name} — ${d.detail}`);
      }
    }
  }
  console.log('');
  if (mode === 'enforce') {
    if (failed) {
      console.error('::error:: viewer-freshness 検査が不合格（enforce）。新ビューア（純アフィン）への更新が必要です。');
    } else {
      console.log('✅ viewer-freshness 検査 すべて合格');
    }
  } else {
    console.log(failed ? '⚠ viewer-freshness 検査は不合格（warn。exit 0）。' : '✅ viewer-freshness 検査 すべて合格');
  }
  return failed;
}

function emitSummary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    } catch {
      // summary に書けなくても判定は stdout に出ている
    }
  }
}

async function runExport(target) {
  const abs = path.resolve(target);
  if (!existsSync(abs)) {
    console.error(`::error:: --export の対象が存在しません: ${abs}`);
    return 1;
  }
  let jsContent = null;
  let mapJsons = [];
  const isDir = statSync(abs).isDirectory();
  if (isDir) {
    const jsPath = path.join(abs, 'assets/maplat_ui.umd.js');
    if (existsSync(jsPath)) jsContent = readFileSync(jsPath, 'utf8');
    const mapsDir = path.join(abs, 'maps');
    if (existsSync(mapsDir)) {
      for (const name of readdirSync(mapsDir)) {
        if (!name.endsWith('.json')) continue;
        mapJsons.push({ name: `maps/${name}`, json: JSON.parse(readFileSync(path.join(mapsDir, name), 'utf8')) });
      }
    }
  } else {
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip(abs);
    for (const entry of zip.getEntries()) {
      if (entry.entryName === 'assets/maplat_ui.umd.js') {
        jsContent = entry.getData().toString('utf8');
      } else if (/^maps\/[^/]+\.json$/.test(entry.entryName)) {
        mapJsons.push({ name: entry.entryName, json: JSON.parse(entry.getData().toString('utf8')) });
      }
    }
  }

  const r = evaluateExport({ jsContent, mapJsons });
  console.log(`--export 対象: ${abs}（${isDir ? 'ディレクトリ' : 'zip'}）`);
  console.log(`  同梱ビューア assets/maplat_ui.umd.js: weight_buffer ${r.viewerWb} 件 / 2.00704 ${r.viewerFmt} 件 → ${r.viewerOk ? '合格' : '不合格'}`);
  console.log(`  maps/*.json compiled: 新 ${r.newCount} 件 / 旧 ${r.oldCount} 件 / 不正 ${r.invalid.length} 件`);
  for (const bad of r.invalid) {
    console.log(`  ❌ 不正 compiled: ${bad.name}（version/weight_buffer が新旧どちらでもない）`);
  }
  if (r.ok) {
    console.log('✅ --export: 合格');
    return 0;
  }
  console.error('::error:: --export が不合格（同梱ビューアが旧い、または unknown 版の compiled を含む）');
  return 1;
}

async function runSelfTest() {
  let passed = 0;
  let total = 0;
  const ok = (cond, msg) => {
    total++;
    assert.ok(cond, msg);
    passed++;
  };

  // --- minVersion（semver.minVersion の限定代替）---
  ok(minVersion('^1.0.0') === '1.0.0', 'minVersion(^1.0.0) = 1.0.0');
  ok(minVersion('~1.2.3') === '1.2.3', 'minVersion(~1.2.3) = 1.2.3');
  ok(minVersion('>=1.0.0') === '1.0.0', 'minVersion(>=1.0.0) = 1.0.0');
  ok(minVersion('^0.2.3') === '0.2.3', 'minVersion(^0.2.3) = 0.2.3');
  ok(minVersion('1.2.3') === '1.2.3', 'minVersion(1.2.3) = 1.2.3');
  // --- prerelease を保持する minVersion と semver 比較（Major-2 の是正）---
  ok(minVersion('^1.1.0-rc.0') === '1.1.0-rc.0', 'minVersion(^1.1.0-rc.0) = 1.1.0-rc.0（prerelease 保持）');
  ok(compareSemver('1.1.0-rc.1', '1.1.0-rc.0') > 0, 'semver: 1.1.0-rc.1 > 1.1.0-rc.0');
  ok(compareSemver('1.1.0', '1.1.0-rc.9') > 0, 'semver: 1.1.0 > 1.1.0-rc.9');
  ok(compareSemver('1.1.0-rc.9', '1.1.0') < 0, 'semver: 1.1.0-rc.9 < 1.1.0');
  ok(compareSemver('1.1.0-rc.10', '1.1.0-rc.9') > 0, 'semver: prerelease 数値 10 > 9');
  ok(compareSemver('1.1.0-rc', '1.1.0-rc.0') < 0, 'semver: rc < rc.0（識別子が少ないほうが小さい）');
  ok(compareSemver('1.1.0-alpha', '1.1.0-rc.0') < 0, 'semver: alpha < rc（ASCII 順）');
  ok(compareSemver('1.1.0-rc.0', '1.1.0-rc.0') === 0, 'semver: 等しい → 0');
  ok(minVersion('^1.1.0-rc.0 || 1.0.0') === '1.0.0', 'minVersion: 複数比較子で prerelease を含む下限選択');
  // --- 数値 prerelease の BigInt 比較（Minor の是正。Number() では両者が同順位になる）---
  ok(compareSemver('1.1.0-rc.9007199254740993', '1.1.0-rc.9007199254740992') > 0, 'semver: 数値 prerelease 9007199254740993 > 9007199254740992（BigInt）');
  ok(compareSemver('1.1.0-rc.9007199254740992', '1.1.0-rc.9007199254740993') < 0, 'semver: 数値 prerelease 9007199254740992 < 9007199254740993（BigInt）');

  // --- 規則表（enforce/warn）---
  ok(decideEnforceOrWarn({ mode: 'full', tagState: 'present' }) === 'enforce', '規則: mode=full → enforce');
  ok(decideEnforceOrWarn({ mode: 'verify', tagState: 'absent' }) === 'enforce', '規則: 未公開（tag absent）→ enforce');
  ok(decideEnforceOrWarn({ mode: 'verify', tagState: 'unknown' }) === 'enforce', '規則: tag 不明 → enforce（fail-closed）');
  ok(decideEnforceOrWarn({ mode: 'verify', tagState: 'present' }) === 'warn', '規則: 公開済み再ビルド → warn');
  ok(classifyTagState('', 0) === 'absent', 'tag 状態: 出力空 → absent');
  ok(classifyTagState('abc refs/tags/v1.0.0', 0) === 'present', 'tag 状態: 出力あり → present');
  ok(classifyTagState('', 1) === 'unknown', 'tag 状態: exit≠0 → unknown');

  // --- compiled 分類（(B)）---
  const C = (v, wb) => ({ version: v, weight_buffer: wb });
  ok(classifyCompiled({}) === 'old', 'compiled: version 無し → old');
  ok(classifyCompiled(C(OLD_V2, { a: 1 })) === 'old', 'compiled: 2.00703（重みあり）→ old');
  ok(classifyCompiled(C(OLD_V3, { a: 1 })) === 'old', 'compiled: 3（旧 V3）→ old');
  ok(classifyCompiled(C(FORMAT_V2, {})) === 'new', 'compiled: 2.00704 + {} → new');
  ok(classifyCompiled(C(FORMAT_V3, {})) === 'new', 'compiled: 3.00001 + {} → new');
  ok(classifyCompiled(C(FORMAT_V2, { a: 1 })) === 'invalid', 'compiled: 2.00704 + 重み → invalid');
  ok(classifyCompiled(C(4, {})) === 'invalid', 'compiled: 未知版 4 → invalid');
  ok(classifyCompiled(C(FORMAT_V2, undefined)) === 'invalid', 'compiled: 2.00704 + weight_buffer 欠落 → invalid');

  // --- (B) 出力物の向き ---
  const cleanViewer = '/* maplat viewer */ 2.00704';
  const staleViewer = '/* maplat viewer */ weight_buffer';
  const oldMap = { compiled: C(OLD_V2, { a: 1 }), sub_maps: [] };
  const newMap = { compiled: C(FORMAT_V2, {}) };
  const badMap = { compiled: C(FORMAT_V2, { a: 1 }) };
  ok(evaluateExport({ jsContent: cleanViewer, mapJsons: [{ name: 'maps/a.json', json: oldMap }] }).ok === true,
    '(B): 新ビューア + 旧 compiled → 合格（陰性対照）');
  ok(evaluateExport({ jsContent: staleViewer, mapJsons: [{ name: 'maps/a.json', json: oldMap }] }).ok === false,
    '(B): 旧ビューア（weight_buffer あり）→ 不合格（陽性対照）');
  ok(evaluateExport({ jsContent: cleanViewer, mapJsons: [{ name: 'maps/a.json', json: badMap }] }).ok === false,
    '(B): 新ビューア + 2.00704 重みあり compiled → 不合格');
  ok(evaluateExport({ jsContent: cleanViewer, mapJsons: [{ name: 'maps/a.json', json: newMap }] }).newCount === 1,
    '(B): 新 compiled の件数が 1');

  // --- ビューア bundle の新旧判定（(B)・prepare 依存なし検査で共用）---
  ok(evaluateViewerBundle('2.00704').viewerOk === true, 'viewer bundle: 2.00704 のみ → 新（合格）');
  ok(evaluateViewerBundle('weight_buffer').viewerOk === false, 'viewer bundle: weight_buffer あり → 旧（不合格）');
  ok(evaluateViewerBundle('2.00704 weight_buffer').viewerOk === false, 'viewer bundle: 2.00704 + weight_buffer → 不合格');

  // --- (A) 各検査の向き ---
  const PASS = {
    specifiers: { transform: '^1.0.0', tin: '^1.0.0', core: '^1.0.0', ui: '^1.0.0' },
    lockVersions: { transform: ['1.0.0'], tin: ['1.0.0'], core: ['1.0.0'], ui: ['1.0.0'] },
    lockEdges: { tinTransform: '1.0.0', coreTransform: '1.0.0', uiCore: '1.0.0' },
    content: {
      formatVersion: FORMAT_V2,
      transformDistWeightBuffer: 0,
      tinCompiled: { version: FORMAT_V2, weightBufferEmpty: true },
      coreDistWeightBuffer: 0,
      coreSrcWeightBuffer: 0,
      uiDistWeightBuffer: 0,
      uiDistFormatMarkers: 1,
    },
    preview: {
      jsSha: 'a'.repeat(64), distJsSha: 'a'.repeat(64),
      cssSha: 'b'.repeat(64), distCssSha: 'b'.repeat(64),
    },
  };
  const clone = () => structuredClone(PASS);
  ok(checkA1(PASS).ok === true, 'A1: 合格入力 → ok');
  {
    const f = clone();
    f.content.formatVersion = OLD_V2;
    ok(checkA1(f).ok === false, 'A1: format_version 2.00703 → ng');
  }
  {
    const f = clone();
    f.lockVersions.transform = ['0.5.2', '1.0.0']; // 2 種の transform を含む lock 断片
    ok(checkA1(f).ok === false, 'A1: transform が lock に 2 種類 → ng');
  }
  {
    const f = clone();
    f.content.transformDistWeightBuffer = 3;
    ok(checkA1(f).ok === false, 'A1: dist に weight_buffer 3 件 → ng');
  }
  {
    const f = clone();
    f.specifiers.transform = '^9.9.9';
    ok(checkA1(f).ok === false, 'A1: 下限と解決版の不一致 → ng');
  }

  ok(checkA2(PASS, '1.0.0').ok === true, 'A2: 合格入力 → ok');
  {
    const f = clone();
    f.content.tinCompiled.version = OLD_V2;
    ok(checkA2(f, f.lockVersions.transform[0]).ok === false, 'A2: getCompiled version 2.00703 → ng');
  }
  {
    const f = clone();
    f.content.tinCompiled.weightBufferEmpty = false;
    ok(checkA2(f, f.lockVersions.transform[0]).ok === false, 'A2: getCompiled 重みあり → ng');
  }
  {
    const f = clone();
    f.lockEdges.tinTransform = '0.5.2';
    ok(checkA2(f, f.lockVersions.transform[0]).ok === false, 'A2: tin→transform の辺が不一致 → ng');
  }

  ok(checkA3(PASS, '1.0.0').ok === true, 'A3: 合格入力 → ok');
  {
    const f = clone();
    f.content.coreDistWeightBuffer = 3;
    ok(checkA3(f, f.lockVersions.transform[0]).ok === false, 'A3: core dist に重量 3 件 → ng');
  }
  {
    const f = clone();
    f.content.coreSrcWeightBuffer = 1;
    ok(checkA3(f, f.lockVersions.transform[0]).ok === false, 'A3: core src に 1 件 → ng');
  }
  {
    const f = clone();
    f.lockEdges.coreTransform = '0.5.2';
    ok(checkA3(f, f.lockVersions.transform[0]).ok === false, 'A3: core→transform の辺が不一致 → ng');
  }

  ok(checkA4(PASS, '1.0.0').ok === true, 'A4: 合格入力 → ok');
  {
    const f = clone();
    f.content.uiDistWeightBuffer = 3;
    ok(checkA4(f, f.lockVersions.core[0]).ok === false, 'A4: ui dist weight_buffer 3 件 → ng');
  }
  {
    const f = clone();
    f.content.uiDistFormatMarkers = 0;
    ok(checkA4(f, f.lockVersions.core[0]).ok === false, 'A4: ui dist 2.00704 0 件 → ng');
  }
  {
    const f = clone();
    f.lockEdges.uiCore = '9.9.9';
    ok(checkA4(f, f.lockVersions.core[0]).ok === false, 'A4: ui→core の辺が不一致 → ng');
  }

  ok(checkA5(PASS).ok === true, 'A5: 合格入力 → ok');
  {
    const f = clone();
    f.preview.jsSha = 'c'.repeat(64);
    ok(checkA5(f).ok === false, 'A5: 同期漏れ（sha256 不一致）→ ng');
  }

  // --- pnpm-lock.yaml のテキスト解析（js-yaml を使わない。依存なし分岐用）---
  const NEW_LOCK_TEXT = [
    "lockfileVersion: '9.0'",
    'packages:',
    "  '@maplat/transform@1.1.0-rc.0':",
    '    resolution: {integrity: sha512-T}',
    "  '@maplat/tin@1.1.0-rc.0':",
    '    resolution: {integrity: sha512-T}',
    "  '@maplat/core@1.1.0-rc.0':",
    '    resolution: {integrity: sha512-C}',
    "  '@maplat/ui@1.1.0-rc.0':",
    '    resolution: {integrity: sha512-U}',
    'snapshots:',
    "  '@maplat/tin@1.1.0-rc.0':",
    '    dependencies:',
    "      '@maplat/transform': 1.1.0-rc.0",
    "  '@maplat/core@1.1.0-rc.0(mapbox-gl@3.0.0)':",
    '    dependencies:',
    "      '@maplat/transform': 1.1.0-rc.0",
    "  '@maplat/ui@1.1.0-rc.0(mapbox-gl@3.0.0)':",
    '    dependencies:',
    "      '@maplat/core': 1.1.0-rc.0(mapbox-gl@3.0.0)",
  ].join('\n');
  const OLD_LOCK_TEXT = [
    "lockfileVersion: '9.0'",
    'packages:',
    "  '@maplat/transform@1.0.0':",
    '    resolution: {integrity: sha512-T}',
    "  '@maplat/tin@1.0.0':",
    '    resolution: {integrity: sha512-T}',
    "  '@maplat/core@1.0.0':",
    '    resolution: {integrity: sha512-C}',
    "  '@maplat/ui@1.0.0':",
    '    resolution: {integrity: sha512-U}',
    'snapshots:',
    "  '@maplat/tin@1.0.0':",
    '    dependencies:',
    "      '@maplat/transform': 1.0.0",
    "  '@maplat/core@1.0.0(mapbox-gl@3.0.0)':",
    '    dependencies:',
    "      '@maplat/transform': 1.0.0",
    "  '@maplat/ui@1.0.0(mapbox-gl@3.0.0)':",
    '    dependencies:',
    "      '@maplat/core': 1.0.0(mapbox-gl@3.0.0)",
  ].join('\n');
  ok(JSON.stringify(textResolvedVersions(NEW_LOCK_TEXT, '@maplat/transform')) === JSON.stringify(['1.1.0-rc.0']), 'lock テキスト: transform 解決版は 1 種類');
  ok(JSON.stringify(textResolvedVersions(NEW_LOCK_TEXT, '@maplat/core')) === JSON.stringify(['1.1.0-rc.0']), 'lock テキスト: core 解決版は 1 種類');
  ok(textSnapshotDep(NEW_LOCK_TEXT, '@maplat/tin', '1.1.0-rc.0', '@maplat/transform') === '1.1.0-rc.0', 'lock テキスト: tin→transform の辺');
  ok(textSnapshotDep(NEW_LOCK_TEXT, '@maplat/core', '1.1.0-rc.0', '@maplat/transform') === '1.1.0-rc.0', 'lock テキスト: core→transform の辺（peer 付きキー）');
  ok(textSnapshotDep(NEW_LOCK_TEXT, '@maplat/ui', '1.1.0-rc.0', '@maplat/core') === '1.1.0-rc.0(mapbox-gl@3.0.0)', 'lock テキスト: ui→core の辺');

  // --- 依存なし検査（evaluateDependencyFreeFacts）の向き（Major-1 の是正 FIX2）---
  const NEW_PKG = { dependencies: { '@maplat/transform': '^1.1.0-rc.0', '@maplat/tin': '^1.1.0-rc.0', '@maplat/core': '^1.1.0-rc.0', '@maplat/ui': '^1.1.0-rc.0' } };
  const OLD_PKG = { dependencies: { '@maplat/transform': '^1.0.0', '@maplat/tin': '^1.0.0', '@maplat/core': '^1.0.0', '@maplat/ui': '^1.0.0' } };
  const NEW_PREVIEW = '/* maplat viewer */ 2.00704';
  const OLD_PREVIEW = '/* maplat viewer */ weight_buffer';
  ok(evaluateDependencyFreeFacts({ pkg: NEW_PKG, lockText: NEW_LOCK_TEXT, previewJs: NEW_PREVIEW }).failed === false,
    '依存なし: 新 preview + 新 package/lock → 合格');
  ok(evaluateDependencyFreeFacts({ pkg: OLD_PKG, lockText: OLD_LOCK_TEXT, previewJs: NEW_PREVIEW }).failed === true,
    '依存なし: 新 preview + 旧 package/lock → 不合格（旧世代 1.0.0 を拒否。enforce exit 1 の向き）');
  ok(evaluateDependencyFreeFacts({ pkg: OLD_PKG, lockText: NEW_LOCK_TEXT, previewJs: NEW_PREVIEW }).failed === true,
    '依存なし: 旧 package（下限 ^1.0.0）+ 新 lock（1.1.0-rc.0）→ 下限不一致で不合格');
  ok(evaluateDependencyFreeFacts({ pkg: NEW_PKG, lockText: NEW_LOCK_TEXT, previewJs: OLD_PREVIEW }).failed === true,
    '依存なし: 旧ビューア（weight_buffer あり）+ 新 package/lock → 不合格');
  ok(evaluateDependencyFreeFacts({ pkg: null, lockText: NEW_LOCK_TEXT, previewJs: NEW_PREVIEW }).failed === true,
    '依存なし: package.json を読めない → 不合格（fail-closed）');
  ok(evaluateDependencyFreeFacts({ pkg: NEW_PKG, lockText: null, previewJs: NEW_PREVIEW }).failed === true,
    '依存なし: pnpm-lock.yaml を読めない → 不合格（fail-closed）');
  ok(evaluateDependencyFreeFacts({ pkg: { dependencies: {} }, lockText: NEW_LOCK_TEXT, previewJs: NEW_PREVIEW }).failed === true,
    '依存なし: 4 パッケージの宣言なし → 不合格（fail-closed）');

  console.log(`\n✅ --self-test: ${passed}/${total} ケース合格`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      [
        'usage: node scripts/m12-t5/check-viewer-freshness.mjs [--enforce|--warn|--export <path>|--self-test]',
        '  --enforce        A1〜A5 を検査し、不合格なら exit 1',
        '  --warn           A1〜A5 を検査し、結果を出すが exit 0',
        '  --export <path>  書き出し（zip または展開ディレクトリ）の (B) を検査',
        '  --self-test      合成入力で判定の向きを検査（CI の smoke はこれを呼ぶ）',
        '  （引数なし）      自動: 規則表（mode / tag）で enforce/warn を決めて A1〜A5 を検査',
      ].join('\n')
    );
    return 0;
  }

  if (args.includes('--self-test')) {
    return await runSelfTest();
  }

  const exportIdx = args.indexOf('--export');
  if (exportIdx !== -1) {
    const target = args[exportIdx + 1];
    if (!target) {
      console.error('::error:: --export には対象パスを指定してください');
      return 2;
    }
    return await runExport(target);
  }

  let mode;
  if (args.includes('--enforce')) mode = 'enforce';
  else if (args.includes('--warn')) mode = 'warn';
  else {
    // 自動: 規則表で決める（mode env + tag の有無）
    const envMode = (process.env.MODE ?? 'verify').trim();
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const version = pkg.version;
    const lsRemote = spawnSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${version}`], {
      encoding: 'utf8',
    });
    const tagState = classifyTagState(lsRemote.stdout, lsRemote.status ?? (lsRemote.error ? 1 : 0));
    mode = decideEnforceOrWarn({ mode: envMode, tagState });
    console.log(
      `[viewer-freshness] 自動判定: mode=${envMode} / version=${version} / tag v${version} = ${tagState} → ${mode}`
    );
  }

  if (depsAvailableForAuto(projectRoot)) {
    const facts = await gatherDepsFacts(projectRoot);
    const results = runA(facts);
    const failed = printResults(results, mode);
    emitSummary([`viewer-freshness（${mode}）: ${failed ? '不合格' : '合格'}`]);
    if (mode === 'enforce') return failed ? 1 : 0;
    return 0;
  }

  // prepare 相当（node_modules 無し）: package.json（4 パッケージの宣言）と pnpm-lock.yaml（解決版・
  // 依存辺）をテキストで読み、A1〜A4 の lock/spec 基準（解決版 1 種類・下限一致・依存辺一致）と
  // 旧世代拒否（解決版 ≤ 1.0.0）を評価し、同梱ビューア public/preview の内容を直接検査する
  // （fail-closed）。js-yaml / node_modules は使わない（Major-1 の是正 FIX2）。公開済みの版（warn）は
  // 結果を出すだけ exit 0、未公開の版（enforce）は旧 package/lock や旧ビューア同梱で exit 1。
  console.log('[viewer-freshness] prepare（node_modules 無し）: package.json と pnpm-lock.yaml をテキストで読み、');
  console.log('  A1〜A4 の lock/spec 基準（解決版 1 種類・下限一致・依存辺一致・旧世代拒否）と同梱ビューアを検査します。');
  const depFree = evaluateDependencyFree(projectRoot);
  const failed = printResults(depFree.results, mode);
  emitSummary([
    `viewer-freshness（${mode}・prepare/node_modules 無し）: ${failed ? '不合格' : '合格'}`,
  ]);
  if (mode === 'enforce') return failed ? 1 : 0;
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error('::error::', err?.stack ?? err);
    process.exitCode = 1;
  }
);