import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LogQuery } from '@theama/contracts'
import { pinoLineToEntry } from './entries'
import { RotatingNdjsonWriter, listLogFiles, logFileName, pruneLogs } from './file-writer'
import { decodeCursor, encodeCursor, readAppLogs, readRecentLocal, readServiceOutput } from './reader'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theama-logs-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const line = (level: number, msg: string, time: string, extra: object = {}) =>
  JSON.stringify({ level, time, msg, pid: 1, ...extra })
const q = (over: Partial<LogQuery> = {}): LogQuery => ({ limit: 100, ...over })

describe('pinoLineToEntry', () => {
  it('maps level numbers and moves extra fields into context', () => {
    const e = pinoLineToEntry(line(40, 'hello', '2026-10-19T10:00:00.000Z', { port: 1 }), 'app', 'x')
    expect(e).toMatchObject({ level: 'warn', message: 'hello', context: { port: 1 } })
  })
  it('skips junk, partial and non-log lines', () => {
    expect(pinoLineToEntry('', 'app', 'x')).toBeNull()
    expect(pinoLineToEntry('plain text', 'app', 'x')).toBeNull()
    expect(pinoLineToEntry('{"level":30,"time":"2026', 'app', 'x')).toBeNull()
    expect(pinoLineToEntry('{"level":99,"time":"2026-10-19T10:00:00Z","msg":"x"}', 'app', 'x')).toBeNull()
  })
})

describe('RotatingNdjsonWriter', () => {
  it('writes to a dated file and rolls over by size', () => {
    let now = new Date('2026-10-19T10:00:00Z')
    const w = new RotatingNdjsonWriter(dir, () => now, 100)
    w.write('a'.repeat(60))
    w.write('b'.repeat(60))
    expect(readdirSync(dir).sort()).toEqual([logFileName('2026-10-19', 1), logFileName('2026-10-19', 2)])
    now = new Date('2026-10-20T00:00:01Z')
    w.write('c')
    expect(listLogFiles(dir)[0]).toBe(logFileName('2026-10-20', 1))
  })

  it('continues the existing file after a restart', () => {
    const now = () => new Date('2026-10-19T10:00:00Z')
    new RotatingNdjsonWriter(dir, now).write('first')
    new RotatingNdjsonWriter(dir, now).write('second')
    expect(readdirSync(dir)).toEqual([logFileName('2026-10-19', 1)])
  })
})

describe('pruneLogs', () => {
  it('removes only files older than the retention window', () => {
    for (const day of ['2026-09-01', '2026-10-10', '2026-10-19']) writeFileSync(join(dir, logFileName(day, 1)), '')
    writeFileSync(join(dir, 'service-stdout.log'), 'keep me')
    const removed = pruneLogs(dir, 14, new Date('2026-10-19T12:00:00Z'))
    expect(removed).toEqual([logFileName('2026-09-01', 1)])
    expect(readdirSync(dir)).toContain('service-stdout.log')
  })
})

describe('readAppLogs', () => {
  beforeEach(() => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, logFileName('2026-10-18', 1)),
      [line(30, 'old-1', '2026-10-18T09:00:00.000Z'), line(50, 'old-error', '2026-10-18T09:05:00.000Z')].join('\n') + '\n',
    )
    appendFileSync(
      join(dir, logFileName('2026-10-19', 1)),
      [
        line(30, 'new-1', '2026-10-19T09:00:00.000Z'),
        'garbage line',
        line(40, 'new-warn', '2026-10-19T09:10:00.000Z'),
        line(30, 'new-2', '2026-10-19T09:20:00.000Z'),
      ].join('\n') + '\n',
    )
  })

  it('returns newest first across files', () => {
    const page = readAppLogs(dir, q())
    expect(page.items.map((e) => e.message)).toEqual(['new-2', 'new-warn', 'new-1', 'old-error', 'old-1'])
    expect(page.nextCursor).toBeNull()
  })

  it('pages with a cursor without duplicates or gaps', () => {
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = readAppLogs(dir, q({ limit: 2, cursor }))
      seen.push(...page.items.map((e) => e.message))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toEqual(['new-2', 'new-warn', 'new-1', 'old-error', 'old-1'])
  })

  it('filters by level, text and time range', () => {
    expect(readAppLogs(dir, q({ level: 'warn' })).items.map((e) => e.message)).toEqual(['new-warn', 'old-error'])
    expect(readAppLogs(dir, q({ q: 'NEW-' })).items).toHaveLength(3)
    expect(readAppLogs(dir, q({ from: '2026-10-19T00:00:00Z' })).items).toHaveLength(3)
    expect(readAppLogs(dir, q({ to: '2026-10-18T23:59:59Z' })).items).toHaveLength(2)
  })

  it('tolerates a stale or corrupt cursor', () => {
    expect(decodeCursor('not base64 json')).toBeNull()
    expect(readAppLogs(dir, q({ cursor: encodeCursor({ file: 'gone.ndjson', line: 3 }) })).items.length).toBeGreaterThan(0)
  })

  it('returns an empty page when the directory does not exist', () => {
    expect(readAppLogs(join(dir, 'missing'), q())).toEqual({ items: [], nextCursor: null })
  })
})

describe('service output files', () => {
  it('reads NSSM stdout/stderr tails as entries', () => {
    writeFileSync(join(dir, 'service-stderr.log'), 'boom\r\nTypeError: x\r\n')
    writeFileSync(join(dir, 'service-stdout.log'), 'hello\n')
    const err = readServiceOutput(dir, 'service-stderr', { limit: 10 })
    expect(err.map((e) => e.message)).toEqual(['TypeError: x', 'boom'])
    expect(err.every((e) => e.level === 'error' && e.source === 'service-stderr')).toBe(true)
    expect(readServiceOutput(dir, 'service-stdout', { limit: 10, level: 'warn' })).toEqual([])
    expect(readServiceOutput(join(dir, 'nope'), 'service-stdout', { limit: 10 })).toEqual([])
  })

  it('readRecentLocal merges app logs and stderr, newest first', () => {
    writeFileSync(join(dir, logFileName('2020-01-01', 1)), line(30, 'ancient', '2020-01-01T00:00:00.000Z') + '\n')
    writeFileSync(join(dir, 'service-stderr.log'), 'crash output\n')
    const items = readRecentLocal(dir, 10)
    expect(items[0]!.message).toBe('crash output')
    expect(items.at(-1)!.message).toBe('ancient')
  })
})
