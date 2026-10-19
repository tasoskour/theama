import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { PlayerInfo, PlayResult } from '@theama/contracts'
import { getBridge } from '@/api/bridge'

/**
 * Media players on this PC, and the one place a video is started from. Starting a player is done by the
 * desktop shell; the UI only says which file (by id) and which player. In a plain browser there is no
 * shell, so nothing can be played and the buttons say so.
 */
export const usePlayersStore = defineStore('players', () => {
  const bridge = getBridge()
  const players = ref<PlayerInfo[]>([])
  const loaded = ref(false)
  const error = ref<string | null>(null)
  /** The last start that failed, for a snackbar. */
  const lastFailure = ref<PlayResult | null>(null)
  const starting = ref(false)

  const canPlay = computed(() => bridge !== null)
  const available = computed(() => players.value.filter((p) => p.available))
  const defaultPlayer = computed(() => players.value.find((p) => p.isDefault) ?? null)

  async function load(): Promise<void> {
    if (!bridge) return
    try {
      players.value = await bridge.players.list()
      loaded.value = true
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function wrap(action: () => Promise<PlayerInfo[] | null>): Promise<void> {
    try {
      const next = await action()
      if (next) players.value = next
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  const setDefault = (id: string): Promise<void> => wrap(() => bridge!.players.setDefault(id))
  const addCustom = (): Promise<void> => wrap(() => bridge!.players.addCustom())
  const remove = (id: string): Promise<void> => wrap(() => bridge!.players.remove(id))

  /** Starts a player on a file. Resolves to the shell's answer; a failure is also kept in `lastFailure`. */
  async function play(fileId: number, playerId?: string): Promise<PlayResult> {
    if (!bridge) {
      const result: PlayResult = { ok: false, code: 'no_player', message: null, playerName: null }
      lastFailure.value = result
      return result
    }
    starting.value = true
    try {
      const result = await bridge.players.play({ fileId, playerId })
      lastFailure.value = result.ok ? null : result
      return result
    } catch (err) {
      const result: PlayResult = { ok: false, code: 'launch_failed', message: err instanceof Error ? err.message : String(err), playerName: null }
      lastFailure.value = result
      return result
    } finally {
      starting.value = false
    }
  }

  void load()

  return { players, available, defaultPlayer, loaded, error, lastFailure, starting, canPlay, load, setDefault, addCustom, remove, play }
})
