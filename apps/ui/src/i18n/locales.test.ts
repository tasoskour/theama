import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import el from './locales/el.json'

type Tree = { [k: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  )
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
}

function get(tree: Tree, key: string): string | undefined {
  let cur: string | Tree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

const enKeys = flatten(en as Tree)
const elKeys = flatten(el as Tree)

describe('locale files', () => {
  it('have identical key sets', () => {
    expect(elKeys.filter((k) => !enKeys.includes(k))).toEqual([])
    expect(enKeys.filter((k) => !elKeys.includes(k))).toEqual([])
  })

  it('use the same interpolation placeholders and plural forms in every language', () => {
    for (const key of enKeys) {
      const a = get(en as Tree, key)!
      const b = get(el as Tree, key)!
      expect(placeholders(b), key).toEqual(placeholders(a))
      expect(b.split('|').length, `${key} plural forms`).toBe(a.split('|').length)
    }
  })

  it('have no empty strings', () => {
    for (const key of enKeys) {
      expect(get(en as Tree, key)!.trim(), `en ${key}`).not.toBe('')
      expect(get(el as Tree, key)!.trim(), `el ${key}`).not.toBe('')
    }
  })

  it('keep the Greek locale actually Greek', () => {
    const greek = /[Ͱ-Ͽἀ-῿]/
    const untranslated = elKeys.filter((k) => !greek.test(get(el as Tree, k)!))
    // Product/technical terms that are intentionally identical or Latin-only.
    expect(untranslated.sort()).toEqual(
      ['settings.about.nodeVersion', 'service.fields.api', 'metadata.tmdb', 'detail.imdb', 'downloads.qb.name', 'downloads.prowlarr.name', 'downloads.releases.name.prowlarr', 'downloads.releases.name.qbittorrent', 'downloads.releases.seeders', 'downloads.tools.open.nordvpn', 'downloads.tools.open.qbittorrent', 'downloads.tools.open.prowlarr'].sort(),
    )
  })
})

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(vue|ts)$/.test(name) && !name.endsWith('.test.ts') ? [p] : []
  })
}

describe('translation keys used in source', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const used = new Set<string>()
  const dynamicPrefixes = new Set<string>()

  const patterns = [
    /\$?\bt\(\s*(['"`])([^'"`]+)\1/g,
    /\$tc?\(\s*(['"`])([^'"`]+)\1/g,
    /(?<![\w:-])(?:title-key|body-key)="([^"]+)"/g,
    /:(?:title-key|body-key)="`([^`]+)`"/g,
    /(?:labelKey|titleKey):\s*(['"`])([^'"`]+)\1/g,
  ]

  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8')
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const key = m[m.length - 1]!
        if (!/^[a-z][\w-]*(\.[\w${}\-.]+)+$/i.test(key)) continue
        if (key.includes('${')) dynamicPrefixes.add(key.slice(0, key.indexOf('${')))
        else used.add(key)
      }
    }
    // Template-literal keys inside bindings, e.g. $t(`service.state.${x}`)
    for (const m of text.matchAll(/`((?:nav|common|connection|empty|recovery|settings|service|logs|errors|app)\.[^`$]*)\$\{/g)) {
      dynamicPrefixes.add(m[1]!)
    }
  }

  it('finds usages (sanity check on the scanner)', () => {
    expect(used.size).toBeGreaterThan(20)
  })

  it('all literal keys exist', () => {
    const missing = [...used].filter((k) => get(en as Tree, k) === undefined)
    expect(missing).toEqual([])
  })

  it('all dynamic key prefixes resolve to at least one key', () => {
    const missing = [...dynamicPrefixes].filter((p) => !enKeys.some((k) => k.startsWith(p)))
    expect(missing).toEqual([])
  })
})
