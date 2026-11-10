#!/usr/bin/env node
/**
 * 用語集の正本を変えた PR に、変更の要約を 1 件のコメントとして出す（設計 v1.2 §5.6 関門 2）。
 *
 * - 要約は scripts/editor-glossary-check.mjs の報告（--report）の glossaryChangeSummary を使う。無ければ何もしない
 * - 目印の文字列（<!-- editor-glossary-summary -->）を持つ既存のコメントがあれば書き換え、無ければ新しく作る
 * - トークンに書き込み権限が無い（fork からの PR など）ときは、ジョブの要約（GITHUB_STEP_SUMMARY）にその旨を書いて 0 で終わる
 * - 合否は決めない（常に exit 0）。用語の合否は smoke:editor-glossary が持つ
 *
 * 使い方: node scripts/ci/post-editor-glossary-summary.mjs --report editor-glossary-report.json
 * 環境変数: GITHUB_TOKEN・GITHUB_REPOSITORY・PR_NUMBER（・GITHUB_API_URL・GITHUB_STEP_SUMMARY）
 */
import { appendFileSync, readFileSync } from 'node:fs';

const MARKER = '<!-- editor-glossary-summary -->';

function note(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${text}\n`);
}

async function main() {
  const i = process.argv.indexOf('--report');
  const reportPath = i > 0 ? process.argv[i + 1] : 'editor-glossary-report.json';
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (e) {
    console.log(`用語集の報告が無い（${reportPath}: ${e.code ?? e.message}）。コメントは出さない`);
    return;
  }
  const summary = report.glossaryChangeSummary;
  if (!summary) {
    console.log('正本の変更が無いので、コメントは出さない');
    return;
  }
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: pr } = process.env;
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  if (!token || !repo || !pr) {
    note('用語集の変更の要約: PR 番号かトークンが無いので、PR へのコメントは出さず、ジョブの要約だけに出した。');
    return;
  }
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const body = summary.includes(MARKER) ? summary : `${MARKER}\n${summary}`;
  let existing = null;
  for (let page = 1; page <= 10 && !existing; page++) {
    const res = await fetch(`${api}/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) break;
    const list = await res.json();
    existing = list.find((c) => typeof c.body === 'string' && c.body.includes(MARKER)) ?? null;
    if (list.length < 100) break;
  }
  const res = existing
    ? await fetch(`${api}/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetch(`${api}/repos/${repo}/issues/${pr}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (!res.ok) {
    note(`用語集の変更の要約: PR へのコメントに失敗した（HTTP ${res.status}。fork からの PR などで書き込み権限が無い）。要約はジョブの要約だけに出した。`);
    return;
  }
  console.log(existing ? `既存のコメント ${existing.id} を書き換えた` : 'コメントを新しく作った');
}

main().catch((e) => {
  note(`用語集の変更の要約: PR へのコメントで例外が起きた（${e.message}）。要約はジョブの要約だけに出した。`);
});
