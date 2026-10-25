import { existsSync, mkdirSync } from 'node:fs'
import { rename, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResilientHttp } from './http'
import type { ImageSize } from './provider'

/** Largest image we will store; posters and backdrops are far smaller. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024

/** A provider-relative path as TMDB writes it. Anything else is refused, so provider data can never choose a file name. */
const REMOTE_PATH = /^\/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/i
/** A cached file name as this class writes it (and as the artwork route accepts it). */
export const ARTWORK_FILE = /^(thumb|poster|backdrop|still)-[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/i

export const ARTWORK_ROUTE = '/api/v1/artwork'

const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export function artworkContentType(file: string): string {
  return CONTENT_TYPES[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
}

/** What the UI loads: the backend serves cached files itself, so nothing is hot-linked from a CDN. */
export function artworkUrl(file: string | null): string | null {
  return file ? `${ARTWORK_ROUTE}/${file}` : null
}

function looksLikeImage(b: Buffer): boolean {
  const jpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const png = b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const webp = b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
  return jpeg || png || webp
}

/** Downloads provider images once and keeps them in the cache folder, so artwork works offline. */
export class ArtworkCache {
  private readonly pending = new Map<string, Promise<string | null>>()
  constructor(
    private readonly dir: string,
    private readonly http: ResilientHttp,
    private readonly urlFor: (path: string, size: ImageSize) => string,
  ) {
    mkdirSync(dir, { recursive: true })
  }

  fileFor(path: string, size: ImageSize): string | null {
    return REMOTE_PATH.test(path) ? `${size}-${path.slice(1)}` : null
  }

  pathOf(file: string): string | null {
    return ARTWORK_FILE.test(file) ? join(this.dir, file) : null
  }

  /** The cached file name for a remote image, downloading it if needed. Null when it cannot be had. */
  async ensure(path: string | null, size: ImageSize): Promise<string | null> {
    if (!path) return null
    const file = this.fileFor(path, size)
    if (!file) return null
    const target = join(this.dir, file)
    if (existsSync(target)) return file
    const known = this.pending.get(file)
    if (known) return known
    const result = this.download(path, size, file, target).finally(() => this.pending.delete(file))
    this.pending.set(file, result)
    return result
  }

  private async download(path: string, size: ImageSize, file: string, target: string): Promise<string | null> {
    try {
      const { bytes, contentType } = await this.http.getBytes(new URL(this.urlFor(path, size)), MAX_IMAGE_BYTES)
      if (!contentType.toLowerCase().startsWith('image/') || !looksLikeImage(bytes)) return null
      const tmp = `${target}.${process.pid}.tmp`
      await writeFile(tmp, bytes)
      try {
        await rename(tmp, target)
      } catch (err) {
        await rm(tmp, { force: true })
        throw err
      }
      return file
    } catch {
      return null // artwork is a nicety: a failure leaves the generated poster in place and is retried later
    }
  }
}
