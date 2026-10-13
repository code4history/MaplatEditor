// Windows 配布物の全 PE 署名 — electron-builder のファイルごとの署名フック
// （Azure Artifact Signing の署名専用ジョブへ渡す収集〔collect〕と、退路の SSL.com eSigner / CodeSignTool）
//
// なぜ（2026-10-03・SAC 起動拒否）:
//   v1.0.0 / v1.1.0-rc.1 は Setup.exe の 2 本にしか署名しておらず、インストール後の MaplatEditor.exe・
//   Electron の DLL・elevate.exe・アンインストーラー・NSIS プラグイン DLL が未署名だった。
//   Windows 11 のスマート アプリ コントロール（SAC）は exe だけでなく DLL も止めるため、
//   同僚の PC でアプリが「発行元を確認できない」として起動できなかった。
//   ∴ 配布物に入る Windows PE を**すべて**署名する（Microsoft 署名済みのものは再署名しない）。
//
// 仕組み:
//   - electron-builder の win.signtoolOptions.sign（ファイルごとに呼ばれる）へ `sign` を渡す。
//     electron-builder 自身がアプリ本体 exe・signExts に合う DLL / .node・elevate.exe・アンインストーラー・
//     インストーラーの順に呼ぶ。インストーラーの署名は blockmap / latest.yml の計算より**前**に行われる
//     （app-builder-lib NsisTarget.js: signIf(installerPath) → createBlockmap → emitArtifactBuildCompleted）。
//   - NSIS のプラグイン DLL は makensis がインストーラーへ埋め込むため、フックの対象にならない。
//     `beforePack` で NSIS ツールセットを作業ディレクトリへ複写し、使うプラグインだけ署名してから
//     ELECTRON_BUILDER_NSIS_DIR / ELECTRON_BUILDER_NSIS_RESOURCES_DIR で electron-builder に使わせる。
//     1 回のビルドで x64・arm64 の両インストーラーが同じ複写を使う（署名はプラグインごとに 1 回）。
//
// モード（環境変数 WIN_SIGN_MODE）:
//   off（既定）… 何もしない。electron-builder.config.cjs はフックも beforePack も登録しない（従来どおり）
//   record   … 署名しない。フックに渡されたファイルと「署名するはずだったか」を JSON 行で記録する（課金ゼロ）
//   collect  … 署名しない。record と同じ判断と記録に加えて、署名するはずのファイルを WIN_SIGN_COLLECT_DIR へ
//              `<SHA-256>.pe` の名前で複写する（nov26-m7-t2）。build.yml の署名専用ジョブ（id-token を持ち、依存を
//              一切実行しない）が Artifact Signing で署名し、次の pack のジョブへ返す。キャッシュは引かない（C-4）。
//              WIN_SIGN_SIGNED_DIR に同じ実行で署名済みの `<SHA-256>--<名前>.signed` があれば、関門（署名を除き
//              TimeDateStamp も除いた中身の一致・証明書表・Authenticode Valid・署名者が artifact-signing）を通ったものだけ
//              差し替える（decision: signed-substituted）。関門は Windows でしか通らない（他の OS では would-sign に落ちる）
//   esigner  … CodeSignTool で本当に署名する（課金あり。build.yml の mode=full・win_signer=esigner だけ。J-7 の退路）
//
// --prepackaged（build.yml の pack のジョブ）では beforePack が呼ばれない（app-builder-lib の doPack が先頭で
// return する）。∴ NSIS ツールセットの用意は electron-builder の外の step（prepare-nsis-toolset.mjs）が
// prepareSignedNsisToolset を呼んで行い、用意した印（<root>/.win-sign-prepared.json）を書く。collect のとき
// sign() はアンインストーラー・インストーラーの署名の前にその印を確かめ、無ければ落ちる（fail-closed）。
//
// 署名済みファイルのキャッシュ（依存の版が同じなら Electron の DLL・elevate.exe・.node・NSIS プラグインは
// バイト単位で同じ。毎リリース署名し直すのは課金の無駄）:
//   - キー = 署名前ファイルの SHA-256。asset 名 = `<キー>--<ファイル名>.signed`
//   - 引く順: (1) このプロセスで署名済み（x64 と arm64 で同じファイル）→ (2) WIN_SIGN_CACHE_DIR →
//     (3) WIN_SIGN_CACHE_URL（GitHub Release `win-signed-cache` の asset。読むだけなのでトークン不要）
//   - 取り込む前に確かめる: 署名を除いた中身が署名前ファイルと一致 / 証明書表がある /
//     Authenticode が Valid / 署名者が signer-identity.json の esigner（Windows のみ）。1 つでも外れたら使わずに署名する
//   - 新しく署名したキャッシュ対象は WIN_SIGN_CACHE_OUTBOX へ置く。build.yml は artifact で
//     書き込み権限のある別ジョブへ渡し、そこで Release の asset に足す（build ジョブに write を与えない）
//   - MaplatEditor.exe・アンインストーラー・インストーラーは毎リリース中身が変わるため対象外（毎回署名）
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const signerIdentity = require('./signer-identity.cjs');

