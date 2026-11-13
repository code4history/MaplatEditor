// metadata の値の形の試験（自作 fixture）。
//
// IIIF の metadata の value は、文字列・言語つきの値（{"@value","@language"}）・
// 文字列の配列・版 3 の言語の表（{"ja":["…"]}）が仕様の形。実在資料には、それらに
// 入れ子の配列が混ざった仕様外の形がある（値の先頭に項目名と同じ文字列が入り、
// その次に作者名の入った配列が入る形）。Core が入れ子の配列を平らにして文字列を読み、
// 形そのものが読めない行だけを警告して捨てる。
//
// fixture はすべて自作。実在資料の Manifest は写していない（URL は example.org 配下）。
//
// 使い方: node scripts/iiif-metadata-value-shapes-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { listIiifCanvases } from '@maplat/core/src/iiif/manifest';
import {
  copyIiifMetadata, copyIiifMetadataWithBindings,
} from '../src/utils/iiifMetadataCopy';

const directory = path.resolve('tests/fixtures/iiif');
const read = (file) => JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
const options = { sanitize: (html) => html, now: () => new Date('2026-11-13T00:00:00Z') };

// 自作 fixture に置いてよい URL の host（架空の example.org と、仕様の URI）。
const SYNTHETIC_HOSTS = new Set(['example.org', 'iiif.example.org', 'iiif.io', 'creativecommons.org']);
const urlsIn = (value, found = []) => {
  if (typeof value === 'string') { if (/^https?:\/\//.test(value)) found.push(value); }
  else if (Array.isArray(value)) for (const item of value) urlsIn(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) urlsIn(item, found);
  return found;
};

test('自作 fixture は架空の URL だけでできている', () => {
  for (const name of ['metadata-value-shapes-p2.manifest.json', 'metadata-value-shapes-p3.manifest.json']) {
    const manifest = read(name);
    const urls = urlsIn(manifest);
    assert.ok(urls.length > 0, name + ' に URL がある');
    assert.deepEqual(urls.filter((url) => !SYNTHETIC_HOSTS.has(new URL(url).hostname)), [], name + ' に架空でない URL が無い');
  }
});

test('版 2: metadata の値の形を 1 行ずつ読む（入れ子の配列は平らにして読む）', () => {
  const manifest = read('metadata-value-shapes-p2.manifest.json');
  const untouched = structuredClone(manifest);
  const listed = listIiifCanvases(manifest);
  assert.equal(listed.ok, true);
  assert.equal(listed.canvases.length, 1);
  const copy = copyIiifMetadata(manifest, listed.canvases[0].id, 'ja', options);
  assert.equal(copy.ok, true);
  assert.deepEqual(copy.copiedMetadata, [
    { from: 'manifest', label: '文字列', value: 'そのままの文字列' },
    { from: 'manifest', label: '言語つきの値', value: { en: 'language-tagged value' } },
    { from: 'manifest', label: '平らな配列', value: { ja: '一つ目<br>二つ目' } },
    { from: 'manifest', label: '作者', value: { ja: '作者<br>架空 太郎（かくそ たろう）, 1850-1900' } },
    { from: 'manifest', label: '言語の表', value: { ja: '日本語の値', en: 'English value' } },
    { from: 'manifest', label: '言語の表の入れ子', value: { ja: '入れ子の<br>値' } },
    { from: 'canvas', label: 'コマの作者', value: { ja: 'コマの作者<br>架空 花子（かくそ はなこ）, 1860-1930' } },
  ]);
  // 空の値の行は警告なしで捨て、形が読めない行（読めない形）だけを警告する。
  assert.deepEqual(copy.warnings, ['Manifest の metadata の値の形が読めません']);
  assert.deepEqual(manifest, untouched, '渡した Manifest は変えない');
});

test('版 3: 言語の表の値を読む（言語の表の中の入れ子の配列も平らにして読む）', () => {
  const manifest = read('metadata-value-shapes-p3.manifest.json');
  const untouched = structuredClone(manifest);
  const listed = listIiifCanvases(manifest);
  assert.equal(listed.ok, true);
  assert.equal(listed.canvases.length, 1);
  const copy = copyIiifMetadata(manifest, listed.canvases[0].id, 'ja', options);
  assert.equal(copy.ok, true);
  assert.deepEqual(copy.copiedMetadata, [
    {
      from: 'manifest',
      label: { ja: '文字列', en: 'String' },
      value: { ja: 'そのままの文字列', en: 'Plain string' },
    },
    {
      from: 'manifest',
      label: { ja: '作者', en: 'Creator' },
      value: { ja: '架空 花子（かくそ はなこ）, 1860-1930', en: 'Kakuso, Hanako, 1860-1930' },
    },
    { from: 'manifest', label: { ja: '平らな配列' }, value: { ja: '一つ目<br>二つ目' } },
    { from: 'manifest', label: { ja: '文字列の値' }, value: '版 3 でも文字列の値' },
    { from: 'canvas', label: { ja: 'コマの言語の表の入れ子' }, value: { ja: 'コマの<br>入れ子の値' } },
  ]);
  assert.deepEqual(copy.warnings, ['Manifest の metadata の値の形が読めません']);
  assert.deepEqual(manifest, untouched, '渡した Manifest は変えない');
});

test('写し直しの道でも metadata の値の入れ子の配列を平らにして読む', () => {
  const manifest = read('metadata-value-shapes-p2.manifest.json');
  const listed = listIiifCanvases(manifest);
  const canvasId = listed.canvases[0].id;
  const first = copyIiifMetadata(manifest, canvasId, 'ja', options);
  assert.equal(first.ok, true);
  const again = copyIiifMetadataWithBindings(manifest, { canvas: canvasId, bindings: first.bindings }, 'ja', options);
  assert.equal(again.ok, true);
  assert.deepEqual(again.copiedMetadata, first.copiedMetadata);
  assert.deepEqual(again.warnings, first.warnings);
});
