// 同梱の viewer（@maplat/ui 1.3 以降）の DOM を e2e から見るための入口。
//
// UI 1.3 から、viewer の画面は `<maplat-ui>`（Shadow DOM open）の中に描かれる。旧 UI の class 名
// （`.modalBase`・`.ol-copyright`・`.modal_map`・`.poi_html_host`・`cc-swiper` など）は無い。
// 部品は `part` 属性で選ぶ（`@maplat/ui` の docs/api/migration-ui-shadow-dom.ja.md の一覧）。
//
// Playwright の locator は open の Shadow DOM を越えて探すので、locator はそのまま書ける。
// `document.querySelector` は越えないので、evaluate の中では `maplat-ui` の shadowRoot から辿る。
import { expect, type Frame, type Locator, type Page } from '@playwright/test';

type Scope = Frame | Page;

/** viewer のホスト（旧 API の `MaplatUi.createObject` が `#map_div` の中に作る） */
export const VIEWER_HOST = 'maplat-ui';

/** viewer の部品を part 名で引く */
export function viewerPart(scope: Scope, part: string): Locator {
  return scope.locator(`${VIEWER_HOST} [part~="${part}"]`);
}

/**
 * 起動中の表示（スプラッシュ）が消えるまで待つ。旧 UI の `.modalBase` が隠れるのを待っていた所の置き換え。
 * 「要素が無いので隠れている」で素通りしないよう、ホストとスプラッシュの要素があることを先に確かめる。
 */
export async function waitViewerSplashHidden(scope: Scope, timeout = 30_000): Promise<void> {
  await expect(scope.locator(VIEWER_HOST)).toHaveCount(1, { timeout });
  const splash = viewerPart(scope, 'splash');
  await expect(splash).toHaveCount(1, { timeout });
  await splash.waitFor({ state: 'hidden', timeout });
}

/** 地図情報の窓を開き、窓の locator を返す（旧 UI の `.ol-copyright button` → `.modal_map`） */
export async function openViewerMapInfo(scope: Scope, timeout = 20_000): Promise<Locator> {
  await viewerPart(scope, 'info').locator('button').click({ timeout });
  const modal = viewerPart(scope, 'map-info-modal');
  await expect(modal).toBeVisible({ timeout });
  return modal;
}
