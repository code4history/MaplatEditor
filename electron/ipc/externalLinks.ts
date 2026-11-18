import { shell } from 'electron';
import { ipc } from './registry';

function toHttpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function isHttpsExternalLink(value: unknown): value is string {
  return toHttpsUrl(value) !== null;
}

export function registerExternalLinkHandlers(): void {
  ipc.handle('external-links:open-https', async (_event, value: unknown) => {
    const url = toHttpsUrl(value);
    if (!url) return false;
    await shell.openExternal(url.href);
    return true;
  });
}
