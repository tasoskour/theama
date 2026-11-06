import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@theama/contracts'
import { clampProgress, downloadProgressFor, fillPercent } from './posterProgress'

const item = (over: Partial<DownloadItem> = {}): DownloadItem => ({
  hash: 'a'.repeat(40),
  name: 'Movie.2020.1080p',
  state: 'downloading',
  progress: 0.5,
  downloadSpeed: 0,
  size: 100,
  eta: null,
  kind: 'movie',
  tmdbId: '603',
  own: true,
  addedAt: null,
  ...over,
})

describe('downloadProgressFor', () => {
  it('returns the progress of the matching unfinished download', () => {
    expect(downloadProgressFor([item({ progress: 0.42 })], '603')).toBe(0.42)
  })
  it('is null when nothing links to the title', () => {
    expect(downloadProgressFor([item()], '1')).toBeNull()
    expect(downloadProgressFor([item({ tmdbId: null })], '603')).toBeNull()
    expect(downloadProgressFor([item()], null)).toBeNull()
    expect(downloadProgressFor(undefined, '603')).toBeNull()
  })
  it('is null once the download is complete', () => {
    expect(downloadProgressFor([item({ progress: 1, state: 'completed' })], '603')).toBeNull()
    expect(downloadProgressFor([item({ progress: 1 })], '603')).toBeNull()
  })
  it('ignores failed downloads', () => {
    expect(downloadProgressFor([item({ state: 'error' })], '603')).toBeNull()
  })
  it('uses the furthest along when several match', () => {
    expect(downloadProgressFor([item({ progress: 0.2 }), item({ progress: 0.7 })], '603')).toBe(0.7)
  })
})

describe('fill helpers', () => {
  it('clamps', () => {
    expect(clampProgress(-1)).toBe(0)
    expect(clampProgress(2)).toBe(1)
    expect(clampProgress(Number.NaN)).toBe(0)
  })
  it('formats whole percentages', () => {
    expect(fillPercent(0.5)).toBe('50%')
    expect(fillPercent(0.999)).toBe('99%')
  })
})
