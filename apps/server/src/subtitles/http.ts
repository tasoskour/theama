import { ApiProblem } from '../library/sources'

export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024

/** Never pass upstream URLs, response bodies or fetch errors to the API/logs: they can contain secrets. */
export async function subtitleFetch(url: URL, init: RequestInit = {}, allowedOrigins = [url.origin]): Promise<Response> {
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      if (!allowedOrigins.includes(url.origin) || url.username || url.password) throw new ApiProblem('subtitle_invalid_download', 'The provider returned an unsupported download address', 502)
      const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location) break
        url = new URL(location, url)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 429 || response.status === 406) throw new ApiProblem('subtitle_quota', 'The subtitle provider limit has been reached. Try again later.', 429)
        if (response.status === 401) throw new ApiProblem('subtitle_auth', 'The subtitle provider did not accept the credentials', 401)
        if (response.status === 403) throw new ApiProblem('subtitle_forbidden', 'The provider rejected the API key or the download allowance is exhausted', 403)
        throw new ApiProblem('subtitle_provider_unavailable', 'The subtitle provider is unavailable. Try again later.', 502)
      }
      return response
    }
  } catch (err) {
    if (err instanceof ApiProblem) throw err
  }
  throw new ApiProblem('subtitle_provider_unavailable', 'The subtitle provider could not be reached. Try again.', 502)
}

export async function boundedBytes(response: Response, limit = MAX_DOWNLOAD_BYTES): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new ApiProblem('subtitle_invalid_download', 'The subtitle download was empty', 502)
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new ApiProblem('subtitle_invalid_download', 'The subtitle download is too large', 502)
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof ApiProblem) throw err
    throw new ApiProblem('subtitle_provider_unavailable', 'The subtitle download was interrupted. Try again.', 502)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

export async function subtitleJson(url: URL, init: RequestInit = {}): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await boundedBytes(await subtitleFetch(url, init), 2 * 1024 * 1024))) as unknown
  } catch (err) {
    if (err instanceof ApiProblem) throw err
    throw new ApiProblem('subtitle_provider_unavailable', 'The subtitle provider returned an invalid response', 502)
  }
}
