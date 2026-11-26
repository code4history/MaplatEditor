#!/usr/bin/env node
/**
 * e2e から main process への evaluate が、共通の 1 つの関数（tests/e2e/helpers/evalMain.ts の evalMain）だけを
 * 通ることを検査する。
 *
 * ElectronApplication.evaluate() に関数をそのまま渡すと、main が JS の実行で塞がっている間に届いた呼び出しが
 * 「Resulting promise was garbage collected.」で落ちる（同期の値を返す形は実測で 1 回あたり数 %〜、塞がっている間は
 * ほぼ毎回。async 関数にしただけの形も、窓が狭まるだけで落ちる）。evalMain は main の側でマクロタスクを 1 つ待ってから
 * 値を返すので落ちない。直接の呼び出しが 1 箇所でも戻ると、その spec だけ間欠的に落ちるようになる。
 *
 * 判定は受け手の型で行う（page.evaluate・locator.evaluate は renderer への呼び出しで、対象外）。
 * 名前（app.evaluate）で探すと、running.app・appA! のような受け手を取りこぼす。
 * ESLint に載せないのは、lint の対象が src・electron だけで tests を読まないことと、型つきの規則の基盤が無いため。
 *
 * 使い方: node scripts/e2e-main-evaluate-smoke.mjs [--tests-dir <dir>]
 *   --tests-dir: 検査する tests ディレクトリ（既定は <リポジトリ>/tests。node_modules を解決できる場所に置くこと）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER_RELATIVE = path.join('e2e', 'helpers', 'evalMain.ts');
const TARGET_TYPE = 'ElectronApplication';
const METHODS = new Set(['evaluate', 'evaluateHandle']);

const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  types: ['node'],
};

function listTypeScriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(full);
    return /\.(ts|mts|cts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** 型が ElectronApplication（null・undefined との union を含む）か */
function isElectronApplication(checker, type) {
  const named = (t) => (t.aliasSymbol ?? t.getSymbol())?.getName() === TARGET_TYPE;
  const base = checker.getNonNullableType(type);
  return base.isUnion() ? base.types.some(named) : named(base);
}

/**
 * files の中から、ElectronApplication への直接の evaluate・evaluateHandle を探す。
 * virtualFiles（パス → 本文）は、ディスクに無いファイルを同じ条件で読ませるためのもの（自己検査用）。
 */
