import { z } from 'zod'
import { SETUP_ITEMS, type SetupItem } from './content'

export const SETUP_PROGRESS_KEY = 'theama.setup.v1'
/** Opens the setup page once on a fresh profile. Existing profiles and anyone who has seen it are never redirected. */
const AUTO_START_SETUP = true
const ProgressSchema = z.object({
  version: z.literal(2),
  state: z.enum(['new', 'in_progress', 'dismissed', 'completed']),
  skipped: z.array(z.enum(SETUP_ITEMS)),
})
export type SetupProgress = z.infer<typeof ProgressSchema>
export type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>
export const emptyProgress = (): SetupProgress => ({ version: 2, state: 'new', skipped: [] })

/** Inspect before the settings store writes its first cached preferences. */
export function readSetupProgress(storage: SetupStorage): { progress: SetupProgress; autoStart: boolean; storageAvailable: boolean } {
  try {
    const raw = storage.getItem(SETUP_PROGRESS_KEY)
    const existingProfile = storage.getItem('theama.prefs') !== null
    if (raw !== null) {
      let value: unknown
      try { value = JSON.parse(raw) } catch { value = undefined }
      const parsed = ProgressSchema.safeParse(value)
      // An old or invalid record is still evidence of a previous visit: never trap it in first-use routing.
      return { progress: parsed.success ? parsed.data : emptyProgress(), autoStart: false, storageAvailable: true }
    }
    return { progress: emptyProgress(), autoStart: AUTO_START_SETUP && !existingProfile, storageAvailable: true }
  } catch {
    return { progress: emptyProgress(), autoStart: false, storageAvailable: false }
  }
}

export function writeSetupProgress(storage: SetupStorage, progress: SetupProgress): boolean {
  try { storage.setItem(SETUP_PROGRESS_KEY, JSON.stringify(ProgressSchema.parse(progress))); return true } catch { return false }
}

export function withSkipped(progress: SetupProgress, item: SetupItem, skipped: boolean): SetupProgress {
  const rest = progress.skipped.filter((s) => s !== item)
  return { ...progress, state: 'in_progress', skipped: skipped ? [...rest, item] : rest }
}
