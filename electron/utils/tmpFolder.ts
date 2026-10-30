// 一時フォルダの解決と、使う前の確認。
//
// Linux の /tmp は全員が書けるので、他の利用者が /tmp/<アプリ名> を先に作れる。そこで Linux だけ
// 利用者のホームの下（userData）を使う。macOS と Windows の一時領域は利用者ごとなので今のまま。
// Windows の userData は Roaming に同期されるので使わない。
//
// このモジュールは electron を import しない（smoke が直接 import する）。
import path from 'node:path';

type TmpFolderDeps = {
  platform: NodeJS.Platform;
  getPath: (name: 'temp' | 'userData') => string;
  appName: string;
};

export function resolveTmpFolder(deps: TmpFolderDeps): string {
  if (deps.platform === 'linux') return path.join(deps.getPath('userData'), 'tmp');
  return path.join(deps.getPath('temp'), deps.appName);
}

type OwnedDirectoryDeps = {
  lstat: (target: string) => Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean; uid: number }>;
  mkdir: (target: string, options: { recursive: true }) => Promise<unknown>;
  /** POSIX だけにある。Windows では undefined で、持ち主を見ない */
  getuid?: () => number;
};

// 無ければ作り、リンク・ディレクトリ以外・他人の持ち物なら投げる。
export async function assertOwnedDirectory(dir: string, deps: OwnedDirectoryDeps): Promise<void> {
  await deps.mkdir(dir, { recursive: true });
  const stat = await deps.lstat(dir);
  if (stat.isSymbolicLink()) throw new Error('temp folder is a link');
  if (!stat.isDirectory()) throw new Error('temp folder is not a directory');
  if (deps.getuid && stat.uid !== deps.getuid()) throw new Error('temp folder is owned by another user');
}
