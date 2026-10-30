// 既定の session の権限の判定（electron を import しない）。
//
// 画面が使う権限はクリップボードへの書き込みだけなので、それ以外はすべて拒否する。
// プレビューの iframe（http://localhost）にも権限を渡さない。
import { isAllowedNavigationUrl } from '../navigation-guard';

export function decidePermission(permission: string, requestingUrl: string, devServerUrl?: string | null): boolean {
  return permission === 'clipboard-sanitized-write' && isAllowedNavigationUrl(requestingUrl, devServerUrl);
}
