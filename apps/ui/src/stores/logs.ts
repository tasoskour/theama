import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { LOG_LEVEL_ORDER, LogPage, type LogEntry, type LogLevel, type LogSource } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from './connection'

export type RangeKey = 'any' | 'hour' | 'day' | 'week'
const RANGE_MS: Record<Exclude<RangeKey, 'any'>, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}
/** Live tail never lets the in-memory list grow without bound. */
const MAX_ITEMS = 2000
const PAGE_SIZE = 100

export interface LogFilters {
  level: LogLevel | undefined
  source: LogSource | undefined
  q: string
  range: RangeKey
}

export function levelAtLeast(level: LogLevel, min: LogLevel | undefined): boolean {
  return !min || LOG_LEVEL_ORDER.indexOf(level) >= LOG_LEVEL_ORDER.indexOf(min)
}

export const useLogsStore = defineStore('logs', () => {
  const connection = useConnectionStore()
  const items = ref<LogEntry[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const live = ref(true)
  const filters = ref<LogFilters>({ level: undefined, source: undefined, q: '', range: 'any' })

  /** Live tail only makes sense for the app log, when no time window is applied. */
  const liveActive = computed(
    () => live.value && filters.value.range === 'any' && (!filters.value.source || filters.value.source === 'app'),
  )
  const hasMore = computed(() => nextCursor.value !== null)

  function query(cursor?: string): Record<string, string | number | undefined> {
    const f = filters.value
    return {
      level: f.level,
      source: f.source,
      q: f.q.trim() || undefined,
      from: f.range === 'any' ? undefined : new Date(Date.now() - RANGE_MS[f.range]).toISOString(),
      limit: PAGE_SIZE,
      cursor,
    }
  }

  let controller: AbortController | undefined
  let generation = 0
  async function load(append = false): Promise<void> {
    if (!connection.client || (append && loading.value)) return
    controller?.abort()
    const current = new AbortController()
    controller = current
    const mine = ++generation
    loading.value = true
    try {
      const page = await connection.client.get('/logs', LogPage, query(append ? (nextCursor.value ?? undefined) : undefined), { signal: current.signal })
      if (mine !== generation) return
      items.value = append ? [...items.value, ...page.items] : page.items
      nextCursor.value = page.nextCursor
      error.value = null
    } catch (err) {
      if (mine === generation && !current.signal.aborted) error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  /** Reads log files directly via the desktop shell when the service is down. */
  async function loadLocal(limit = 200): Promise<void> {
    const bridge = getBridge()
    if (!bridge) return
    loading.value = true
    try {
      items.value = await bridge.logs.readLocal(limit)
      nextCursor.value = null
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function matchesFilters(entry: LogEntry): boolean {
    const f = filters.value
    if (!levelAtLeast(entry.level, f.level)) return false
    const q = f.q.trim().toLowerCase()
    return !q || entry.message.toLowerCase().includes(q)
  }

  /** Subscribes to pushed log lines for the caller's lifetime. */
  function watchLive(): void {
    let pending: LogEntry[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = connection.onEvent(e => {
      if (e.type !== 'log.appended' || !liveActive.value || !matchesFilters(e.entry)) return
      pending.push(e.entry)
      if (!timer) timer = setTimeout(() => {
        timer = undefined
        const fresh = liveActive.value ? pending.filter(matchesFilters).reverse() : []
        items.value = [...fresh, ...items.value].slice(0, MAX_ITEMS)
        pending = []
      }, 50)
    })
    onScopeDispose(() => { off(); clearTimeout(timer) })
  }

  function exportText(): string {
    return items.value.map((e) => `${e.time}\t${e.level.toUpperCase()}\t${e.source}\t${e.message}`).join('\n')
  }

  let debounce: ReturnType<typeof setTimeout> | undefined
  watch(
    filters,
    () => {
      generation++
      controller?.abort()
      loading.value = false
      clearTimeout(debounce)
      debounce = setTimeout(() => void load(), 250)
    },
    { deep: true },
  )

  onScopeDispose(() => { generation++; controller?.abort(); clearTimeout(debounce) })

  return { items, nextCursor, loading, error, live, filters, liveActive, hasMore, load, loadLocal, watchLive, exportText }
})
