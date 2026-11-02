import { ref } from 'vue'
import { defineStore } from 'pinia'
import { SubtitleProviders, type SubtitleProviderId } from '@theama/contracts'
import { useConnectionStore } from './connection'

export const useSubtitlesStore = defineStore('subtitles', () => {
  const connection = useConnectionStore()
  const providers = ref<SubtitleProviders['providers']>([])
  /** Session-only evidence: saved credentials alone do not prove current provider access. */
  const verification = ref<Partial<Record<SubtitleProviderId, 'verified' | 'failed' | 'unknown'>>>({})
  async function load(): Promise<void> {
    if (!connection.client) return
    providers.value = (await connection.client.get('/subtitles/providers', SubtitleProviders)).providers
  }
  async function action(path: string, body: unknown = {}, method: 'post' | 'put' | 'delete' = 'post'): Promise<void> {
    const client = connection.client
    if (!client) throw new Error('Disconnected')
    const status = method === 'delete' ? await client.delete(path, SubtitleProviders) : await client[method](path, body, SubtitleProviders)
    providers.value = status.providers
  }
  async function verify(id: SubtitleProviderId, operation: () => Promise<void>): Promise<void> {
    try { await operation(); verification.value[id] = 'verified' }
    catch (error) { verification.value[id] = 'failed'; throw error }
  }
  async function setKey(id: SubtitleProviderId, apiKey: string | null): Promise<void> {
    await verify(id, () => action(`/subtitles/providers/${id}/credentials`, { apiKey }, 'put'))
    if (apiKey === null) verification.value[id] = 'unknown'
  }
  const test = (id: SubtitleProviderId) => verify(id, () => action(`/subtitles/providers/${id}/test`))
  const login = (username: string, password: string) => verify('opensubtitles', () => action('/subtitles/opensubtitles/login', { username, password }))
  const logout = () => action('/subtitles/opensubtitles/login', {}, 'delete')
  return { providers, verification, load, setKey, test, login, logout }
})
