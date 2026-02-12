import { createApp } from 'vue'
import './style.css' // Keep default vite style for now, or remove if conflicting
import './assets/scss/main.scss' // Import Modern SCSS
import 'bootstrap' // Import Bootstrap JS
import App from './App.vue'
import router from './router'
import i18n from './i18n'

const app = createApp(App)
app.use(router)
i18n(app)
app.mount('#app')
.$nextTick(() => {
  // Use contextBridge
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log(message)
  })
})
