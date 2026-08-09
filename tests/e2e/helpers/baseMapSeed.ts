// ベースマップマスタを IPC で1件 seed する E2E 共通ハーネス。
//
// m6-t9 / m6-t10-app-source-diff-model / m6-t10-human-check の3スペックが**同一実装**を
// それぞれ持っていたところへ、m6-t6 が4本目を必要としたため、複製せずここへ移した
// （恒久指示「同一扱い処理は共通実装へ徹底」。mapPackage.ts と同じ理由）。
//
// m6-t10（ADR-0018）の差分保持モデル以降、アプリソースは kind / url / maptype を持たず、
// これらはすべてベースマップマスタ側の所有になった。∴ ソースの種別に依存する検証
// （provider キーの要否・GL CDN の要否・merc タイルの配信）は、**マスタを実際に登録した
// 状態でしか成立しない**。マスタ無しのソースは resolveAppSource が master-missing として
// 先に除外してしまい、後段の判定へ到達しない（AppPreviewService.ts / AppExportService.ts）。
import { expect, type Page } from '@playwright/test';

/**
 * ユーザーベースマップを1件作成し、その uid を返す。
 * `tms` はマスタの data_json に入る内容そのもの（kind / maptype / url / style など）。
 */
export async function seedBaseMap(
  page: Page,
  slug: string,
  tms: Record<string, unknown>,
): Promise<string> {
  const result = await page.evaluate(
    async ({ slug: s, tms: t }) => await (window as any).baseMaps.saveUser({
      slug: s, create: true, uid: crypto.randomUUID(), tms: t,
    }),
    { slug, tms },
  );
  expect(result?.result, `seedBaseMap(${slug}) failed: ${JSON.stringify(result)}`).toBe('Success');
  return result.uid as string;
}

/**
 * マスタ文書の共通土台。lang: 'ja' は AppEdit の既定言語（AppEdit.vue currentLang = 'ja'）と
 * 揃え、langText('attr') 等の言語キー参照ミスマッチを避けるため。
 */
export const baseMapMasterDoc = (extra: Record<string, unknown>): Record<string, unknown> => ({
  lang: 'ja',
  title: { ja: 'T' },
  label: { ja: 'T' },
  attr: { ja: '© Test' },
  dataAttr: {},
  license: '',
  dataLicense: '',
  licenseNote: {},
  dataLicenseNote: {},
  minZoom: null,
  maxZoom: null,
  thumbnail: '',
  coverageLngLats: null,
  ...extra,
});
