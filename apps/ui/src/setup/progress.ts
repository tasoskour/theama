import { z } from 'zod'
import { WIZARD_STEPS, type WizardStep } from './content'

export const SETUP_PROGRESS_KEY = 'theama.setup.v1'
// Temporarily disable first-launch setup; manual setup stays available in Settings.
const AUTO_START_SETUP = false
const ProgressSchema = z.object({
  version: z.literal(1),
  state: z.enum(['new', 'in_progress', 'dismissed', 'completed']),
  step: z.enum(WIZARD_STEPS),
  skipped: z.array(z.enum(WIZARD_STEPS)),
  language: z.enum(['en', 'el']).optional(),
})
export type SetupProgress = z.infer<typeof ProgressSchema>
export type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>
export const emptyProgress = (): SetupProgress => ({ version: 1, state: 'new', step: 'welcome', skipped: [] })

/** Inspect before the settings store writes its first cached preferences. */
export function readSetupProgress(storage: SetupStorage): { progress: SetupProgress; autoStart: boolean; storageAvailable: boolean } {
  try {
    const raw = storage.getItem(SETUP_PROGRESS_KEY)
    const existingProfile = storage.getItem('theama.prefs') !== null
    if (raw !== null) {
      let value: unknown
      try { value = JSON.parse(raw) } catch { value = undefined }
      const parsed = ProgressSchema.safeParse(value)
      // An invalid record is still evidence of a previous visit: never trap it in first-use routing.
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

export function advanceProgress(progress: SetupProgress, skip: boolean): SetupProgress {
  const index = WIZARD_STEPS.indexOf(progress.step)
  const skipped = progress.skipped.filter((s) => s !== progress.step)
  if (skip && progress.step !== 'welcome' && progress.step !== 'review') skipped.push(progress.step)
  return { ...progress, state: 'in_progress', step: WIZARD_STEPS[Math.min(index + 1, WIZARD_STEPS.length - 1)]!, skipped }
}

export function previousStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.max(0, WIZARD_STEPS.indexOf(step) - 1)]!
}
