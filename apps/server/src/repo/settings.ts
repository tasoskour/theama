import { AppSettings, type AppSettingsPatch } from '@theama/contracts'
import type { Db } from '../db/client'
import { applicationSetting } from '../db/schema'

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  /** Reads all stored rows and fills anything missing or invalid with defaults. */
  get(): AppSettings {
    const rows = this.db.select().from(applicationSetting).all()
    const stored: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value)
      } catch {
        // A corrupt value falls back to its default below.
      }
    }
    const parsed = AppSettings.safeParse(stored)
    if (parsed.success) return parsed.data
    // Drop only the invalid keys so one bad value cannot reset everything.
    const valid: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(stored)) {
      if (AppSettings.safeParse({ [k]: v }).success) valid[k] = v
    }
    return AppSettings.parse(valid)
  }

  update(patch: AppSettingsPatch): AppSettings {
    const now = new Date().toISOString()
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        tx.insert(applicationSetting)
          .values({ key, value: JSON.stringify(value), updatedAt: now })
          .onConflictDoUpdate({ target: applicationSetting.key, set: { value: JSON.stringify(value), updatedAt: now } })
          .run()
      }
    })
    return this.get()
  }
}
