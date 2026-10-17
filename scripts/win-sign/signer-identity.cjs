// Windows の署名者の照合（nov26-m7-t2・C-3）。正本は同じディレクトリの signer-identity.json。
//
// 照合は 2 段:
//   (1) 署名者の Subject を parseDn で属性の集合に読み、正本の当該モードの subject と**集合として一致**
//       （多い属性・少ない属性も不一致。DN の文字列の並び・引用符・S／ST の表記の揺れでは落ちない）
//   (2) X509Chain の index 2 以降（0 は葉・1 は直接の発行者）に、正本の issuerAllow の thumbprint が 1 つ以上ある
//       （Artifact Signing の葉は 3 日ごとに替わり、直接の発行者 EOC CA 01／02／03 も替わりうるので照らさない）
// 照合したいモード（artifact-signing / esigner）は呼ぶ側が決める。Microsoft の署名（d3dcompiler_47.dll 等）は
// 呼ぶ側が isMicrosoftSubject で別に扱う。
//
// Authenticode の読み取り（Windows のみ・pwsh）もここに置く（win-sign.cjs・verify-win-sign-coverage.mjs・
// verify-win-install.mjs が同じ形で Subject とチェーンを得るため）。
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const IDENTITY_FILE = path.join(__dirname, 'signer-identity.json');

let cachedIdentity = null;
function loadIdentity() {
  if (cachedIdentity == null) cachedIdentity = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
  return cachedIdentity;
}

const KEY_ALIASES = { S: 'ST', E: 'EMAIL', EMAILADDRESS: 'EMAIL' };
const normKey = (k) => {
  const u = k.trim().toUpperCase();
  return KEY_ALIASES[u] ?? u;
};

/**
 * DN の文字列を属性の集合（{ KEY: value }）に読む。.NET 形式（`CN="a, b", S=x`）と RFC 4514 形式
 * （`CN=a\, b,ST=x`）の両方を読む。区切りは , ; +。同じキーが 2 回出たら値の配列にする。
 */
function parseDn(str) {
  if (typeof str !== 'string') throw new Error(`DN が文字列でない: ${JSON.stringify(str)}`);
  const out = {};
  let i = 0;
  const n = str.length;
  const put = (k, v) => {
    if (k === '') throw new Error(`DN のキーが空: ${str}`);
    if (out[k] === undefined) out[k] = v;
    else out[k] = [].concat(out[k], v);
  };
  while (i < n) {
    while (i < n && /\s/.test(str[i])) i++;
    if (i >= n) break;
    const eq = str.indexOf('=', i);
    if (eq < 0) throw new Error(`DN に = が無い: ${str}`);
    const key = normKey(str.slice(i, eq));
    i = eq + 1;
    while (i < n && str[i] === ' ') i++;
    let value = '';
    if (str[i] === '"') {
      i++;
      let closed = false;
      while (i < n) {
        if (str[i] === '"') {
          if (str[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++; closed = true; break;
        }
        if (str[i] === '\\' && i + 1 < n) { value += str[i + 1]; i += 2; continue; }
        value += str[i++];
      }
      if (!closed) throw new Error(`DN の引用符が閉じていない: ${str}`);
      while (i < n && str[i] === ' ') i++;
    } else {
      while (i < n && !',;+'.includes(str[i])) {
        if (str[i] === '\\' && i + 1 < n) {
          const hex = str.slice(i + 1, i + 3);
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); i += 3; continue; }
          value += str[i + 1]; i += 2; continue;
        }
        value += str[i++];
      }
      value = value.trim();
    }
    put(key, value);
    if (i < n) {
      if (!',;+'.includes(str[i])) throw new Error(`DN の区切りが不正（位置 ${i}）: ${str}`);
      i++;
    }
  }
  return out;
}

/** 正本の subject（{ KEY: value | value[] }）のキーを parseDn と同じ形に揃える */
function normalizeSubject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = normKey(k);
    out[key] = out[key] === undefined ? v : [].concat(out[key], v);
  }
  return out;
}

const asPairs = (obj) => Object.entries(obj)
  .flatMap(([k, v]) => [].concat(v).map((x) => `${k}=${x}`))
  .sort();

/**
 * @param {{subject: string|null, chain?: Array<{subject?: string, thumbprint?: string}>}} result
 * @param {string} mode artifact-signing | esigner
 * @param {object} [identity] 省略時は signer-identity.json
 * @returns {string|null} 外れた理由（通れば null）
 */
