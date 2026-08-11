export interface LanguageValueOption {
  code: string;
  nativeName: string;
}

export interface LangValueChip {
  code: string;
  label: string;
  nativeName: string;
  value: string;
}

export function collectLangValueChips(
  modelValue: string | Record<string, string> | undefined,
  activeLang: string,
  languageOptions: readonly LanguageValueOption[],
  defaultLang: string,
): LangValueChip[] {
  const values =
    typeof modelValue === 'string'
      ? { [defaultLang]: modelValue }
      : modelValue ?? {};

  return languageOptions.flatMap((language) => {
    if (language.code === activeLang) return [];
    const value = values[language.code]?.trim();
    if (!value) return [];
    return [{
      code: language.code,
      label: language.code.toUpperCase(),
      nativeName: language.nativeName,
      value,
    }];
  });
}
