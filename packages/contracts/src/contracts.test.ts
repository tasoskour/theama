import { describe, expect, it } from 'vitest'
import { AppSettings, AppSettingsPatch, DEFAULT_SETTINGS, LogQuery, ServerEvent } from './index'

describe('settings contract', () => {
  it('fills defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({ language: 'en', theme: 'system', logRetentionDays: 14, metadataLanguage: 'en' })
  })
  it('rejects unknown language', () => {
    expect(AppSettings.safeParse({ language: 'fr' }).success).toBe(false)
  })
  it('patch is partial', () => {
    expect(AppSettingsPatch.parse({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })
})

describe('log query', () => {
  it('coerces query-string limit', () => {
    expect(LogQuery.parse({ limit: '25' }).limit).toBe(25)
  })
  it('caps limit', () => {
    expect(LogQuery.safeParse({ limit: 5000 }).success).toBe(false)
  })
})

describe('server events', () => {
  it('parses a heartbeat', () => {
    const r = ServerEvent.safeParse({ type: 'heartbeat', time: new Date().toISOString() })
    expect(r.success).toBe(true)
  })
})
