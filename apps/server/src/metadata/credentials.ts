import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Where the TMDB key lives: a file in the data folder's secrets directory, never in the database and
 * never returned by the API. Whoever can read the data folder can read it, which is the same trust
 * boundary as the API token next to it (see docs/11-risks.md).
 */
export class CredentialStore {
  private cached: string | null | undefined

  constructor(private readonly file: string) {}

  get(): string | null {
    if (this.cached !== undefined) return this.cached
    try {
      const value = existsSync(this.file) ? readFileSync(this.file, 'utf8').trim() : ''
      this.cached = value || null
    } catch {
      this.cached = null
    }
    return this.cached
  }

  has(): boolean {
    return this.get() !== null
  }

  set(value: string | null): void {
    if (value === null) {
      rmSync(this.file, { force: true })
      this.cached = null
      return
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, value.trim(), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.file)
    try {
      chmodSync(this.file, 0o600)
    } catch {
      // Windows ignores POSIX modes; the folder's ACL is what protects the file there.
    }
    this.cached = value.trim()
  }
}
