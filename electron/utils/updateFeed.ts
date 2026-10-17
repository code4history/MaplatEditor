// nov26-m7-t5（#141）: 自動更新の更新元と更新器の設定を決める純関数。electron を import しない
// （smoke が node で直接読む。前例: appScheme.ts・releaseChannel.ts）。
//
// 更新元（C-5）: 製品（app.isPackaged が真）は常に GitHub（electron-builder.config.cjs の publish から
// electron-builder が書く app-update.yml）。試験用の更新元を差し込めるのは、開発時（isPackaged が偽）かつ
// e2e（MAPLAT_E2E_ROOT が空でない）で、MAPLAT_E2E_UPDATE_FEED が 127.0.0.1 の http を指すときだけ。
// 利用者の設定（設定画面の保存値）・コマンドライン引数は読まない（smoke がソースで確かめる）。

export type UpdateFeed = { kind: 'github' } | { kind: 'test'; options: Record<string, unknown> };

const GITHUB: UpdateFeed = { kind: 'github' };
const LOOPBACK_HOST = /^127\.0\.0\.1:\d{1,5}$/;
const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\//;

function parseTestFeed(raw: string | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const options = value as Record<string, unknown>;
  if (options.provider === 'github') {
    if (typeof options.host !== 'string' || !LOOPBACK_HOST.test(options.host)) return null;
    if (options.protocol !== 'http') return null;
    return options;
  }
  if (options.provider === 'generic') {
    if (typeof options.url !== 'string' || !LOOPBACK_URL.test(options.url)) return null;
    return options;
  }
  return null;
}

export function resolveUpdateFeed(input: { isPackaged: boolean; env: Record<string, string | undefined> }): UpdateFeed {
  // 製品は env を読まない（試験用の口が製品に残らないことを、読み取りの有無まで含めて smoke が確かめる）
  if (input.isPackaged !== false) return GITHUB;
  const { env } = input;
  const root = env.MAPLAT_E2E_ROOT;
  if (typeof root !== 'string' || root === '') return GITHUB;
  const options = parseTestFeed(env.MAPLAT_E2E_UPDATE_FEED);
  return options == null ? GITHUB : { kind: 'test', options };
}

/** 更新器に当てる値（t5/AC1）。呼ぶたびに新しいオブジェクトを返す */
export function updaterSettings() {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    fullChangelog: false,
  };
}

export type UpdaterSettings = ReturnType<typeof updaterSettings>;

/**
 * updaterSettings() を更新器に当てる。
 * Windows の x64／arm64 は latest.yml に両方の Setup.exe が名前に arch を含んで載り、electron-updater の
 * findFile が process.arch で選ぶ（§3.5 の判定 (A)）ので channel は使わない。
 * electron-updater は channel を設定すると allowDowngrade を真にするので、channel を使う形へ変えても
 * channel の設定の後にこれを呼べば allowDowngrade は偽に戻る（§3.4）。
 */
export function applyUpdaterSettings(updater: UpdaterSettings): void {
  Object.assign(updater, updaterSettings());
  updater.allowDowngrade = false;
}
