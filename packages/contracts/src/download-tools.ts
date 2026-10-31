import { z } from 'zod'

export const DownloadTool = z.enum(['nordvpn', 'qbittorrent', 'prowlarr'])
export type DownloadTool = z.infer<typeof DownloadTool>
export const OpenDownloadToolRequest = z.object({ tool: DownloadTool })

export const VpnState = z.enum(['connected', 'disconnected', 'unknown', 'unsupported'])
export const VpnReason = z.enum(['verified', 'no_tunnel', 'unsupported_tunnel', 'route_mismatch', 'protection_failed', 'check_failed', 'unsupported_platform'])
export const VpnLocation = z.object({ country: z.string(), countryCode: z.string().length(2).nullable(), city: z.string().nullable() })
export type VpnLocation = z.infer<typeof VpnLocation>
export const DownloadToolsStatus = z.object({
  vpn: z.object({ state: VpnState, reason: VpnReason, checkedAt: z.number(), location: VpnLocation.nullish() }),
  tools: z.record(DownloadTool, z.object({ installed: z.boolean(), running: z.boolean().nullable() })),
})
export type DownloadToolsStatus = z.infer<typeof DownloadToolsStatus>

export const OpenDownloadToolResult = z.object({
  ok: z.boolean(),
  code: z.enum(['not_installed', 'launch_failed', 'not_ready', 'unavailable', 'invalid_address']).nullable(),
})
export type OpenDownloadToolResult = z.infer<typeof OpenDownloadToolResult>
