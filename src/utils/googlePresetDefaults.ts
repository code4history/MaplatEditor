// m6-t4b: Google プリセット選択時の帰属・ライセンス・ズーム既定値
// Vue / i18next 非依存の純粋モジュール。smoke から直接検証する。
//
// Minor 吸収:
// - m1: minZoom / maxZoom はフィールド独立に null のときだけ埋める
// - m3: 既定 Note 全文は本モジュールの言語テーブルに持ち、isGoogleDefaultNote は全言語分と照合する
//       （実行時 t() は現在言語しか返さないため、比較用セットを i18n に依存させない）

import type { LangCode } from "./editorLanguages";
import type { BaseMapEditDocument } from "./baseMapEditorDocument";

export const GOOGLE_DEFAULT_ATTR = "© Google";
export const GOOGLE_DEFAULT_LICENSE = "All right reserved";
export const GOOGLE_DEFAULT_MIN_ZOOM = 0;
/** ol/source/Google.js の maxZoom = 22 に整合 */
export const GOOGLE_DEFAULT_MAX_ZOOM = 22;

/** i18n キー basemap.google.default_license_note と同期（比較用の正本はここ） */
export const GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG: Record<LangCode, string> = {
  en: "Google Maps Platform terms apply. Attribution must remain visible.",
  ja: "Google Maps Platform の利用規約が適用されます。帰属表記は表示したままにしてください。",
  de: "Es gelten die Nutzungsbedingungen der Google Maps Platform. Die Attribution muss sichtbar bleiben.",
  fr: "Les conditions de Google Maps Platform s'appliquent. L'attribution doit rester visible.",
  es: "Se aplican los términos de Google Maps Platform. La atribución debe permanecer visible.",
  ko: "Google Maps Platform 이용약관이 적용됩니다. 저작자 표시는 계속 보여야 합니다.",
  zh: "适用 Google Maps Platform 服务条款。必须保留归属标注。",
  "zh-TW": "適用 Google Maps Platform 服務條款。必須保留歸屬標示。",
  vi: "Áp dụng điều khoản Google Maps Platform. Phải giữ nguyên dòng ghi công.",
  th: "ใช้ข้อกำหนดของ Google Maps Platform ต้องแสดงการระบุที่มาไว้",
  id: "Berlaku ketentuan Google Maps Platform. Atribusi harus tetap terlihat.",
};

/** i18n キー basemap.google.default_data_license_note と同期 */
export const GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG: Record<LangCode, string> = {
  en: "Map data and imagery © Google. See Google Maps Platform terms.",
  ja: "地図データおよび画像 © Google。Google Maps Platform の利用規約を参照してください。",
  de: "Kartendaten und Bildmaterial © Google. Siehe Nutzungsbedingungen der Google Maps Platform.",
  fr: "Données cartographiques et imagerie © Google. Voir les conditions de Google Maps Platform.",
  es: "Datos de mapas e imágenes © Google. Consulte los términos de Google Maps Platform.",
  ko: "지도 데이터 및 이미지 © Google. Google Maps Platform 이용약관을 참조하세요.",
  zh: "地图数据与影像 © Google。请参阅 Google Maps Platform 服务条款。",
  "zh-TW": "地圖資料與影像 © Google。請參閱 Google Maps Platform 服務條款。",
  vi: "Dữ liệu bản đồ và hình ảnh © Google. Xem điều khoản Google Maps Platform.",
  th: "ข้อมูลแผนที่และภาพ © Google ดูข้อกำหนดของ Google Maps Platform",
  id: "Data peta dan citra © Google. Lihat ketentuan Google Maps Platform.",
};

export type GooglePresetDefaults = {
  attr: Record<string, string>;
  license: string;
  dataLicense: string;
  licenseNote: Record<string, string>;
  dataLicenseNote: Record<string, string>;
  minZoom: number;
  maxZoom: number;
};

export function allGoogleDefaultNoteTexts(): string[] {
  return [
    ...Object.values(GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG),
    ...Object.values(GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG),
  ];
}

export function isGoogleDefaultAttr(text: string | undefined | null): boolean {
  const v = (text ?? "").trim();
  return v === "" || v === GOOGLE_DEFAULT_ATTR;
}

/**
 * 空文字は「埋めてよい」。非空は全言語の既定 Note のいずれかと一致すれば Google 既定とみなす。
 * （UI 言語切替後も再上書き抑止が効く — design review Minor m3）
 */
export function isGoogleDefaultNote(
  text: string | undefined | null,
  noteTexts: readonly string[] = allGoogleDefaultNoteTexts(),
): boolean {
  const v = (text ?? "").trim();
  if (v === "") return true;
  return noteTexts.includes(v);
}

export function buildGooglePresetDefaults(defaultLang: LangCode): GooglePresetDefaults {
  const licenseNote =
    GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG[defaultLang] ?? GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG.en;
  const dataLicenseNote =
    GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG[defaultLang] ?? GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG.en;
  return {
    attr: { [defaultLang]: GOOGLE_DEFAULT_ATTR },
    license: GOOGLE_DEFAULT_LICENSE,
    dataLicense: GOOGLE_DEFAULT_LICENSE,
    licenseNote: { [defaultLang]: licenseNote },
    dataLicenseNote: { [defaultLang]: dataLicenseNote },
    minZoom: GOOGLE_DEFAULT_MIN_ZOOM,
    maxZoom: GOOGLE_DEFAULT_MAX_ZOOM,
  };
}

/**
 * §4.2 上書きポリシーで defaults を doc へマージする。
 * zoom は min/max をフィールド独立に判定する（Minor m1: min のみ null なら min だけ埋める）。
 */
export function applyGooglePresetDefaults(
  doc: BaseMapEditDocument,
  defaults: GooglePresetDefaults = buildGooglePresetDefaults(doc.defaultLang),
): BaseMapEditDocument {
  const lang = doc.defaultLang;
  const next: BaseMapEditDocument = {
    ...doc,
    attr: { ...doc.attr },
    dataAttr: { ...doc.dataAttr },
    licenseNote: { ...doc.licenseNote },
    dataLicenseNote: { ...doc.dataLicenseNote },
    title: { ...doc.title },
    label: { ...doc.label },
  };

  const attrVal = doc.attr?.[lang] ?? "";
  if (isGoogleDefaultAttr(attrVal)) {
    next.attr = { ...next.attr, [lang]: defaults.attr[lang] ?? GOOGLE_DEFAULT_ATTR };
  }

  // license / dataLicense: 空のときだけ（ユーザー明示の All right reserved を尊重）
  if (!(doc.license ?? "").trim()) {
    next.license = defaults.license;
  }
  if (!(doc.dataLicense ?? "").trim()) {
    next.dataLicense = defaults.dataLicense;
  }

  const licenseNoteVal = doc.licenseNote?.[lang] ?? "";
  if (isGoogleDefaultNote(licenseNoteVal)) {
    next.licenseNote = {
      ...next.licenseNote,
      [lang]: defaults.licenseNote[lang] ?? GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG.en,
    };
  }

  const dataLicenseNoteVal = doc.dataLicenseNote?.[lang] ?? "";
  if (isGoogleDefaultNote(dataLicenseNoteVal)) {
    next.dataLicenseNote = {
      ...next.dataLicenseNote,
      [lang]: defaults.dataLicenseNote[lang] ?? GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG.en,
    };
  }

  // m1: per-field
  if (doc.minZoom === null) {
    next.minZoom = defaults.minZoom;
  }
  if (doc.maxZoom === null) {
    next.maxZoom = defaults.maxZoom;
  }

  return next;
}
