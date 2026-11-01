// JSON のキーの重複を見つける検査器を確かめる smoke。
//
// JSON.parse は同じキーが 2 回出ても後の値で黙って上書きするので、重複を見逃す。
// この検査器は字句を読むので、重複（同じオブジェクトの中の同じキー）を見つけられること、
// 入れ子・配列・文字列の中の記号・エスケープを正しく読めること、壊れた JSON を
// 弾くことを、一時フォルダに作った資料で確かめる。
//
// 使い方: node scripts/json-duplicate-keys-smoke.mjs
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const checker = path.join(projectRoot, 'scripts/ci/check-json-duplicate-keys.mjs');

const workDir = await mkdtemp(path.join(os.tmpdir(), 'json-duplicate-keys-'));
const run = (...files) =>
  spawnSync(process.execPath, [checker, ...files], { encoding: 'utf8', timeout: 30000 });

const write = async (name, text) => {
  const file = path.join(workDir, name);
  await writeFile(file, text, 'utf8');
  return file;
};

// 見分ける assert: 重複の 2 つ（exit 1 と `duplicate key:` の 1 行目）と、
// 壊れた JSON の 1 つ（`invalid json:`）。正しい JSON の 2 つは通しすぎを防ぐ。
try {
  // ---- 同じオブジェクトの同じキーは見つける（入れ子のパスも出す） ----
  const topDup = await write('top-duplicate.json', '{"a": 1, "a": 2}');
  let result = run(topDup);
  // 知らせの中身を先に見る（ファイルが無いだけでも exit 1 になるので、順を逆にしない）
  assert.match(result.stdout, /duplicate key: /, '重複の知らせを出していない: ' + result.stdout);
  assert.equal(result.status, 1, '重複を見逃した: ' + result.stdout + result.stderr);
  assert.ok(result.stdout.includes(topDup), 'ファイル名を出していない: ' + result.stdout);
  assert.match(result.stdout, /:a(\s|$)/, 'キーのパスを出していない: ' + result.stdout);

  const nestedDup = await write('nested-duplicate.json', '{"outer": {"inner": 1, "inner": 2}}');
  result = run(nestedDup);
  assert.ok(
    result.stdout.includes('outer.inner'),
    '入れ子のキーのパスを出していない: ' + result.stdout
  );
  assert.equal(result.status, 1, '入れ子の重複を見逃した: ' + result.stdout + result.stderr);

  // ---- エスケープをほどいた同じキーも重複として見つける ----
  const escapedDup = await write('escaped-duplicate.json', '{"\\u0061": 1, "a": 2}');
  result = run(escapedDup);
  assert.match(
    result.stdout,
    /duplicate key: .*:a(\s|$)/,
    'エスケープをほどいた重複を見つけていない: ' + result.stdout
  );
  assert.equal(result.status, 1, 'エスケープをほどいた重複を見逃した: ' + result.stdout + result.stderr);

  // ---- 文字列の中の記号・エスケープに惑わされず、壊れた JSON を弾く ----
  const broken = await write('broken.json', '{"a": }');
  result = run(broken);
  assert.match(result.stdout, /invalid json: /, '壊れた JSON の知らせを出していない: ' + result.stdout);
  assert.equal(result.status, 1, '壊れた JSON を通した: ' + result.stdout + result.stderr);

  // ---- 正しい JSON は通す（別々のオブジェクトの同じキー・配列・文字列の中の括弧） ----
  const goodText = [
    '{',
    '  "title": "a } brace ] and \\" quote",',
    '  "list": [{"name": 1, "name2": 2}, {"name": 3, "name4": 4}],',
    '  "nested": {"deep": {"key": "value"}},',
    '  "escaped": "\\u30ad\\u30fc"',
    '}',
  ].join('\n');
  const good = await write('good.json', goodText);
  result = run(good);
  assert.equal(result.status, 0, '正しい JSON を弾いた: ' + result.stdout + result.stderr);
  assert.match(result.stdout, /ok: 1 files/, '件数の知らせが違う: ' + result.stdout);

  // ---- 複数のファイルをまとめて数える ----
  const good2 = await write('good2.json', '[1, 2, {"a": 1}, {"a": 2}]');
  result = run(good, good2);
  assert.equal(result.status, 0, '正しい JSON 2 つを弾いた: ' + result.stdout + result.stderr);
  assert.match(result.stdout, /ok: 2 files/, 'ファイル数を数えていない: ' + result.stdout);

  console.log('ok: detects-duplicate-keys');

  // ---- 画面の文言（public/locales の 11 言語）に、重複したキーが無い ----
  const { readdirSync } = await import('node:fs');
  const localeDir = path.join(projectRoot, 'public/locales');
  const localeFiles = readdirSync(localeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(localeDir, entry.name, 'translation.json'));
  result = run(...localeFiles);
  assert.equal(result.status, 0, '画面の文言に重複したキーか壊れた JSON がある: ' + result.stdout + result.stderr);
  console.log('ok: locales-have-no-duplicate-keys (' + localeFiles.length + ' files)');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
