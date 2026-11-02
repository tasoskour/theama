import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { advanceProgress, emptyProgress, previousStep, readSetupProgress, writeSetupProgress, type SetupStorage } from '@/setup/progress'
import type { WizardStep } from '@/setup/content'

export const useSetupStore = defineStore('setup', () => {
  // Accessing localStorage itself can throw in a restricted browser profile.
  let storage: SetupStorage
  try { storage = localStorage } catch { storage = { getItem() { throw new Error('Storage unavailable') }, setItem() { throw new Error('Storage unavailable') } } }
  const initial = readSetupProgress(storage)
  const progress = ref(initial.progress)
  const storageAvailable = ref(initial.storageAvailable)
  const autoStart = ref(initial.autoStart)
  const resumable = computed(() => progress.value.state === 'in_progress' || progress.value.state === 'dismissed')
  function persist(): void { storageAvailable.value = writeSetupProgress(storage, progress.value) }
  function start(reset = false): void {
    if (reset) progress.value = emptyProgress()
    progress.value = { ...progress.value, state: 'in_progress' }
    autoStart.value = false
    persist()
  }
  function advance(skip = false): void { progress.value = advanceProgress(progress.value, skip); persist() }
  function back(): void { progress.value.step = previousStep(progress.value.step); persist() }
  function jump(step: WizardStep): void { progress.value.step = step; persist() }
  function chooseLanguage(language: 'en' | 'el'): void { progress.value.language = language; persist() }
  function dismiss(): void { progress.value.state = 'dismissed'; persist() }
  function complete(): void { progress.value.state = 'completed'; persist() }
  return { progress, storageAvailable, autoStart, resumable, start, advance, back, jump, chooseLanguage, dismiss, complete }
})
