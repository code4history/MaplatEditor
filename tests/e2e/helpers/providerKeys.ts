import type { Page } from '@playwright/test';

// m6-t6 (§3.4/§3.6): google/mapbox の種別選択はエディタ用キー未設定時に disabled になる。
// 既存の m6-t1/m6-t4/m6-t4b/m6-t5 系 E2E は種別ボタンを直接クリックする前提で書かれているため、
// これらのセットアップでダミーのエディタ用キーを事前投入し、ゲート追加前の挙動を維持する。
// 実キーではないため実際の地図タイル取得はできない（それらの検証は本タスクの
// human_verification H-4 / m6-t4 の V-1 に委ねる）。
export async function seedE2EProviderKeys(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.settings.set('editorGoogleApiKey', 'e2e-dummy-google-key');
    await window.settings.set('editorMapboxToken', 'e2e-dummy-mapbox-token');
  });
}
