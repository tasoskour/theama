import type { z } from 'zod'
import { API_PREFIX, ApiError } from '@theama/contracts'

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

type Query = Record<string, string | number | boolean | undefined>

/**
 * Typed REST client. Every response is parsed with its contract schema, so a
 * server/UI version mismatch fails loudly here rather than deep in a component.
 * In the desktop app the Authorization header is added by the Electron main
 * process; the optional token is only for running the UI in a plain browser.
 */
export class ApiClient {
  constructor(
    private readonly base: string,
    private readonly token?: string,
  ) {}

  get<S extends z.ZodType>(path: string, schema: S, query?: Query): Promise<z.output<S>> {
    return this.request('GET', path, schema, undefined, query)
  }

  /** A plain-text endpoint (the diagnostics report). */
  async getText(path: string): Promise<string> {
    const headers: Record<string, string> = {}
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    const res = await fetch(new URL(`${this.base}${API_PREFIX}${path}`), { headers })
    if (!res.ok) throw new ApiRequestError(`HTTP ${res.status}`, res.status, 'http_error')
    return res.text()
  }

  put<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.output<S>> {
    return this.request('PUT', path, schema, body)
  }

  post<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.output<S>> {
    return this.request('POST', path, schema, body)
  }

  patch<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.output<S>> {
    return this.request('PATCH', path, schema, body)
  }

  delete<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    return this.request('DELETE', path, schema)
  }

  private async request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
    query?: Query,
  ): Promise<z.output<S>> {
    const url = new URL(`${this.base}${API_PREFIX}${path}`)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
    const headers: Record<string, string> = {}
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let res: Response
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (err) {
      throw new ApiRequestError(err instanceof Error ? err.message : 'Network error', 0, 'network')
    }
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const parsed = ApiError.safeParse(json)
      throw new ApiRequestError(
        parsed.success ? parsed.data.error.message : `HTTP ${res.status}`,
        res.status,
        parsed.success ? parsed.data.error.code : 'http_error',
      )
    }
    return schema.parse(json)
  }
}
