// 取り込みのときの最初の書誌の写し。
//
// Manifest から地図の metadata の鍵へ値を写す規則は Core が持つ。ここは
// 「既定の selector を作る」「値を取り出す」「写した日時を添える」の薄い包みだけを置く。
// renderer（取り込みのダイアログ）から呼び、main では呼ばない。
//
// 値の洗浄は呼び出し側が渡せる（省略したら Core の sanitizeIiifHtml）。
// Node には window が無いので、smoke は偽の洗浄を渡して Core の結果と比べる。
// @ts-ignore
import { IIIF_BINDABLE_KEYS, compareIiifCopy, listIiifCanvases, proposeIiifBindings, resolveIiifMetadata } from '@maplat/core/src/iiif/manifest';
// @ts-ignore
import type { IiifBindings, IiifFrom, IiifMetadataEntry, MaplatIiifSection } from '@maplat/core/src/iiif/manifest';
import type { Localized } from '@maplat/core/common';
import { sanitizeIiifHtml } from '@maplat/core/common';
import { DEPRECATED_EXACT_NAME_KEY } from './mapNameUnification';

/** 包みの受け取れる指定。 */
export type IiifMetadataCopyOptions = {
  /** HTML として写す値の洗浄。省略したら Core の sanitizeIiifHtml。 */
  sanitize?: (html: string) => string;
  /** 写した日時の時計。省略したら実時計。 */
  now?: () => Date;
};

/** 写しに成功したときの結果。 */
export type IiifMetadataCopySuccess = {
  ok: true;
  /** 既定の selector（Core の proposeIiifBindings の戻り値）。 */
  bindings: IiifBindings;
  /** 地図の metadata の鍵へ写す値。 */
  values: Record<string, Localized | string>;
  /** 鍵 → 言語 → 写した時点の値。 */
  copiedValues: Record<string, Record<string, string>>;
  /** Manifest と canvas の metadata の全件。 */
  copiedMetadata: IiifMetadataEntry[];
  /** 写した日時（ISO 8601）。 */
  copiedAt: string;
  /** Core が返した警告（画面には出さないが、呼び出し側が残せる）。 */
  warnings: string[];
};

/** 写せなかったときの結果。 */
export type IiifMetadataCopyFailure = {
  ok: false;
  reason: 'not-manifest' | 'unsupported-version';
  warnings: string[];
};

export type IiifMetadataCopy = IiifMetadataCopySuccess | IiifMetadataCopyFailure;

/**
 * 地図に書き戻さない鍵を外した結び付けを返す（元は変えない）。
 *
 * 1.0.0 で廃止した属性は Editor に欄が無く、写すと保存時の正規化で
 * 「廃止した属性 → 題名、旧題名 → 表示ラベル」が当たり、利用者が見ていない値で題名が
 * 置き換わる。他の道具や手書きの結び付けに残っていても写さないよう、Core へ渡す前にここで外す。
 * 外す場所はこの 1 か所に閉じる。
 */
function withoutRetiredKeys(bindings: IiifBindings): IiifBindings {
  const next: IiifBindings = { ...bindings };
  delete next[DEPRECATED_EXACT_NAME_KEY];
  return next;
}

/**
 * 選んだ canvas の書誌を、地図の metadata の鍵へ写す。
 * selector の規則も値の取り出し方も Core に任せ、ここでは何も読み替えない
 *（廃止した属性を外すことだけをここで行う）。
 */
export function copyIiifMetadata(
  manifest: unknown,
  canvasId: string,
  lang: string,
  options: IiifMetadataCopyOptions = {},
): IiifMetadataCopy {
  const sanitize = options.sanitize ?? sanitizeIiifHtml;
  const bindings = withoutRetiredKeys(proposeIiifBindings(manifest, canvasId));
  const resolved = resolveIiifMetadata(manifest, { canvas: canvasId, bindings }, lang, sanitize);
  const copiedAt = (options.now ? options.now() : new Date()).toISOString();
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, warnings: [] };
  }
  return {
    ok: true,
    bindings,
    values: resolved.values,
    copiedValues: resolved.copiedValues,
    copiedMetadata: resolved.copiedMetadata,
    copiedAt,
    warnings: resolved.warnings,
  };
}

