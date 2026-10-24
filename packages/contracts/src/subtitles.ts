import { z } from 'zod'

export const SubtitleProviderId = z.enum(['opensubtitles', 'subdl'])
export type SubtitleProviderId = z.infer<typeof SubtitleProviderId>
export const SubtitleFormat = z.enum(['srt', 'ass', 'ssa', 'vtt'])
export const SubtitleProviderStatus = z.object({
  id: SubtitleProviderId,
  configured: z.boolean(),
  loggedIn: z.boolean(),
})
export const SubtitleProviders = z.object({ providers: z.array(SubtitleProviderStatus) })
export type SubtitleProviders = z.infer<typeof SubtitleProviders>
export const SubtitleCredentialsRequest = z.object({ apiKey: z.string().trim().min(1).max(2000).nullable() })
export const SubtitleLoginRequest = z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(1000) })
export const SubtitleSearchRequest = z.object({
  provider: SubtitleProviderId,
  language: z.string().regex(/^[a-z]{2}$/),
  title: z.string().trim().min(1).max(200),
})
export type SubtitleSearchRequest = z.infer<typeof SubtitleSearchRequest>
export const SubtitleSearchHit = z.object({
  id: z.string(),
  release: z.string(),
  language: z.string(),
  format: SubtitleFormat.nullable(),
  hashMatch: z.boolean(),
  forced: z.boolean(),
  sdh: z.boolean(),
  downloads: z.number().nullable(),
  rating: z.number().nullable(),
})
export type SubtitleSearchHit = z.infer<typeof SubtitleSearchHit>
export const SubtitleSearchResults = z.object({ results: z.array(SubtitleSearchHit) })
export type SubtitleSearchResults = z.infer<typeof SubtitleSearchResults>
export const SubtitleDownloadRequest = z.object({ resultId: z.string().uuid(), entryId: z.string().optional() })
export const SubtitleDownloadResult = z.discriminatedUnion('state', [
  z.object({ state: z.literal('saved'), fileName: z.string() }),
  z.object({ state: z.literal('select'), files: z.array(z.object({ id: z.string(), fileName: z.string(), format: SubtitleFormat })) }),
])
export type SubtitleDownloadResult = z.infer<typeof SubtitleDownloadResult>
