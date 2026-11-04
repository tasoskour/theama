import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { emptyProgress, readSetupProgress, withSkipped, writeSetupProgress, type SetupStorage } from '@/setup/progress'
import type { SetupItem } from '@/setup/content'

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
    // Running the wizard again must not turn a finished setup back into an unfinished one.
    if (progress.value.state !== 'completed') progress.value = { ...progress.value, state: 'in_progress' }
    autoStart.value = false
    persist()
  }
  /** Remembers that one item was skipped (or, with `false`, picked up again). Skipping never deletes saved configuration. */
  function setSkipped(item: SetupItem, skipped: boolean): void { progress.value = withSkipped(progress.value, item, skipped); persist() }
  function dismiss(): void { progress.value.state = 'dismissed'; persist() }
  function complete(): void { progress.value.state = 'completed'; persist() }
  return { progress, storageAvailable, autoStart, resumable, start, setSkipped, dismiss, complete }
})
