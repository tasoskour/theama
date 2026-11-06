import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { navState } from '@/utils/navState'

declare module 'vue-router' {
  interface RouteMeta {
    /** i18n key of the page title shown in the window title. */
    titleKey?: string
    /** Setup help must remain readable without a backend connection. */
    offline?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/setup', name: 'setup', component: () => import('@/views/SetupWizardView.vue'), meta: { titleKey: 'setup.title', offline: true } },
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { titleKey: 'nav.home' } },
  { path: '/movies', name: 'movies', component: () => import('@/views/MoviesView.vue'), meta: { titleKey: 'nav.movies' } },
  { path: '/series', name: 'series', component: () => import('@/views/SeriesView.vue'), meta: { titleKey: 'nav.series' } },
  { path: '/videos', name: 'videos', component: () => import('@/views/MyVideosView.vue'), meta: { titleKey: 'nav.videos' } },
  {
    path: '/title',
    name: 'title',
    component: () => import('@/views/TitleDetailView.vue'),
    meta: { titleKey: 'nav.home' },
  },
  { path: '/downloads', name: 'downloads', component: () => import('@/views/DownloadsView.vue'), meta: { titleKey: 'nav.downloads' } },
  { path: '/search', name: 'search', component: () => import('@/views/SearchView.vue'), meta: { titleKey: 'nav.search' } },
  {
    path: '/collection',
    name: 'collection',
    component: () => import('@/views/CollectionDetailView.vue'),
    meta: { titleKey: 'nav.collections' },
  },
  {
    path: '/collections',
    name: 'collections',
    component: () => import('@/views/CollectionsView.vue'),
    meta: { titleKey: 'nav.collections' },
  },
  {
    path: '/settings',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: { titleKey: 'nav.settings' },
    redirect: '/settings/general',
    children: [
      { path: 'setup', name: 'settings-setup', component: () => import('@/views/settings/SetupGuideView.vue'), meta: { titleKey: 'setup.guideTitle', offline: true } },
      { path: 'general', name: 'settings-general', component: () => import('@/views/settings/GeneralSettings.vue') },
      { path: 'library', name: 'settings-library', component: () => import('@/views/settings/LibrarySettings.vue') },
      {
        path: 'metadata',
        name: 'settings-metadata',
        component: () => import('@/views/settings/MetadataSettings.vue'),
      },
      {
        path: 'playback',
        name: 'settings-playback',
        component: () => import('@/views/settings/PlaybackSettings.vue'),
      },
      {
        path: 'downloads',
        name: 'settings-downloads',
        component: () => import('@/views/settings/DownloadsSettings.vue'),
      },
      { path: 'files', name: 'settings-files', component: () => import('@/views/settings/FilesSettings.vue') },
      {
        path: 'advanced',
        component: () => import('@/views/settings/AdvancedSettings.vue'),
        redirect: '/settings/advanced/service',
        children: [
          { path: 'service', name: 'settings-service', component: () => import('@/views/settings/ServiceSettings.vue') },
          { path: 'logs', name: 'settings-logs', component: () => import('@/views/settings/LogsSettings.vue') },
          { path: 'backup', name: 'settings-backup', component: () => import('@/views/settings/BackupSettings.vue') },
          { path: 'about', name: 'settings-about', component: () => import('@/views/settings/AboutSettings.vue') },
        ],
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  // Hash history keeps routing independent of the app:// protocol's path handling.
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, _from, saved) {
    // A saved position only exists for back/forward moves; browsing pages use this to restore their place.
    navState.arrivedByHistory = saved !== null
    // Downloads restores its own per-tab position after its cached pages render.
    if (to.name === 'downloads') return false
    return saved ?? { top: 0 }
  },
})
