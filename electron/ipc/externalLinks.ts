import { shell } from 'electron';
import { ipc } from './registry';

export function isHttpsExternalLink(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerExternalLinkHandlers(): void {
  ipc.handle('external-links:open-https', async (_event, value: unknown) => {
    if (!isHttpsExternalLink(value)) return false;
    await shell.openExternal(value);
    return true;
  });
}
