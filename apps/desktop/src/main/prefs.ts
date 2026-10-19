import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { UiLanguage } from '@theama/contracts'

const PrefsSchema = z.object({ language: UiLanguage.default('en') })
export type DesktopPrefs = z.infer<typeof PrefsSchema>

/** Tiny per-user file for what the main process needs before the API is reachable (menu language). */
export class PrefsStore {
  private readonly file: string
  private prefs: DesktopPrefs

  constructor(userDataDir: string, systemLocale: string) {
    this.file = join(userDataDir, 'desktop-prefs.json')
    const fallback: DesktopPrefs = { language: systemLocale.toLowerCase().startsWith('el') ? 'el' : 'en' }
    try {
      this.prefs = PrefsSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      this.prefs = fallback
    }
  }

  get language(): UiLanguage {
    return this.prefs.language
  }

  setLanguage(language: UiLanguage): void {
    if (language === this.prefs.language) return
    this.prefs = { ...this.prefs, language }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.prefs), 'utf8')
  }
}