/**
 * 写す鍵の一覧。Core の表の鍵から廃止した属性だけを外して返し、Editor に一覧を持たない。
 * 並びは Core の表の順。
 */
export function iiifBindableKeys(): string[] {
  return Object.keys(IIIF_BINDABLE_KEYS).filter((key) => key !== DEPRECATED_EXACT_NAME_KEY);
}

/**
 * 1 つの鍵の結び付けを変えた新しい bindings を返す（元は変えない）。
 * from が null ならその鍵を外す。Core の表に無い鍵は何も変えない。
 */
export function setIiifBinding(
  bindings: IiifBindings,
  key: string,
  from: IiifFrom | null,
): IiifBindings {
  const property = IIIF_BINDABLE_KEYS[key];
  if (property === undefined) return { ...bindings };
  const next: IiifBindings = { ...bindings };
  if (from === null) {
    delete next[key];
    return next;
  }
  next[key] = { from, property };
  return next;
}

/**
 * 選んだ結び付けのまま Manifest を取り直して写す。
 * 結び付けの決め方も値の取り出し方も Core に任せ、ここでは廃止した属性を外すことだけを行う。
 * 戻り値の結び付けも外した後のもの（写し直しはこの関数を通るので同じく外れる）。
 */
export function copyIiifMetadataWithBindings(
  manifest: unknown,
  iiif: Pick<MaplatIiifSection, 'canvas' | 'bindings'>,
  lang: string,
  options: IiifMetadataCopyOptions = {},
): IiifMetadataCopy {
  const sanitize = options.sanitize ?? sanitizeIiifHtml;
  const bindings = withoutRetiredKeys(iiif.bindings ?? {});
  const resolved = resolveIiifMetadata(manifest, { canvas: iiif.canvas, bindings }, lang, sanitize);
  const copiedAt = (options.now ? options.now() : new Date()).toISOString();
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, warnings: [] };
  }
  return {
    ok: true,
    bindings,
    values: resolved.values,
    copiedValues: resolved.copiedValues,
    copiedMetadata: resolved.copiedMetadata,
    copiedAt,
    warnings: resolved.warnings,
  };
}

/**
 * 写した値を地図の metadata へ入れた新しいオブジェクトを返す（元は変えない）。
 * 値が言語つきなら、その言語の値だけを入れる（地図の言語が無ければ値の最初の言語）。
 * 地図の欄が言語つきなら他の言語を残し、文字列なら置き換える。
 */
export function applyIiifValues(
  target: Record<string, unknown>,
  values: Record<string, Localized | string>,
  lang: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(values)) {
    const table = textTable(value, lang);
    if (table === undefined) continue;
    next[key] = mergeText(next[key], table, lang);
  }
  return next;
}

/** 写した値を「言語 → 文字」の表にする。地図の言語が無ければ値の最初の言語を使う。 */
function textTable(value: Localized | string, lang: string): Record<string, string> | undefined {
  if (typeof value === 'string') return { [lang]: value };
  if (Object.prototype.hasOwnProperty.call(value, lang)) return { [lang]: value[lang] };
  const entry = Object.entries(value)[0];
  return entry === undefined ? undefined : { [entry[0]]: entry[1] };
}

/**
 * 地図の 1 つの欄に、言語ごとの文字を入れる（元は変えない）。
 * 欄が言語つきなら他の言語を残し、文字列や未設定なら地図の言語の文字を 1 つ入れる。
 */
function mergeText(
  current: unknown,
  table: Record<string, string>,
  defaultLang: string,
): string | Record<string, string> | undefined {
  if (typeof current === 'object' && current !== null) {
    return { ...(current as Record<string, string>), ...table };
  }
  return Object.prototype.hasOwnProperty.call(table, defaultLang)
    ? table[defaultLang]
    : Object.values(table)[0];
}

