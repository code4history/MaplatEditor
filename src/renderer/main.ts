import { createApp } from 'vue'
import './styles/theme.css'
import App from './App.vue'
import router from './router'
import i18next from 'i18next'
import HttpApi from 'i18next-http-backend'
import I18NextVue from 'i18next-vue'

const lang = "ja"; //await window.settings.lang()
const i18n = i18next.use(HttpApi);
i18n.init({
  lng: lang,
  fallbackLng: 'en',
  backend: {
    loadPath: `locales/{{lng}}/{{ns}}.json`
  }
});

const app = createApp(App)
app.use(router)
app.use(I18NextVue, {i18next: i18n})
app.mount('#app')