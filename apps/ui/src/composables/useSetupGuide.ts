import { shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SetupGuide } from '@/setup/content'

/** Only setup views import the long localized instructions. */
export function useSetupGuide() {
  const { locale } = useI18n()
  const guide = shallowRef<SetupGuide | null>(null)
  let generation = 0
  watch(locale, async (language) => {
    const mine = ++generation
    const content = language === 'el' ? await import('@/setup/guide.el') : await import('@/setup/guide.en')
    if (mine === generation) guide.value = content.guide
  }, { immediate: true })
  return guide
}
