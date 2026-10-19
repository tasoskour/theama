import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  ServiceEventList,
  type ServiceAccountChoice,
  type ServiceActionResult,
  type ServiceEvent,
  type ServiceStatus,
} from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from './connection'

export type ServiceAction = 'start' | 'stop' | 'restart' | 'install' | 'repair' | 'uninstall'

export const useServiceStore = defineStore('service', () => {
  const connection = useConnectionStore()
  const bridge = getBridge()
  const supported = bridge !== null

  const status = ref<ServiceStatus | null>(null)
  const busy = ref<ServiceAction | null>(null)
  const lastResult = ref<{ action: ServiceAction; ok: boolean; message: string | null } | null>(null)
  const events = ref<ServiceEvent[]>([])

  const installed = computed(() => status.value !== null && status.value.state !== 'not-installed')
  const isNssm = computed(() => status.value?.host === 'nssm')

  async function refresh(): Promise<void> {
    if (!bridge) return
    status.value = await bridge.service.status()
  }

  async function loadEvents(): Promise<void> {
    if (!connection.client) return
    events.value = (await connection.client.get('/service/events', ServiceEventList)).items
  }

  async function run(action: ServiceAction, account?: ServiceAccountChoice): Promise<ServiceActionResult | null> {
    if (!bridge || busy.value) return null
    busy.value = action
    try {
      let result: ServiceActionResult
      switch (action) {
        case 'start':
          result = await bridge.service.start()
          break
        case 'stop':
          result = await bridge.service.stop()
          break
        case 'restart':
          result = await bridge.service.restart()
          break
        case 'uninstall':
          result = await bridge.service.uninstall()
          break
        case 'install':
          result = await bridge.service.install(account ?? { kind: 'current-user' })
          break
        case 'repair':
          result = await bridge.service.repair(account ?? { kind: 'current-user' })
          break
      }
      status.value = result.status
      lastResult.value = { action, ok: result.ok, message: result.message }
      if (connection.isConnected) void loadEvents().catch(() => undefined)
      return result
    } catch (err) {
      lastResult.value = { action, ok: false, message: err instanceof Error ? err.message : String(err) }
      return null
    } finally {
      busy.value = null
    }
  }

  /** Subscribes to status pushes from the desktop shell for the caller's lifetime. */
  function watchStatus(): void {
    if (!bridge) return
    void refresh()
    const off = bridge.service.onStatus((s) => (status.value = s))
    onScopeDispose(off)
  }

  return { supported, status, busy, lastResult, events, installed, isNssm, refresh, loadEvents, run, watchStatus }
})
