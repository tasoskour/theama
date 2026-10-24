import { z } from 'zod'
import { IsoDate } from './common'
import { MatchCandidate, MatchKind } from './metadata'

export const ProviderIdentity = z.object({
  provider: z.string().min(1).max(80),
  kind: MatchKind,
  externalId: z.string().min(1).max(80),
})
export type ProviderIdentity = z.infer<typeof ProviderIdentity>
export const LibraryIdentities = z.object({ items: z.array(ProviderIdentity) })

export const SaveFavoriteRequest = MatchCandidate.extend({
  ...ProviderIdentity.shape,
  title: z.string().trim().min(1).max(1000),
  posterUrl: z.string().regex(/^\/api\/v1\/artwork\/[a-zA-Z0-9._-]+$/).nullable(),
  rating: z.number().min(0).max(10).nullable().default(null),
})
export type SaveFavoriteRequest = z.infer<typeof SaveFavoriteRequest>
export const FavoriteTitle = SaveFavoriteRequest.extend({ savedAt: IsoDate })
export type FavoriteTitle = z.infer<typeof FavoriteTitle>
export const FavoriteList = z.object({ items: z.array(FavoriteTitle) })
export const RemoveFavoriteResult = z.object({ deleted: z.boolean() })

export function providerIdentityKey(item: ProviderIdentity): string {
  return JSON.stringify([item.provider, item.kind, item.externalId])
}
