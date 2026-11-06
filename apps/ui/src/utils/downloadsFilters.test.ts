import { expect, it, vi } from 'vitest'
import type { Suggestion } from '@theama/contracts'
import { matchesFindFilters, searchFindYears, type FindFilters } from './downloadsFilters'

const item: Suggestion = { provider: 'tmdb', externalId: '1', kind: 'movie', title: 'Title', originalTitle: null, year: 2020, overview: null, posterUrl: null, score: null, rating: 8, genres: ['Drama', 'Comedy'] }
const filters: FindFilters = { years: [], genres: [], genreMode: 'any', ratingRange: [0, 10] }

it('combines any selected year with inclusive ratings, kind and Any/All genres', () => {
  const selected = { ...filters, years: [2019, 2020], genres: ['Drama', 'Comedy'], genreMode: 'all' as const, ratingRange: [8, 8] }
  expect(matchesFindFilters(item, selected)).toBe(true)
  expect(matchesFindFilters({ ...item, kind: 'series' }, selected)).toBe(true)
  expect(matchesFindFilters(item, { ...selected, kind: 'series' })).toBe(false)
  expect(matchesFindFilters(item, { ...selected, years: [2019] })).toBe(false)
  expect(matchesFindFilters(item, { ...selected, ratingRange: [8.1, 10] })).toBe(false)
  expect(matchesFindFilters(item, { ...selected, ratingRange: [0, 7.9] })).toBe(false)
  expect(matchesFindFilters(item, { ...selected, genres: ['Drama', 'Horror'] })).toBe(false)
  expect(matchesFindFilters(item, { ...selected, genres: ['Drama', 'Horror'], genreMode: 'any' })).toBe(true)
})

it('includes unknown years and ratings only when the corresponding filter is unrestricted', () => {
  expect(matchesFindFilters({ ...item, year: null, rating: null }, filters)).toBe(true)
  expect(matchesFindFilters({ ...item, year: null }, { ...filters, years: [2020] })).toBe(false)
  expect(matchesFindFilters({ ...item, rating: null }, { ...filters, ratingRange: [0, 9] })).toBe(false)
  expect(matchesFindFilters({ ...item, rating: 0 }, { ...filters, ratingRange: [0, 0] })).toBe(true)
  expect(matchesFindFilters({ ...item, rating: 10 }, { ...filters, ratingRange: [10, 10] })).toBe(true)
})

it('bounds year-search concurrency, keeps order, deduplicates and retains partial successes', async () => {
  let running = 0
  let peak = 0
  const search = vi.fn(async (kind: 'movie' | 'series', year: number | undefined) => {
    peak = Math.max(peak, ++running)
    await new Promise(resolve => setTimeout(resolve, year === 2022 ? 10 : 0))
    running--
    return kind === 'series' && year === 2020
      ? { ok: false as const, message: 'Failed year' }
      : { ok: true as const, items: [{ ...item, externalId: String(year), kind }, item] }
  })
  const result = await searchFindYears(['movie', 'series'], [2020, 2022, 2021, 2022], search, new AbortController().signal)
  expect(peak).toBe(4)
  expect(search).toHaveBeenCalledTimes(6)
  expect(result.items?.map(c => `${c.kind}:${c.externalId}`)).toEqual(['movie:2022', 'movie:1', 'series:2022', 'movie:2021', 'series:2021', 'movie:2020'])
  expect(result.problem).toBe('Failed year')
})

it('stops scheduling years after cancellation and searches once per kind with no selected year', async () => {
  const controller = new AbortController()
  const search = vi.fn(async () => { controller.abort(); return { ok: true as const, items: [item] } })
  await searchFindYears(['movie'], [2020, 2021, 2022, 2023, 2024], search, controller.signal)
  expect(search).toHaveBeenCalledOnce()
  search.mockClear()
  const result = await searchFindYears(['movie'], [], search, new AbortController().signal)
  expect(search).toHaveBeenCalledWith('movie', undefined)
  expect(result.items).toEqual([item])
})
