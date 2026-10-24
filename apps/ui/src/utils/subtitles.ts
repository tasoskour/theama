import { ApiRequestError } from '@/api/client'

const codes = new Set(['subtitle_not_configured', 'subtitle_auth', 'subtitle_forbidden', 'subtitle_quota', 'subtitle_provider_unavailable', 'subtitle_file_unavailable', 'subtitle_stale_result', 'subtitle_invalid_download', 'subtitle_exists', 'subtitle_write_failed'])
export function subtitleErrorKey(error: unknown): string {
  return `subtitles.errors.${error instanceof ApiRequestError && codes.has(error.code) ? error.code : 'generic'}`
}
export const SUBTITLE_LANGUAGES = ['el', 'en', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'tr', 'ar', 'he', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'hu', 'ro', 'bg', 'sr', 'hr', 'uk', 'ja', 'ko', 'zh', 'hi', 'th', 'id', 'vi', 'fa']
export const subtitleProviderName = (id: string): string => id === 'opensubtitles' ? 'OpenSubtitles' : 'SubDL'
