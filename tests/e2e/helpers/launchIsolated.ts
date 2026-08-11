import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

// m11-t5-shell-tokens.spec.ts で導入された隔離 Electron 起動ヘルパー。
// m14-t3-wiki-screenshots.spec.ts が env（MAPLAT_E2E_ROOT・--user-data-dir）含め
// 丸ごと再利用するため、両スペックが import できる helpers/ 配下へ抽出した
// （設計書 §3.5.2。MAPLAT_E2E_ROOT の付け忘れを構造的に防ぐのが目的で、挙動は無変更。
// 実装レビュー v1 Major 1 対応: スペック間 import は Playwright が禁止するパターンで
// `playwright test`（引数なし・全体実行）の collection を破壊するため、
// helpers/ への抽出でスペック間 import を解消した）。
export async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // AC14: 実ユーザーデータへ接続せず、隔離 root 外なら test 開始前に throw する
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}
