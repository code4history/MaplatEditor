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
    path: '/mapedit', // map uid is passed as query param (?uid=xxx) (ADR-0007)
    name: 'MapEdit',
    component: () => import('../views/MapEdit.vue')
  },
  {
    path: '/applist',
    name: 'AppList',
    component: () => import('../views/AppList.vue')
  },
  {
    path: '/appedit',
    name: 'AppEdit',
    component: () => import('../views/AppEdit.vue')
  },
  {
    path: '/basemaps', // master-detail selection uses ?uid=<asset uid>&new=1; q/page are preserved
    name: 'BaseMapList',
    component: () => import('../views/BaseMapList.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue')
  },
  {
    path: '/poisources',
    name: 'PoiSourceList',
    component: () => import('../views/PoiSourceList.vue')
  },
  {
    path: '/assets', // image asset master-detail; ?uid/new selection and q/page are preserved
    name: 'AssetList',
    component: () => import('../views/AssetList.vue')
  },
  {
    path: '/poisources/:sourceId', // POI source uid (ADR-0007)
    name: 'PoiEdit',
    component: () => import('../views/PoiEdit.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
