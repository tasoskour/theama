import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useTitleActionsStore = defineStore('titleActions', () => {
  const message = ref<string | null>(null)
  const color = ref<'surface-bright' | 'error'>('surface-bright')

  function notify(text: string, failed = false): void {
    message.value = text
    color.value = failed ? 'error' : 'surface-bright'
  }

  function clear(): void {
    message.value = null
  }

  return { message, color, notify, clear }
})
