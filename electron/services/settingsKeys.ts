// renderer が読み書きできる設定キーの表と値の検査（electron を import しない）。
//
// SettingsService には main だけが使うキー（一時領域の場所・ダイアログの記憶など）もあるので、
// renderer から届く `settings:get`・`settings:set` はこの表のキーだけを通す。
// renderer で新しいキーを使うときは、この表も同時に足す。
import path from 'node:path';

export const RENDERER_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'lang',
  'saveFolder',
  'jpegDecodeMaxMemoryMB',
  'jpegDecodeMaxResolutionMP',
  'updateCheckEnabled',
  'editorGoogleApiKey',
  'editorMapboxToken',
  'defaultPublishGoogleApiKey',
  'defaultPublishMapboxToken',
  'recentSearches',
]);

const STRING_KEYS: ReadonlySet<string> = new Set([
  'lang',
  'editorGoogleApiKey',
  'editorMapboxToken',
  'defaultPublishGoogleApiKey',
  'defaultPublishMapboxToken',
]);

/** Set で判定する（ドット区切りや `__proto__` を設定の保存先へ届かせない） */
export function assertRendererSettingsKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !RENDERER_SETTINGS_KEYS.has(key)) {
    throw new Error('settings key is not allowed');
  }
}

function assertSaveFolderShape(value: unknown, platform: NodeJS.Platform): void {
  if (typeof value !== 'string' || value === '') throw new Error('saveFolder must be a path');
  if (value.startsWith('\\\\') || value.startsWith('//')) throw new Error('saveFolder must not be a network path');
  const absolute = platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) : path.posix.isAbsolute(value);
  if (!absolute) throw new Error('saveFolder must be an absolute path');
}

export function validateRendererSettingsValue(
  key: string,
  value: unknown,
  options: { platform?: NodeJS.Platform } = {},
): void {
  if (key === 'saveFolder') {
    assertSaveFolderShape(value, options.platform ?? process.platform);
  } else if (STRING_KEYS.has(key) && typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  // 数値・真偽値のキーは SettingsService.set が正規化し、recentSearches は renderer が正規化する
}

/**
 * フォルダのダイアログが返した値を 1 回だけ覚える。保存フォルダは配信と読み出しの許可ルートになるので、
 * renderer が組み立てた文字列ではなく、利用者がダイアログで選んだ値だけを通すためのもの。
 */
export class SaveFolderGate {
  private picked: string | null = null;

  /** ダイアログの結果を覚える。キャンセル（null）は前の選択を忘れる */
  remember(value: string | null): void {
    this.picked = value;
  }

  consume(value: unknown): boolean {
    if (this.picked === null || value !== this.picked) return false;
    this.picked = null;
    return true;
  }
}