const MODES = ['off', 'record', 'collect', 'esigner'];

/** electron-builder の NSIS テンプレートが実際に埋め込むプラグイン（v1.1.0-rc.1 の $PLUGINSDIR から実測）。
 *  増えたら verify-win-sign-coverage.mjs が「未署名の PE」として落とすので、ここへ足す。 */
const NSIS_PLUGINS_TO_SIGN = [
  'StdUtils.dll', 'System.dll', 'UAC.dll', 'WinShell.dll', 'nsDialogs.dll', 'nsExec.dll', 'nsis7z.dll',
];

/** キャッシュしてよいファイル（依存の版が変わらない限り中身が同じもの）。
 *  MaplatEditor.exe・アンインストーラー・インストーラーは毎回変わるので入れない。 */
function isCacheable(file) {
  const base = path.basename(file).toLowerCase();
  return base.endsWith('.dll') || base.endsWith('.node') || base === 'elevate.exe';
}

function getMode() {
  const raw = (process.env.WIN_SIGN_MODE ?? '').trim().toLowerCase();
  if (raw === '') return 'off';
  if (!MODES.includes(raw)) {
    throw new Error(`WIN_SIGN_MODE の値が不正です: "${raw}"（${MODES.join(' / ')} のいずれか）`);
  }
  return raw;
}

const workDir = () => path.resolve(process.env.WIN_SIGN_WORK_DIR || path.join('release', '.win-sign'));
const recordFile = () => path.resolve(process.env.WIN_SIGN_RECORD_FILE || path.join(workDir(), 'sign-record.jsonl'));
const outboxDir = () => path.resolve(process.env.WIN_SIGN_CACHE_OUTBOX || path.join(workDir(), 'cache-outbox'));
const collectDir = () => path.resolve(process.env.WIN_SIGN_COLLECT_DIR || path.join(workDir(), 'collect'));
const signedDir = () => (process.env.WIN_SIGN_SIGNED_DIR ? path.resolve(process.env.WIN_SIGN_SIGNED_DIR) : null);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ───────────────────────────────────────────────
// PE の解析
// ───────────────────────────────────────────────

/** PE なら証明書表（IMAGE_DIRECTORY_ENTRY_SECURITY）と CheckSum の位置を返す。PE でなければ null。 */
function readPeInfo(buf) {
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) return null; // 'MZ'
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return null; // 'PE\0\0'
  const opt = peOff + 24;
  if (opt + 2 > buf.length) return null;
  const magic = buf.readUInt16LE(opt);
  if (magic !== 0x10b && magic !== 0x20b) return null;
  const numDirsOff = opt + (magic === 0x20b ? 108 : 92);
  const dirsOff = opt + (magic === 0x20b ? 112 : 96);
  if (dirsOff + 5 * 8 > buf.length) return null;
  const numDirs = buf.readUInt32LE(numDirsOff);
  const secDirOff = dirsOff + 4 * 8;
  const certOffset = numDirs > 4 ? buf.readUInt32LE(secDirOff) : 0;
  const certSize = numDirs > 4 ? buf.readUInt32LE(secDirOff + 4) : 0;
  const hasCert = certSize > 0 && certOffset > 0 && certOffset + certSize <= buf.length;
  return { magic, peOff, checksumOff: opt + 64, secDirOff: numDirs > 4 ? secDirOff : null, certOffset, certSize, hasCert };
}

/** 署名を除いた中身のハッシュ。署名で変わる 3 か所（CheckSum・証明書表の位置/大きさ・末尾の証明書表と
 *  その前の 8 バイト境界への詰め物）を除いて比べる。未署名ファイルとその署名済み版で一致する。 */
