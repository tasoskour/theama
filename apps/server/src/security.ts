import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Reads the per-install API token, creating it on first run. The token is the
 * credential that separates the Theama UI from any other local process or
 * web page that can reach the loopback port.
 */
export function loadOrCreateToken(tokenFile: string): string {
  if (existsSync(tokenFile)) {
    const existing = readFileSync(tokenFile, 'utf8').trim()
    if (existing.length >= 32) return existing
  }
  mkdirSync(dirname(tokenFile), { recursive: true })
  const token = randomBytes(32).toString('hex')
  writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 })
  return token
}

/** Constant-time comparison of a presented token with the expected one. */
export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m?.[1]
}

/**
 * DNS-rebinding defence: a page on attacker.example that re-resolves to
 * 127.0.0.1 still sends Host: attacker.example, which is rejected here.
 */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0]!
  return LOOPBACK_HOSTNAMES.has(host.toLowerCase())
}

/** A request without an Origin (Node, curl, Electron main) is not a browser CSRF vector. */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true
  return allowed.includes(origin)
}
