import { z } from 'zod'

/**
 * official: a set the provider publishes (for example a film series). user: made by the person.
 * Sequel chains and universes need curated data Theama does not have; nothing is inferred (docs/03).
 */
export const CollectionKind = z.enum(['official', 'user'])
export type CollectionKind = z.infer<typeof CollectionKind>

export const CollectionRef = z.object({ id: z.number().int(), kind: CollectionKind, name: z.string() })
export type CollectionRef = z.infer<typeof CollectionRef>
