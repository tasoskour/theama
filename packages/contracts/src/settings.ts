import { z } from 'zod'

export const UiLanguage = z.enum(['en', 'el'])
export type UiLanguage = z.infer<typeof UiLanguage>

export const ThemePreference = z.enum(['system', 'dark', 'light'])
export type ThemePreference = z.infer<typeof ThemePreference>

/** Days of rotated NDJSON log files kept on disk. */
const LogRetentionDays = z.number().int().min(1).max(365)

export const AppSettings = z.object({
  language: UiLanguage.default('en'),
  theme: ThemePreference.default('system'),
  logRetentionDays: LogRetentionDays.default(14),
})
export type AppSettings = z.infer<typeof AppSettings>

/** Defaults are deliberately absent here: a patch only carries what the caller sets. */
export const AppSettingsPatch = z.object({
  language: UiLanguage.optional(),
  theme: ThemePreference.optional(),
  logRetentionDays: LogRetentionDays.optional(),
})
export type AppSettingsPatch = z.infer<typeof AppSettingsPatch>

export const DEFAULT_SETTINGS: AppSettings = AppSettings.parse({})
