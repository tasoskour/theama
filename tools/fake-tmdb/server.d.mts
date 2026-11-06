export const GOOD_KEY: string
export const GOOD_TOKEN: string
export interface FakeTmdb {
  /** 'down' = HTTP 500, 'rate' = HTTP 429, 'dead' = connection dropped. */
  mode: 'ok' | 'down' | 'rate' | 'dead'
  requests: { path: string; query: Record<string, string>; auth: string | null }[]
  imageRequests: number
  collectionDelayMs: number
  url: string
  imageUrl: string
  close(): Promise<void>
}
export function startFakeTmdb(options?: { port?: number }): Promise<FakeTmdb>
