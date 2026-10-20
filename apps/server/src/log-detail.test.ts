import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type RunningServer } from './bootstrap'
import { loadConfig } from './config'

let dir = ''
let server: RunningServer | null = null
afterEach(async () => {
  await server?.stop('test finished')
  server = null
  await rm(dir, { recursive: true, force: true })
})

async function start(env: Record<string, string> = {}): Promise<{ put: (body: unknown) => Promise<Response> }> {
  dir = mkdtempSync(join(tmpdir(), 'theama-logdetail-'))
  server = await startServer(loadConfig({ THEAMA_DATA_DIR: dir, THEAMA_PORT: '0', THEAMA_FFPROBE: 'none', ...env }))
  const base = `http://127.0.0.1:${server.port}/api/v1`
  const token = server.token
  return { put: (body) => fetch(`${base}/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
}

describe('log detail setting', () => {
  it('starts at Normal, changes the running logger at once, and is remembered across a restart', async () => {
    const api = await start()
    expect(server!.logger.level).toBe('info')
    expect((await api.put({ logDetail: 'debug' })).status).toBe(200)
    expect(server!.logger.level).toBe('debug')
    expect((await api.put({ logDetail: 'error' })).status).toBe(200)
    expect(server!.logger.level).toBe('error')

    const keep = dir
    await server!.stop('restart')
    server = await startServer(loadConfig({ THEAMA_DATA_DIR: keep, THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' }))
    expect(server.logger.level).toBe('error')
  })

  it('refuses a level that does not exist', async () => {
    const api = await start()
    expect((await api.put({ logDetail: 'trace' })).status).toBe(400)
    expect((await api.put({ logDetail: 'loud' })).status).toBe(400)
    expect(server!.logger.level).toBe('info')
  })

  it('leaves a level set in the environment alone', async () => {
    const api = await start({ THEAMA_LOG_LEVEL: 'warn' })
    expect(server!.logger.level).toBe('warn')
    expect((await api.put({ logDetail: 'debug' })).status).toBe(200)
    expect(server!.logger.level).toBe('warn') // the saved choice waits until the environment no longer overrides it
  })
})