/** 写し直した 1 行の理由。 */
export type IiifRecopyReason = 'unchanged' | 'human-edited' | 'iiif-changed' | 'both';

/** 写し直した 1 行。 */
export type IiifRecopyRow = {
  /** 地図の metadata の鍵。 */
  key: string;
  /** 値の言語。 */
  lang: string;
  /** 4 通りの理由。 */
  reason: IiifRecopyReason;
  /** いまの地図の値。 */
  current: string | undefined;
  /** 写した時点の値。 */
  copied: string | undefined;
  /** 取り直した Manifest の新しい値。無ければ undefined。 */
  next: string | undefined;
};

/** この包みが地図の iiif 節から読む部分。 */
type IiifSectionPart = {
  canvas?: string;
  bindings?: IiifBindings;
  copiedValues?: Record<string, Record<string, string>>;
};

/** Core の compareIiifCopy が返す 1 行（真偽から 4 つの語へ移すための材料）。 */
type IiifComparedRow = {
  key: string;
  lang: string;
  humanEdited: boolean;
  iiifChanged: boolean | undefined;
};

/** 取り直した Manifest の戻り値の形（main の inspect・recopy の戻り値）。 */
export type IiifRecopyReply =
  | { ok: true; json: unknown }
  | { ok: false; reason: string; detail?: string };

/** 比べられたときの結果。 */
export type IiifRecopyPlanSuccess = {
  ok: true;
  /** 取り直した Manifest を今の結び付けで写した結果。 */
  fresh: IiifMetadataCopySuccess;
  /** 鍵・言語ごとの行。 */
  rows: IiifRecopyRow[];
};

/** 比べられなかったときの結果。 */
export type IiifRecopyPlanFailure = {
  ok: false;
  reason: string;
};

export type IiifRecopyPlan = IiifRecopyPlanSuccess | IiifRecopyPlanFailure;

/** 地図から、ある言語の値として読める文字を取り出す（理由づけは Core が行う）。 */
function currentText(value: unknown, language: string, defaultLang: string): string | undefined {
  if (typeof value === 'string') return language === defaultLang ? value : undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const found = (value as Record<string, unknown>)[language];
  return typeof found === 'string' ? found : undefined;
}

/**
 * 取り直した Manifest と地図を比べ、鍵・言語ごとに理由を付けた行を返す（地図は変えない）。
 * 人が直したか・IIIF の側が変わったかの判定は Core の compareIiifCopy に任せ、
 * ここではその真偽を 4 つの語へ移すだけにする。
 */
export function planIiifRecopy(
  reply: IiifRecopyReply,
  map: Record<string, unknown>,
  options: IiifMetadataCopyOptions = {},
): IiifRecopyPlan {
  if (!reply.ok) return { ok: false, reason: reply.reason };
  const iiif = (map.iiif ?? {}) as IiifSectionPart;
  const lang = typeof map.lang === 'string' && map.lang !== '' ? map.lang : 'ja';
  const fresh = copyIiifMetadataWithBindings(
    reply.json,
    { canvas: iiif.canvas, bindings: iiif.bindings },
    lang,
    options,
  );
  if (!fresh.ok) return { ok: false, reason: fresh.reason };
  // IIIF から配信する地図は、新しい Manifest のコマの大きさが地図の記録と合うかを見る。
  // 画像が差し替わると打った GCP が合わなくなるため、合わなければ 1 つも写さない。
  // 「書誌だけ」の地図は手元の画像の大きさが canvas と違ってよいので、この検査をしない。
  if (map.delivery !== undefined && map.delivery !== null) {
    const listed = listIiifCanvases(reply.json);
    const canvas = listed.ok
      ? listed.canvases.find((item: { id: string; width: number; height: number }) => item.id === iiif.canvas)
      : undefined;
    if (canvas === undefined || canvas.width !== map.width || canvas.height !== map.height) {
      return { ok: false, reason: 'size-mismatch' };
    }
  }
  const copiedValues = iiif.copiedValues ?? {};
  const compared: IiifComparedRow[] = compareIiifCopy(map, copiedValues, fresh.copiedValues, lang);
  const rows: IiifRecopyRow[] = compared.map((row) => {
    const iiifChanged = row.iiifChanged === true;
    let reason: IiifRecopyReason;
    if (row.humanEdited && iiifChanged) reason = 'both';
    else if (row.humanEdited) reason = 'human-edited';
    else if (iiifChanged) reason = 'iiif-changed';
    else reason = 'unchanged';
    return {
      key: row.key,
      lang: row.lang,
      reason,
      current: currentText(map[row.key], row.lang, lang),
      copied: copiedValues[row.key]?.[row.lang],
      next: fresh.copiedValues[row.key]?.[row.lang],
    };
  });
  return { ok: true, fresh, rows };
}

