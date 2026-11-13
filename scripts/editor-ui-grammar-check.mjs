#!/usr/bin/env node
/* global console, process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'vue/compiler-sfc';
import ts from 'typescript';

const helpKey = /(?:[_.](?:help|note|desc|hint|examples|notice|description))$/;
const ruleIds = new Set(['help.form-text', 'help.muted-text', 'help.key-outside-contexthelp', 'help.slot-misuse', 'help.aria-label', 'diag.inline-text', 'diag.raw-alert', 'dialog.native-browser', 'dialog.notify-only', 'dialog.ad-hoc-modal', 'empty.ad-hoc', 'button.variant', 'map.tool-button']);
const normalize = (name) => name.replace(/-/g, '').toLowerCase();
function expression(text) { return ts.createSourceFile('expression.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
function visitTs(node, visit) { visit(node); ts.forEachChild(node, (child) => visitTs(child, visit)); }
function keys(text) {
  const result = [];
  visitTs(expression(text), (node) => {
    if (ts.isCallExpression(node) && /^(?:t|\$t)$/.test(node.expression.getText()) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) result.push(node.arguments[0].text);
  });
  return result;
}
function strings(text) {
  const result = [];
  visitTs(expression(text), (node) => { if (ts.isStringLiteralLike(node)) result.push(...node.text.split(/\s+/)); });
  return result;
}
function propName(p) { return p.type === 6 ? p.name : p.name === 'bind' ? p.arg?.content : undefined; }
function attr(node, name) { return node.props?.find((p) => normalize(propName(p) ?? '') === normalize(name)); }
function attrValue(p) { return p?.type === 6 ? p.value?.content : p?.exp?.content; }
function classes(node) {
  return node.props.filter((p) => propName(p) === 'class').flatMap((p) => p.type === 6 ? (p.value?.content ?? '').split(/\s+/) : strings(p.exp?.content ?? ''));
}

// showMessageBox のボタンの数。buttons を書かなければ Electron は OK を 1 個だけ出す ∴ 1。
// 変数で渡すなど、ソースから数が決まらないときは null（違反として扱い、許可リストで個別に通す）。
function buttonCount(call, ast) {
  const options = call.arguments.find(ts.isObjectLiteralExpression);
  if (!options) return null;
  const buttons = options.properties.find((p) => p.name?.getText(ast) === 'buttons');
  if (!buttons) return options.properties.some(ts.isSpreadAssignment) ? null : 1;
  if (!ts.isPropertyAssignment(buttons) || !ts.isArrayLiteralExpression(buttons.initializer)) return null;
  if (buttons.initializer.elements.some(ts.isSpreadElement)) return null;
  return buttons.initializer.elements.length;
}

export function inspectSource(file, source) {
  const violations = [];
  const add = (rule, offset, hit, selectors = {}) => {
    violations.push({ file, line: source.slice(0, offset).split('\n').length, rule, hit, ...selectors });
  };
  const inspectScript = (text, offset = 0) => {
    const ast = expression(text);
    visitTs(ast, (node) => {
      if (!ts.isCallExpression(node)) return;
      // 型の注釈つきの長い callee（(window as unknown as {…}).dialog.showMessageBox）も 1 行に縮める
      const callee = node.expression.getText(ast).replace(/\s+/g, ' ');
      if (/^(?:(?:window|globalThis)\.)?(?:alert|confirm|prompt)$/.test(callee)) add('dialog.native-browser', offset + node.getStart(ast), callee);
      // 自前の wrapper（showMessageBox(...)）も同じに調べる
      if (!/(?:^|\.)showMessageBox$/.test(callee)) return;
      const count = buttonCount(node, ast);
      if (count === 1 || count === null) {
        // 許可リストで個別に通せるよう、文言のキーが無い呼び出しは引数の書き方を選択子にする
        const key = keys(node.getText(ast))[0] ?? `args:${node.arguments.map((a) => a.getText(ast)).join(',').replace(/\s+/g, ' ')}`;
        add('dialog.notify-only', offset + node.getStart(ast), count === null ? `${callee}（ボタンの数が分からない）` : callee, { key });
      }
    });
  };
  if (!file.endsWith('.vue')) { inspectScript(source); return violations; }
  const { descriptor, errors } = parse(source, { filename: file });
  if (errors.length) throw new Error(`${file}: ${errors.map(String).join(', ')}`);
  for (const script of [descriptor.script, descriptor.scriptSetup]) if (script) inspectScript(script.content, script.loc.start.offset);
  const root = descriptor.template?.ast;
  if (!root) return violations;
  function walk(node, ancestors = []) {
    if (node.type === 1) {
      const cls = classes(node);
      const testid = attrValue(attr(node, 'data-testid'));
      const ownKeys = node.children.filter((c) => c.type === 5).flatMap((c) => keys(c.content.content));
      const selectors = { ...(testid ? { testid } : {}), ...(ownKeys.length ? { key: ownKeys[0] } : {}) };
      const emit = (rule, hit = node.tag, sel = selectors) => add(rule, node.loc.start.offset, hit, sel);
      if (cls.includes('form-text')) emit('help.form-text');
      if ((cls.includes('text-muted') || cls.includes('small') || node.tag === 'small') && ownKeys.some((k) => helpKey.test(k))) emit('help.muted-text', ownKeys.join(', '));
      if (cls.some((c) => c === 'text-danger' || c === 'text-warning') && node.children.some((c) => c.type === 5 || (c.type === 2 && c.content.trim() && c.content.trim() !== '*'))) emit('diag.inline-text');
      if (cls.includes('alert')) emit('diag.raw-alert');
      if (cls.includes('modal')) emit('dialog.ad-hoc-modal');
      if (cls.includes('text-center') && cls.includes('text-muted') && ownKeys.some((k) => /empty|no_|not_found|select_/.test(k))) emit('empty.ad-hoc');
      const inFooter = ancestors.some((n) => n.type === 1 && classes(n).includes('modal-footer'));
      if (node.tag === 'button' && (cls.includes('btn-secondary') || cls.includes('btn-outline-info') || (inFooter && cls.includes('btn-sm')) || (ownKeys.includes('common.cancel') && !cls.includes('btn-outline-secondary')))) emit('button.variant', cls.join(' '));
      // 地図の上に重ねる道具のボタン（ui-map-overlay-proposal.md §4.2）。札（map-tool）を持ち、aria-label と title の両方があること
      const inMapOverlay = ancestors.some((n) => n.type === 1 && classes(n).some((c) => c === 'map-overlay-tools' || c === 'map-overlay-tools__row'));
      if (node.tag === 'button' && inMapOverlay) {
        const hasText = (name) => {
          const text = attrValue(attr(node, name))?.trim() ?? '';
          return Boolean(text) && !/^(?:''|"")$/.test(text);
        };
        const hasLabel = hasText('aria-label');
        const hasTitle = hasText('title');
        if (!cls.includes('map-tool') || !hasLabel || !hasTitle) {
          emit('map.tool-button', [cls.includes('map-tool') ? '' : 'map-tool が無い', hasLabel ? '' : 'aria-label が無い', hasTitle ? '' : 'title が無い'].filter(Boolean).join(' / '), { ...selectors, key: 'map-tool' });
        }
      }
      if (normalize(node.tag) === 'contexthelp') {
        const label = attr(node, 'ariaLabel');
        if (!label || !attrValue(label)?.trim() || /^(?:''|"")$/.test(attrValue(label).trim())) emit('help.aria-label');
      }
      if (node.tag === 'template' && node.props.some((p) => p.type === 7 && p.name === 'slot' && p.arg?.content === 'help') && ancestors.some((n) => normalize(n.tag ?? '') === 'editorfield')) {
        if (node.children.some((c) => c.type === 5 || (c.type === 2 && c.content.trim()) || (c.type === 1 && normalize(c.tag) !== 'contexthelp'))) emit('help.slot-misuse');
      }
      for (const p of node.props.filter((p) => p.type === 7 && p.exp)) {
        const keyList = keys(p.exp.content).filter((k) => helpKey.test(k));
        const allowedHelp = normalize(node.tag) === 'contexthelp' && ['text', 'title', 'arialabel'].includes(normalize(propName(p) ?? ''));
        if (!allowedHelp) for (const key of keyList) emit('help.key-outside-contexthelp', key, { ...(testid ? { testid } : {}), key });
        if (p.name === 'on') inspectScript(p.exp.content, p.exp.loc.start.offset);
      }
    }
    if (node.type === 5) {
      const parent = ancestors.at(-1);
      for (const key of keys(node.content.content).filter((k) => helpKey.test(k))) add('help.key-outside-contexthelp', node.loc.start.offset, key, { key, ...(attrValue(attr(parent ?? {}, 'data-testid')) ? { testid: attrValue(attr(parent, 'data-testid')) } : {}) });
    }
    for (const child of node.children ?? []) walk(child, node.type === 1 ? [...ancestors, node] : ancestors);
  }
  walk(root);
  return violations;
}

export function applyAllowlist(violations, entries) {
  const errors = [];
  const warnings = [];
  const allowed = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!ruleIds.has(entry.rule) || typeof entry.file !== 'string' || !entry.file.startsWith('src/') || /[*?[\]{}]|\.\./.test(entry.file) || !entry.reason?.trim() || !entry.source?.trim() || !/^(?:docs\/|https:\/\/)/.test(entry.source) || (!entry.testid && !entry.key) || /[*?]/.test(entry.testid ?? entry.key)) {
      errors.push(`allowlist[${index}]: rule/file/key または testid/reason/source が必要（glob 不可）`);
      continue;
    }
    const matches = violations.filter((v) => v.rule === entry.rule && v.file === entry.file && (!entry.testid || v.testid === entry.testid) && (!entry.key || v.key === entry.key));
    if (matches.length === 0) warnings.push(`allowlist[${index}]: stale ${entry.file} ${entry.rule}`);
    if (matches.length > 1 || matches.some((v) => allowed.has(v))) { errors.push(`allowlist[${index}]: 一意でない例外 ${entry.file} ${entry.rule}`); continue; }
    for (const match of matches) allowed.add(match);
  }
  return { violations: violations.filter((v) => !allowed.has(v)), allowed: [...allowed], errors, warnings };
}

export function check(root) {
  const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((f) => /\.(vue|ts)$/.test(f)).sort();
  const all = files.flatMap((f) => inspectSource(`src/${f}`, fs.readFileSync(path.join(root, 'src', f), 'utf8')));
  const allowFile = path.join(root, 'docs/ui-grammar.allowlist.json');
  const entries = fs.existsSync(allowFile) ? JSON.parse(fs.readFileSync(allowFile, 'utf8')) : [];
  if (!Array.isArray(entries)) throw new Error('許可リストは配列でなければならない');
  return { scannedFiles: files.length, ...applyAllowlist(all, entries) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = check(process.cwd());
    const reportAt = process.argv.indexOf('--report');
    if (reportAt !== -1) fs.writeFileSync(process.argv[reportAt + 1], JSON.stringify(result, null, 2) + '\n');
    for (const v of result.violations) console.log(`${v.file}:${v.line} ${v.rule} ${v.hit}`);
    for (const message of [...result.errors, ...result.warnings]) console.log(message);
    console.log(`UI grammar: ${result.violations.length} violations, ${result.allowed.length} allowed, ${result.errors.length} errors, ${result.warnings.length} warnings`);
    process.exitCode = result.violations.length || result.errors.length ? 1 : 0;
  } catch (error) { console.error(error); process.exitCode = 2; }
}
