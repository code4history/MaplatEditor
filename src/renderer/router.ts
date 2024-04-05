import { createRouter, createWebHistory } from 'vue-router'
import Home from './components/pages/Home.vue'
import Edit from './components/pages/Edit.vue'
//import { pathToRegexp } from 'path-to-regexp'

const routes = [
  { path: '/', alias: '*', name: 'Home', component: Home },
  { path: '/edit', name: 'Edit', component: Edit },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router