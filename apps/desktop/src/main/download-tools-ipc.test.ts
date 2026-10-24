import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@theama/contracts'
import { registerIpc, type IpcDeps } from './ipc'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>())
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) => handlers.set(channel, fn) }, shell: {}, dialog: {} }))

beforeEach(() => { handlers.clear() })

describe('download tools IPC boundary', () => {
  it('validates app identifiers and rejects untrusted frames before acting', async () => {
    const open = vi.fn(async () => ({ ok: true, code: null }))
    const status = vi.fn(async () => ({}))
    registerIpc({ trustedOrigins: ['app://theama'], downloadTools: { open, status } } as unknown as IpcDeps)
    const trusted = { senderFrame: { url: 'app://theama/index.html' } }
    const untrusted = { senderFrame: { url: 'https://example.com/' } }
    const handler = handlers.get(IPC.downloadToolsOpen)!
    await expect(handler(untrusted, { tool: 'qbittorrent' })).rejects.toThrow('untrusted')
    await expect(handler(trusted, { tool: 'C:\\Windows\\notepad.exe' })).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
    await handler(trusted, { tool: 'qbittorrent' })
    expect(open).toHaveBeenCalledExactlyOnceWith('qbittorrent')
    await expect(handlers.get(IPC.downloadToolsStatus)!(untrusted, undefined)).rejects.toThrow('untrusted')
    expect(status).not.toHaveBeenCalled()
    await handlers.get(IPC.downloadToolsStatus)!(trusted, undefined)
    expect(status).toHaveBeenCalledOnce()
  })
})
