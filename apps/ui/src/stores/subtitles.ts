import { ref } from 'vue'
import { defineStore } from 'pinia'
import { SubtitleProviders, type SubtitleProviderId } from '@theama/contracts'
import { useConnectionStore } from './connection'

export const useSubtitlesStore = defineStore('subtitles', () => {
  const connection = useConnectionStore()
  const providers = ref<SubtitleProviders['providers']>([])
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
  const setKey = (id: SubtitleProviderId, apiKey: string | null) => action(`/subtitles/providers/${id}/credentials`, { apiKey }, 'put')
  const test = (id: SubtitleProviderId) => action(`/subtitles/providers/${id}/test`)
  const login = (username: string, password: string) => action('/subtitles/opensubtitles/login', { username, password })
  const logout = () => action('/subtitles/opensubtitles/login', {}, 'delete')
  return { providers, load, setKey, test, login, logout }
})
