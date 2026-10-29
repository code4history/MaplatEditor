// 取り込みのときの最初の書誌の写し。
//
// Manifest から地図の metadata の鍵へ値を写す規則は Core が持つ。ここは
// 「既定の selector を作る」「値を取り出す」「写した日時を添える」の薄い包みだけを置く。
// renderer（取り込みのダイアログ）から呼び、main では呼ばない。
//
// 値の洗浄は呼び出し側が渡せる（省略したら Core の sanitizeIiifHtml）。
// Node には window が無いので、smoke は偽の洗浄を渡して Core の結果と比べる。
// @ts-ignore
import { proposeIiifBindings, resolveIiifMetadata } from '@maplat/core/src/iiif/manifest';
// @ts-ignore
import type { IiifBindings, IiifMetadataEntry } from '@maplat/core/src/iiif/manifest';
import type { Localized } from '@maplat/core/common';
import { sanitizeIiifHtml } from '@maplat/core/common';

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
 * 選んだ canvas の書誌を、地図の metadata の鍵へ写す。
 * selector の規則も値の取り出し方も Core に任せ、ここでは何も読み替えない。
 */
export function copyIiifMetadata(
  manifest: unknown,
  canvasId: string,
  lang: string,
  options: IiifMetadataCopyOptions = {},
): IiifMetadataCopy {
  const sanitize = options.sanitize ?? sanitizeIiifHtml;
  const bindings = proposeIiifBindings(manifest, canvasId);
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
