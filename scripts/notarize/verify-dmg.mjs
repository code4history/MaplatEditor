#!/usr/bin/env node
/** DMG 2 本の署名を検査し、full では公証・更新情報・zip 内 app の staple も照合する。 */
import { readdirSync, readFileSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = (result) => `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
const succeeded = (result) => result?.status === 0 && !result?.error;
const stapleValid = (result) => succeeded(result) && /^The validate action worked!\r?$/m.test(output(result));
function checkExpectation(expect) {
  if (!['signed', 'notarized'].includes(expect)) throw new Error('--expect は signed または notarized が必要です。');
}

/** spawnSync の終了コードと出力を受け取る。表示だけ成功しても終了コードが非ゼロなら失敗。 */
export function judgeDmgOutputs({ codesignVerify, codesignDisplay, staplerValidate, spctl }, expect = 'signed') {
  checkExpectation(expect);
  const errors = [];
  if (!succeeded(codesignVerify)) errors.push(`codesign --verify が失敗しました: ${output(codesignVerify)}`);
  const authority = output(codesignDisplay).split(/\r?\n/).find((line) => line.startsWith('Authority='));
  if (!succeeded(codesignDisplay) || !authority?.startsWith('Authority=Developer ID Application:')) {
    errors.push(`DMG の署名者が Developer ID Application ではありません: ${output(codesignDisplay)}`);
  }
  if (expect === 'notarized') {
    if (!stapleValid(staplerValidate)) errors.push(`DMG の staple 検証が失敗しました: ${output(staplerValidate)}`);
    if (!succeeded(spctl) || !/^.+: accepted\r?$/m.test(output(spctl)) || !/^source=Notarized Developer ID\r?$/m.test(output(spctl))) {
      errors.push(`Gatekeeper が公証済みとして受け入れませんでした: ${output(spctl)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function artifactPair(dir, ext) {
  const names = readdirSync(dir).filter((name) => name.endsWith(ext)).sort();
  const archPattern = new RegExp(`^MaplatEditor-Mac-[A-Za-z0-9.+-]+-(x64|arm64)\\${ext}$`);
  const arches = names.map((name) => archPattern.exec(name)?.[1]);
  if (names.length !== 2 || new Set(arches).size !== 2 || arches.some((arch) => !arch)) {
    throw new Error(`${ext} は x64・arm64 の 2 本必要です（検出: ${names.length} 本）。`);
  }
  for (const name of names) {
    if (!lstatSync(path.join(dir, name)).isFile()) throw new Error(`通常ファイルではありません: ${name}`);
  }
  return names;
}

// electron-builder と再生成スクリプトの js-yaml.dump が出す files 配列だけを読む。
// 既存の更新 feed fixture と同じ「2 字下げの url・4 字下げの sha512/size」の形に限定し、
// 未知の YAML 構文・重複・参照・別階層を許可しない。汎用 YAML パーサーの代用にはしない。
function readUpdateFiles(text) {
  const lines = text.split(/\r?\n/);
  const starts = lines.map((line, index) => /^files:/.test(line) ? index : -1).filter((index) => index >= 0);
  if (starts.length !== 1 || lines[starts[0]] !== 'files:') throw new Error('latest-mac.yml の files 配列の形式が不正です。');
  const entries = [];
  let entry;
  for (const line of lines.slice(starts[0] + 1)) {
    if (/^\S/.test(line)) break;
    if (line === '') continue;
    const start = /^  - url: (MaplatEditor-Mac-[A-Za-z0-9.+-]+-(?:x64|arm64)\.(?:dmg|zip))$/.exec(line);
    if (start) { entry = { url: start[1] }; entries.push(entry); continue; }
    const field = /^    (sha512|size|blockMapSize): (\S+)$/.exec(line);
    if (!entry || !field || Object.hasOwn(entry, field[1])) throw new Error(`latest-mac.yml の files 行が不正です: ${line}`);
    const [, key, value] = field;
    if (key === 'sha512') {
      if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) throw new Error('latest-mac.yml の sha512 が不正です。');
      entry.sha512 = value;
    } else {
      if (!/^(?:0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`latest-mac.yml の ${key} が不正です。`);
      entry[key] = Number(value);
    }
  }
  const urls = new Set();
  for (const item of entries) {
    if (!Object.hasOwn(item, 'sha512') || !Object.hasOwn(item, 'size') || urls.has(item.url)) throw new Error('latest-mac.yml の files に欠落または重複があります。');
    urls.add(item.url);
  }
  return entries;
}

const execute = (command, args) => spawnSync(command, args, { encoding: 'utf8' });
export function verifyDmgs(directory, { expect = 'signed', run = execute } = {}) {
  checkExpectation(expect);
  const dir = path.resolve(directory);
  const dmgs = artifactPair(dir, '.dmg');
  for (const name of dmgs) {
    const dmg = path.join(dir, name);
    const outputs = {
      codesignVerify: run('codesign', ['--verify', '--strict', '--verbose=2', dmg]),
      codesignDisplay: run('codesign', ['-dv', '--verbose=2', dmg]),
    };
    if (expect === 'notarized') {
      outputs.staplerValidate = run('xcrun', ['stapler', 'validate', dmg]);
      outputs.spctl = run('spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-v', dmg]);
    }
    const judgment = judgeDmgOutputs(outputs, expect);
    if (!judgment.ok) throw new Error(`${name}: ${judgment.errors.join('\n')}`);
    console.log(`${name}: ${expect} OK`);
  }
  if (expect === 'signed') return;

  const entries = readUpdateFiles(readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8'));
  const dmgEntries = entries.filter((entry) => entry.url.endsWith('.dmg'));
  if (dmgEntries.length !== dmgs.length || dmgEntries.some((entry) => !dmgs.includes(entry.url))) {
    throw new Error('latest-mac.yml の DMG の集合が配布物と一致しません。');
  }
  for (const entry of dmgEntries) {
    const body = readFileSync(path.join(dir, entry.url));
    if (entry.sha512 !== createHash('sha512').update(body).digest('base64') || entry.size !== body.length) {
      throw new Error(`latest-mac.yml の sha512/size が一致しません: ${entry.url}`);
    }
    console.log(`${entry.url}: sha512/size OK`);
  }
  for (const name of artifactPair(dir, '.zip')) {
    const temp = mkdtempSync(path.join(tmpdir(), 'verify-dmg-'));
    try {
      const extracted = run('ditto', ['-x', '-k', path.join(dir, name), temp]);
      if (!succeeded(extracted)) throw new Error(`${name} の展開に失敗しました: ${output(extracted)}`);
      const app = path.join(temp, 'MaplatEditor.app');
      if (!lstatSync(app).isDirectory()) throw new Error(`${name} に MaplatEditor.app がありません。`);
      const validated = run('xcrun', ['stapler', 'validate', app]);
      if (!stapleValid(validated)) throw new Error(`${name} 内の .app の staple 検証が失敗しました: ${output(validated)}`);
      console.log(`${name}: MaplatEditor.app stapler validate OK`);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [dir, flag, expect, ...rest] = process.argv.slice(2);
    if (!dir || flag !== '--expect' || !expect || rest.length) throw new Error('使い方: node scripts/notarize/verify-dmg.mjs <dir> --expect <signed|notarized>');
    verifyDmgs(dir, { expect });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
