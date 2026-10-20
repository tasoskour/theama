import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { UiLanguage } from '@theama/contracts'

const PlayerPrefsSchema = z.object({
  defaultId: z.string().max(200).default(''),
  custom: z.array(z.object({ id: z.string().max(200), name: z.string().max(200), exe: z.string().max(32_000) })).max(20).default([]),
})

const BehaviourSchema = z.object({
  closeToTray: z.boolean().default(false),
  startWithWindows: z.boolean().default(false),
})

const PrefsSchema = z.object({
  behaviour: BehaviourSchema.default({ closeToTray: false, startWithWindows: false }),
  language: UiLanguage.default('en'),
  players: PlayerPrefsSchema.default({ defaultId: '', custom: [] }),
  /** Last size and place of the window; validated again against the screens when it is used. */
  window: z.unknown().optional(),
})
export type DesktopPrefs = z.infer<typeof PrefsSchema>

/** Tiny per-user file for what the main process needs before the API is reachable (menu language). */
export class PrefsStore {
  private readonly file: string
  private prefs: DesktopPrefs

  constructor(userDataDir: string, systemLocale: string) {
    this.file = join(userDataDir, 'desktop-prefs.json')
    const fallback: DesktopPrefs = { language: systemLocale.toLowerCase().startsWith('el') ? 'el' : 'en', players: { defaultId: '', custom: [] }, behaviour: { closeToTray: false, startWithWindows: false } }
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
    this.save()
  }

  /** Which media player to use, and the programs the person added. Only the main process writes this. */
  get players(): DesktopPrefs['players'] {
    return this.prefs.players
  }

  setPlayers(players: DesktopPrefs['players']): void {
    this.prefs = { ...this.prefs, players }
    this.save()
  }

  get behaviour(): DesktopPrefs['behaviour'] {
    return this.prefs.behaviour
  }

  setBehaviour(behaviour: DesktopPrefs['behaviour']): void {
    this.prefs = { ...this.prefs, behaviour }
    this.save()
  }

  get window(): unknown {
    return this.prefs.window
  }

  setWindow(state: unknown): void {
    this.prefs = { ...this.prefs, window: state }
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.prefs), 'utf8')
  }
}