function strippedDigest(buf, { zeroTimeDateStamp = false } = {}) {
  const pe = readPeInfo(buf);
  if (pe == null) throw new Error('PE ではありません');
  const end = pe.hasCert ? pe.certOffset : buf.length;
  const body = Buffer.from(buf.subarray(0, end));
  body.fill(0, pe.checksumOff, pe.checksumOff + 4);
  if (pe.secDirOff != null) body.fill(0, pe.secDirOff, pe.secDirOff + 8);
  // COFF ヘッダーの TimeDateStamp（'PE\0\0' の 8 バイト後の 4 バイト）。リンカ／makensis が書く時刻で、働きに関わらない
  if (zeroTimeDateStamp) body.fill(0, pe.peOff + 8, pe.peOff + 12);
  let n = body.length;
  while (n > 0 && body[n - 1] === 0) n--;
  return sha256(body.subarray(0, n));
}

/** 署名を除き、さらに TimeDateStamp も除いた中身のハッシュ（nov26-m7-t2・決定的にする手当て (b)）。
 *  同じ入力から 2 回作ったアンインストーラーは時刻だけが違いうるので、差し替えの照合はこれで行う。 */
const comparableDigest = (buf) => strippedDigest(buf, { zeroTimeDateStamp: true });

/** 埋め込まれた PKCS#7（WIN_CERTIFICATE の bCertificate）を取り出す。無ければ null。 */
function extractPkcs7(buf) {
  const pe = readPeInfo(buf);
  if (pe == null || !pe.hasCert) return null;
  const len = buf.readUInt32LE(pe.certOffset);
  return Buffer.from(buf.subarray(pe.certOffset + 8, pe.certOffset + Math.min(len, pe.certSize)));
}

// ───────────────────────────────────────────────
// Authenticode の検証（Windows のみ。Get-AuthenticodeSignature）
// ───────────────────────────────────────────────

/** @returns {{status: string, subject: string|null, chain: Array<{subject: string, thumbprint: string}>}} */
function authenticode(file) {
  return signerIdentity.authenticodeFiles([file]).get(file);
}

// smoke のための差し込み口（製品の経路からは呼ばない）。platform と authenticode の参照、NSIS ツールセットの
// 複写元（既定は app-builder-lib の getNsisElevatePath・getNsisPluginsPath ＝ macOS ではツールセットの取得が走る）を差し替える
const defaultDeps = () => ({ platform: process.platform, authenticode, toolsetSources: null });
let deps = defaultDeps();
function __setDepsForTest(next) {
  deps = next == null ? defaultDeps() : { ...defaultDeps(), ...next };
}

/** 証明書の subject の CN が期待どおりか（旧来の判定。照合には使わない — 照合は signer-identity.cjs の checkSigner）。
 *  .NET（Get-AuthenticodeSignature）は値にカンマを含むと引用符で囲むため、引用符あり・なしの両方を読む。 */
function subjectHasCn(subject, cn) {
  if (!subject) return false;
  const re = /(?:^|,\s*)CN=(?:"((?:[^"]|"")*)"|([^,]*))/g;
  for (const m of subject.matchAll(re)) {
    const value = (m[1] != null ? m[1].replace(/""/g, '"') : m[2]).trim();
    if (value === cn) return true;
  }
  // 引用符なしでカンマを含む値（"CN=ACME, INC., O=..."）は上の分割では切れるので、文字列として照らす
  const bare = `CN=${cn}`;
  return subject === bare || subject.startsWith(`${bare}, `) || subject.includes(`, ${bare}, `) || subject.endsWith(`, ${bare}`);
}

// ───────────────────────────────────────────────
// 記録（JSON 行）
// ───────────────────────────────────────────────
function record(entry) {
  const file = recordFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), mode: getMode(), ...entry }) + '\n');
}

// ───────────────────────────────────────────────
// 署名済みファイルのキャッシュ
// ───────────────────────────────────────────────
// 末尾の .signed は、Release の asset や Actions の artifact に .exe / .dll の名前で並ばないようにするため
// （scripts/oct26-m4-t2-ci-artifact-verify.mjs は成果物中の全 .exe に版番号を要求する。配布物と見誤らせない意味もある）
const assetName = (key, file) => `${key}--${path.basename(file).replace(/[^A-Za-z0-9._-]/g, '_')}.signed`;

/** このプロセスで署名した・検証済みキャッシュを使ったキー → 署名済みファイル（record モードでは null）。
 *  x64 と arm64 で同じファイル（elevate.exe 等）を 2 回署名しない・2 回取得しないため */
const sessionHits = new Map();

/**
 * 取り込んでよい署名済みファイルか。改ざん・取り違えを入れないための関門。
 * @returns {string|null} 不可の理由（可なら null）
 */
