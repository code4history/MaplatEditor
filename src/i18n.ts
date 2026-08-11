import i18next from 'i18next'
import I18NextVue from 'i18next-vue'
import Backend from 'i18next-http-backend'

// エディタUI言語は設定に従う(未設定の初回起動時はSettingsService側でOSの言語から解決される)。
// マウント前にawaitすることで、初期描画から設定言語で表示される
export async function initI18n(): Promise<void> {
  let lang = 'en';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stored = await (window as any).settings?.get('lang');
    if (stored) lang = stored;
  } catch (e) {
    console.error('Failed to load language setting, falling back to en:', e);
  }
  await i18next
    .use(Backend)
    .init({
      lng: lang,
      fallbackLng: 'en',
      debug: true,
      // 補間値の HTML エスケープを無効化する (Vue 環境の標準設定)。
      // Vue テンプレートは自動エスケープするため二重エスケープになるうえ、
      // t() の結果をネイティブダイアログ (showMessageBox) に渡す箇所では
      // エンティティが生表示される (2026-07-12 実機バグ: export 完了ダイアログの
      // パスが &#x2F; 化)。t() を v-html に渡すことは禁止 (現状使用ゼロ)
      interpolation: { escapeValue: false },
      backend: {
        loadPath: './locales/{{lng}}/{{ns}}.json'
      }
    })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function (app: any) {
  app.use(I18NextVue, { i18next })
}
