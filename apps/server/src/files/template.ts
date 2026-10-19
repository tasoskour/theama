import { TEMPLATE_TOKENS } from '@theama/contracts'

/** The values a file name template can use. Anything missing is null and simply leaves its place empty. */
export interface TemplateValues {
  title: string | null
  year: number | null
  season: number | null
  episode: number | null
  episodeCode: string | null
  episodeTitle: string | null
  resolution: string | null
  videoCodec: string | null
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

const TOKEN = /\{(\w+)(?::(0+))?\}/g
const known = new Set<string>(TEMPLATE_TOKENS)

/** Throws a TemplateError (with a message fit to show) if the template cannot be used. */
export function validateTemplate(template: string): void {
  if (/[\\/]/.test(template)) throw new TemplateError('A template names a file, not a folder: it cannot contain / or \\')
  const stripped = template.replace(TOKEN, (whole, name: string) => {
    if (!known.has(name)) throw new TemplateError(`Unknown name {${name}}. Use: ${TEMPLATE_TOKENS.map((t) => `{${t}}`).join(' ')}`)
    return ''
  })
  if (/[{}]/.test(stripped)) throw new TemplateError('A { or } is not part of a name like {title}')
  if (!template.includes('{')) throw new TemplateError('A template with no {name} in it would give every file the same name')
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** Fills a template in. `{season:00}` pads a number to two digits. The result still needs cleaning (see cleanFileName). */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(TOKEN, (_whole, name: keyof TemplateValues, zeros: string | undefined) => {
    const v = values[name]
    if (v === null || v === undefined || v === '') return ''
    return typeof v === 'number' && zeros ? pad(v, zeros.length) : String(v)
  })
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** Longest name (without extension) we will produce; Windows allows 255, and paths have their own limit. */
export const MAX_BASE_LENGTH = 180

/**
 * Turns rendered text into something Windows will accept as a file name, in a way a person would:
 * a colon becomes " -" ("Mad Max: Fury Road" -> "Mad Max - Fury Road"), slashes become dashes, characters
 * Windows forbids are dropped, empty brackets and dangling separators left by missing values disappear,
 * and trailing dots and spaces (which Windows silently strips, causing surprises) are removed.
 */
export function cleanFileName(raw: string): string {
  let s = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/|]/g, '-')
    .replace(/"/g, "'")
    .replace(/[<>?*]/g, '')
  s = s.replace(/\(\s*\)|\[\s*\]/g, '')
  s = s.replace(/(\s-\s)(?:\s*-\s)+/g, '$1')
  s = s.replace(/\s{2,}/g, ' ')
  s = s.replace(/^[\s.\-_]+|[\s.\-_]+$/g, '')
  // A "-" left before a closing bracket or after an opening one.
  s = s.replace(/\s-\s*([)\]])/g, '$1').replace(/([([])\s*-\s/g, '$1')
  s = s.replace(/\s{2,}/g, ' ').trim()
  if (s.length > MAX_BASE_LENGTH) s = s.slice(0, MAX_BASE_LENGTH).replace(/[\s.\-_]+$/, '')
  if (RESERVED.test(s)) s = `_${s}`
  return s
}
