import i18next from 'i18next'
import I18NextVue from 'i18next-vue'
import Backend from 'i18next-http-backend'

// Initialize i18next
i18next
  .use(Backend)
  .init({
    lng: 'ja', // Default to Japanese for now, will implement settings sync later
    fallbackLng: 'en',
    debug: true,
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json'
    }
  })

export default function (app: any) {
  app.use(I18NextVue, { i18next })
}
