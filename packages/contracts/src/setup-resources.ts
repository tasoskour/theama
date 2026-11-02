import { z } from 'zod'

/** Fixed public destinations used by setup, the browser fallback, and the printable guide. */
export const SETUP_RESOURCES = {
  repository: 'https://github.com/tasoskour/theama',
  tmdbSignup: 'https://www.themoviedb.org/signup',
  tmdbApi: 'https://www.themoviedb.org/settings/api',
  tmdbDocs: 'https://developer.themoviedb.org/docs/getting-started',
  opensubtitles: 'https://www.opensubtitles.com/en/consumers',
  subdl: 'https://subdl.com/panel/api',
  subdlDocs: 'https://subdl.com/api-doc',
  qbittorrent: 'https://www.qbittorrent.org/download',
  qbittorrentOptions: 'https://github.com/qbittorrent/qBittorrent/wiki/Explanation-of-Options-in-qBittorrent',
  searchPlugins: 'https://github.com/qbittorrent/search-plugins/wiki/Install-search-plugins',
  prowlarr: 'https://prowlarr.com/#download',
  prowlarrDocs: 'https://wiki.servarr.com/prowlarr/quick-start-guide',
  nordvpn: 'https://nordvpn.com/download/windows/',
  vlc: 'https://www.videolan.org/vlc/download-windows.html',
  mpcHc: 'https://github.com/clsid2/mpc-hc/releases',
  mpcBe: 'https://github.com/Aleksoid1978/MPC-BE/releases',
  mpv: 'https://mpv.io/installation/',
  potplayer: 'https://potplayer.daum.net/',
  python: 'https://www.python.org/downloads/windows/',
  node: 'https://nodejs.org/en/download',
  git: 'https://git-scm.com/downloads/win',
  yarn: 'https://yarnpkg.com/getting-started/install',
  ffprobe: 'https://www.gyan.dev/ffmpeg/builds/',
  nssm: 'https://nssm.cc/download',
} as const

export const SetupResourceId = z.enum(Object.keys(SETUP_RESOURCES) as [keyof typeof SETUP_RESOURCES, ...(keyof typeof SETUP_RESOURCES)[]])
export type SetupResourceId = z.infer<typeof SetupResourceId>