function checkSigner(result, mode, identity = loadIdentity()) {
  const id = identity?.[mode];
  if (!id || typeof id !== 'object') return `署名者の正本に ${mode} が無い`;
  const subject = result?.subject;
  if (!subject) return `署名者が無い（${mode}）`;
  let got;
  try {
    got = parseDn(subject);
  } catch (e) {
    return `署名者の DN が読めない（${e.message}）`;
  }
  const want = asPairs(normalizeSubject(id.subject));
  const have = asPairs(got);
  if (JSON.stringify(want) !== JSON.stringify(have)) {
    return `署名者が ${mode} の正本と違う（実物 ${subject}）`;
  }
  const allow = new Set((id.issuerAllow ?? []).map((a) => String(a.thumbprint ?? '').toUpperCase()).filter(Boolean));
  if (allow.size === 0) return `${mode} の issuerAllow が空（上位の証明書が未測定。照合を通さない）`;
  const chain = Array.isArray(result.chain) ? result.chain : [];
  const upper = chain.slice(2).map((c) => String(c?.thumbprint ?? '').toUpperCase());
  if (!upper.some((t) => allow.has(t))) {
    return `上位の証明書（チェーンの index 2 以降）が ${mode} の issuerAllow に無い（${upper.join(',') || 'チェーンなし'}）`;
  }
  return null;
}

const isMicrosoftSubject = (s) => /O\s*=\s*"?Microsoft Corporation\b/.test(s ?? '');

// ───────────────────────────────────────────────
// Authenticode の読み取り（Windows のみ）
// ───────────────────────────────────────────────
// 各ファイルの Status・Subject・チェーン（RevocationMode NoCheck で Build した各段の Subject と Thumbprint）
const PS_AUTHENTICODE = "$ErrorActionPreference='Stop'; $files = @(Get-Content -LiteralPath $env:WIN_SIGN_LIST -Raw | ConvertFrom-Json); "
  + '$out = @($files | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; $chain = @(); '
  + 'if ($s.SignerCertificate) { $c = [System.Security.Cryptography.X509Certificates.X509Chain]::new(); '
  + "$c.ChainPolicy.RevocationMode = 'NoCheck'; [void]$c.Build($s.SignerCertificate); "
  + '$chain = @($c.ChainElements | ForEach-Object { [pscustomobject]@{ subject = $_.Certificate.Subject; thumbprint = $_.Certificate.Thumbprint } }) }; '
  + '[pscustomobject]@{ file = $_; status = [string]$s.Status; subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }; chain = $chain } }); '
  + 'ConvertTo-Json -InputObject $out -Compress -Depth 5';

/** eSigner の資格情報（nov26-m7-t3）。pwsh の子へは渡さない */
const ES_ENV_KEYS = ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET'];

/** Authenticode の検証に起動する pwsh の子の env（ES_* を外し、一覧のファイルの場所だけを足す） */
function buildPwshEnv(listFile) {
  const env = { ...process.env, WIN_SIGN_LIST: listFile };
  for (const k of ES_ENV_KEYS) delete env[k];
  return env;
}

/**
 * @param {string[]} files
 * @returns {Map<string, {status: string, subject: string|null, chain: Array<{subject: string, thumbprint: string}>}>}
 */
function authenticodeFiles(files) {
  if (process.platform !== 'win32') throw new Error('Authenticode の検証は Windows でしか行えません');
  const listFile = path.join(os.tmpdir(), `win-sign-list-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(listFile, JSON.stringify(files));
  // GitHub Actions の Windows は step を pwsh で動かす。そこから powershell.exe を起動すると PSModulePath の
  // 食い違いで Microsoft.PowerShell.Security を読めず、Get-AuthenticodeSignature が黙って $null を返す
  // （1.1.0-rc.2 の run 37122225835）。∴ pwsh を優先し、無いときだけ PSModulePath を外して powershell.exe を使う。
  const env = buildPwshEnv(listFile);
  const opts = { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 };
  let shell = 'pwsh';
  let r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', PS_AUTHENTICODE], opts);
  if (r.error && r.error.code === 'ENOENT') {
    shell = 'powershell.exe';
    delete env.PSModulePath;
    r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', PS_AUTHENTICODE], opts);
  }
  try { fs.unlinkSync(listFile); } catch { /* 一時ファイルの後始末だけ */ }
  if (r.error) throw new Error(`${shell} を起動できません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`Get-AuthenticodeSignature が失敗しました（${shell}）: ${r.stderr || r.stdout}`);
  const parsed = JSON.parse(r.stdout.trim() || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const map = new Map();
  for (const e of rows) {
    // 状態が空 ＝ 署名が無効なのではなく、検証そのものが動いていない。署名の失敗と取り違えない
    if (!e || !e.status) {
      throw new Error(`Get-AuthenticodeSignature が結果を返しませんでした（${shell}・検証そのものの失敗）: ${(r.stderr || '').trim() || '(stderr なし)'}`);
    }
    const chain = Array.isArray(e.chain) ? e.chain : (e.chain ? [e.chain] : []);
    map.set(e.file, { status: e.status, subject: e.subject ?? null, chain });
  }
  return map;
}

module.exports = {
  IDENTITY_FILE,
  loadIdentity,
  parseDn,
  normalizeSubject,
  checkSigner,
  isMicrosoftSubject,
  authenticodeFiles,
  buildPwshEnv,
  PS_AUTHENTICODE,
};
