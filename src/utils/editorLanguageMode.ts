export function isTranslationMode(
  activeLang: string | null | undefined,
  defaultLang: string | null | undefined,
): boolean {
  return Boolean(activeLang && defaultLang && activeLang !== defaultLang);
}
