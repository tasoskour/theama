import { win32 } from 'node:path'
import { unzipSync } from 'fflate'
import { SubtitleFormat } from '@theama/contracts'
import { ApiProblem } from '../library/sources'
import type { SubtitlePayload } from './provider'

export interface SubtitleContent { fileName: string; format: 'srt' | 'ass' | 'ssa' | 'vtt'; bytes: Uint8Array }
const MAX_FILE_BYTES = 2 * 1024 * 1024
function invalid(): never { throw new ApiProblem('subtitle_invalid_download', 'The download contains no valid supported subtitles, or the archive is unsafe', 502) }

function validate(fileName: string, bytes: Uint8Array, language: string): SubtitleContent | null {
  const format = SubtitleFormat.safeParse(win32.extname(fileName).slice(1).toLowerCase()).data
  if (!format) return null
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) invalid()
  let text: string
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes)
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes)
    else text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { text = new TextDecoder(language === 'el' ? 'windows-1253' : 'windows-1252').decode(bytes) }
  text = text.replace(/^\uFEFF/, '').trim()
  if (text.includes('\0') || /^\s*(?:<!doctype|<html)/i.test(text)) invalid()
  const time = /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/
  if (format === 'srt' && !time.test(text)) invalid()
  if (format === 'vtt' && (!/^WEBVTT(?:\s|$)/.test(text) || !/\d{2}:\d{2}(?::\d{2})?\.\d{3}\s*-->/.test(text))) invalid()
  if ((format === 'ass' || format === 'ssa') && (!/^\[Events\]/im.test(text) || !/^Dialogue\s*:/im.test(text))) invalid()
  const normalized = new TextEncoder().encode(`${text}\n`)
  if (normalized.length > MAX_FILE_BYTES) invalid()
  return { fileName: win32.basename(fileName), format, bytes: normalized }
}

/** Extract only bounded text entries in memory; archive names are never used as destination paths. */
export function subtitleContents(payload: SubtitlePayload, language: string): SubtitleContent[] {
  const zip = payload.bytes[0] === 0x50 && payload.bytes[1] === 0x4b
  if (!zip) {
    const content = validate(payload.fileName, payload.bytes, language)
    if (!content) invalid()
    return [content]
  }
  try {
    let count = 0
    let total = 0
    const extracted = unzipSync(payload.bytes, { filter: (entry) => {
      count++
      total += entry.originalSize
      if (count > 32 || total > 8 * 1024 * 1024 || entry.originalSize > MAX_FILE_BYTES
        || /^[\\/]|^[a-z]:/i.test(entry.name) || entry.name.split(/[\\/]/).includes('..')) invalid()
      return SubtitleFormat.safeParse(win32.extname(entry.name).slice(1).toLowerCase()).success
    } })
    const contents = Object.entries(extracted).flatMap(([name, bytes]) => {
      const content = validate(name, bytes, language)
      return content ? [content] : []
    })
    if (!contents.length) invalid()
    return contents
  } catch { return invalid() }
}
