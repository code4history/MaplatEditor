/**
 * smoke 試験の作業フォルダ（scratch）共通ヘルパー。
 *
 * - makeSmokeScratch(prefix) が `.tmp-smoke/` 配下に mkdtemp 相当の作業フォルダを作る
 * - 作ったフォルダはプロセスの終了時に必ず消す（正常終了・例外・process.exit・SIGINT/SIGTERM/SIGHUP）。
 *   従来は各 smoke が自分で rm していたが、片付けが成功経路だけにある・process.exit が
 *   finally より先に走る・そもそも片付け記述がない、という理由で `.tmp-smoke/` に残り続けた
 *   （1 回の全数実行で最大 13GB が残留した実測）。ここへ寄せることで残置を防ぐ。
 * - 失敗の調査に使う場合は KEEP_SMOKE_TMP=1 を付ける。消さず、残した場所を表示する。
 * - 打ち切り（run-smokes の 600 秒タイムアウト）は SIGKILL のため片付けられない。
 *   溜まった分は scripts/clean-smoke-tmp.mjs（`smoke:clean`）で消す。
 */
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const smokeScratchRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.tmp-smoke'
);

const created = new Set();
let handlersInstalled = false;

function keepScratch() {
  const v = process.env.KEEP_SMOKE_TMP;
  return v != null && v !== '' && v !== '0';
}

function cleanupSync(reason) {
  if (created.size === 0) return;
  const dirs = [...created];
  created.clear();
  if (keepScratch()) {
    for (const dir of dirs) {
      console.error(`[smoke-scratch] KEEP_SMOKE_TMP により残置（${reason}）: ${dir}`);
    }
    return;
  }
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`[smoke-scratch] 片付けに失敗（${reason}）: ${dir}: ${e.message}`);
    }
  }
}

function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  // process.exit()・例外・イベントループの枯渇のいずれでも 'exit' は走る（実測）。
  // ただし 'exit' 内は同期しか走らせられないので rmSync で消す。
  process.on('exit', () => cleanupSync('exit'));
  // SIGINT 等は既定では 'exit' を経由せずに死ぬ（実測）ので、明示的に受けて消してから終了する。
  const signals = { SIGINT: 130, SIGHUP: 129, SIGTERM: 143 };
  for (const [sig, code] of Object.entries(signals)) {
    process.on(sig, () => {
      cleanupSync(sig);
      process.exit(code);
    });
  }
}

/**
 * `.tmp-smoke/` 配下に作業フォルダを作る（mkdtemp 互換。prefix の末尾に乱数が付く）。
 * プロセス終了時に自動で消す。KEEP_SMOKE_TMP=1 のときは残して場所を表示する。
 * @param {string} prefix フォルダ名の接頭辞（例: 'asset-draft-'）
 * @returns {Promise<string>} 作成したフォルダの絶対パス
 */
export async function makeSmokeScratch(prefix) {
  installHandlers();
  await mkdir(smokeScratchRoot, { recursive: true });
  const dir = await mkdtemp(path.join(smokeScratchRoot, prefix));
  created.add(dir);
  if (keepScratch()) console.error(`[smoke-scratch] KEEP_SMOKE_TMP により残す予定: ${dir}`);
  return dir;
}
