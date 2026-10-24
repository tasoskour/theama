import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { z } from 'zod'
import { API_PREFIX, SubtitleCredentialsRequest, SubtitleDownloadRequest, SubtitleLoginRequest, SubtitleProviderId, SubtitleSearchRequest } from '@theama/contracts'
import type { SubtitleService } from './service'

export function registerSubtitleRoutes<L extends FastifyBaseLogger>(app: FastifyInstance<import('node:http').Server, import('node:http').IncomingMessage, import('node:http').ServerResponse, L>, service: SubtitleService): void {
  const ProviderParams = z.object({ provider: SubtitleProviderId })
  const FileParams = z.object({ id: z.coerce.number().int().positive() })
  app.get(`${API_PREFIX}/subtitles/providers`, async () => service.status())
  app.put(`${API_PREFIX}/subtitles/providers/:provider/credentials`, async (req) => {
    const { provider } = ProviderParams.parse(req.params)
    return service.setKey(provider, SubtitleCredentialsRequest.parse(req.body).apiKey)
  })
  app.post(`${API_PREFIX}/subtitles/providers/:provider/test`, async (req) => service.test(ProviderParams.parse(req.params).provider))
  app.post(`${API_PREFIX}/subtitles/opensubtitles/login`, async (req) => {
    const { username, password } = SubtitleLoginRequest.parse(req.body)
    return service.login(username, password)
  })
  app.delete(`${API_PREFIX}/subtitles/opensubtitles/login`, async () => service.logout())
  app.post(`${API_PREFIX}/library/files/:id/subtitles/search`, async (req) => service.search(FileParams.parse(req.params).id, SubtitleSearchRequest.parse(req.body)))
  app.post(`${API_PREFIX}/library/files/:id/subtitles/download`, async (req) => {
    const { resultId, entryId } = SubtitleDownloadRequest.parse(req.body)
    return service.download(FileParams.parse(req.params).id, resultId, entryId)
  })
}
