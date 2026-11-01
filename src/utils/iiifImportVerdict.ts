// 取り込んだ info.json を「配れるか」の判定に組み立てる純粋な関数。
//
// 版・level・タイルの形・大きさの判定は Core の checkIiifDelivery に任せ、
// ここでは Editor の都合の 4 語（https でない・CORS が * でない・拒む宛先・
// Manifest でない）だけを足す。DOM にも Node にも依らないので、smoke が
// 別名つきで束ねて試せる。

// @ts-ignore
import type { IiifDeliveryReason } from '@maplat/core/src/iiif/delivery';
// @ts-ignore
import { checkIiifDelivery } from '@maplat/core/src/iiif/delivery';
import { isAllowedDeliveryUrl } from './ipClassify';

/** Core の理由に Editor の語を足したもの。 */
export type IiifImportReason =
  | IiifDeliveryReason
  | 'not-https'
  | 'cors-not-wildcard'
  | 'blocked-address'
  | 'not-manifest';

/** 配れると決まったときの情報。 */
export type IiifImportInfo = {
  version: '2' | '3';
  level: 0 | 1 | 2;
  tiling: string;
  width: number;
  height: number;
  serviceUrl: string;
  imageId: string;
};

/** 判定の結果。理由のときの message は i18n の鍵。 */
export type IiifImportVerdict =
  | { kind: 'deliverable'; info: IiifImportInfo }
  | { kind: 'metadata-only'; reason: IiifImportReason; message: string };

/** main から受け取る「応答の事実」。判定の材料だけを運ぶ。 */
export type IiifFetchFacts = {
  requestedUrl: string;
  finalUrl: string;
  accessControlAllowOrigin?: string;
  infoJson: unknown;
};

/** 取得そのものが失敗したときの事実（main の戻り値をそのまま渡せる）。 */
export type IiifFetchFailureInput = { reason: IiifImportReason };

export type IiifVerdictInput =
  | { facts: IiifFetchFacts; expected?: { width: number; height: number } }
  | { failure: IiifFetchFailureInput; expected?: { width: number; height: number } };

/** 理由を i18n の鍵にする（翻訳の実体はこの段では持たない）。 */
function messageOf(reason: IiifImportReason): string {
  return 'iiif_import.reason.' + reason;
}

function metadataOnly(reason: IiifImportReason): IiifImportVerdict {
  return { kind: 'metadata-only', reason, message: messageOf(reason) };
}

/** URL の scheme を読む。URL として読めなければ undefined。 */
function schemeOf(url: string): string | undefined {
  try {
    return new URL(url).protocol;
  } catch (_e) {
    return undefined;
  }
}

/** info.json の値（文字列なら JSON として読む）をオブジェクトにする。 */
function toInfoObject(info: unknown): Record<string, unknown> | undefined {
  if (typeof info === 'string') {
    try {
      const parsed = JSON.parse(info);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch (_e) {
      return undefined;
    }
  }
  if (info && typeof info === 'object') return info as Record<string, unknown>;
  return undefined;
}

/**
 * info.json の id（v3）／@id（v2）。scheme の判定と serviceUrl にだけ使う
 * （info.json の形の判定は Core が持つ）。
 */
function imageIdOf(info: unknown): string | undefined {
  const json = toInfoObject(info);
  if (!json) return undefined;
  const id = json.id ?? json['@id'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * 配れるかの判定を組み立てる。
 * 取得の失敗はその理由をそのまま返し、取れていれば Core の判定に Editor の
 * 4 語を足す。理由は「先に決まる方から」の優先順で 1 つだけ返す。
 */
export function verdictOf(input: IiifVerdictInput): IiifImportVerdict {
  if ('failure' in input) {
    return metadataOnly(input.failure.reason);
  }

  const { facts, expected } = input;
  const requestedScheme = schemeOf(facts.requestedUrl);
  const finalScheme = schemeOf(facts.finalUrl);
  if (requestedScheme === undefined || finalScheme === undefined) {
    return metadataOnly('bad-url');
  }
  if (requestedScheme !== 'https:' || finalScheme !== 'https:') {
    return metadataOnly('not-https');
  }

  const imageId = imageIdOf(facts.infoJson);
  if (imageId !== undefined && schemeOf(imageId) !== 'https:') {
    return metadataOnly('not-https');
  }

  const check = checkIiifDelivery(facts.infoJson, expected);
  if (!check.ok) {
    return metadataOnly(check.reason);
  }

  if (facts.accessControlAllowOrigin !== '*') {
    return metadataOnly('cors-not-wildcard');
  }

  const json = toInfoObject(facts.infoJson) ?? {};
  // id が無い info.json は、取ってきた URL から末尾の /info.json を外して画像サービスの URL にする
  const serviceUrl = imageId ?? facts.finalUrl.replace(/\/info\.json$/, '');
  // 配れると決まった URL も、文字列の検査に通す（IP のリテラルの私的・loopback な宛先は配らない）
  if (!isAllowedDeliveryUrl(serviceUrl)) {
    return metadataOnly('blocked-address');
  }
  return {
    kind: 'deliverable',
    info: {
      version: check.version,
      level: check.level,
      tiling: check.tiling,
      width: json.width as number,
      height: json.height as number,
      serviceUrl,
      imageId: serviceUrl,
    },
  };
}