function rejectCachedReason(cachedBuf, unsignedDigest, cachedPath) {
  const pe = readPeInfo(cachedBuf);
  if (pe == null) return 'PE ではない';
  if (!pe.hasCert) return '証明書表が無い（署名されていない）';
  if (strippedDigest(cachedBuf) !== unsignedDigest) return '署名を除いた中身が署名前ファイルと一致しない';
  if (deps.platform === 'win32') {
    const a = deps.authenticode(cachedPath);
    if (a.status !== 'Valid') return `Authenticode が Valid でない（${a.status}）`;
    // キャッシュ（Release win-signed-cache）の中身は eSigner の署名
    const why = signerIdentity.checkSigner(a, 'esigner');
    if (why != null) return why;
  } else if (getMode() === 'esigner') {
    return 'esigner モードは Windows でしか Authenticode を確かめられない';
  }
  return null;
}

async function fetchRemote(name, dest) {
  const base = (process.env.WIN_SIGN_CACHE_URL || '').trim();
  if (base === '') return false;
  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(name)}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status === 404) return false;
    if (!res.ok) {
      console.warn(`[win-sign] キャッシュ取得に失敗（HTTP ${res.status}）。署名で代える: ${name}`);
      return false;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (e) {
    console.warn(`[win-sign] キャッシュ取得で例外（${e.message}）。署名で代える: ${name}`);
    return false;
  }
}

/**
 * キャッシュを引く。esigner モードでは検証済みの署名済みファイルの場所を返す。
 * record モードでは置き換えずに「当たるか」だけを返す（シミュレーション用に WIN_SIGN_CACHE_SIMULATE_DIR も見る）。
 * @returns {Promise<{source: string, path: string|null}|null>}
 */
async function lookupCache(file, key, unsignedDigest) {
  const name = assetName(key, file);
  const mode = getMode();
  if (sessionHits.has(key)) return { source: 'session', path: sessionHits.get(key) };
  if (mode === 'record') {
    const sim = process.env.WIN_SIGN_CACHE_SIMULATE_DIR;
    if (sim && fs.existsSync(path.join(sim, name))) return { source: 'simulate', path: null };
  }
  const candidates = [
    ...(process.env.WIN_SIGN_CACHE_DIR ? [{ source: 'local', path: path.join(path.resolve(process.env.WIN_SIGN_CACHE_DIR), name) }] : []),
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c.path)) continue;
    const reason = rejectCachedReason(fs.readFileSync(c.path), unsignedDigest, c.path);
    if (reason == null) return c;
    console.warn(`[win-sign] キャッシュを使わない（${c.source}: ${reason}）: ${name}`);
  }
  const fetched = path.join(workDir(), 'cache-fetched', name);
  if (await fetchRemote(name, fetched)) {
    const reason = rejectCachedReason(fs.readFileSync(fetched), unsignedDigest, fetched);
    if (reason == null) return { source: 'remote', path: fetched };
    console.warn(`[win-sign] キャッシュを使わない（remote: ${reason}）: ${name}`);
  }
  return null;
}

// ───────────────────────────────────────────────
// CodeSignTool（SSL.com eSigner）
// ───────────────────────────────────────────────
function redact(text) {
  let t = String(text ?? '');
  for (const k of ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
    const v = process.env[k];
    if (v) t = t.split(v).join('***');
  }
  return t;
}

/** esigner-codesign action（v1.3.2）と同じ失敗判定。CodeSignTool は失敗しても exit 0 を返すことがある。 */
const FAILURE_MARKERS = ['Error', 'Exception', 'Missing required option', 'Unmatched argument'];

