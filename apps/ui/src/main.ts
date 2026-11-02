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
import { useConnectionStore } from './stores/connection'
import { useSetupStore } from './stores/setup'

const app = createApp(App)
app.use(createPinia()).use(router).use(i18n).use(vuetify)
// Capture first-use state before mounting creates stores that cache default preferences.
const setup = useSetupStore()
void router.isReady().then(async () => {
  if (setup.autoStart && router.currentRoute.value.path === '/') {
    setup.start()
    await router.replace('/setup')
  }
})
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
// Browsers raise this when an observer callback changes layout within the same frame; nothing is lost, so it is not an error.
const BENIGN_ERRORS = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/
window.addEventListener('error', (e) => {
  if (BENIGN_ERRORS.test(e.message)) {
    e.stopImmediatePropagation()
    return
  }
  reportError('error', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason))
