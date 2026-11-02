import { describe, expect, it } from 'vitest'
import { LibrarySource, MetadataStatus, PlayerInfo } from '@theama/contracts'
import { clientStatus, libraryStatus, metadataStatus, playerStatus, withSkip } from './status'

describe('setup readiness is based on evidence', () => {
  it('distinguishes saved, working, failed and unknown download connections', () => {
    expect(clientStatus(undefined)).toBe('unavailable')
    expect(clientStatus('not_configured')).toBe('not_configured')
    expect(clientStatus('connected')).toBe('configured')
    for (const state of ['unreachable', 'auth_failed', 'forbidden'] as const) expect(clientStatus(state)).toBe('attention')
  })
  it('never reports cached metadata as working while disconnected', () => {
    const metadata = MetadataStatus.parse({ provider: 'tmdb', configured: true, state: 'idle', pending: 0, matched: 1, ambiguous: 0, unmatched: 0, current: null, message: null })
    expect(metadataStatus(metadata, true)).toBe('configured')
    expect(metadataStatus(metadata, false)).toBe('unavailable')
    expect(metadataStatus({ ...metadata, state: 'invalid_key' }, true)).toBe('attention')
    expect(metadataStatus({ ...metadata, state: 'unavailable' }, true)).toBe('attention')
    expect(metadataStatus({ ...metadata, configured: false, state: 'no_key' }, true)).toBe('not_configured')
  })
  it('flags offline or unknown media sources', () => {
    const source = LibrarySource.parse({ id: 1, path: 'D:\\Movies', libraryType: 'movies', recursive: true, enabled: true, volumeId: null, lastSeenOnlineAt: null, availability: 'online', createdAt: '2026-11-02T00:00:00Z' })
    expect(libraryStatus([source], true, true)).toBe('configured')
    expect(libraryStatus([{ ...source, availability: 'offline' }], true, true)).toBe('attention')
    expect(libraryStatus([{ ...source, availability: 'unknown' }], true, true)).toBe('unavailable')
    expect(libraryStatus([], true, true)).toBe('not_configured')
    expect(libraryStatus([source], true, false)).toBe('unavailable')
  })
  it('does not treat the unprobed Windows association as verified playback', () => {
    const player = PlayerInfo.parse({ id: 'vlc', name: 'VLC', kind: 'vlc', available: true, exe: 'C:\\vlc.exe', isDefault: true, removable: false, externalSubtitle: true, tracksPosition: true })
    expect(playerStatus(player, true)).toBe('configured')
    expect(playerStatus({ ...player, kind: 'system' }, true)).toBe('unavailable')
    expect(playerStatus({ ...player, available: false }, true)).toBe('attention')
    expect(playerStatus(null, true)).toBe('not_configured')
  })
  it('a skip never hides an error, verified feature or unavailable state', () => {
    expect(withSkip('not_configured', true)).toBe('skipped')
    for (const state of ['configured', 'attention', 'unavailable'] as const) expect(withSkip(state, true)).toBe(state)
  })
})
