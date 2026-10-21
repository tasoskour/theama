import { onScopeDispose, readonly, shallowRef, watchEffect } from 'vue'
import type { SceneContext } from '@/components/immersive/resolve'

/**
 * What the page on screen says about itself for the 3D backdrop: the kind of title and its genres.
 * Pages publish it; the backdrop reads it. Nothing depends on this being used, so a page that publishes
 * nothing simply gets the backdrop its route implies.
 */
const hint = shallowRef<SceneContext>({})
let owner: symbol | null = null

export const sceneHint = readonly(hint)

/** Publish a hint while the calling component (or effect scope) is alive; it follows the source and is withdrawn on unmount. */
export function useSceneHint(source: () => SceneContext): void {
  const mine = Symbol('scene-hint')
  owner = mine
  watchEffect(() => {
    // The old page leaves before the new one arrives, but a late update from a page that has already gone must not win.
    if (owner === mine) hint.value = source()
  })
  onScopeDispose(() => {
    if (owner === mine) {
      owner = null
      hint.value = {}
    }
  })
}
