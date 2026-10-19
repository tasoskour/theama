import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractBearer, isAllowedOrigin, isLoopbackHost, loadOrCreateToken, tokenMatches } from './security'

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1:47890', 'localhost:3000', 'LOCALHOST', '[::1]:80', '127.0.0.1'])('accepts %s', (h) => {
    expect(isLoopbackHost(h)).toBe(true)
  })
  it.each(['evil.example', 'evil.example:47890', '127.0.0.1.evil.example', '192.168.1.5:80', undefined, ''])(
    'rejects %s',
    (h) => {
      expect(isLoopbackHost(h)).toBe(false)
    },
  )
})

describe('isAllowedOrigin', () => {
  const allowed = ['app://theama', 'http://localhost:5173']
  it('allows requests with no Origin', () => expect(isAllowedOrigin(undefined, allowed)).toBe(true))
  it('allows listed origins', () => expect(isAllowedOrigin('app://theama', allowed)).toBe(true))
  it('rejects other websites', () => expect(isAllowedOrigin('https://evil.example', allowed)).toBe(false))
  it('rejects look-alike origins', () => expect(isAllowedOrigin('app://theama.evil', allowed)).toBe(false))
})

describe('token handling', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('creates a token once and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theama-sec-'))
    dirs.push(dir)
    const file = join(dir, 'secrets', 'api-token')
    const first = loadOrCreateToken(file)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(file, 'utf8')).toBe(first)
    expect(loadOrCreateToken(file)).toBe(first)
  })

  it('compares tokens', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abd', 'abc')).toBe(false)
    expect(tokenMatches(undefined, 'abc')).toBe(false)
  })

  it('extracts bearer tokens', () => {
    expect(extractBearer('Bearer xyz')).toBe('xyz')
    expect(extractBearer('bearer xyz')).toBe('xyz')
    expect(extractBearer('Basic xyz')).toBeUndefined()
    expect(extractBearer(undefined)).toBeUndefined()
  })
})
