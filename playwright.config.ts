import path from 'node:path';
import { defineConfig } from '@playwright/test';

// e2e 起動の Electron が前面に出てフォーカスを奪わないようにする（詳細は
// tests/e2e/helpers/electronNoFocus.cjs）。NODE_OPTIONS の --require なので
// env を個別に渡している起動にも届く。MAPLAT_E2E_FOCUS=1 で従来どおりに戻る。
if (process.env.MAPLAT_E2E_FOCUS !== '1') {
  const noFocus = path.resolve(import.meta.dirname, 'tests/e2e/helpers/electronNoFocus.cjs');
  const current = process.env.NODE_OPTIONS ?? '';
  if (!current.includes(noFocus)) {
    // 空白を含むパスでも 1 つの引数になるよう、二重引用符で囲む（Node は NODE_OPTIONS の引用符を解釈する）
    process.env.NODE_OPTIONS = `${current} --require=${JSON.stringify(noFocus)}`.trim();
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  // 並列高負荷時のみ発生する希少なUI競合(発生率~0.2%/テスト)への
  // フレーク運用。失敗時その場で1回だけ再実行し、通れば合格扱い。ただしリトライ発生は
  // レポートに「flaky」として記録されるため、隠れずに追跡できる
  retries: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
