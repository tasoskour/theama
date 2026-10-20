import { z } from 'zod'
import { CollectionKind } from './collection-ref'
import { TitleSummary } from './titles'

/** `release` is by release date; `custom` is the person's own order (user collections only). */
export const CollectionOrder = z.enum(['release', 'custom'])
export type CollectionOrder = z.infer<typeof CollectionOrder>

export const CollectionSummary = z.object({
  id: z.number().int(),
  kind: CollectionKind,
  name: z.string(),
  overview: z.string().nullable(),
  /** Everything in the collection, local or not. */
  memberCount: z.number().int(),
  /** Members that are in the library (even if their drive is currently offline). */
  localCount: z.number().int(),
  /** The collection's own poster, if the provider has one. */
  posterUrl: z.string().nullable(),
  /** Posters of up to four local members, for a collage when there is no poster. */
  previewPosters: z.array(z.string()),
})
export type CollectionSummary = z.infer<typeof CollectionSummary>

export const CollectionMember = z.object({
  position: z.number().int(),
  /** Set when the member is in the library. A member without a key is a contextual entry: never playable. */
  key: z.string().nullable(),
  /** The title key a user collection stores for this member, even after its files are gone (needed to remove or reorder it). */
  titleKey: z.string().nullable(),
  title: z.string(),
  year: z.number().int().nullable(),
  releaseDate: z.string().nullable(),
  overview: z.string().nullable(),
  posterUrl: z.string().nullable(),
  /** The library card for a local member. */
  summary: TitleSummary.nullable(),
})
export type CollectionMember = z.infer<typeof CollectionMember>

export const CollectionDetail = z.object({
  summary: CollectionSummary,
  backdropUrl: z.string().nullable(),
  /** Which orders make sense for this collection. */
  orders: z.array(CollectionOrder),
  order: CollectionOrder,
  members: z.array(CollectionMember),
})
export type CollectionDetail = z.infer<typeof CollectionDetail>

export const CollectionList = z.object({ items: z.array(CollectionSummary) })
export type CollectionList = z.infer<typeof CollectionList>

export const CollectionListQuery = z.object({
  kind: CollectionKind.optional(),
  /** Words of the name, accents and capitals ignored (the same folding as search). */
  q: z.string().trim().max(200).optional(),
})
export type CollectionListQuery = z.input<typeof CollectionListQuery>

export const CollectionDetailQuery = z.object({ order: CollectionOrder.optional() })
export type CollectionDetailQuery = z.input<typeof CollectionDetailQuery>

const Name = z.string().trim().min(1).max(80)
export const CreateCollectionRequest = z.object({ name: Name, /** Optionally start with this title. */ key: z.string().min(1).max(1000).optional() })
export type CreateCollectionRequest = z.infer<typeof CreateCollectionRequest>

export const RenameCollectionRequest = z.object({ name: Name })
export type RenameCollectionRequest = z.infer<typeof RenameCollectionRequest>

export const AddMemberRequest = z.object({ key: z.string().min(1).max(1000) })
export type AddMemberRequest = z.infer<typeof AddMemberRequest>

/** The complete custom order, as title keys. Keys not in the collection are rejected. */
export const ReorderRequest = z.object({ keys: z.array(z.string().min(1).max(1000)).max(2000) })
export type ReorderRequest = z.infer<typeof ReorderRequest>