function resolveCodeSignTool() {
  const dir = process.env.CODE_SIGN_TOOL_PATH;
  if (!dir || !fs.existsSync(dir)) {
    throw new Error('CODE_SIGN_TOOL_PATH が未設定か存在しません（build.yml の CodeSignTool 取得 step を確認）');
  }
  const jarDir = path.join(dir, 'jar');
  const jar = fs.readdirSync(jarDir).find((f) => /^code_sign_tool-.*\.jar$/.test(f));
  if (!jar) throw new Error(`CodeSignTool の jar が見つかりません: ${jarDir}`);
  const java = process.env.CODESIGNTOOL_JAVA
    || path.join(dir, 'jdk-11.0.2', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!fs.existsSync(java)) throw new Error(`CodeSignTool 同梱の Java が見つかりません: ${java}`);
  return { dir, jar: path.join(jarDir, jar), java };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CodeSignTool は拡張子で署名形式を決める。.node（中身は PE の DLL）は
// 「Unsupported file format for signing - node」で断られる（1.1.0-rc.2 の run 37125230712）。
// ∴ 対応外の拡張子は、作業ディレクトリに .dll の名前でコピーして署名し、元のファイルへ書き戻す。
const CODESIGNTOOL_EXTS = new Set(['.exe', '.dll', '.msi', '.sys', '.ocx', '.cab', '.cat', '.ps1', '.psm1', '.appx', '.msix']);

async function codeSignTool(file) {
  const ext = path.extname(file).toLowerCase();
  if (!CODESIGNTOOL_EXTS.has(ext)) {
    const base = process.env.WIN_SIGN_WORK_DIR ? path.resolve(process.env.WIN_SIGN_WORK_DIR) : os.tmpdir();
    fs.mkdirSync(base, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(base, 'ext-'));
    const alias = path.join(tmpDir, `${path.basename(file, path.extname(file))}.dll`);
    fs.copyFileSync(file, alias);
    console.log(`[win-sign] ${path.basename(file)} は CodeSignTool が拡張子で受け付けないため、${path.basename(alias)} として署名する`);
    await codeSignToolRaw(alias);
    fs.copyFileSync(alias, file);
    return;
  }
  await codeSignToolRaw(file);
}

async function codeSignToolRaw(file) {
  for (const k of ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
    if (!process.env[k]) throw new Error(`${k} が未設定です（environment release の secrets）`);
  }
  const tool = resolveCodeSignTool();
  const args = [
    '-Xmx1024M', '-jar', tool.jar, 'sign',
    `-username=${process.env.ES_USERNAME}`,
    `-password=${process.env.ES_PASSWORD}`,
    `-credential_id=${process.env.ES_CREDENTIAL_ID}`,
    `-totp_secret=${process.env.ES_TOTP_SECRET}`,
    `-input_file_path=${path.resolve(file)}`, // CodeSignTool は cwd を自分の置き場にして動かすため絶対パスで渡す
    '-override=true',
  ];
  // OTP は 30 秒窓。連続署名で同じ OTP が拒まれたときだけ、次の窓まで待って最大 2 回やり直す
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync(tool.java, args, {
      cwd: tool.dir, env: { ...process.env, CODE_SIGN_TOOL_PATH: tool.dir }, encoding: 'utf8', timeout: 600_000,
    });
    const out = redact(`${r.stdout ?? ''}\n${r.stderr ?? ''}`).trim();
    console.log(`[win-sign] CodeSignTool（${attempt} 回目）: ${path.basename(file)}\n${out}`);
    const failed = r.error != null || r.status !== 0 || FAILURE_MARKERS.some((m) => out.includes(m));
    if (!failed) return;
    if (attempt < 3 && /OTP/i.test(out)) {
      const wait = 30_000 - (Date.now() % 30_000) + 2_000;
      console.warn(`[win-sign] OTP が拒まれた。${Math.round(wait / 1000)} 秒待って再試行します`);
      await sleep(wait);
      continue;
    }
    throw new Error(`CodeSignTool の署名に失敗しました: ${file}${r.error ? ` (${r.error.message})` : ''}`);
  }
}

// ───────────────────────────────────────────────
// 同じ実行の署名済みファイルでの差し替え（collect・nov26-m7-t2）
// ───────────────────────────────────────────────
/**
 * WIN_SIGN_SIGNED_DIR から、このファイルの署名済みの複写を探す。名前のキーは署名前ファイルの SHA-256。
 * キーで見つからなければ、同じ名前（`--<名前>.signed`）の全候補を関門にかける（アンインストーラーは作り直すと
 * TimeDateStamp だけが違いうるので SHA-256 が変わる）。
 * @returns {{path: string, buf: Buffer}|{rejected: string[]}|null} 候補が無ければ null
 */
function findSignedSubstitute(file, buf, key) {
  const dir = signedDir();
  if (dir == null || !fs.existsSync(dir)) return null;
  const exact = path.join(dir, assetName(key, file));
  const suffix = assetName(key, file).slice(key.length); // `--<名前>.signed`
  const candidates = fs.existsSync(exact)
    ? [exact]
    : fs.readdirSync(dir).filter((n) => n.endsWith(suffix) && /^[0-9a-f]{64}--/.test(n)).sort().map((n) => path.join(dir, n));
  if (candidates.length === 0) return null;
  const want = comparableDigest(buf);
  const rejected = [];
  for (const c of candidates) {
    const cbuf = fs.readFileSync(c);
    const pe = readPeInfo(cbuf);
    let reason = null;
    if (pe == null) reason = 'PE ではない';
    else if (!pe.hasCert) reason = '証明書表が無い（署名されていない）';
    else if (comparableDigest(cbuf) !== want) reason = '署名と TimeDateStamp を除いた中身が署名前ファイルと一致しない';
    else if (deps.platform !== 'win32') reason = 'Windows でしか確かめられない（Authenticode・署名者）';
    else {
      const a = deps.authenticode(c);
      if (a.status !== 'Valid') reason = `Authenticode が Valid でない（${a.status}）`;
      else reason = signerIdentity.checkSigner(a, 'artifact-signing');
    }
    if (reason == null) return { path: c, buf: cbuf };
    rejected.push(`${path.basename(c)}: ${reason}`);
  }
  return { rejected };
}

