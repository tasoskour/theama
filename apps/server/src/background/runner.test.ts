import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAppLogs } from '@theama/logs'
import { BackgroundReader } from './runner'

describe('background log reader', () => {
  it('preserves ordering, filters and cursors across rotated files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'theama-worker-test-'))
    const reader = new BackgroundReader()
    try {
      for (let file = 1; file <= 2; file++) {
        const lines = Array.from({ length: 8 }, (_, index) => JSON.stringify({ time: '2026-10-25T09:00:00Z', level: index % 2 ? 40 : 30, msg: `file ${file} line ${index}` }))
        writeFileSync(join(directory, `theama-2026-10-25-00${file}.ndjson`), lines.join('\n') + '\n')
      }
      const query = { limit: 3, q: 'line', level: 'warn' as const }
      const first = await reader.logs(directory, query)
      expect(first).toEqual(readAppLogs(directory, query))
      const next = { ...query, cursor: first.nextCursor! }
      expect(await reader.logs(directory, next)).toEqual(readAppLogs(directory, next))
      expect(await reader.logs(directory, { limit: 10, q: 'absent' })).toEqual({ items: [], nextCursor: null })
    } finally { await reader.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('rejects pending work and future requests after shutdown', async () => {
    const reader = new BackgroundReader()
    const pending = expect(reader.logs('unused', { limit: 10 })).rejects.toThrow('closed')
    await reader.close()
    await pending
    await expect(reader.logs('unused', { limit: 10 })).rejects.toThrow('closed')
  })
})
