import { localizeTitle } from "./langResource";

export interface ResolvedAppLocalizedMetadata {
  lang: string;
  appName: string;
  keywords: string;
  manifestName: string;
  manifestShortName: string;
}

export function resolveAppLocalizedMetadata(document: any): ResolvedAppLocalizedMetadata {
  const lang = typeof document?.lang === "string" && document.lang ? document.lang : "ja";
  const appID = typeof document?.appID === "string" ? document.appID : "";
  const appName =
    localizeTitle(document?.appName, lang) ||
    localizeTitle(document?.title, lang) ||
    appID;
  const manifest = document?.manifestSettings || document?.manifest || {};

  return {
    lang,
    appName,
    keywords: localizeTitle(document?.keywords, lang),
    manifestName: localizeTitle(manifest.name, lang) || appName,
    manifestShortName: localizeTitle(manifest.shortName || manifest.short_name, lang) || appName,
  };
}
