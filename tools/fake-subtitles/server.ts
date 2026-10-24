import { createServer, type IncomingHttpHeaders } from 'node:http'
import { zipSync, strToU8 } from 'fflate'

export const SUBTITLE_TEST_KEY = 'subtitle-test-key-123456789'
export const SUBTITLE_TEST_PASSWORD = 'subtitle-test-password-987654321'
export const GREEK_SRT = '1\n00:00:01,000 --> 00:00:03,000\nΚαλημέρα κόσμε!\n'
export interface SubtitleTestRequest { path: string; method: string; query: Record<string, string>; body: Record<string, unknown>; headers: IncomingHttpHeaders }
export async function startFakeSubtitles() {
  const state = {
    requests: [] as SubtitleTestRequest[], mode: 'normal' as 'normal' | 'quota' | 'unavailable' | 'html' | 'multi' | 'unsafe' | 'external',
    expireToken: false, logins: 0, downloads: 0,
    beforeDownload: null as (() => Promise<void>) | null,
  }
  let origin = ''
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, origin)
      let text = ''
      for await (const chunk of req) text += String(chunk)
      const body = text ? JSON.parse(text) as Record<string, unknown> : {}
      state.requests.push({ path: url.pathname, method: req.method!, query: Object.fromEntries(url.searchParams), body, headers: req.headers })
      const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
      if (state.mode === 'quota') return json(429, { message: 'Download limit exceeded' })
      if (state.mode === 'unavailable') return json(503, { message: 'Down' })
      if (url.pathname.startsWith('/file') || url.pathname.startsWith('/subtitle/')) {
        state.downloads++
        if (state.beforeDownload) await state.beforeDownload()
        if (state.mode === 'html') { res.end('<!DOCTYPE html><html>login</html>'); return }
        if (url.pathname.endsWith('.zip') || state.mode === 'multi' || state.mode === 'unsafe') {
          res.setHeader('Content-Type', 'application/zip')
          res.end(zipSync(state.mode === 'unsafe' ? { '../escape.srt': strToU8(GREEK_SRT) } : {
            'release.srt': strToU8(GREEK_SRT), ...(state.mode === 'multi' ? { 'alternative.srt': strToU8(GREEK_SRT.replace('Καλημέρα', 'Καλησπέρα')) } : {}),
          })); return
        }
        res.end(GREEK_SRT); return
      }
      const subdl = url.pathname.startsWith('/subdl/')
      if ((subdl ? url.searchParams.get('api_key') : req.headers['api-key']) !== SUBTITLE_TEST_KEY) return json(403, { message: 'Invalid API key' })
      if (url.pathname.endsWith('/login')) {
        if (body.username !== 'viewer' || body.password !== SUBTITLE_TEST_PASSWORD) return json(401, { message: 'Bad login' })
        state.logins++
        return json(200, { token: `subtitle-token-${state.logins}-123456789`, base_url: 'api.opensubtitles.com' })
      }
      if (state.expireToken && req.headers.authorization) { state.expireToken = false; return json(401, { message: 'Expired' }) }
      if (url.pathname.endsWith('/download')) return json(200, { link: state.mode === 'external' ? 'http://127.0.0.1:9/stolen' : `${origin}/file/release.srt`, file_name: 'release.srt' })
      if (url.pathname.endsWith('/subtitles')) {
        const language = (url.searchParams.get('languages') ?? 'el').toLowerCase()
        const episode = url.searchParams.get('episode_number')
        const release = episode ? `Show.S01E${episode.padStart(2, '0')}.1080p.WEB-DL` : 'Film.2020.1080p.BluRay'
        if (subdl) return json(200, { status: true, subtitles: [
          { release_name: release, language: language === 'el' ? 'Greek' : language, hi: false, full_season: false, url: '/subtitle/release.zip' },
          { release_name: 'Season Pack', language, full_season: true, url: '/subtitle/pack.zip' },
        ] })
        return json(200, { data: [false, true].map((hash, i) => ({ attributes: {
          release: hash ? release : 'Different.Release', language, moviehash_match: hash,
          foreign_parts_only: false, hearing_impaired: false, download_count: 10 + i, ratings: '8.5', files: [{ file_id: i + 1, file_name: 'release.srt' }],
        } })) })
      }
      json(404, {})
    } catch { res.writeHead(500); res.end() }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  origin = `http://127.0.0.1:${address.port}`
  return { state, origin, openSubtitlesBase: `${origin}/os`, subdlBase: `${origin}/subdl`, close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())) }
}
export type FakeSubtitles = Awaited<ReturnType<typeof startFakeSubtitles>>
