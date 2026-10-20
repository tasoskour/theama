import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { z } from 'zod'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-serif-display'
import '@/styles/global.css'
import App from './App.vue'
import { i18n, setLanguage } from './i18n'
import { router } from './router'
import { vuetify } from './theme/vuetify'
import { getBridge } from './api/bridge'
import { useConnectionStore } from './stores/connection'

const app = createApp(App)
app.use(createPinia()).use(router).use(i18n).use(vuetify)
setLanguage(i18n.global.locale.value)
app.mount('#app')

useConnectionStore().start()

/**
 * Errors the interface catches are sent to the service, so they appear in the log history beside everything
 * else (and in the diagnostics report). Local only; if the service cannot be reached the error is just dropped.
 */
function reportError(kind: 'error' | 'unhandledrejection' | 'vue', error: unknown): void {
  const client = useConnectionStore().client
  if (!client) return
  const e = error instanceof Error ? error : new Error(String(error))
  void client
    .post('/diagnostics/client-error', { kind, message: e.message.slice(0, 500), stack: e.stack?.slice(0, 4000), where: router.currentRoute.value.path.slice(0, 200) }, z.object({ accepted: z.boolean() }))
    .catch(() => undefined)
}
app.config.errorHandler = (err) => {
  console.error(err)
  reportError('vue', err)
}
window.addEventListener('error', (e) => reportError('error', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason))

// The native Service / View menus ask the renderer to navigate.
getBridge()?.onNavigate((route) => void router.push(route))
