import { createRouter, createWebHashHistory } from 'vue-router'
import MapEdit from './components/pages/MapEdit.vue'
import MapList from './components/pages/MapList.vue'

const routes = [
  { path: '/', name: 'MapList', component: MapList },
  { path: '/edit', name: 'MapEdit', component: MapEdit },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router