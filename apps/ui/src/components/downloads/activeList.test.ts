import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@theama/contracts'
import { bucket, counts, filterAndSort, totalSpeed, type ListOptions } from './activeList'

const item = (over: Partial<DownloadItem> & { hash: string; name: string }): DownloadItem => ({
  state: 'downloading',
  progress: 0.5,
  downloadSpeed: 0,
  size: 1000,
  eta: null,
  kind: 'movie',
  own: true,
  addedAt: null,
  ...over,
})

const dune = item({ hash: 'a', name: 'Dune.2021.1080p', progress: 0.9, size: 5000, downloadSpeed: 300, addedAt: '2026-01-02T00:00:00Z' })
const amelie = item({ hash: 'b', name: 'Amélie.2001.720p', state: 'paused', progress: 0.2, size: 2000, addedAt: '2026-01-03T00:00:00Z' })
const sever = item({ hash: 'c', name: 'Severance.S01', state: 'completed', progress: 1, size: 9000, kind: 'series', addedAt: '2026-01-01T00:00:00Z' })
const broken = item({ hash: 'd', name: 'Broken.Thing', state: 'error', progress: 0.1, size: 100 })
const all = [dune, amelie, sever, broken]

const opts = (o: Partial<ListOptions> = {}): ListOptions => ({ search: '', filter: 'all', sort: 'added', descending: true, ...o })
const names = (list: DownloadItem[]) => list.map((i) => i.name)

describe('bucket', () => {
  it('groups the states a person cares about', () => {
    expect(bucket('downloading')).toBe('downloading')
    expect(['metadata', 'stalled', 'queued', 'checking'].map((s) => bucket(s as never))).toEqual(['downloading', 'downloading', 'downloading', 'downloading'])
    expect(bucket('paused')).toBe('paused')
    expect(bucket('completed')).toBe('finished')
    expect(bucket('error')).toBe('problems')
  })
})

describe('filterAndSort', () => {
  it('filters by status', () => {
    expect(names(filterAndSort(all, opts({ filter: 'paused' })))).toEqual(['Amélie.2001.720p'])
    expect(names(filterAndSort(all, opts({ filter: 'problems' })))).toEqual(['Broken.Thing'])
    expect(filterAndSort(all, opts({ filter: 'all' }))).toHaveLength(4)
  })

  it('searches ignoring case and accents', () => {
    expect(names(filterAndSort(all, opts({ search: 'AMELIE' })))).toEqual(['Amélie.2001.720p'])
    expect(names(filterAndSort(all, opts({ search: '  sever ' })))).toEqual(['Severance.S01'])
    expect(filterAndSort(all, opts({ search: 'nothing like it' }))).toEqual([])
  })

  it('combines the search with the status filter', () => {
    expect(filterAndSort(all, opts({ search: 'dune', filter: 'paused' }))).toEqual([])
  })

  it('sorts by every key in both directions', () => {
    expect(names(filterAndSort(all, opts({ sort: 'added' })))).toEqual(['Amélie.2001.720p', 'Dune.2021.1080p', 'Severance.S01', 'Broken.Thing'])
    expect(names(filterAndSort(all, opts({ sort: 'added', descending: false })))).toEqual(['Broken.Thing', 'Severance.S01', 'Dune.2021.1080p', 'Amélie.2001.720p'])
    expect(names(filterAndSort(all, opts({ sort: 'name', descending: false })))).toEqual(['Amélie.2001.720p', 'Broken.Thing', 'Dune.2021.1080p', 'Severance.S01'])
    expect(names(filterAndSort(all, opts({ sort: 'progress' })))).toEqual(['Severance.S01', 'Dune.2021.1080p', 'Amélie.2001.720p', 'Broken.Thing'])
    expect(names(filterAndSort(all, opts({ sort: 'size' })))[0]).toBe('Severance.S01')
    expect(names(filterAndSort(all, opts({ sort: 'speed' })))[0]).toBe('Dune.2021.1080p')
  })

  it('sorts names with numbers the way people read them', () => {
    const list = [item({ hash: '1', name: 'Show.S10' }), item({ hash: '2', name: 'Show.S2' })]
    expect(names(filterAndSort(list, opts({ sort: 'name', descending: false })))).toEqual(['Show.S2', 'Show.S10'])
  })

  it('keeps ties in a stable order and does not change the input', () => {
    const a = item({ hash: 'x', name: 'Same' })
    const b = item({ hash: 'y', name: 'Same' })
    const input = [b, a]
    expect(filterAndSort(input, opts({ sort: 'progress' })).map((i) => i.hash)).toEqual(['x', 'y'])
    expect(input.map((i) => i.hash)).toEqual(['y', 'x'])
  })
})

describe('counts and speed', () => {
  it('counts each group', () => {
    expect(counts(all)).toEqual({ all: 4, downloading: 1, paused: 1, finished: 1, problems: 1 })
    expect(counts([])).toEqual({ all: 0, downloading: 0, paused: 0, finished: 0, problems: 0 })
  })

  it('adds up the speed of what is downloading', () => {
    expect(totalSpeed(all)).toBe(300)
    expect(totalSpeed([item({ hash: 'p', name: 'p', state: 'paused', downloadSpeed: 50 })])).toBe(0)
  })
})
