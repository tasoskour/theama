import type { DownloadTool } from '@theama/contracts'
import nordvpn from '@/assets/download-tools/nordvpn.svg'
import qbittorrent from '@/assets/download-tools/qbittorrent.svg'
import prowlarr from '@/assets/download-tools/prowlarr.svg'

/** The apps' own logos, so a button that opens one looks like that app. */
export const toolLogos: Record<DownloadTool, string> = { nordvpn, qbittorrent, prowlarr }