/** 中身を書き換えたファイルの mtime を元へ戻す（NSIS は File で入れるファイルの日時を保存する ∴ 決定的にする手当て (a)） */
function writeKeepingTimes(file, buf, st) {
  fs.writeFileSync(file, buf);
  fs.utimesSync(file, st.atime, st.mtime);
}

// ───────────────────────────────────────────────
// 1 ファイルの署名判断（フック・NSIS プラグインの両方がここを通る）
// ───────────────────────────────────────────────
/**
 * @param {string} file
 * @param {{kind?: string}} [opts]
 * @returns {Promise<string>} decision
 */
async function signFile(file, opts = {}) {
  const mode = getMode();
  const kind = opts.kind ?? 'electron-builder';
  if (mode === 'off') return 'off';

  const st = fs.statSync(file);
  const buf = fs.readFileSync(file);
  const key = sha256(buf);
  const base = { file: path.resolve(file), name: path.basename(file), kind, sha256: key, size: buf.length };
  const pe = readPeInfo(buf);
  if (pe == null) {
    record({ ...base, decision: 'skip-not-pe' });
    return 'skip-not-pe';
  }

  // 既に署名があるもの（Microsoft 署名の d3dcompiler_47.dll / dxil.dll 等）は再署名しない
  if (pe.hasCert) {
    let detail = 'embedded-signature';
    if (deps.platform === 'win32') {
      const a = deps.authenticode(file);
      detail = `${a.status}: ${a.subject ?? ''}`;
      if (a.status === 'Valid') {
        record({ ...base, decision: 'skip-already-signed', detail });
        return 'skip-already-signed';
      }
      if (mode === 'esigner') console.warn(`[win-sign] 署名はあるが Valid でないため署名し直す: ${file}（${detail}）`);
    } else {
      record({ ...base, decision: 'skip-already-signed', detail });
      return 'skip-already-signed';
    }
  }

  const cacheable = isCacheable(file);

  // collect（Artifact Signing の経路）: キャッシュを引かない（C-4）。同じ実行の署名済みがあれば差し替え、
  // 無ければ署名専用ジョブへ渡すために複写する
  if (mode === 'collect') {
    const sub = findSignedSubstitute(file, buf, key);
    if (sub && sub.path) {
      writeKeepingTimes(file, sub.buf, st);
      record({ ...base, decision: 'signed-substituted', cacheable, signedSha256: sha256(sub.buf), source: path.basename(sub.path) });
      return 'signed-substituted';
    }
    const collected = `${key}.pe`;
    fs.mkdirSync(collectDir(), { recursive: true });
    fs.copyFileSync(file, path.join(collectDir(), collected));
    record({
      ...base, decision: 'would-sign', cacheable, collected,
      ...(sub && sub.rejected ? { detail: `差し替えなかった: ${sub.rejected.join(' / ')}` } : {}),
    });
    return 'would-sign';
  }

  const unsignedDigest = cacheable ? strippedDigest(buf) : null;
  if (cacheable) {
    const hit = await lookupCache(file, key, unsignedDigest);
    if (hit) {
      // record モードは成果物を変えない（照合は署名前の SHA-256 で行うため）
      if (mode === 'esigner') {
        writeKeepingTimes(file, fs.readFileSync(hit.path), st);
        sessionHits.set(key, hit.path);
      } else {
        sessionHits.set(key, null);
      }
      record({ ...base, decision: 'cache-hit', cache: hit.source });
      return 'cache-hit';
    }
  }

  if (mode === 'record') {
    if (cacheable) {
      sessionHits.set(key, null);
      const sim = process.env.WIN_SIGN_CACHE_SIMULATE_DIR;
      if (sim) {
        fs.mkdirSync(sim, { recursive: true });
        fs.writeFileSync(path.join(sim, assetName(key, file)), ''); // 印だけ（中身は署名されていない）
      }
    }
    record({ ...base, decision: 'would-sign', cacheable });
    return 'would-sign';
  }

  // esigner
  await codeSignTool(file);
  const signed = fs.readFileSync(file);
  fs.utimesSync(file, st.atime, st.mtime);
  const after = readPeInfo(signed);
  if (after == null || !after.hasCert) throw new Error(`署名後のファイルに証明書表がありません: ${file}`);
  if (deps.platform === 'win32') {
    const a = deps.authenticode(file);
    const why = a.status !== 'Valid' ? `Authenticode が ${a.status}` : signerIdentity.checkSigner(a, 'esigner');
    if (why != null) {
      throw new Error(`署名後の検証に失敗しました: ${file}（${why}）`);
    }
  }
  if (cacheable) {
    if (strippedDigest(signed) !== unsignedDigest) {
      // 署名が中身を変えた（想定外）。キャッシュに入れると次回の照合で必ず外れるので入れない
      console.warn(`[win-sign] 署名の前後で署名以外の中身が変わった。キャッシュに入れない: ${file}`);
    } else {
      fs.mkdirSync(outboxDir(), { recursive: true });
      const kept = path.join(outboxDir(), assetName(key, file));
      fs.copyFileSync(file, kept);
      sessionHits.set(key, kept);
    }
  }
  record({ ...base, decision: 'signed', cacheable, signedSha256: sha256(signed) });
  return 'signed';
}

