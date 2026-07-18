import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  // M11-T12 (2026-07-18 人間承認): 並列高負荷時のみ発生する希少なUI競合(発生率~0.2%/テスト)への
  // フレーク運用。失敗時その場で1回だけ再実行し、通れば合格扱い。ただしリトライ発生は
  // レポートに「flaky」として記録されるため、隠れずに追跡できる
  retries: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
