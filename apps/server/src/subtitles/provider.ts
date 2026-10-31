import type { SubtitleSearchHit } from '@theama/contracts'

export interface SubtitleQuery {
  path: string
  title: string
  languages: string[]
  kind: 'movie' | 'episode'
  year: number | null
  season: number | null
  episode: number | null
  imdbId: string | null
  tmdbId: string | null
}
export interface SubtitleCandidate extends Omit<SubtitleSearchHit, 'id'> {
  remoteId: string
}
export interface SubtitlePayload { bytes: Uint8Array; fileName: string }
export interface SubtitleProvider {
  test(): Promise<void>
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>
  download(candidate: SubtitleCandidate): Promise<SubtitlePayload>
}
