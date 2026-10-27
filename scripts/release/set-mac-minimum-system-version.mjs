#!/usr/bin/env node
/**
 * latest-mac.yml（自動更新の更新情報）に minimumSystemVersion を足す。
 *
 * なぜ要るか: electron-updater は更新情報の minimumSystemVersion を os.release()（macOS では Darwin の
 * カーネル版。macOS 12 = 21.x・macOS 13 = 22.x）と比べ、下回れば更新を案内しない。electron-builder 26 は
 * mac.minimumSystemVersion を Info.plist の LSMinimumSystemVersion にしか書かず、latest-mac.yml には書かない
 * （releaseInfo のスキーマも追加のキーを許さない）。何もしないと、起動できない OS の利用者に更新が案内される。
 *
 * 使い方: node scripts/release/set-mac-minimum-system-version.mjs <latest-mac.yml> <Darwin の版 例 22.0.0>
 *   - 既存の本文は書き換えず、末尾に 1 行足すだけ（sha512 などの値の書式を保つ）
 *   - 既に minimumSystemVersion があり、渡した値と同じなら何もしない（exit 0）
 *   - 既に minimumSystemVersion があり、渡した値と違えば失敗する（exit 非 0・ファイルは変えない）。
 *     electron-updater 6.8.10 は比較で例外が出ると更新を案内する側に倒れるので、違う値（例 13.0）を
 *     黙って残すと macOS 12 に更新が案内されうる
 *   - 値は X.Y.Z の形（semver の比較に使われる）。ファイルが無い・YAML の対応表でなければ失敗する
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const KEY = 'minimumSystemVersion';

/**
 * @param {string} text latest-mac.yml の本文
 * @param {string} value Darwin の版（X.Y.Z）
 * @returns {{ text: string, changed: boolean }}
 */
export function addMinimumSystemVersion(text, value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${KEY} の値は X.Y.Z の形であること（受け取った値: ${JSON.stringify(value)}）`);
  }
  const doc = yaml.load(text);
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('latest-mac.yml が YAML の対応表として読めない');
  }
  if (Object.prototype.hasOwnProperty.call(doc, KEY)) {
    if (doc[KEY] === value) {
      return { text, changed: false };
    }
    throw new Error(`latest-mac.yml に既に ${KEY}: ${JSON.stringify(doc[KEY])} がある（渡した値 ${JSON.stringify(value)} と違う）`);
  }
  const base = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`;
  const out = `${base}${KEY}: ${value}\n`;
  // 足した結果を読み直して、文字列の値として入ったことを確かめる（fail-closed）
  const check = yaml.load(out);
  if (check?.[KEY] !== value) {
    throw new Error(`${KEY} を足した結果を読み直すと ${JSON.stringify(check?.[KEY])} になった`);
  }
  return { text: out, changed: true };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [file, value] = process.argv.slice(2);
  if (!file || !value) {
    console.error('使い方: node scripts/release/set-mac-minimum-system-version.mjs <latest-mac.yml> <X.Y.Z>');
    process.exit(2);
  }
  const before = readFileSync(file, 'utf8');
  const { text, changed } = addMinimumSystemVersion(before, value);
  if (changed) {
    writeFileSync(file, text);
    console.log(`${file}: ${KEY}: ${value} を足した`);
  } else {
    console.log(`${file}: ${KEY}: ${value} は既にある。何もしない`);
  }
}
