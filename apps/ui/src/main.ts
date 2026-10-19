import { createApp } from 'vue'
import { createPinia } from 'pinia'
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

// The native Service / View menus ask the renderer to navigate.
getBridge()?.onNavigate((route) => void router.push(route))
