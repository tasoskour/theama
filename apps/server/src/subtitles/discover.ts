import { readdir } from 'node:fs/promises'
import { win32 } from 'node:path'
import type { SubtitleTrack } from '@theama/contracts'
import { toLanguageCode } from './languages'

/** Text formats players read directly. `.sub` is included although it can be half of a VobSub pair. */
export const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt', 'sub'] as const
/** Folders (next to the video) where releases usually put their subtitles. */
const SUBTITLE_FOLDERS = ['Subs', 'Subtitles', 'Sub']

export interface ExternalSubtitle {
  path: string
  fileName: string
  format: string
  /** ISO 639-1, from a tag in the file name (`Film.en.srt`, `Film.Greek.srt`); null when it cannot be told. */
  language: string | null
  forced: boolean
  /** For the deaf and hard of hearing (`.sdh`, `.hi`, `.cc`). */
  sdh: boolean
}

export type ListDir = (dir: string) => Promise<string[]>

const defaultListDir: ListDir = (dir) => readdir(dir)

const fold = (s: string): string => s.normalize('NFC').toLowerCase()
const TOKEN_SPLIT = /[.\s_\-[\]()]+/

function describe(dir: string, fileName: string, rest: string): ExternalSubtitle {
  const tokens = rest.split(TOKEN_SPLIT).filter(Boolean)
  const language = tokens.map((t) => toLanguageCode(t)).find((l): l is string => l !== null) ?? null
  return {
    path: win32.join(dir, fileName),
    fileName,
    format: win32.extname(fileName).slice(1).toLowerCase(),
    language,
    forced: tokens.includes('forced'),
    sdh: tokens.some((t) => t === 'sdh' || t === 'hi' || t === 'cc'),
  }
}

/**
 * Subtitle files that belong to a video: same folder (or a `Subs`/`Subtitles` folder, or a folder named
 * after the video) and a name that starts with the video's name. Read when asked, never cached, so a file
 * added or renamed since the last scan is seen. A folder that cannot be read just yields nothing.
 */
export async function discoverExternal(videoPath: string, listDir: ListDir = defaultListDir): Promise<ExternalSubtitle[]> {
  const dir = win32.dirname(videoPath)
  const base = fold(win32.basename(videoPath, win32.extname(videoPath)))
  const found: ExternalSubtitle[] = []
  const seen = new Set<string>()

  const scan = async (folder: string, anyName: boolean): Promise<void> => {
    let names: string[]
    try {
      names = await listDir(folder)
    } catch {
      return
    }
    for (const name of names) {
      const ext = win32.extname(name).slice(1).toLowerCase()
      if (!(SUBTITLE_EXTENSIONS as readonly string[]).includes(ext)) continue
      const stem = fold(win32.basename(name, win32.extname(name)))
      let rest: string
      if (stem === base) rest = ''
      else if (stem.startsWith(base) && /[.\s_\-[(]/.test(stem.charAt(base.length))) rest = stem.slice(base.length)
      else if (anyName) rest = stem
      else continue
      const key = fold(win32.join(folder, name))
      if (seen.has(key)) continue
      seen.add(key)
      found.push(describe(folder, name, rest))
    }
  }

  await scan(dir, false)
  for (const sub of SUBTITLE_FOLDERS) {
    await scan(win32.join(dir, sub), false)
    // A folder named after the video holds its subtitles whatever they are called ("2_English.srt").
    await scan(win32.join(dir, sub, win32.basename(videoPath, win32.extname(videoPath))), true)
  }
  return found.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' }))
}

/**
 * The subtitle to start with: for each preferred language in order, the first normal (not forced-only,
 * not hearing-impaired) subtitle in that language, else a hearing-impaired one. Null when nothing matches;
 * the player then does what it does by default.
 */
export function chooseSubtitle(external: readonly ExternalSubtitle[], preferred: readonly string[]): ExternalSubtitle | null {
  for (const lang of preferred) {
    const inLang = external.filter((s) => s.language === lang && !s.forced)
    const pick = inLang.find((s) => !s.sdh) ?? inLang[0]
    if (pick) return pick
  }
  return null
}

/** Embedded streams in the order players list them, for showing alongside the external files. */
export function describeEmbedded(tracks: readonly SubtitleTrack[]): string[] {
  return tracks.map((t) => [t.language ?? '?', t.title, t.forced ? 'forced' : null, t.codec].filter(Boolean).join(' · '))
}
