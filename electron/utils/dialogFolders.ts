import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import SettingsService from '../services/SettingsService';

export type DialogPurpose = 'import' | 'export' | 'image' | 'saveFolder';
export type RememberedDialogFolders = Partial<Record<Exclude<DialogPurpose, 'saveFolder'>, string>>;
const REMEMBERED_PURPOSES = ['import', 'export', 'image'] as const;

function availableFolder(value: unknown): value is string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return false;
  try {
    if (!fs.statSync(value).isDirectory()) return false;
    fs.accessSync(value, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// 保存フォルダは現在の設定そのもの。残り3用途は最後の選択を別々に記憶する。
export function dialogDefaultPath(purpose: DialogPurpose, fileName?: string): string {
  const folders = SettingsService.get('lastDialogFolders');
  const remembered = purpose === 'saveFolder'
    ? SettingsService.get('saveFolder')
    : folders && typeof folders === 'object' && !Array.isArray(folders) ? folders[purpose] : undefined;
  const folder = availableFolder(remembered) ? remembered : app.getPath('documents');
  return fileName === undefined ? folder : path.join(folder, fileName);
}

// 呼出し側は取消でない結果だけを渡す。ファイル名・内容は永続化しない。
export function rememberDialogPath(purpose: DialogPurpose, pickedPath: string, kind: 'file' | 'directory'): void {
  if (purpose === 'saveFolder' || typeof pickedPath !== 'string' || !path.isAbsolute(pickedPath)) return;
  const existing = SettingsService.get('lastDialogFolders');
  const folders: RememberedDialogFolders = {};
  for (const key of REMEMBERED_PURPOSES) {
    const value = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing[key] : undefined;
    if (typeof value === 'string' && path.isAbsolute(value)) folders[key] = value;
  }
  folders[purpose] = kind === 'directory' ? path.resolve(pickedPath) : path.dirname(pickedPath);
  SettingsService.set('lastDialogFolders', folders);
}
