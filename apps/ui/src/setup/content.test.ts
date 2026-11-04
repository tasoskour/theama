import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ExternalLinkRequest, SETUP_RESOURCES } from '@theama/contracts'
import { externalUrl } from '@/composables/useExternalLinks'
import { guide as en } from './guide.en'
import { guide as el } from './guide.el'
import { guideMarkdown, searchableText, GUIDE_STEPS } from './content'

describe('complete bilingual setup guide', () => {
  it('covers every wizard step and every integration in both languages', () => {
    const ids = [...GUIDE_STEPS, 'installation', 'prowlarr', 'vpn', 'maintenance', 'developer', 'troubleshooting']
    expect(new Set(en.sections.map((s) => s.id))).toEqual(new Set(ids))
    expect(el.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id))
    for (let i = 0; i < en.sections.length; i++) {
      const a = en.sections[i]!, b = el.sections[i]!
      expect(b.optional).toBe(a.optional)
      expect(b.route).toBe(a.route)
      expect(b.blocks.map((block) => block.kind)).toEqual(a.blocks.map((block) => block.kind))
      expect(/[Α-ω]/.test(b.title)).toBe(true)
    }
    for (const guide of [en, el]) {
      const text = JSON.stringify(guide)
      for (const term of ['OpenSubtitles', 'SubDL', 'TMDB', 'qBittorrent', 'Prowlarr', 'NordVPN', 'FFprobe', 'NSSM', 'MPC-HC', 'MPC-BE', 'PotPlayer', '47890', '4.18.1', 'CSC_LINK', 'THEAMA_DATA_DIR']) expect(text).toContain(term)
      expect(guideMarkdown(guide).length).toBeGreaterThan(20000)
    }
  })
  it('uses the same fixed destinations in both languages, browser links and generated docs', () => {
    const used = (guide: typeof en) => guide.sections.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'links' ? b.items.map((i) => i.resource) : []))
    expect(used(el)).toEqual(used(en))
    expect(new Set(used(en))).toEqual(new Set(Object.keys(SETUP_RESOURCES)))
    for (const [resource, url] of Object.entries(SETUP_RESOURCES)) {
      const request = ExternalLinkRequest.parse({ service: 'setup', resource })
      expect(externalUrl(request)).toBe(url)
      expect(new URL(url).protocol).toBe('https:')
      expect(guideMarkdown(en)).toContain(`](${url})`)
    }
    expect(ExternalLinkRequest.safeParse({ service: 'setup', resource: 'https://evil.example' }).success).toBe(false)
  })
  it('keeps checked-in Markdown synchronized with the in-app content', () => {
    expect(readFileSync(new URL('../../../../docs/13-setup-guide.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n')).toBe(guideMarkdown(en))
    expect(readFileSync(new URL('../../../../docs/13-setup-guide.el.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n')).toBe(guideMarkdown(el))
  })
  it('supports searches in translated instructions without accents', () => {
    const section = el.sections.find((s) => s.id === 'library')!
    expect(searchableText(section)).toContain('σαρωση')
    expect(searchableText(en.sections.find((s) => s.id === 'metadata')!)).toContain('read access token')
  })
})
