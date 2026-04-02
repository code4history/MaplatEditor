import { createRouter, createWebHashHistory } from 'vue-router'
import MapList from '../views/MapList.vue'

const routes = [
  {
    path: '/',
    redirect: '/maplist'
  },
  {
    path: '/maplist',
    name: 'MapList',
    component: MapList
  },
  {
    path: '/mapedit', // mapid is passed as query param (?mapid=xxx)
    name: 'MapEdit',
    component: () => import('../views/MapEdit.vue')
  },
  {
    path: '/applist',
    name: 'AppList',
    component: () => import('../views/AppList.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
