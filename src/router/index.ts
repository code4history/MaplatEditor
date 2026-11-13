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
    path: '/basemaps', // master-detail query contract: uid/new/q/bbox/page (bbox=west,south,east,north)
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
  routes,
  // 画面を移ったら新しい画面を先頭から表示する。スクロールは .main-content など
  // 画面の外にある要素でも行われるため、window の位置に加えて共有のスクロール要素も
  // ここで揃える（画面の中のスクロールは各画面が持つので触らない）。
  scrollBehavior: () => ({ left: 0, top: 0 })
})

router.afterEach((to, from, failure) => {
  // 取り消された・重複した遷移と、同じ画面の中の操作（クエリの変更など）では動かさない
  if (failure || to.path === from.path) return
  for (const el of [
    document.querySelector('.main-content'),
    document.body,
    document.documentElement,
  ]) {
    if (el) el.scrollTop = 0
  }
})

export default router
