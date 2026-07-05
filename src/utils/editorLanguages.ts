// エディタ/ビューア共通の対応言語定義。
// ここに載る言語 = ビューア(@maplat/ui assets/locales)にUIリソースがある言語であり、
// エディタUI言語・地図/アプリのデフォルト言語の選択肢はすべて本リストから導出する。
// renderer(Vue)とelectron main(SettingsServiceのOS言語検出)の両方から使う。

export const SUPPORTED_LANGUAGES = [
  { code: 'ja', labelKey: 'japanese', nativeName: '日本語' },
  { code: 'en', labelKey: 'english', nativeName: 'English' },
  { code: 'de', labelKey: 'germany', nativeName: 'Deutsch' },
  { code: 'fr', labelKey: 'french', nativeName: 'Français' },
  { code: 'es', labelKey: 'spanish', nativeName: 'Español' },
  { code: 'ko', labelKey: 'korean', nativeName: '한국어' },
  { code: 'zh', labelKey: 'simplified', nativeName: '简体中文' },
  { code: 'zh-TW', labelKey: 'traditional', nativeName: '繁體中文' },
  { code: 'vi', labelKey: 'vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'th', labelKey: 'thai', nativeName: 'ไทย' },
  { code: 'id', labelKey: 'indonesian', nativeName: 'Bahasa Indonesia' },
] as const;

export type LangCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const LANG_CODES: LangCode[] = SUPPORTED_LANGUAGES.map((entry) => entry.code);

// 旧実装のlangsマップ互換: langコード → common.* i18nキー名
export const LANGS_MAP: Record<LangCode, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((entry) => [entry.code, entry.labelKey])
) as Record<LangCode, string>;

// OSロケール(app.getLocale()やnavigator.language)を対応言語コードへ解決する。
// 中国語は繁体系(Hant/TW/HK/MO)をzh-TWへ、それ以外をzhへ寄せる。非対応言語はenへフォールバック
export function resolveEditorLanguage(locale: string): LangCode {
  const normalized = (locale || '').toLowerCase();
  if (!normalized) return 'en';
  if (normalized.startsWith('zh')) {
    const traditional = ['hant', '-tw', '_tw', '-hk', '_hk', '-mo', '_mo'].some((token) =>
      normalized.includes(token)
    );
    return traditional ? 'zh-TW' : 'zh';
  }
  const base = normalized.split(/[-_]/)[0];
  return (LANG_CODES as string[]).includes(base) ? (base as LangCode) : 'en';
}
