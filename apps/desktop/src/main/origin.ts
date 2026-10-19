/**
 * Origin of a URL as `scheme://host[:port]`. `new URL(x).origin` returns the
 * string "null" for custom schemes such as app://, so it cannot be used to
 * recognise Theama's own pages.
 */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}
