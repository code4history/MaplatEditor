import { createApp } from 'vue'
import './assets/scss/main.scss' // Import Modern SCSS
import 'bootstrap' // Import Bootstrap JS
import 'bootstrap-icons/font/bootstrap-icons.css'
import App from './App.vue'
import router from './router'
import i18n, { initI18n } from './i18n'

// 設定言語でのi18next初期化を待ってからマウントする(初期描画から設定言語で表示)
await initI18n()

const app = createApp(App)
app.use(router)
i18n(app)
app.mount('#app')
.$nextTick(() => {
  window.appEvents.onMainProcessMessage((message) => {
    console.log(message)
  })
})
