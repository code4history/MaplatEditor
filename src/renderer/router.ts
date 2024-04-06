import { createRouter, createWebHashHistory } from 'vue-router'
import MapEdit from './components/pages/MapEdit.vue'
import MapList from './components/pages/MapList.vue'
import Settings from './components/pages/Settings.vue'

const routes = [
  { path: '/', name: 'MapList', component: MapList },
  { path: '/edit', name: 'MapEdit', component: MapEdit },
  { path: '/settings', name: 'Settings', component: Settings }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router