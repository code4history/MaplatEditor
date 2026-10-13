// nov26-m6-t3 スモーク: adm-zip の使い方の恒久の断言（#102・#98）。タスク設計（outer リポジトリ
// docs/superpowers/specs/2026-10-11-nov26-m6-t3-task-design.md）§3.3・§7 AC6。
//
//   (a) electron/ に adm-zip の非同期の読み取り API（getDataAsync・extractAllToAsync・readFileAsync・
//       readAsTextAsync）の呼び出しが 0 件。非同期版の inflater（createInflateRaw）は error リスナを
//       持たず、例外が呼び出し元の try/catch に掛からない（#102 の読み取り側の閉鎖条件）。
//       同期版（extractAllTo・getData）は zlib.inflateRawSync で、例外は呼び出し元で捕まる
//   (b) electron/ に adm-zip の書き出し API（addLocalFile・addFile・toBuffer・writeZip）の呼び出しが
//       0 件（書き出しは electron/utils/zipWriter.ts の writeZipStreaming だけ。#98・#102）
//
// コメント行（`//` で始まる行）と型宣言（electron/vendor.d.ts）は数えない。
// 実行方法: node scripts/nov26-m6-t3-zip-guards-smoke.mjs
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const electronDir = path.join(projectRoot, 'electron');

async function listSources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listSources(p));
    else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = (await listSources(electronDir))
  .filter((p) => path.relative(projectRoot, p) !== path.join('electron', 'vendor.d.ts'));
if (files.length < 10) throw new Error(`走査対象が少なすぎる（${files.length} 件）。electron/ の位置を確かめる`);

const ASYNC_READ = /\b(getDataAsync|extractAllToAsync|readFileAsync|readAsTextAsync)\s*\(/;
const WRITE = /(addLocalFile\(|\.addFile\(|toBuffer\(|writeZip\()/;

const hits = { asyncRead: [], write: [] };
for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    const where = `${path.relative(projectRoot, file)}:${i + 1}: ${line.trim()}`;
    if (ASYNC_READ.test(line)) hits.asyncRead.push(where);
    if (WRITE.test(line)) hits.write.push(where);
  });
}

// 判別力の確認: 検出式が実際の呼び出しの形に当たること（式が壊れて常に 0 件になるのを防ぐ）
for (const sample of ['zip.getDataAsync(entry, cb)', 'zip.extractAllToAsync(dir, true)', 'entry.readFileAsync(e, cb)', 'zip.readAsTextAsync(e, cb)']) {
  if (!ASYNC_READ.test(sample)) throw new Error(`(a) 検出式が ${sample} に当たらない`);
}
for (const sample of ['zip.addLocalFile(p)', 'zip.addFile(name, buf)', 'zip.toBuffer()', 'zip.writeZip(p)']) {
  if (!WRITE.test(sample)) throw new Error(`(b) 検出式が ${sample} に当たらない`);
}

if (hits.asyncRead.length > 0) {
  throw new Error('(a) adm-zip の非同期の読み取り API の呼び出しがある:\n  ' + hits.asyncRead.join('\n  '));
}
console.log(`ok (a): electron/ の ${files.length} ファイルに adm-zip の非同期の読み取り API の呼び出しが無い`);
if (hits.write.length > 0) {
  throw new Error('(b) adm-zip の書き出し API の呼び出しがある:\n  ' + hits.write.join('\n  '));
}
console.log(`ok (b): electron/ の ${files.length} ファイルに adm-zip の書き出し API の呼び出しが無い`);
console.log('nov26-m6-t3 zip guards smoke passed');
