import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextureBank, type PosterSource } from './layers'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const poster = (seed: string): PosterSource => ({ seed, url: `https://local/${seed}`, from: '#000000', to: '#ffffff' })

describe('poster textures', () => {
  it('shares pending loads and releases textures after materials change sources', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    let finish!: (texture: THREE.Texture<HTMLImageElement>) => void
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, success) => { finish = success!; return new THREE.Texture<HTMLImageElement>() })
    const bank = new TextureBank()
    bank.setPosters([poster('a')])
    bank.textureAt(0); bank.textureAt(0)
    expect(load).toHaveBeenCalledOnce()
    const texture = new THREE.Texture<HTMLImageElement>()
    const dispose = vi.spyOn(texture, 'dispose')
    finish(texture)
    expect(bank.textureAt(0)).toBe(texture)
    bank.setPosters([poster('b')])
    expect(dispose).toHaveBeenCalledOnce()
    bank.dispose()
  })

  it('disposes late results after removal or teardown without refreshing a dead scene', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    const finishes: ((texture: THREE.Texture<HTMLImageElement>) => void)[] = []
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, success) => { finishes.push(success!); return new THREE.Texture<HTMLImageElement>() })
    const bank = new TextureBank()
    bank.setPosters([poster('a')]); bank.textureAt(0)
    bank.setPosters([poster('b')]); bank.textureAt(0)
    const changed = vi.fn()
    bank.onChange = changed
    const a = new THREE.Texture<HTMLImageElement>(); const b = new THREE.Texture<HTMLImageElement>()
    const disposeA = vi.spyOn(a, 'dispose'); const disposeB = vi.spyOn(b, 'dispose')
    finishes[0]!(a)
    expect(disposeA).toHaveBeenCalledOnce()
    bank.dispose()
    finishes[1]!(b)
    expect(disposeB).toHaveBeenCalledOnce()
    expect(changed).not.toHaveBeenCalled()
  })
})