/**
 * 選んだ鍵・言語の行だけを、取り直した Manifest の値で上書きした新しい地図を返す。
 * 選ばなかった行の地図の値と copiedValues は変えない（手で直した値を黙って消さない）。
 * 1 行でも上書きしたら、copiedMetadata と copiedAt は新しい取得の値で作り直す。
 */
export function applyIiifRecopy(
  map: Record<string, unknown>,
  plan: IiifRecopyPlan,
  selected: ReadonlyArray<{ key: string; lang: string }>,
  options: IiifMetadataCopyOptions = {},
): Record<string, unknown> {
  if (!plan.ok) return map;
  const iiif = (map.iiif ?? {}) as IiifSectionPart;
  const lang = typeof map.lang === 'string' && map.lang !== '' ? map.lang : 'ja';

  // 選ばれた行のうち、新しい値がある行だけを上書きする
  //（IIIF の側で値が消えた行は選べない）。
  const chosen: Record<string, Record<string, string>> = {};
  for (const row of plan.rows) {
    if (row.next === undefined) continue;
    // ライセンスの注記は Core の表に無い鍵で、ライセンスの鍵に付いて動く。
    // 単独で選ばれても上書きしない（ライセンスを選んだときだけ、下で一緒に動かす）。
    if (!Object.prototype.hasOwnProperty.call(IIIF_BINDABLE_KEYS, row.key)) continue;
    if (!selected.some((item) => item.key === row.key && item.lang === row.lang)) continue;
    const table = chosen[row.key] ?? (chosen[row.key] = {});
    table[row.lang] = row.next;
  }
  const keys = Object.keys(chosen);
  if (keys.length === 0) return map;

  const next: Record<string, unknown> = { ...map };
  const copiedValues: Record<string, Record<string, string>> = {};
  for (const [key, table] of Object.entries(iiif.copiedValues ?? {})) {
    copiedValues[key] = { ...table };
  }
  for (const key of keys) {
    const table = chosen[key];
    next[key] = mergeText(next[key], table, lang);
    copiedValues[key] = { ...(copiedValues[key] ?? {}), ...table };
    // ライセンスの鍵は、注記の鍵（鍵の名前 + Note）も新しい値にそろえる（無ければ消す）。
    const noteKey = key + 'Note';
    if (copiedValues[noteKey] === undefined && plan.fresh.values[noteKey] === undefined) continue;
    const note = plan.fresh.values[noteKey];
    if (note === undefined) {
      delete next[noteKey];
      delete copiedValues[noteKey];
      continue;
    }
    next[noteKey] = note;
    const freshNote = plan.fresh.copiedValues[noteKey];
    if (freshNote === undefined) delete copiedValues[noteKey];
    else copiedValues[noteKey] = { ...freshNote };
  }

  next.iiif = {
    ...iiif,
    copiedValues,
    copiedMetadata: plan.fresh.copiedMetadata,
    copiedAt: (options.now ? options.now() : new Date()).toISOString(),
  };
  return next;
}
