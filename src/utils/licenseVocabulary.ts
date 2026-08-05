// ライセンス語彙の正本 (m6-t2)。
// 保存値 (ASCII)・表示 i18n キー・画像/データ側の出し分けを単一のテーブルで持つ。
// MapEdit と BaseMapEdit の両方がこの正本から選択肢を供給される (LicenseSelect 経由)。
// アイコン解決規則 (§4.3): 保存値の toLowerCase + 空白→アンダースコアがファイル名になる。

export interface LicenseOption {
  /** 保存値 (ASCII)。そのまま DB/交換形へ書かれる */
  value: string;
  /** i18n キー (表示ラベル) */
  labelKey: string;
  /** 画像/スタイル側の選択肢に出すか */
  forImage: boolean;
  /** データ側の選択肢に出すか */
  forData: boolean;
}

// §4.1 の語彙表。PD の image/data 非対称は既存仕様を温存する。
export const LICENSE_VOCABULARY: readonly LicenseOption[] = [
  { value: "All right reserved", labelKey: "mapedit.cc_allright_reserved", forImage: true, forData: true },
  { value: "CC BY", labelKey: "mapedit.cc_by", forImage: true, forData: true },
  { value: "CC BY-SA", labelKey: "mapedit.cc_by_sa", forImage: true, forData: true },
  { value: "CC BY-ND", labelKey: "mapedit.cc_by_nd", forImage: true, forData: true },
  { value: "CC BY-NC", labelKey: "mapedit.cc_by_nc", forImage: true, forData: true },
  { value: "CC BY-NC-SA", labelKey: "mapedit.cc_by_nc_sa", forImage: true, forData: true },
  { value: "CC BY-NC-ND", labelKey: "mapedit.cc_by_nc_nd", forImage: true, forData: true },
  { value: "CC0", labelKey: "mapedit.cc0", forImage: true, forData: true },
  { value: "PD", labelKey: "mapedit.cc_pd", forImage: true, forData: false },
  { value: "ODbL", labelKey: "mapedit.cc_odbl", forImage: true, forData: true },
  { value: "Custom", labelKey: "mapedit.cc_custom", forImage: true, forData: true },
];

export const IMAGE_LICENSE_OPTIONS: readonly LicenseOption[] = LICENSE_VOCABULARY.filter(
  (option) => option.forImage,
);

export const DATA_LICENSE_OPTIONS: readonly LicenseOption[] = LICENSE_VOCABULARY.filter(
  (option) => option.forData,
);

/** アイコンを持たない語彙の保存値 (Custom)。ビューアではアイコン無しで Note 文章だけを出す (§4.3) */
export const LICENSE_WITHOUT_ICON = "Custom";
