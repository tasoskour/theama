import { z } from 'zod'

/** An error the interface caught, sent to the service so it lands in the log history next to everything else. */
export const ClientErrorReport = z.object({
  kind: z.enum(['error', 'unhandledrejection', 'vue']),
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  /** The route the person was on, e.g. `/title`. */
  where: z.string().max(200).optional(),
})
export type ClientErrorReport = z.infer<typeof ClientErrorReport>