// ───────────────────────────────────────────────
// electron-builder フック
// ───────────────────────────────────────────────

const PREPARED_MARKER = '.win-sign-prepared.json';
/** NSIS の出力（アンインストーラー・インストーラー）か。アンインストーラーの実物の名前は
 *  `<インストーラー名から exe を除いたもの>__uninstaller.exe`（app-builder-lib 26.17.0 NsisTarget.js:366） */
const isNsisOutput = (file) => /__uninstaller\.exe$/i.test(path.basename(file)) || /-Setup\.exe$/i.test(path.basename(file));

/**
 * collect のとき、NSIS の出力を署名する前に「この electron-builder が、用意された NSIS ツールセットを使っている」
 * ことを確かめる。ELECTRON_BUILDER_NSIS_RESOURCES_DIR の祖先に印があり、その mode が今のモードと一致しなければ落ちる。
 * （--prepackaged では beforePack が呼ばれない ∴ 準備の step を落とした・順を誤った・環境変数が渡らなかった、の
 * どれでも、黙って未署名のプラグインをインストーラーに入れない）
 */
function assertNsisToolsetPrepared(file) {
  const mode = getMode();
  if (mode !== 'collect' || !isNsisOutput(file)) return;
  const res = process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR;
  const fail = (why) => {
    throw new Error(`[win-sign] NSIS ツールセットが用意されていない（${why}）。scripts/win-sign/prepare-nsis-toolset.mjs を `
      + `electron-builder より前の step で実行すること: ${path.basename(file)}`);
  };
  if (!res) fail('ELECTRON_BUILDER_NSIS_RESOURCES_DIR が無い');
  let dir = path.resolve(res);
  for (;;) {
    const m = path.join(dir, PREPARED_MARKER);
    if (fs.existsSync(m)) {
      let marker;
      try { marker = JSON.parse(fs.readFileSync(m, 'utf8')); } catch (e) { fail(`印が読めない: ${e.message}`); }
      if (marker.mode !== mode) fail(`印のモード ${marker.mode} が今のモード ${mode} と違う`);
      return;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  fail(`${res} の祖先に ${PREPARED_MARKER} が無い`);
}

/** win.signtoolOptions.sign。signingHashAlgorithms: ['sha256'] なので 1 ファイル 1 回だけ呼ばれる。 */
async function sign(configuration) {
  if (configuration.isNest) return; // 念のため（2 回目のハッシュ呼び出しは課金の無駄）
  assertNsisToolsetPrepared(configuration.path);
  await signFile(configuration.path, { kind: 'electron-builder' });
}

let nsisPrepared = null;

/**
 * NSIS ツールセットを複写し、使うプラグインだけ署名（collect では収集か差し替え）して electron-builder に使わせる。
 * beforePack（--prepackaged でないビルド）と prepare-nsis-toolset.mjs（--prepackaged の前の step）から呼ばれる。
 * @param {{config?: object}} packagerLike  config.toolsets?.nsis・config.nsis?.customNsisResources だけを読む
 * @returns {Promise<{root: string, nsisDir: string, resourcesDir: string, plugins: Array<{name: string, decision: string}>}>}
 */
async function prepareSignedNsisToolset(packagerLike) {
  const root = path.join(workDir(), `nsis-${getMode()}`);
  let nsisSrc;
  let pluginsSrc;
  if (deps.toolsetSources) {
    ({ nsisSrc, pluginsSrc } = deps.toolsetSources);
  } else {
    const ebDir = path.dirname(require.resolve('electron-builder/package.json'));
    const winTools = require(require.resolve('app-builder-lib/out/toolsets/windows', { paths: [ebDir] }));
    const toolsetNsis = packagerLike?.config?.toolsets?.nsis;
    const customRes = packagerLike?.config?.nsis?.customNsisResources;
    // 元の場所（既存の上書き環境変数があればそれを尊重する）
    nsisSrc = path.dirname(await winTools.getNsisElevatePath(toolsetNsis));
    pluginsSrc = await winTools.getNsisPluginsPath(toolsetNsis, customRes);
  }
  // 複写先から複写しない（以前の用意を指す ELECTRON_BUILDER_NSIS_* が残っていると、消してから読むことになる）
  for (const src of [nsisSrc, pluginsSrc]) {
    if (!path.relative(path.resolve(root), path.resolve(src)).startsWith('..')) {
      throw new Error(`NSIS ツールセットの複写元が複写先の中にある: ${src}（ELECTRON_BUILDER_NSIS_DIR／RESOURCES_DIR を外して実行すること）`);
    }
  }
  // 既定（toolsets.nsis 未指定）は nsis-3.0.4.1 本体 + 別梱包の nsis-resources-3.4.1/plugins。
  // 統合バンドル（toolsets.nsis: 1.2.1 等）はプラグインが本体の windows/Plugins にある
  const pluginsInsideNsis = !path.relative(path.resolve(nsisSrc), path.resolve(pluginsSrc)).startsWith('..');
  const resSrc = pluginsInsideNsis ? null : path.dirname(pluginsSrc);

  fs.rmSync(root, { recursive: true, force: true });
  const nsisDst = path.join(root, 'nsis');
  // preserveTimestamps: NSIS は File で入れるファイルの日時を保存する（SetDateSave 既定 on）。複写で mtime が
  // 実行ごとに変わるとアンインストーラーのバイト列が変わる（U-1 の主な原因の候補・決定的にする手当て (a)）
  fs.cpSync(nsisSrc, nsisDst, { recursive: true, preserveTimestamps: true });
  // ELECTRON_BUILDER_NSIS_RESOURCES_DIR は <dir>/plugins か <dir>/windows/Plugins を探す（toolsets/windows.js）
  let resDst = nsisDst;
  if (resSrc != null) {
    resDst = path.join(root, 'nsis-resources');
    fs.cpSync(resSrc, resDst, { recursive: true, preserveTimestamps: true });
  }

  const found = new Set();
  const signQueue = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (path.basename(dir) === 'x86-unicode' && NSIS_PLUGINS_TO_SIGN.includes(ent.name)) {
        found.add(ent.name);
        signQueue.push(p);
      }
    }
  };
  walk(nsisDst);
  if (resDst !== nsisDst) walk(resDst);
  const missing = NSIS_PLUGINS_TO_SIGN.filter((n) => !found.has(n));
  if (missing.length > 0) {
    throw new Error(`NSIS プラグインが見つかりません: ${missing.join(', ')}（ツールセットの版が変わった可能性）`);
  }
  const plugins = [];
  for (const p of signQueue) plugins.push({ name: path.basename(p), decision: await signFile(p, { kind: 'nsis-plugin' }) });

  process.env.ELECTRON_BUILDER_NSIS_DIR = nsisDst;
  process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR = resDst;
  fs.writeFileSync(path.join(root, PREPARED_MARKER),
    JSON.stringify({ mode: getMode(), nsisDir: nsisDst, resourcesDir: resDst, plugins }, null, 2));
  console.log(`[win-sign] 署名済み NSIS ツールセットを使う: ${root}`);
  return { root, nsisDir: nsisDst, resourcesDir: resDst, plugins };
}

/** electron-builder の beforePack。Windows のときだけ、最初の 1 回で NSIS ツールセットを用意する。 */
async function beforePack(context) {
  if (getMode() === 'off' || context.electronPlatformName !== 'win32') return;
  if (nsisPrepared == null) nsisPrepared = prepareSignedNsisToolset(context.packager);
  await nsisPrepared;
}

module.exports = {
  MODES,
  NSIS_PLUGINS_TO_SIGN,
  PREPARED_MARKER,
  getMode,
  isCacheable,
  readPeInfo,
  strippedDigest,
  comparableDigest,
  extractPkcs7,
  subjectHasCn,
  assetName,
  rejectCachedReason,
  signFile,
  sign,
  assertNsisToolsetPrepared,
  prepareSignedNsisToolset,
  beforePack,
  __setDepsForTest,
  default: sign,
};
