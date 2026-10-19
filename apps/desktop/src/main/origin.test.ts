import { describe, expect, it } from 'vitest'
import { originOf } from './origin'

describe('originOf', () => {
  it('handles the custom app:// scheme (where URL.origin is "null")', () => {
    expect(new URL('app://theama/index.html').origin).toBe('null')
    expect(originOf('app://theama/index.html')).toBe('app://theama')
  })
  it('handles http with ports', () => {
    expect(originOf('http://localhost:5173/#/x')).toBe('http://localhost:5173')
  })
  it('rejects look-alikes and garbage', () => {
    expect(originOf('app://theama.evil/index.html')).toBe('app://theama.evil')
    expect(originOf('not a url')).toBeNull()
  })
})