function findDirectMainEvaluates(files, virtualFiles = new Map()) {
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  const real = { fileExists: host.fileExists, readFile: host.readFile, getSourceFile: host.getSourceFile };
  host.fileExists = (file) => virtualFiles.has(file) || real.fileExists(file);
  host.readFile = (file) => virtualFiles.get(file) ?? real.readFile(file);
  host.getSourceFile = (file, languageVersion, ...rest) =>
    virtualFiles.has(file)
      ? ts.createSourceFile(file, virtualFiles.get(file), languageVersion, true)
      : real.getSourceFile(file, languageVersion, ...rest);

  const roots = [...files, ...virtualFiles.keys()];
  const program = ts.createProgram(roots, COMPILER_OPTIONS, host);
  const checker = program.getTypeChecker();
  const wanted = new Set(roots);
  const found = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (!wanted.has(sourceFile.fileName)) continue;
    const visit = (node) => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && METHODS.has(node.expression.name.text)
        && isElectronApplication(checker, checker.getTypeAtLocation(node.expression.expression))
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        found.push({
          file: sourceFile.fileName,
          line: line + 1,
          call: `${node.expression.expression.getText()}.${node.expression.name.text}(`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

function parseTestsDir(argv) {
  const index = argv.indexOf('--tests-dir');
  if (index === -1) return path.join(projectRoot, 'tests');
  assert.ok(argv[index + 1], '--tests-dir にディレクトリが要る');
  return path.resolve(argv[index + 1]);
}

try {
  const testsDir = parseTestsDir(process.argv.slice(2));

  // ---- [1/3] 自己検査: 検査が、直接の呼び出しを型で見つけられること ----
  // 型（@playwright/test）を解決できない環境では受け手がすべて any になり、何も見つからずに通ってしまう。
  // 実物を読む前に、偽の spec で「見つかるべきものが見つかる」ことを確かめる
  {
    const fixture = path.join(projectRoot, 'tests', 'e2e', '__e2e_main_evaluate_smoke_fixture__.spec.ts');
    const source = [
      "import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';",
      "import { evalMain } from './helpers/evalMain';",
      'export async function fixture(page: Page, running: { app: ElectronApplication }, maybe: ElectronApplication | undefined) {',
      '  const app = await electron.launch({ args: [] });',
      '  await app.evaluate(() => 1);', // 5: 同期の値を返す形
      '  await app.evaluate(async () => 1);', // 6: async にしただけの形
      '  await running.app.evaluate(({ app: electronApp }) => electronApp.getName());', // 7: 受け手がプロパティ
      '  await maybe!.evaluate(() => 1);', // 8: 受け手が non-null 表明
      '  await maybe?.evaluate(() => 1);', // 9: 受け手が optional chaining
      '  await app.evaluateHandle(() => globalThis);', // 10: handle を取る形
      '  await expect_poll(() => app.evaluate(() => 2));', // 11: poll の中
      '  await page.evaluate(() => 1);', // renderer への呼び出し（対象外）
      "  await page.locator('body').evaluate((el) => el.tagName);", // 対象外
      '  await page.mainFrame().evaluate(() => 1);', // 対象外
      '  await evalMain(app, () => 1);', // 共通の口（対象外）
      '}',
      'declare function expect_poll(fn: () => Promise<unknown>): Promise<void>;',
      '',
    ].join('\n');
    const found = findDirectMainEvaluates([], new Map([[fixture, source]]));
    assert.deepEqual(
      found.map((hit) => `${hit.line}:${hit.call}`),
      [
        '5:app.evaluate(',
        '6:app.evaluate(',
        '7:running.app.evaluate(',
        '8:maybe!.evaluate(',
        '9:maybe.evaluate(',
        '10:app.evaluateHandle(',
        '11:app.evaluate(',
      ],
      '自己検査: 偽の spec の中の直接の呼び出しを、過不足なく見つけること（型を解決できていない可能性がある）',
    );
    console.log('  [1/3] 自己検査（直接の呼び出し 7 種を検出・renderer への呼び出しと evalMain は検出しない）: PASS');
  }

  // ---- [2/3] 実物: tests の中で、main への evaluate を直接呼ぶのは共通の口だけ ----
  {
    const files = listTypeScriptFiles(testsDir);
    assert.ok(files.length > 0, `${testsDir} に TypeScript のファイルが無い`);
    const helper = path.join(testsDir, HELPER_RELATIVE);
    const found = findDirectMainEvaluates(files);
    const outside = found.filter((hit) => hit.file !== helper);
    assert.equal(
      outside.length,
      0,
      `main への evaluate を直接呼んでいる箇所が ${outside.length} 件ある。`
        + `tests/e2e/helpers/evalMain.ts の evalMain(app, fn, arg) を通すこと:\n`
        + outside.map((hit) => `  ${path.relative(projectRoot, hit.file)}:${hit.line}  ${hit.call}`).join('\n'),
    );
    const inside = found.filter((hit) => hit.file === helper);
    assert.deepEqual(
      inside.map((hit) => hit.call),
      ['app.evaluate('],
      '共通の口（helpers/evalMain.ts）が main を呼ぶのは 1 箇所だけ',
    );
    console.log(`  [2/3] 実物（${files.length} ファイル）: 直接の呼び出しは共通の口の 1 箇所だけ: PASS`);
  }

  // ---- [3/3] 共通の口の形: マクロタスクを待つ・呼び直さない ----
  {
    const helperSource = fs.readFileSync(path.join(testsDir, HELPER_RELATIVE), 'utf8');
    const code = helperSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(code, /setImmediate\(/, '共通の口は、値を返す前に main の側でマクロタスク（setImmediate）を待つ');
    assert.equal((code.match(/\.evaluate\(/g) ?? []).length, 1, '共通の口は evaluate を 1 回だけ呼ぶ（呼び直さない）');
    assert.doesNotMatch(code, /garbage collected/, '共通の口は「garbage collected」を捕まえて呼び直さない');
    console.log('  [3/3] 共通の口の形（マクロタスクを待つ・呼び直さない）: PASS');
  }

  console.log('e2e main evaluate smoke passed');
} catch (error) {
  console.error('e2e main evaluate smoke FAILED:', error.stack ?? error.message);
  process.exit(1);
}
