// エディタUIロケールの整合性チェック。
// public/locales/ 配下の全言語について、jaとのキー完全一致・空値なし・
// i18next補間プレースホルダ({{...}})の保持を検証する。
// 使い方: node scripts/editor-locale-parity.mjs
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const localesDir = path.resolve(new URL('..', import.meta.url).pathname, 'public/locales');
const langs = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const load = (lang) => JSON.parse(readFileSync(path.join(localesDir, lang, 'translation.json'), 'utf8'));
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );

const ja = new Map(flatten(load('ja')));
const jaKeys = [...ja.keys()].sort();
const placeholders = (value) => (String(value).match(/\{\{[^}]+\}\}/g) ?? []).sort().join(',');

let failed = false;
for (const lang of langs) {
  const entries = new Map(flatten(load(lang)));
  const keys = [...entries.keys()].sort();
  const missing = jaKeys.filter((key) => !entries.has(key));
  const extra = keys.filter((key) => !ja.has(key));
  const empty = jaKeys.filter((key) => entries.has(key) && String(entries.get(key)).trim() === '');
  const brokenPlaceholders = jaKeys.filter(
    (key) => entries.has(key) && placeholders(ja.get(key)) !== placeholders(entries.get(key))
  );
  const problems = [];
  if (missing.length) problems.push(`missing: ${missing.join(', ')}`);
  if (extra.length) problems.push(`extra: ${extra.join(', ')}`);
  if (empty.length) problems.push(`empty: ${empty.join(', ')}`);
  if (brokenPlaceholders.length) problems.push(`placeholder mismatch: ${brokenPlaceholders.join(', ')}`);
  if (problems.length) {
    failed = true;
    console.error(`NG ${lang}\n  ${problems.join('\n  ')}`);
  } else {
    console.log(`OK ${lang} (${keys.length} keys)`);
  }
}
if (failed) process.exit(1);
console.log(`Editor locale parity check passed for ${langs.length} languages`);
