import { describe, expect, it } from 'vitest'
import { AppSettings, AppSettingsPatch, DEFAULT_SETTINGS, LogQuery, ReleaseQuery, SCENE_IDS, ServerEvent, SetDownloadClientRequest, SetIndexerRequest } from './index'

describe('settings contract', () => {
  it('fills defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({ language: 'en', theme: 'system', textSize: 'default', visualMode: 'standard', graphicsQuality: 'medium', backdropScene: 'classic', backdropByGenre: true, backdropByKind: true, logRetentionDays: 14, logDetail: 'info', metadataLanguage: 'en', subtitleLanguages: ['el', 'en'], autoPlayNext: true, nextEpisodeCountdownSeconds: 5, renameMovieTemplate: '{title} ({year})', renameEpisodeTemplate: '{title} - {episodeCode} - {episodeTitle}', downloadMovieSourceId: null, downloadSeriesSourceId: null, downloadsShowAll: false })
  })
  it('rejects unknown language', () => {
    expect(AppSettings.safeParse({ language: 'fr' }).success).toBe(false)
  })
  it('patch is partial', () => {
    expect(AppSettingsPatch.parse({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })
  it('defaults old settings to the responsive baseline and validates text size presets', () => {
    expect(AppSettings.parse({ theme: 'light' }).textSize).toBe('default')
    expect(AppSettingsPatch.parse({})).not.toHaveProperty('textSize')
    for (const textSize of ['small', 'default', 'large', 'extra-large']) {
      expect(AppSettingsPatch.parse({ textSize })).toEqual({ textSize })
    }
    for (const textSize of ['huge', 130, null]) {
      expect(AppSettingsPatch.safeParse({ textSize }).success).toBe(false)
    }
  })
  it('accepts the visual mode and graphics quality, and nothing else', () => {
    expect(AppSettingsPatch.parse({ visualMode: 'immersive', graphicsQuality: 'high' })).toEqual({ visualMode: 'immersive', graphicsQuality: 'high' })
    expect(AppSettingsPatch.safeParse({ visualMode: '3d' }).success).toBe(false)
    expect(AppSettingsPatch.safeParse({ graphicsQuality: 'ultra' }).success).toBe(false)
  })
})

describe('backdrop scene settings', () => {
  it('keeps the original scene as the default', () => {
    expect(DEFAULT_SETTINGS.backdropScene).toBe('classic')
    expect(SCENE_IDS[0]).toBe('classic')
  })
  it('accepts auto and every scene, and nothing else', () => {
    for (const id of ['auto', ...SCENE_IDS]) expect(AppSettingsPatch.parse({ backdropScene: id })).toEqual({ backdropScene: id })
    expect(AppSettingsPatch.safeParse({ backdropScene: 'cartoon' }).success).toBe(false)
  })
  it('has unique scene ids', () => {
    expect(new Set(SCENE_IDS).size).toBe(SCENE_IDS.length)
  })
  it('takes the two follow toggles as booleans', () => {
    expect(AppSettingsPatch.parse({ backdropByGenre: false, backdropByKind: false })).toEqual({ backdropByGenre: false, backdropByKind: false })
    expect(AppSettingsPatch.safeParse({ backdropByGenre: 'no' }).success).toBe(false)
  })
  it('takes a library folder id (or null) for downloads', () => {
    expect(AppSettingsPatch.parse({ downloadMovieSourceId: 3, downloadSeriesSourceId: null })).toEqual({ downloadMovieSourceId: 3, downloadSeriesSourceId: null })
    expect(AppSettingsPatch.safeParse({ downloadMovieSourceId: 0 }).success).toBe(false)
  })
})

describe('download contracts', () => {
  it('only accepts http(s) addresses for the clients', () => {
    const ok = { qbittorrent: { url: 'http://localhost:8080', username: 'admin', password: 'x' } }
    expect(SetDownloadClientRequest.safeParse(ok).success).toBe(true)
    expect(SetDownloadClientRequest.safeParse({ qbittorrent: null }).success).toBe(true)
    expect(SetDownloadClientRequest.safeParse({ qbittorrent: { ...ok.qbittorrent, url: 'ftp://host' } }).success).toBe(false)
    expect(SetDownloadClientRequest.safeParse({ qbittorrent: { ...ok.qbittorrent, url: 'javascript:alert(1)' } }).success).toBe(false)
    expect(SetIndexerRequest.safeParse({ prowlarr: { url: 'http://localhost:9696', apiKey: 'short' } }).success).toBe(false)
  })
  it('reads a release query from a query string', () => {
    expect(ReleaseQuery.parse({ kind: 'series', title: ' Severance ', season: '1', episode: '2' })).toEqual({ kind: 'series', title: 'Severance', season: 1, episode: 2 })
    expect(ReleaseQuery.safeParse({ kind: 'video', title: 'x' }).success).toBe(false)
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
