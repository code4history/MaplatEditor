import type { Page } from '@playwright/test';

// google/mapbox の種別選択はエディタ用キー未設定時に disabled になる。
// 既存の Google・Mapbox・MapLibre の種別の E2E は種別ボタンを直接クリックする前提で書かれているため、
// これらのセットアップでダミーのエディタ用キーを事前投入し、ゲート追加前の挙動を維持する。
// 実キーではないため実際の地図タイル取得はできない（それらの検証は本タスクの
// 人間による確認に委ねる）。
export async function seedE2EProviderKeys(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.settings.set('editorGoogleApiKey', 'e2e-dummy-google-key');
    await window.settings.set('editorMapboxToken', 'e2e-dummy-mapbox-token');
  });
}
